// server/services/djangoWebhook.ts
// ── Notificação ao Django CRM ──

import type { ConversationRow } from '../repositories/conversationRepository.js';
import { createServiceJwt } from './jwtService.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { resolveOperationalCustomerName } from '../utils/customerNameResolver.js';
import { getPool } from '../db/pg.js';
import type { PoolClient } from 'pg';

/** Timeout por chamada (ms). Cabe folgado dentro do tick de 10s do worker. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Resultado do POST para o Django. Usado pelo djangoSyncWorker pra decidir
 * se carimba o outbox como sincronizado ou deixa pra retentar.
 */
export interface DjangoNotifyResult {
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: 'event';
}

/**
 * Envia dados para o Django CRM via webhook com JWT.
 * - Sucesso (2xx) → { ok: true, status }
 * - Falha (não-2xx, timeout, exceção) → { ok: false, status? }
 *
 * NOTA: continua sendo seguro chamar fire-and-forget (sem await) — quem não
 * usa o retorno simplesmente ignora. Não é breaking change.
 */
export async function notifyDjango(
  url: string,
  payload: Record<string, unknown>
): Promise<DjangoNotifyResult> {
  const webhookBaseUrl = process.env.DJANGO_WEBHOOK_URL;
  const secret = process.env.SSO_SHARED_SECRET;
  if (!webhookBaseUrl || !secret) {
    // Sem URL ou secret configurados, não faz nada. Retorna ok=false pro
    // worker NÃO carimbar a conversa (caso esse cenário aconteça em prod).
    return { ok: false };
  }

  const fullUrl = `${webhookBaseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

  try {
    const jwt = createServiceJwt('netiv');
    const resp = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
        'X-Webhook-Secret': secret, // backward-compat
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[Django Webhook] ${fullUrl} → HTTP ${resp.status}: ${body}`);
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${body}`.slice(0, 500) };
    }
    return { ok: true, status: resp.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Django Webhook] Erro:', msg);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

/**
 * Converte telefone para o formato nacional brasileiro (10 ou 11 dígitos),
 * removendo o prefixo '55' do país. Formato esperado pelo Django CRM.
 */
function toNationalPhone(input: string | null | undefined): string {
  const normalized = normalizePhoneE164(input);
  if (!normalized) return '';
  if (normalized.startsWith('55') && normalized.length >= 12) {
    return normalized.slice(2);
  }
  return normalized;
}

/**
 * Monta payload do webhook de leads NETIV → Django.
 *
 * IMPORTANTE — fallback do nome:
 *   conv.customer_name só é preenchido quando a Ana detecta auto-identificação
 *   explícita ("meu nome é Maria"). Pra muitos leads esse campo é null.
 *   Pra equiparar ao CSV do Dashboard (que mostra full_name + display_name),
 *   aplicamos cascata:
 *     customer_name → whatsapp_display_name → contact.full_name → phone
 *
 * O parâmetro `fallbacks` é opcional (chamadas antigas em fire-and-forget
 * continuam funcionando), mas o worker SEMPRE passa, garantindo nome bom.
 */
export function buildLeadPayload(
  conv: ConversationRow,
  fallbacks?: {
    whatsappDisplayName?: string | null;
    contactFullName?: string | null;
    contactFirstName?: string | null;
  }
): Record<string, unknown> {
  const phone = toNationalPhone(conv.contact_phone || conv.external_contact_id);
  const name = resolveOperationalCustomerName({
    conversationCustomerName: conv.customer_name ?? null,
    whatsappDisplayName: conv.whatsapp_display_name ?? fallbacks?.whatsappDisplayName ?? null,
    contactFullName: fallbacks?.contactFullName ?? null,
    contactFirstName: fallbacks?.contactFirstName ?? null,
    phone,
    fallbackLabel: 'Cliente',
  });

  // ── Montar URL da conversa no frontend NETIV ──
  const frontendUrl = (process.env.NETIV_FRONTEND_URL || '').replace(/\/$/, '');
  const netiv_conversation_url = frontendUrl
    ? `${frontendUrl}/inbox?conversationId=${conv.id}`
    : null;

  return {
    phone,
    name,
    enterprise_id: conv.enterprise_id,
    broker_id: conv.assigned_broker_id,
    classification: conv.classification,
    temperature: conv.lead_temperature,
    netiv_conversation_id: conv.id,
    contact_id: conv.contact_id,
    netiv_conversation_url,
  };
}

/** Só conversas CLIENT viram lead no Django. CORRETOR/ADMIN (aba INTERNO) são bloqueados. */
function isClientConversation(conv: ConversationRow): boolean {
  return String(conv.conversation_type ?? 'CLIENT').toUpperCase() === 'CLIENT';
}

/**
 * Ponto ÚNICO de envio de lead ao Django. Garante que contatos internos
 * (corretores/admin) NUNCA sejam enviados como lead, independente do call site.
 */
export async function notifyDjangoLead(
  conv: ConversationRow,
  fallbacks?: {
    whatsappDisplayName?: string | null;
    contactFullName?: string | null;
    contactFirstName?: string | null;
  }
): Promise<DjangoNotifyResult> {
  if (conv.is_event_lead === true) {
    console.log('[Django Webhook] lead_skip_event', { conversationId: conv.id });
    return { ok: false, skipped: 'event' };
  }
  if (!isClientConversation(conv)) {
    console.log('[Django Webhook] lead_skip_internal', {
      conversationId: conv.id,
      conversationType: conv.conversation_type ?? 'CLIENT',
    });
    return { ok: false };
  }
  let client: PoolClient | null = null;
  let lockAcquired = false;
  let discardClient = false;
  const lockKey = `django-lead:${conv.id}`;
  try {
    client = await getPool().connect();
    // Share a per-conversation lock with event creation so a stale worker row
    // cannot race the event tag and post after the lead is classified as an event.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
    lockAcquired = true;
    const current = await client.query<{
      conversation_type: string | null;
      is_event_lead: boolean;
    }>(
      'SELECT conversation_type, is_event_lead FROM conversations WHERE id = $1',
      [conv.id]
    );
    const currentType = current.rows[0]?.conversation_type ?? conv.conversation_type;
    if (current.rows[0]?.is_event_lead === true) {
      console.log('[Django Webhook] lead_skip_event', { conversationId: conv.id });
      return { ok: false, skipped: 'event' };
    }
    if (!isClientConversation({ ...conv, conversation_type: currentType })) {
      console.log('[Django Webhook] lead_skip_internal', {
        conversationId: conv.id,
        conversationType: currentType ?? 'CLIENT',
      });
      return { ok: false };
    }
    return await notifyDjango('api/webhook/netiv-lead/', buildLeadPayload(conv, fallbacks));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Django Webhook] lead lock failed', { conversationId: conv.id, error: message });
    return { ok: false, error: message.slice(0, 500) };
  } finally {
    if (client) {
      try {
        if (lockAcquired) {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
        }
      } catch (error) {
        discardClient = true;
        console.error('[Django Webhook] lead lock release failed', { conversationId: conv.id, error });
      } finally {
        client.release(discardClient);
      }
    }
  }
}
