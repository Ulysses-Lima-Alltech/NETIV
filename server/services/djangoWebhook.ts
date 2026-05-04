// server/services/djangoWebhook.ts
// ── Notificação ao Django CRM ──

import type { ConversationRow } from '../repositories/conversationRepository.js';
import { createServiceJwt } from './jwtService.js';
import { normalizePhoneE164 } from '../utils/phone.js';

/** Timeout por chamada (ms). Cabe folgado dentro do tick de 10s do worker. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Resultado do POST para o Django. Usado pelo djangoSyncWorker pra decidir
 * se carimba o outbox como sincronizado ou deixa pra retentar.
 */
export interface DjangoNotifyResult {
  ok: boolean;
  status?: number;
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
      return { ok: false, status: resp.status };
    }
    return { ok: true, status: resp.status };
  } catch (e) {
    console.error('[Django Webhook] Erro:', e instanceof Error ? e.message : e);
    return { ok: false };
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
  }
): Record<string, unknown> {
  const phone = toNationalPhone(conv.contact_phone || conv.external_contact_id);
  const name =
    conv.customer_name?.trim() ||
    fallbacks?.whatsappDisplayName?.trim() ||
    fallbacks?.contactFullName?.trim() ||
    phone; // último recurso: telefone como nome (Django nunca recebe null)

  return {
    phone,
    name,
    enterprise_id: conv.enterprise_id,
    broker_id: conv.assigned_broker_id,
    classification: conv.classification,
    temperature: conv.lead_temperature,
    netiv_conversation_id: conv.id,
    contact_id: conv.contact_id,
  };
}
