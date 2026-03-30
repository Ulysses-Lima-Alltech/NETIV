/**
 * Quando não há arquivo enviável, evita promessa falsa de envio de material.
 */
const DELIVERY_PROMISE_RE =
  /(vou te enviar|vou enviar|vou mandar|vou te mandar|vou encaminhar|posso te enviar|posso te mandar|te envio|j[aá] te envio|te mando( o| a)?|mandarei|mandando (o |a )?(arquivo|material|pdf|book|documento)|segue (o |a )?(arquivo|material|pdf|book)|envio (o |a )?(arquivo|material|pdf|book)|em anexo|já te envio|já te mando|o arquivo está a caminho|te entrego( o| a)?|vou te passar (o |a )?(arquivo|material|pdf|book))/i;

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

/**
 * Versão "forçada": quando o sistema tentou resolver arquivo e não achou/enviou,
 * garantimos que a Ana não prometa envio de material neste contexto.
 */
export function forceHonestMaterialFallbackWhenNoFile(reply: string): string {
  const base = (reply || '').trim();
  if (!base) return HONEST_FALLBACK;
  if (base.includes(HONEST_FALLBACK)) return base;

  // Regra segura (anti promessa): quando não existe arquivo resolvido e o sistema quer "forçar honestidade",
  // não mantemos trechos potencialmente promissores (mesmo que não batam exatamente no regex).
  const n = base.toLowerCase();
  const hasMaterialOrAttachmentNoun = /\b(arquivo|material|pdf|book|documento|anexo|anexa)\b/i.test(n);
  const hasDeliveryVerb = /\b(enviar|mandar|entregar|te mando|te entrego|segue|segue o|a caminho|vou te|vou mandar|vou entregar)\b/i.test(n);

  if (hasMaterialOrAttachmentNoun || hasDeliveryVerb || DELIVERY_PROMISE_RE.test(base)) {
    return HONEST_FALLBACK.slice(0, 3800);
  }

  // Sem sinais de promessa: preserva o texto natural e anexa fallback honesto.
  return `${base}\n\n${HONEST_FALLBACK}`.slice(0, 3800);
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
