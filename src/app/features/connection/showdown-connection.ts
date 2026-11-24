import { DestroyRef, Service, inject, signal } from '@angular/core';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { Observable, Subject } from 'rxjs';
import { ConnectionAttempt, ConnectionState } from './connection.model';
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_COMMAND,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_TIMEOUT_MS,
  PROBE_EVERY_MS,
  PROBE_TIMEOUT_MS,
  PROBE_URL,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  SHOWDOWN_WEBSOCKET_URL,
  UNREACHABLE_AFTER_ATTEMPTS,
} from './showdown-config';
import { ProtocolFrame, parseFrame, splitLine } from './showdown-protocol';

/** How often the heartbeat checks the connection's silence. */
const HEARTBEAT_TICK_MS = 5000;
/** The attempts kept for the diagnostics. */
const ATTEMPTS_KEPT = 6;

/** Why a socket is let go. */
type DropReason = 'timeout' | 'closed' | 'abandoned' | 'silent';

/**
 * The app's single WebSocket connection to the Pokémon Showdown server. Connects on demand,
 * reconnects with backoff when the connection drops, and broadcasts every server message as a
 * parsed frame. Feature stores subscribe to `frames` and filter the rooms they care about.
 * A drop isn't always told: an attempt that never opens is given up after CONNECT_TIMEOUT_MS, and an
 * open connection that goes quiet is asked something small (the heartbeat) and dropped if it doesn't
 * answer. Attempts that keep failing say why (`trouble`): no network, as the device tells it
 * (`navigator.onLine` and its events, where the engine has them), or Showdown out of reach, and then
 * whether its website still answers (the probe), to tell the internet or Showdown being down from
 * only its battle server not answering. The last attempts and the probe show on L3 + R3.
 */
@Service()
export class ShowdownConnection {
  private readonly stateSignal = signal<ConnectionState>({ status: 'offline', error: null, challstr: null, trouble: null, retryAt: null, attempt: 1, attemptSince: null });
  private readonly framesSubject = new Subject<ProtocolFrame>();
  private readonly openedSubject = new Subject<void>();
  private readonly endedSubject = new Subject<void>();
  private readonly render = inject(RenderScheduler);
  private readonly diagnostics = inject(GlDiagnostics);
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  /** Attempts in a row that never opened. */
  private failedAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** When the last message came, and when the heartbeat's question went out (0: none waiting). */
  private lastMessageAt = 0;
  private heartbeatSentAt = 0;
  /** The last attempts, newest last (the diagnostics), and the one under way. */
  private readonly attempts: ConnectionAttempt[] = [];
  private attemptNow: ConnectionAttempt | null = null;
  /** The website's last answer to the probe (or its silence), and whether one is out. */
  private probe: { at: number; ok: boolean; ms: number } | null = null;
  private probing = false;

  readonly state = this.stateSignal.asReadonly();
  readonly frames: Observable<ProtocolFrame> = this.framesSubject.asObservable();
  /**
   * Emits each time the socket opens (including reconnections). Room joins belong here rather than
   * in an effect on `state`: effects only run when Angular renders, which is exactly what stalled on the console.
   */
  readonly opened: Observable<void> = this.openedSubject.asObservable();
  /** Emits when the connection is closed on purpose (`disconnect()`): no reconnection follows. */
  readonly ended: Observable<void> = this.endedSubject.asObservable();

