// server/services/djangoWebhook.ts
// ── Notificação ao Django CRM ──

import type { ConversationRow } from '../repositories/conversationRepository.js';
import { createServiceJwt } from './jwtService.js';

/**
 * Envia dados para o Django CRM via webhook com JWT (fire-and-forget).
 * Se falhar, apenas loga — NÃO bloqueia o fluxo do Netiv.
 * 
 * Migration: Now uses JWT in Authorization header instead of X-Webhook-Secret
 * Fallback: Still sends X-Webhook-Secret for backward compatibility during transition
 */
export async function notifyDjango(url: string, payload: Record<string, unknown>): Promise<void> {
  const webhookBaseUrl = process.env.DJANGO_WEBHOOK_URL;
  const secret = process.env.SSO_SHARED_SECRET;
  if (!webhookBaseUrl || !secret) return; // Sem URL ou secret configurados, não faz nada

  try {
    const fullUrl = `${webhookBaseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
    
    // Create JWT for service authentication
    const jwt = createServiceJwt('netiv');
    
    const resp = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
        // Keep X-Webhook-Secret for backward compatibility during transition
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[Django Webhook] ${fullUrl} → HTTP ${resp.status}: ${body}`);
    }
  } catch (e) {
    console.error('[Django Webhook] Erro:', e instanceof Error ? e.message : e);
  }
}

/**
 * Monta payload para webhook de leads do Netiv para Django
 */
export function buildLeadPayload(conv: ConversationRow): Record<string, unknown> {
  return {
    phone: conv.contact_phone || conv.external_contact_id,
    name: conv.customer_name,
    enterprise_id: conv.enterprise_id,
    broker_id: conv.assigned_broker_id,
    classification: conv.classification,
    temperature: conv.lead_temperature,
    netiv_conversation_id: conv.id,
    contact_id: conv.contact_id,  // NOVO: ID do contato no Netiv
  };
}
