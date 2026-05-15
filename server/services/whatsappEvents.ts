import type { Request, Response } from 'express';

export type WhatsAppEventType = 'message.created' | 'message.updated' | 'conversation.updated';

export interface WhatsAppEventEnvelope<T = Record<string, unknown>> {
  type: WhatsAppEventType;
  payload: T;
}

type Client = {
  id: number;
  res: Response;
};

let nextClientId = 1;
const clients = new Map<number, Client>();

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerWhatsAppEventsSse(_req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const id = nextClientId++;
  const client: Client = { id, res };
  clients.set(id, client);
  writeSse(res, 'ready', { ok: true });

  const keepAlive = setInterval(() => {
    writeSse(res, 'ping', { ts: Date.now() });
  }, 25000);

  const close = () => {
    clearInterval(keepAlive);
    clients.delete(id);
  };

  res.on('close', close);
  res.on('finish', close);
}

export function emitWhatsAppEvent<T = Record<string, unknown>>(type: WhatsAppEventType, payload: T): void {
  const envelope: WhatsAppEventEnvelope<T> = { type, payload };
  for (const client of clients.values()) {
    writeSse(client.res, type, envelope);
  }
}
