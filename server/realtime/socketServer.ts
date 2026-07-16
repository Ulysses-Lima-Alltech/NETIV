import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { getSessionUser } from '../repositories/userRepository.js';

const INBOX_GLOBAL_ROOM = 'inbox:global';
const SOCKET_PATH = '/socket.io';
const allowedOrigins = String(process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

let io: SocketIOServer | null = null;
let realtimeEnabled = false;

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
    (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null);
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
      origin: allowedOrigins.length > 0 ? allowedOrigins : process.env.NODE_ENV !== 'production',
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = resolveHandshakeToken(socket);
      if (token) {
        const user = await getSessionUser(token);
        if (!user || user.must_change_password) {
          console.warn('[realtime] unauthorized_invalid_credentials');
          return next(new Error('unauthorized'));
        }
        socket.data.userId = user.id;
        socket.data.userRole = user.role;
        socket.data.sessionScope = user.sessionScope ?? null;
        socket.data.sessionToken = token;
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

export function disconnectUserSockets(userId: number, reason = 'session_revoked'): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === userId) {
      socket.emit('auth.revoked', { reason });
      socket.disconnect(true);
    }
  }
}

export function disconnectSessionSockets(token: string, reason = 'session_revoked'): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionToken === token) {
      socket.emit('auth.revoked', { reason });
      socket.disconnect(true);
    }
  }
}

export async function closeSocketServerForTests(): Promise<void> {
  if (!io) return;
  const current = io;
  io = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}
