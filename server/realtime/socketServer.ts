import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { findEmbeddedDefaultUser, getSessionUser } from '../repositories/userRepository.js';

const INBOX_GLOBAL_ROOM = 'inbox:global';
const SOCKET_PATH = '/socket.io';
const allowedOrigins = String(process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

let io: SocketIOServer | null = null;
let realtimeEnabled = false;

function isAuthBypassEnabled(): boolean {
  const raw = String(process.env.AUTH_BYPASS_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseCookieValue(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== key) continue;
    const value = rest.join('=').trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function resolveHandshakeToken(socket: Socket): string | null {
  const authToken =
    (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null) ??
    (typeof socket.handshake.query?.access_token === 'string'
      ? socket.handshake.query.access_token
      : null);
  if (authToken && authToken.trim().length > 0) return authToken.trim();

  const cookieToken =
    parseCookieValue(socket.handshake.headers.cookie, 'auth_token') ??
    parseCookieValue(socket.handshake.headers.cookie, 'access_token') ??
    parseCookieValue(socket.handshake.headers.cookie, 'session_token');
  if (cookieToken && cookieToken.trim().length > 0) return cookieToken.trim();

  return null;
}

export function initSocketServer(server: HttpServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(server, {
    path: SOCKET_PATH,
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = resolveHandshakeToken(socket);
      if (token) {
        const user = await getSessionUser(token);
        if (!user) {
          console.warn('[realtime] unauthorized_invalid_credentials');
          return next(new Error('unauthorized'));
        }
        socket.data.userId = user.id;
        socket.data.userRole = user.role;
        return next();
      }

      if (isAuthBypassEnabled()) {
        const embeddedUser = await findEmbeddedDefaultUser();
        if (!embeddedUser) {
          console.warn('[realtime] unauthorized_missing_credentials');
          return next(new Error('unauthorized'));
        }
        socket.data.userId = embeddedUser.id;
        socket.data.userRole = embeddedUser.role;
        return next();
      }

      console.warn('[realtime] unauthorized_missing_credentials');
      return next(new Error('unauthorized'));
    } catch (error) {
      console.warn('[realtime] unauthorized_invalid_credentials');
      return next(error instanceof Error ? error : new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(INBOX_GLOBAL_ROOM);
    console.info('[realtime] socket connected', {
      userId: socket.data.userId ?? null,
      userRole: socket.data.userRole ?? null,
      socketId: socket.id,
    });
    socket.on('disconnect', (reason) => {
      console.info('[realtime] socket disconnected', {
        userId: socket.data.userId ?? null,
        userRole: socket.data.userRole ?? null,
        socketId: socket.id,
        reason,
      });
    });
  });

  return io;
}

export function setRealtimeEnabled(value: boolean): void {
  realtimeEnabled = value;
}

export function isRealtimeEnabled(): boolean {
  return realtimeEnabled;
}

export function getSocketPath(): string {
  return SOCKET_PATH;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function getInboxGlobalRoom(): string {
  return INBOX_GLOBAL_ROOM;
}
