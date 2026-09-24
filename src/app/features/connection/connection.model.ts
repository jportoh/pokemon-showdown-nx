export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  challstr: string | null;
}
