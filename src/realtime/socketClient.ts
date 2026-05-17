import { io, type Socket } from 'socket.io-client';
import { getStoredAuthToken } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== ''
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : window.location.origin;

let socket: Socket | null = null;

export function getInboxSocket(): Socket {
  if (socket) return socket;
  const token = getStoredAuthToken() ?? '';
  socket = io(API_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: true,
    auth: { token },
    query: { access_token: token },
    withCredentials: true,
  });
  return socket;
}

export function refreshInboxSocketAuth(): void {
  if (!socket) return;
  const token = getStoredAuthToken() ?? '';
  socket.auth = { token };
  socket.io.opts.query = { access_token: token };
}
