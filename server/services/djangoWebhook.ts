// server/services/djangoWebhook.ts
// ── Notificação ao Django CRM ──

/**
 * Envia dados para o Django CRM via webhook (fire-and-forget).
 * Se falhar, apenas loga — NÃO bloqueia o fluxo do Netiv.
 */
export async function notifyDjango(url: string, payload: Record<string, unknown>): Promise<void> {
  const webhookBaseUrl = process.env.DJANGO_WEBHOOK_URL;
  const secret = process.env.SSO_SHARED_SECRET;
  if (!webhookBaseUrl || !secret) return; // Sem URL ou secret configurados, não faz nada

  try {
    const fullUrl = `${webhookBaseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
    const resp = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
