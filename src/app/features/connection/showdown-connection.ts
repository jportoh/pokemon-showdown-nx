import { DestroyRef, Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { Observable, Subject } from 'rxjs';
import { ConnectionState } from './connection.model';
import { RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS, SHOWDOWN_WEBSOCKET_URL } from './showdown-config';
import { ProtocolFrame, parseFrame, splitLine } from './showdown-protocol';

/**
 * The app's single WebSocket connection to the Pokémon Showdown server. Connects on demand,
 * reconnects with backoff when the connection drops, and broadcasts every server message as a
 * parsed frame. Feature stores subscribe to `frames` and filter the rooms they care about.
 */
@Service()
export class ShowdownConnection {
  private readonly stateSignal = signal<ConnectionState>({ status: 'offline', error: null, challstr: null });
  private readonly framesSubject = new Subject<ProtocolFrame>();
  private readonly openedSubject = new Subject<void>();
  private readonly endedSubject = new Subject<void>();
  private readonly render = inject(RenderScheduler);
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  /** Opens the connection if it isn't already open or opening. */
  connect(): void {
    if (this.socket) return;
    if (typeof WebSocket === 'undefined') {
      this.setState({ status: 'error', error: 'WebSocket is not available in this browser.' });
      return;
    }
    this.clearReconnectTimer();
    this.setState({ status: 'connecting', error: null });

    const socket = new WebSocket(SHOWDOWN_WEBSOCKET_URL);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({ status: 'connected', error: null });
      this.openedSubject.next();
    };
    socket.onmessage = (event) => this.handleMessage(String(event.data));
    socket.onerror = () => this.setState({ error: 'Connection error.' });
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setState({ status: 'disconnected', challstr: null });
      this.scheduleReconnect();
    };
  }

  /** Sends `text` to a room. Global commands use an empty room: `send('', '/join lobby')`. */
  send(roomId: string, text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(`${roomId}|${text}`);
  }

  /** Closes the connection for good (until the next `connect()`). */
  disconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState({ status: 'offline', error: null, challstr: null });
    this.endedSubject.next();
  }

  private handleMessage(data: string): void {
    const frame = parseFrame(data);
    for (const line of frame.lines) {
      if (line.startsWith('|challstr|')) {
        this.setState({ challstr: splitLine(line, 1)[1] ?? null });
      }
    }
    this.framesSubject.next(frame);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(changes: Partial<ConnectionState>): void {
    this.stateSignal.update((state) => ({ ...state, ...changes }));
    this.render.request();
  }
}
