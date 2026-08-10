import { ActionConfig, DeckConfig, ServerState } from '../../../shared/types';

const BACKEND_PORT = 5001;

export function getBackendHost(): string {
  const customIp = localStorage.getItem('webpcdeck_backend_ip');
  if (customIp) {
    return customIp.replace(/^https?:\/\//, '');
  }

  const host = window.location.hostname;
  // Default to localhost if hostname is empty (e.g. file:// protocol in Electron) or local loopback
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'localhost';
  }
  return host;
}

export function getBaseUrl(): string {
  const customIp = localStorage.getItem('webpcdeck_backend_ip');
  if (customIp) {
    if (customIp.startsWith('http://') || customIp.startsWith('https://')) {
      return customIp;
    }
    // If it's a domain name (like ngrok, localtunnel)
    if (customIp.includes('ngrok') || customIp.includes('loca.lt') || customIp.includes('.')) {
      return `https://${customIp}`;
    }
    return `http://${customIp}:${BACKEND_PORT}`;
  }

  const host = window.location.hostname;
  if (
    host &&
    !host.includes('localhost') &&
    !host.includes('127.0.0.1') &&
    !host.startsWith('192.168.') &&
    !host.startsWith('10.') &&
    !host.startsWith('172.')
  ) {
    return window.location.origin;
  }
  return `http://${getBackendHost()}:${BACKEND_PORT}`;
}

export function getWsUrl(): string {
  const token = getPairingToken();
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  const host = getBackendHost();

  if (host.includes('ngrok') || host.includes('loca.lt')) {
    const isSecure = window.location.protocol === 'https:' || localStorage.getItem('webpcdeck_backend_ip')?.startsWith('https');
    const protocol = isSecure ? 'wss' : 'ws';
    return `${protocol}://${host}/ws${tokenParam}`;
  }
  
  return `ws://${host}:${BACKEND_PORT}/ws${tokenParam}`;
}

export function getPairingToken(): string | null {
  return localStorage.getItem('webpcdeck_token');
}

export function setPairingToken(token: string): void {
  localStorage.setItem('webpcdeck_token', token);
}

export function clearPairingToken(): void {
  localStorage.removeItem('webpcdeck_token');
}

// Global headers helper
function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': '1',
  };
  const token = getPairingToken();
  if (token) {
    headers['x-pairing-token'] = token;
  }
  return headers;
}

// REST API calls
export async function getServerState(): Promise<ServerState & { isLocal: boolean }> {
  const res = await fetch(`${getBaseUrl()}/api/state`, {
    headers: { 'ngrok-skip-browser-warning': '1' }
  });
  if (!res.ok) throw new Error('Failed to get server state');
  return res.json();
}

export async function pairWithCode(code: string): Promise<{ success: boolean; token?: string }> {
  const res = await fetch(`${getBaseUrl()}/api/pair`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1'
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.error || 'Failed to pair');
  }
  const data = await res.json();
  if (data.success && data.token) {
    setPairingToken(data.token);
  }
  return data;
}

export async function getDeckConfig(): Promise<DeckConfig> {
  const res = await fetch(`${getBaseUrl()}/api/config`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Unauthorized or failed to fetch config');
  return res.json();
}

export async function saveDeckConfig(config: DeckConfig): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/config`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to save config');
}

export async function triggerAction(action: ActionConfig): Promise<void> {
  const url = `${getBaseUrl()}/api/action`;
  console.log('[DEBUG-Api] triggerAction POSTing to:', url, 'with action:', action);
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(action),
  });
  console.log('[DEBUG-Api] triggerAction response status:', res.status);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Action failed to execute');
  }
}

// WebSocket client connection helper
export class DeckSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onMessageCallback: ((data: any) => void) | null = null;
  private onStatusChangeCallback: ((connected: boolean) => void) | null = null;

  constructor(
    onMessage: (data: any) => void,
    onStatusChange?: (connected: boolean) => void
  ) {
    this.onMessageCallback = onMessage;
    if (onStatusChange) this.onStatusChangeCallback = onStatusChange;
    this.connect();
  }

  connect() {
    if (this.socket) {
      this.socket.close();
    }

    try {
      this.socket = new WebSocket(getWsUrl());

      this.socket.onopen = () => {
        console.log('WebSocket connected to backend');
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.onMessageCallback) this.onMessageCallback(data);
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      this.socket.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 3s...');
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(false);
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        if (this.socket) this.socket.close();
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    }
  }

  // Note: Client-to-server WS action triggers are retired.
  // We now use HTTP POST directly (via triggerAction HTTP helper) to execute actions.
  // The WebSocket is strictly used for server-to-client pushed config synchronization.

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
  }
}
