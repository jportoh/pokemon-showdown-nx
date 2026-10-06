import { DestroyRef, Service, inject, signal } from '@angular/core';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { Observable, Subject } from 'rxjs';
import { ConnectionState } from './connection.model';
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_COMMAND,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  SHOWDOWN_WEBSOCKET_URL,
  UNREACHABLE_AFTER_ATTEMPTS,
} from './showdown-config';
import { ProtocolFrame, parseFrame, splitLine } from './showdown-protocol';

/** How often the heartbeat checks the connection's silence. */
const HEARTBEAT_TICK_MS = 5000;

/**
 * The app's single WebSocket connection to the Pokémon Showdown server. Connects on demand,
 * reconnects with backoff when the connection drops, and broadcasts every server message as a
 * parsed frame. Feature stores subscribe to `frames` and filter the rooms they care about.
 * A drop isn't always told: an attempt that never opens is given up after CONNECT_TIMEOUT_MS, and an
 * open connection that goes quiet is asked something small (the heartbeat) and dropped if it doesn't
 * answer. Attempts that keep failing say why (`trouble`): no network, as the device tells it
 * (`navigator.onLine` and its events, where the engine has them), or Showdown out of reach.
 */
@Service()
export class ShowdownConnection {
  private readonly stateSignal = signal<ConnectionState>({ status: 'offline', error: null, challstr: null, trouble: null, retryAt: null });
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

  readonly state = this.stateSignal.asReadonly();
  readonly frames: Observable<ProtocolFrame> = this.framesSubject.asObservable();
  /**
   * Emits each time the socket opens (including reconnections). Room joins belong here rather than
   * in an effect on `state`: effects only run when Angular renders, which is exactly what stalled on Brewser.
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
    inject(DestroyRef).onDestroy(() => {
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
    this.setState({ status: 'connecting', error: null, retryAt: null });

    let socket: WebSocket;
    try {
      socket = new WebSocket(SHOWDOWN_WEBSOCKET_URL);
    } catch {
      this.onAttemptFailed();
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket === socket && socket.readyState !== WebSocket.OPEN) this.drop(socket);
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.reconnectAttempts = 0;
      this.failedAttempts = 0;
      this.lastMessageAt = Date.now();
      this.heartbeatSentAt = 0;
      this.startHeartbeat();
      this.setState({ status: 'connected', error: null, trouble: null });
      this.openedSubject.next();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.heartbeatSentAt = 0;
      this.handleMessage(String(event.data));
    };
    socket.onerror = () => {
      if (this.socket === socket) this.setState({ error: 'Connection error.' });
    };
    socket.onclose = () => {
      if (this.socket === socket) this.drop(socket);
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
    if (this.socket) this.drop(this.socket, false);
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
    this.setState({ status: 'offline', error: null, challstr: null, trouble: null, retryAt: null });
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
    // With what every store did with it (the L3 diagnostics).
    this.diagnostics.record('socket', performance.now() - started);
  }

  /**
   * The socket is gone (closed, never opened, or silent): forgotten, so whatever it still sends is
   * ignored, and a reconnection scheduled unless one is about to start anyway (`reconnect` false).
   */
  private drop(socket: WebSocket, reconnect = true): void {
    if (this.socket !== socket) return;
    const opened = this.stateSignal().status === 'connected';
    this.socket = null;
    this.clearConnectTimer();
    this.stopHeartbeat();
    closeQuietly(socket);
    if (opened) this.setState({ status: 'disconnected', challstr: null });
    else this.onAttemptFailed(false);
    if (reconnect) this.scheduleReconnect();
  }

  /** An attempt that never opened: after a few in a row, the state says why (`trouble`). */
  private onAttemptFailed(reconnect = true): void {
    this.failedAttempts++;
    const trouble = isDeviceOffline() ? 'no-network' : this.failedAttempts >= UNREACHABLE_AFTER_ATTEMPTS ? 'unreachable' : null;
    this.setState({ status: 'disconnected', challstr: null, trouble: trouble ?? this.stateSignal().trouble });
    if (reconnect) this.scheduleReconnect();
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
