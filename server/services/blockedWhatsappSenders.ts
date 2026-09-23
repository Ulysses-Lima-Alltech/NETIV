import { createHash } from 'crypto';
import type { WebhookMessage, WebhookPayload } from '../types/webhook.js';

export const NETIV_BLOCKED_WHATSAPP_SENDERS_ENV = 'NETIV_BLOCKED_WHATSAPP_SENDERS';

export interface BlockedWhatsappSenderAudit {
  messageIdHash: string | null;
  senderTail: string | null;
  senderHash: string | null;
  type: string | null;
}

export interface BlockedWhatsappSenderFilterResult {
  payload: WebhookPayload | null;
  blockedCount: number;
  audit: BlockedWhatsappSenderAudit[];
}

export function normalizeWhatsappSender(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function getBlockedWhatsappSenders(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = String(env[NETIV_BLOCKED_WHATSAPP_SENDERS_ENV] ?? '');
  return new Set(
    raw
      .split(/[,\s;]+/)
      .map((value) => normalizeWhatsappSender(value))
      .filter((value): value is string => !!value)
  );
}

export function isBlockedWhatsappSender(
  sender: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const normalizedSender = normalizeWhatsappSender(sender);
  return !!normalizedSender && getBlockedWhatsappSenders(env).has(normalizedSender);
}

function senderTail(sender: string | null | undefined): string | null {
  const normalized = normalizeWhatsappSender(sender);
  return normalized ? normalized.slice(-4) : null;
}

function senderHash(sender: string | null | undefined): string | null {
  const normalized = normalizeWhatsappSender(sender);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function auditHash(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function auditForMessage(message: WebhookMessage): BlockedWhatsappSenderAudit {
  return {
    messageIdHash: auditHash(message.id),
    senderTail: senderTail(message.from),
    senderHash: senderHash(message.from),
    type: message.type ?? null,
  };
}

export function filterBlockedWhatsappSenderMessages(
  payload: WebhookPayload,
  env: NodeJS.ProcessEnv = process.env
): BlockedWhatsappSenderFilterResult {
  const blocked = getBlockedWhatsappSenders(env);
  if (blocked.size === 0 || payload.object !== 'whatsapp_business_account') {
    return { payload, blockedCount: 0, audit: [] };
  }

  let blockedCount = 0;
  let keptMessages = 0;
  const audit: BlockedWhatsappSenderAudit[] = [];

  const entry = (payload.entry ?? []).map((entryItem) => ({
    ...entryItem,
    changes: (entryItem.changes ?? []).map((change) => {
      if (change.field !== 'messages') return change;
      const messages = change.value?.messages ?? [];
      if (messages.length === 0) return change;

      const allowedMessages = messages.filter((message) => {
        const normalizedSender = normalizeWhatsappSender(message.from);
        const shouldBlock = !!normalizedSender && blocked.has(normalizedSender);
        if (shouldBlock) {
          blockedCount += 1;
          audit.push(auditForMessage(message));
          return false;
        }
        keptMessages += 1;
        return true;
      });

      return {
        ...change,
        value: {
          ...change.value,
          messages: allowedMessages,
        },
      };
    }),
  }));

  const hasStatuses = entry.some((entryItem) =>
    entryItem.changes.some((change) => (change.value?.statuses ?? []).length > 0)
  );

  if (blockedCount > 0 && keptMessages === 0 && !hasStatuses) {
    return { payload: null, blockedCount, audit };
  }

  return {
    payload: {
      ...payload,
      entry,
    },
    blockedCount,
    audit,
  };
}
