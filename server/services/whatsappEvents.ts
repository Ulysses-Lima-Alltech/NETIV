import type { Request, Response } from 'express';
import { getSessionUser } from '../repositories/userRepository.js';
import { canAccessConversation } from './authorizationService.js';

export type WhatsAppEventType = 'message.created' | 'message.updated' | 'conversation.updated';

export interface WhatsAppEventEnvelope<T = Record<string, unknown>> {
  type: WhatsAppEventType;
  payload: T;
}

type Client = {
  id: number;
  res: Response;
  token: string;
  userId: number;
  validating: boolean;
};

let nextClientId = 1;
const clients = new Map<number, Client>();

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerWhatsAppEventsSse(req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const id = nextClientId++;
  const token = String((req as Request & { authToken?: string }).authToken ?? '');
  const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
  if (!token || !Number.isSafeInteger(userId) || userId < 1) {
    res.end();
    return;
  }
  const client: Client = { id, res, token, userId, validating: false };
  clients.set(id, client);
  writeSse(res, 'ready', { ok: true });

  const keepAlive = setInterval(() => {
    if (client.validating) return;
    client.validating = true;
    void getSessionUser(client.token)
      .then((user) => {
        if (!user || user.must_change_password) {
          disconnectClient(client);
          return;
        }
        writeSse(res, 'ping', { ts: Date.now() });
      })
      .catch(() => disconnectClient(client))
      .finally(() => { client.validating = false; });
  }, 25000);

  const close = () => {
    clearInterval(keepAlive);
    clients.delete(id);
  };

  res.on('close', close);
  res.on('finish', close);
}

function disconnectClient(client: Client): void {
  clients.delete(client.id);
  if (!client.res.writableEnded) client.res.end();
}

export function disconnectSseSession(token: string): void {
  if (!token) return;
  for (const client of [...clients.values()]) {
    if (client.token === token) disconnectClient(client);
  }
}

export function disconnectSseUser(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) return;
  for (const client of [...clients.values()]) {
    if (client.userId === userId) disconnectClient(client);
  }
}

export function getSseConnectionCountForTests(): number {
  return clients.size;
}

export function emitWhatsAppEvent<T = Record<string, unknown>>(type: WhatsAppEventType, payload: T): void {
  const envelope: WhatsAppEventEnvelope<T> = { type, payload };
  for (const client of clients.values()) {
    void (async () => {
      const user = client.token ? await getSessionUser(client.token) : null;
      if (!user || user.must_change_password) {
        disconnectClient(client);
        return;
      }
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const rawConversationId = record.conversationId ?? (type === 'conversation.updated' ? record.id : null);
      const conversationId = Number(rawConversationId);
      if (Number.isSafeInteger(conversationId) && conversationId > 0) {
        if (await canAccessConversation(user, conversationId)) writeSse(client.res, type, envelope);
      } else if (user.role === 'ADMIN') {
        writeSse(client.res, type, envelope);
      }
    })().catch(() => {
      disconnectClient(client);
    });
  }
}
