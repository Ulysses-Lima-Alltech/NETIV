/**
 * Quando não há arquivo enviável, evita promessa falsa de envio de material.
 */
const DELIVERY_PROMISE_RE =
  /(vou te enviar|vou enviar|te envio|j[aá] te envio|mandando (o |a )?(arquivo|material|pdf|book)|segue (o |a )?(arquivo|material|pdf)|envio (o |a )?(arquivo|material)|te mando (o |a )?)/i;

const HONEST_FALLBACK =
  'Posso te passar as informações por aqui enquanto organizo o material completo no sistema — se precisar do arquivo agora, um atendente pode te enviar.';

export function mergeHonestMaterialFallbackWhenNoFile(reply: string): string {
  const base = (reply || '').trim();
  if (!base) return HONEST_FALLBACK;
  if (DELIVERY_PROMISE_RE.test(base)) {
    return `${base}\n\n${HONEST_FALLBACK}`.slice(0, 3800);
  }
  return base;
}

/** Texto único após falha real de upload/envio WhatsApp — não afirma que o arquivo foi entregue. */
export function anaMediaDeliveryFailedReply(fileName: string, technicalHint?: string | null): string {
  const safe = (fileName || 'material').replace(/[\r\n]/g, ' ').slice(0, 120);
  const hint = (technicalHint || '').trim().slice(0, 280);
  const detail = hint ? ` Detalhe: ${hint}` : '';
  return `Não consegui concluir o envio do arquivo "${safe}" pelo WhatsApp agora.${detail} Posso continuar te orientando por aqui, ou você pode pedir o material a um atendente.`.slice(
    0,
    4000
  );
}
