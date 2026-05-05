/**
 * Frases que afirmam ou prometem envio de material/arquivo — só permitidas se o backend
 * confirmou envio real (`mediaOutcome.ok === true`). Caso contrário, remover do texto ao cliente.
 */
const DELIVERY_PROMISE_RE =
  /(\btenho\s*,?\s*sim\b|\benviei\b|\bj[aá]\s*enviei\b|vou te enviar|vou enviar|vou mandar|vou te mandar|vou encaminhar|posso te enviar|posso te mandar|posso enviar|posso mandar|consigo (te )?(enviar|mandar)|se quiser (eu )?(te )?(envio|mando)|te envio|j[aá] te envio|te mando|te enviei|j[aá] te enviei|acabei de te (mandar|enviar)|pronto,\s*mandei|mandei (pra|a|para) voc[eê]|segue (o |a )?(arquivo|material|pdf|book|documento|cat[aá]logo)|envio (o |a )?(arquivo|material|pdf|book|documento)|em anexo|já te envio|já te mando|o arquivo está a caminho|te entrego|vou te passar (o |a )?(arquivo|material|pdf|book|documento|cat[aá]logo)|material completo.{0,40}(vou|posso|mando|envio)|(?:vou|posso).{0,24}material completo)/i;

/** Testa texto completo (para validação pós-strip). */
export function textHasMaterialDeliveryClaim(text: string): boolean {
  return DELIVERY_PROMISE_RE.test((text || '').trim());
}

/**
 * Remove frases que prometem/afirmam envio quando o envio NÃO foi confirmado pelo pipeline.
 * Primeiro tenta cortar por pontuação; se ainda restar promessa numa frase única longa, remove o trecho.
 */
export function stripMaterialDeliveryClaims(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return '';
  const pieces = raw.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = pieces.filter((s) => !DELIVERY_PROMISE_RE.test(s));
  let out = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (DELIVERY_PROMISE_RE.test(out)) {
    out = raw.replace(DELIVERY_PROMISE_RE, ' ').replace(/\s+/g, ' ').replace(/^\s*[.,;:]\s*|\s*[.,;:]\s*$/g, '').trim();
  }
  return out;
}

const HONEST_FALLBACK_PURE = '';
const HONEST_FALLBACK_MARKER = '';

/** Turno hard-send: arquivo não encontrado / sem envio — sem pergunta, sem desvio de assunto. */
const MATERIAL_UNAVAILABLE_NEUTRAL: readonly string[] = [
  'No momento não localizei esse material.',
  'Agora não encontrei esse material disponível.',
  'Esse material não está disponível para envio neste momento.',
] as const;

/** Turno hard-send: tentativa de envio falhou — sem pergunta, sem promessa. */
const MATERIAL_SEND_FAILED_NEUTRAL: readonly string[] = [
  'Agora não consegui concluir esse envio.',
  'No momento esse material não foi enviado.',
  'Esse envio não foi concluído agora.',
] as const;

function pickFirstNotSimilarToLast(options: readonly string[], lastAssistantMessage: string | null | undefined): string {
  const last = (lastAssistantMessage ?? '').trim().toLowerCase();
  for (const t of options) {
    const p = t.slice(0, Math.min(22, t.length)).toLowerCase();
    if (!last.includes(p)) return t;
  }
  return options[0] ?? '';
}

/** Quando o cliente pediu material mas não há arquivo resolvível no empreendimento. */
export function pickMaterialUnavailableNeutralReply(lastAssistantMessage?: string | null): string {
  void lastAssistantMessage;
  return '';
}

/** Quando há arquivo mas o envio (Meta/WhatsApp) falhou. */
export function pickMaterialSendFailedNeutralReply(lastAssistantMessage?: string | null): string {
  void lastAssistantMessage;
  return '';
}

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
  void params;
  return '';
}

export function mergeHonestMaterialFallbackWhenNoFile(reply: string): string {
  const base = (reply || '').trim();
  if (!base) return HONEST_FALLBACK_PURE;
  if (DELIVERY_PROMISE_RE.test(base)) {
    return stripMaterialDeliveryClaims(base).slice(0, 3800);
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
  if (HONEST_FALLBACK_MARKER && base.includes(HONEST_FALLBACK_MARKER)) return base;

  // Se houver sinais de promessa de envio/material/anexo, remove a promessa e deixa o motor decidir retry/handoff.
  if (DELIVERY_PROMISE_RE.test(base)) return stripMaterialDeliveryClaims(base).slice(0, 3800);

  return base.slice(0, 3800);
}

/** Texto único após falha real de upload/envio WhatsApp — não afirma que o arquivo foi entregue. */
export function anaMediaDeliveryFailedReply(fileName: string, technicalHint?: string | null): string {
  void fileName;
  void technicalHint;
  return pickMaterialSendFailedNeutralReply(null);
}
