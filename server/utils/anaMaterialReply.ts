/**
 * Quando não há arquivo enviável, evita promessa falsa de envio de material.
 */
const DELIVERY_PROMISE_RE =
  /(vou te enviar|vou enviar|vou mandar|vou te mandar|vou encaminhar|posso te enviar|posso te mandar|te envio|j[aá] te envio|te mando( o| a)?|mandarei|mandando (o |a )?(arquivo|material|pdf|book|documento)|segue (o |a )?(arquivo|material|pdf|book)|envio (o |a )?(arquivo|material|pdf|book)|em anexo|já te envio|já te mando|o arquivo está a caminho|te entrego( o| a)?|vou te passar (o |a )?(arquivo|material|pdf|book))/i;

const HONEST_FALLBACK_PURE = 'Claro. Posso te adiantar os principais pontos por aqui. Seu foco é morar ou investir?';
const HONEST_FALLBACK_MARKER = 'Seu foco é morar ou investir?';

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooSimilarToLast(candidate: string, lastAssistantMessage?: string | null): boolean {
  const last = (lastAssistantMessage ?? '').trim();
  if (!last) return false;
  const a = norm(candidate);
  const b = norm(last);
  if (!a || !b) return false;
  if (a === b) return true;
  // Se compartilhar o "começo" bem próximo, consideramos repetição.
  return a.slice(0, 40) === b.slice(0, 40);
}

export function buildHumanMaterialFallback(params: {
  enterpriseName?: string | null;
  reply?: string;
  customerAskedForBook?: boolean;
  lastAssistantMessage?: string | null;
}): string {
  const ent = (params.enterpriseName ?? '').trim();
  const templates: string[] = ent
    ? [
        `Perfeito. Sobre ${ent}, eu te adianto os principais pontos por aqui. Seu foco é morar ou investir?`,
        `Claro. Sobre ${ent}, eu te explico os detalhes por aqui. O que você quer entender primeiro?`,
        `Perfeito. No ${ent}, eu te passo os pontos principais por aqui. Seu foco é morar ou investir?`,
        `Claro. Sobre ${ent}, posso te explicar por aqui. O que você quer entender primeiro?`,
      ]
    : [
        `Claro. Posso te adiantar os principais pontos por aqui. Seu foco é morar ou investir?`,
        `Perfeito. Eu te explico os detalhes por aqui. O que você quer entender primeiro?`,
        `Claro. Posso te adiantar os pontos principais por aqui. Seu foco é morar ou investir?`,
      ];

  // Anti repetição: evita candidato igual/parecido com a última mensagem da Ana.
  for (const t of templates) {
    if (!isTooSimilarToLast(t, params.lastAssistantMessage)) return t;
  }
  return templates[0] ?? HONEST_FALLBACK_PURE;
}

export function mergeHonestMaterialFallbackWhenNoFile(reply: string): string {
  const base = (reply || '').trim();
  if (!base) return HONEST_FALLBACK_PURE;
  if (DELIVERY_PROMISE_RE.test(base)) {
    return `${base}\n\n${HONEST_FALLBACK_PURE}`.slice(0, 3800);
  }
  return base;
}

/**
 * Versão "forçada": impede promessa falsa quando o sistema tentou resolver envio
 * mas não há material resolvido. (Mantida por compatibilidade; o engine passa a usar
 * buildHumanMaterialFallback diretamente.)
 */
export function forceHonestMaterialFallbackWhenNoFile(reply: string): string {
  const base = (reply || '').trim();
  if (!base) return HONEST_FALLBACK_PURE;
  if (base.includes(HONEST_FALLBACK_MARKER)) return base;

  // Se houver sinais de promessa de envio/material/anexo, substitui pelo fallback honesto puro.
  if (DELIVERY_PROMISE_RE.test(base)) return HONEST_FALLBACK_PURE.slice(0, 3800);

  // Se não houver sinais, preserva texto natural e anexa fallback honesto.
  return `${base}\n\n${HONEST_FALLBACK_PURE}`.slice(0, 3800);
}

/** Texto único após falha real de upload/envio WhatsApp — não afirma que o arquivo foi entregue. */
export function anaMediaDeliveryFailedReply(fileName: string, technicalHint?: string | null): string {
  void fileName;
  void technicalHint;
  return buildHumanMaterialFallback({ customerAskedForBook: true });
}
