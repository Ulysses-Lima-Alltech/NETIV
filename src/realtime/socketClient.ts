import { io, type Socket } from 'socket.io-client';
import { getStoredAuthToken } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== ''
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : window.location.origin;

let socket: Socket | null = null;
let realtimeLogged = false;
const realtimeEnabled = String(import.meta.env.VITE_REALTIME_ENABLED ?? '').trim().toLowerCase() === 'true';

function buildSocketAuthOptions(): {
  auth?: { token: string };
  query?: { access_token: string };
  authMode: 'token' | 'cookie';
} {
  const token = getStoredAuthToken()?.trim() ?? '';
  if (token.length > 0) {
    return {
      auth: { token },
      query: { access_token: token },
      authMode: 'token',
    };
  }
  return { authMode: 'cookie' };
}

export function getInboxSocket(): Socket | null {
  if (!realtimeEnabled) {
    if (!realtimeLogged) {
      console.info('[Realtime] disabled');
      realtimeLogged = true;
    }
    return null;
  }
  if (socket) return socket;
  console.info('[Realtime] enabled');
  const authOptions = buildSocketAuthOptions();
  console.info('[realtime] socket init', {
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
    ...(authOptions.query ? { query: authOptions.query } : {}),
    withCredentials: true,
  });
  socket.on('connect', () => {
    console.info('[realtime] socket connected', { socketId: socket?.id ?? null });
  });
  socket.on('connect_error', (error) => {
    console.warn('[realtime] socket connect_error', { message: error.message });
  });
  socket.on('disconnect', (reason) => {
    console.info('[realtime] socket disconnected', { reason });
  });
  return socket;
}

export function refreshInboxSocketAuth(): void {
  if (!realtimeEnabled) return;
  if (!socket) return;
  const authOptions = buildSocketAuthOptions();
  if (authOptions.auth) socket.auth = authOptions.auth;
  else socket.auth = {};
  if (authOptions.query) socket.io.opts.query = authOptions.query;
  else socket.io.opts.query = {};
}

export function isRealtimeClientEnabled(): boolean {
  return realtimeEnabled;
}