  constructor() {
    const online = () => this.onNetworkBack();
    const offline = () => this.onNetworkLost();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
    }
    this.diagnostics.connection = () => this.diagnosticLines();
    inject(DestroyRef).onDestroy(() => {
      this.diagnostics.connection = () => [];
      this.disconnect();
      window.removeEventListener?.('online', online);
      window.removeEventListener?.('offline', offline);
    });
  }

  /** Opens the connection if it isn't already open or opening. */
  connect(): void {
    if (this.socket) return;
    if (typeof WebSocket === 'undefined') {
      this.setState({ status: 'error', error: 'WebSocket is not available in this browser.' });
      return;
    }
    this.clearReconnectTimer();
    const now = Date.now();
    this.setState({ status: 'connecting', error: null, retryAt: null, attempt: this.failedAttempts + 1, attemptSince: now });
    this.attemptNow = { at: now, outcome: 'opening', ms: 0 };
    this.attempts.push(this.attemptNow);
    if (this.attempts.length > ATTEMPTS_KEPT) this.attempts.shift();

    let socket: WebSocket;
    try {
      socket = new WebSocket(SHOWDOWN_WEBSOCKET_URL);
    } catch {
      this.endAttempt('closed');
      this.onAttemptFailed();
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket === socket && socket.readyState !== WebSocket.OPEN) this.drop(socket, true, 'timeout');
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.endAttempt('opened');
      this.reconnectAttempts = 0;
      this.failedAttempts = 0;
      this.lastMessageAt = Date.now();
      this.heartbeatSentAt = 0;
      this.startHeartbeat();
      this.setState({ status: 'connected', error: null, trouble: null, attempt: 1, attemptSince: null });
      this.openedSubject.next();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.heartbeatSentAt = 0;
      this.handleMessage(String(event.data));
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      if (this.attemptNow) this.attemptNow.error = true;
      this.setState({ error: 'Connection error.' });
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.drop(socket, true, 'closed', event?.code);
    };
  }

  /** Sends `text` to a room. Global commands use an empty room: `send('', '/join lobby')`. */
  send(roomId: string, text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(`${roomId}|${text}`);
  }

  /** While a reconnection waits (or an attempt hangs): tries again right away, from the shortest wait. */
  retryNow(): void {
    const status = this.stateSignal().status;
    if (status === 'offline' || status === 'connected' || status === 'error') return;
    this.reconnectAttempts = 0;
    if (this.socket) this.drop(this.socket, false, 'abandoned');
    this.connect();
  }

  /** Closes the connection for good (until the next `connect()`). */
  disconnect(): void {
    this.clearReconnectTimer();
    this.clearConnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;
    this.failedAttempts = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket) closeQuietly(socket);
    this.attemptNow = null;
    this.setState({ status: 'offline', error: null, challstr: null, trouble: null, retryAt: null, attempt: 1, attemptSince: null });
    this.endedSubject.next();
  }

  private handleMessage(data: string): void {
    const started = performance.now();
    const frame = parseFrame(data);
    for (const line of frame.lines) {
      if (line.startsWith('|challstr|')) {
        this.setState({ challstr: splitLine(line, 1)[1] ?? null });
      }
    }
    this.framesSubject.next(frame);
    // With what every store did with it (the L3 + R3 diagnostics).
    this.diagnostics.record('socket', performance.now() - started);
  }

  /**
   * The socket is gone (closed, never opened, or silent): forgotten, so whatever it still sends is
   * ignored, and a reconnection scheduled unless one is about to start anyway (`reconnect` false).
   */
  private drop(socket: WebSocket, reconnect = true, reason: DropReason = 'silent', code?: number): void {
    if (this.socket !== socket) return;
    const opened = this.stateSignal().status === 'connected';
    this.socket = null;
    this.clearConnectTimer();
    this.stopHeartbeat();
    closeQuietly(socket);
    if (opened) {
      this.dropOpened(code);
      this.setState({ status: 'disconnected', challstr: null, attemptSince: null });
    } else {
      this.endAttempt(reason === 'silent' ? 'timeout' : reason, code);
      this.onAttemptFailed(false);
    }
    if (reconnect) this.scheduleReconnect();
  }

  /**
   * An attempt that never opened: after a few in a row, the state says why (`trouble`), first as
   * unreachable, then as what the website's answer tells (the probe).
   */
  private onAttemptFailed(reconnect = true): void {
    this.failedAttempts++;
    const known = this.stateSignal().trouble;
    let trouble = known;
    if (isDeviceOffline()) trouble = 'no-network';
    else if (this.failedAttempts >= UNREACHABLE_AFTER_ATTEMPTS) {
      trouble = known === 'showdown-down' || known === 'server-only' ? known : 'unreachable';
      this.probeWebsite();
    }
    this.setState({ status: 'disconnected', challstr: null, trouble, attempt: this.failedAttempts + 1, attemptSince: null });
    if (reconnect) this.scheduleReconnect();
  }

  /** The attempt under way is over: how, and after how long. */
  private endAttempt(outcome: ConnectionAttempt['outcome'], code?: number): void {
    const attempt = this.attemptNow;
    if (!attempt) return;
    attempt.outcome = outcome;
    attempt.ms = Date.now() - attempt.at;
    if (code !== undefined) attempt.code = code;
    if (outcome !== 'opened') this.attemptNow = null;
  }

  /** The open connection went: its attempt is marked dropped (with the code), the connection's life as its time. */
  private dropOpened(code?: number): void {
    const attempt = this.attemptNow;
    this.attemptNow = null;
    if (!attempt) return;
    attempt.outcome = 'dropped';
    attempt.ms = Date.now() - attempt.at;
    if (code !== undefined) attempt.code = code;
  }

  /**
   * Asks Showdown's website for a small file, to tell why the battle server doesn't answer: if the
   * website does, the internet is fine and only the server isn't (`server-only`); if it doesn't either,
   * the internet or Showdown is down (`showdown-down`). At most every PROBE_EVERY_MS.
   */
  private probeWebsite(): void {
    if (this.probing || (this.probe && Date.now() - this.probe.at < PROBE_EVERY_MS)) {
      // A recent answer still says it.
      if (this.probe && !this.probing) this.applyProbe(this.probe.ok);
      return;
    }
    this.probing = true;
    const started = Date.now();
    void reachable(PROBE_URL, PROBE_TIMEOUT_MS).then((ok) => {
      this.probing = false;
      this.probe = { at: Date.now(), ok, ms: Date.now() - started };
      this.applyProbe(ok);
    });
  }

  private applyProbe(ok: boolean): void {
    const state = this.stateSignal();
    if (state.status === 'connected' || state.status === 'offline' || state.trouble === 'no-network') return;
    this.setState({ trouble: ok ? 'server-only' : 'showdown-down' });
  }

  /**
   * The diagnostics' (L3 + R3) connection lines: the state, the last attempts ("14 s ago: timeout after 10.0 s", "closed
   * 1006 after 0.3 s", "opened in 0.5 s") and the website's answer to the probe.
   */
  private diagnosticLines(): string[] {
    const now = Date.now();
    const state = this.stateSignal();
    const ago = (at: number) => `${Math.max(0, Math.round((now - at) / 1000))} s ago`;
    const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const describe = (a: ConnectionAttempt): string => {
      const code = a.code !== undefined ? ` ${a.code}` : '';
      const error = a.error ? ' (error)' : '';
      switch (a.outcome) {
        case 'opening':
          return `opening for ${secs(now - a.at)}${error}`;
        case 'opened':
          return `opened in ${secs(a.ms)}`;
        case 'dropped':
          return `dropped${code} after ${secs(a.ms)} open${error}`;
        default:
          return `${a.outcome}${code} after ${secs(a.ms)}${error}`;
      }
    };
    const lines = [`Showdown: ${state.status}${state.trouble ? ` · ${state.trouble}` : ''}${state.status !== 'connected' ? ` · attempt ${state.attempt}` : ''}`];
    const recent = this.attempts.slice(-4).reverse();
    for (let i = 0; i < recent.length; i += 2) {
      lines.push(recent.slice(i, i + 2).map((a) => `${ago(a.at)}: ${describe(a)}`).join(' · '));
    }
    if (this.probing) lines.push('Website check: asking…');
    else if (this.probe) lines.push(`Website check ${ago(this.probe.at)}: ${this.probe.ok ? `answered in ${secs(this.probe.ms)}` : `no answer (${secs(this.probe.ms)})`}`);
    return lines;
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.setState({ retryAt: Date.now() + delay });
  }

  /** The device says its network is back: a reconnection waiting starts now. */
  private onNetworkBack(): void {
    if (this.stateSignal().trouble === 'no-network') this.setState({ trouble: null });
    if (this.reconnectTimer !== null) this.retryNow();
  }

  /** The device says its network is gone: an open connection is checked at once rather than trusted. */
  private onNetworkLost(): void {
    if (this.stateSignal().status === 'connected') this.sendHeartbeat();
    else if (this.stateSignal().status !== 'offline') this.setState({ trouble: 'no-network' });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      const now = Date.now();
      if (this.heartbeatSentAt && now - this.heartbeatSentAt >= HEARTBEAT_TIMEOUT_MS) this.drop(socket);
      else if (!this.heartbeatSentAt && now - this.lastMessageAt >= HEARTBEAT_IDLE_MS) this.sendHeartbeat();
    }, HEARTBEAT_TICK_MS);
  }

  private sendHeartbeat(): void {
    if (this.heartbeatSentAt) return;
    this.heartbeatSentAt = Date.now();
    this.send('', HEARTBEAT_COMMAND);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatSentAt = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private setState(changes: Partial<ConnectionState>): void {
    this.stateSignal.update((state) => ({ ...state, ...changes }));
    this.render.request();
  }
}

/** The device says it has no network. Engines without `navigator.onLine` never say so. */
function isDeviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Closes a socket we're done with: its handlers are cleared first, so nothing it does later reaches us. */
function closeQuietly(socket: WebSocket): void {
  socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
  try {
    socket.close();
  } catch {
    // Closing a socket still connecting can throw on some engines: it's forgotten either way.
  }
}

/**
 * Whether `url` answers within `timeoutMs`: any answer counts (no-cors: an opaque one is enough), only
 * a network failure or silence doesn't. Never throws.
 */
async function reachable(url: string, timeoutMs: number): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(false);
    }, timeoutMs);
  });
  const request = fetch(`${url}?t=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: controller?.signal }).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
