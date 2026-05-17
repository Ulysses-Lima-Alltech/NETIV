import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { getSessionUser } from '../repositories/userRepository.js';

const INBOX_GLOBAL_ROOM = 'inbox:global';
const allowedOrigins = String(process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

let io: SocketIOServer | null = null;

export function initSocketServer(server: HttpServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const authToken =
        (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null) ??
        (typeof socket.handshake.query?.access_token === 'string'
          ? socket.handshake.query.access_token
          : null);
      const token = authToken?.trim() ?? '';
      if (!token) {
        return next(new Error('unauthorized'));
      }
      const user = await getSessionUser(token);
      if (!user) {
        return next(new Error('unauthorized'));
      }
      socket.data.userId = user.id;
      socket.data.userRole = user.role;
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(INBOX_GLOBAL_ROOM);
  });

  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function getInboxGlobalRoom(): string {
  return INBOX_GLOBAL_ROOM;
}
