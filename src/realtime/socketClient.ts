import { io, type Socket } from 'socket.io-client';
import { AUTH_UNAUTHORIZED_EVENT, getStoredAuthToken } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== ''
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : window.location.origin;

let socket: Socket | null = null;
let realtimeLogged = false;
const realtimeEnabled = String(import.meta.env.VITE_REALTIME_ENABLED ?? '').trim().toLowerCase() === 'true';

function buildSocketAuthOptions(): {
  auth?: { token: string };
  authMode: 'token' | 'cookie';
} {
  const token = getStoredAuthToken()?.trim() ?? '';
  if (token.length > 0) {
    return {
      auth: { token },
      authMode: 'token',
    };
  }
  return { authMode: 'cookie' };
}

export function getInboxSocket(): Socket | null {
  if (!realtimeEnabled) {
    if (!realtimeLogged) {
      console.info('[RealtimeInbox] socket disabled by env', {
        VITE_REALTIME_ENABLED: String(import.meta.env.VITE_REALTIME_ENABLED ?? ''),
      });
      realtimeLogged = true;
    }
    return null;
  }
  if (socket) return socket;
  console.info('[RealtimeInbox] enabled flag', {
    VITE_REALTIME_ENABLED: String(import.meta.env.VITE_REALTIME_ENABLED ?? ''),
  });
  const authOptions = buildSocketAuthOptions();
  console.info('[RealtimeInbox] socket init', {
    apiUrl: API_URL,
    authMode: authOptions.authMode,
  });
  socket = io(API_URL, {
    path: '/socket.io',
    autoConnect: true,
    // Deixa o Engine.IO negociar transporte de forma automática (polling -> websocket upgrade quando possível).
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    ...(authOptions.auth ? { auth: authOptions.auth } : {}),
    withCredentials: true,
  });
  socket.on('connect', () => {
    console.info('[RealtimeInbox] socket connected', { socketId: socket?.id ?? null });
  });
  socket.on('connect_error', (error) => {
    console.warn('[RealtimeInbox] socket connect_error', { message: error.message });
  });
  socket.on('disconnect', (reason) => {
    console.info('[RealtimeInbox] socket disconnected', { reason });
  });
  socket.on('auth.revoked', (payload?: { reason?: string }) => {
    if (payload?.reason === 'password_changed') return;
    window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
  });
  return socket;
}

export function refreshInboxSocketAuth(): void {
  if (!realtimeEnabled) return;
  if (!socket) return;
  const authOptions = buildSocketAuthOptions();
  if (authOptions.auth) socket.auth = authOptions.auth;
  else socket.auth = {};
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

export function disconnectInboxSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export function reconnectInboxSocket(): void {
  if (!realtimeEnabled || !getStoredAuthToken()) return;
  disconnectInboxSocket();
  getInboxSocket();
}

export function isRealtimeClientEnabled(): boolean {
  return realtimeEnabled;
}
