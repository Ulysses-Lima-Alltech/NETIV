import type { EnterpriseTipo } from '../repositories/enterpriseRepository.js';

/** Tipo comercial inferido no backend a partir da mensagem + contexto recente (triagem). */
export type RequestedProductType = EnterpriseTipo | 'INDEFINIDO';

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Inferência determinística (regex) — não delega à IA.
 * Ordem: MCMV → LOTEAMENTO → APARTAMENTO; sem sinal claro → INDEFINIDO.
 */
export function inferRequestedProductType(
  currentMessage: string,
  conversationContext: string
): RequestedProductType {
  const hay = norm(`${currentMessage || ''}\n${conversationContext || ''}`);
  if (!hay) return 'INDEFINIDO';

  if (
    /\b(mcmv|mc\s*mv|minha\s+casa|minha\s+casa\s+minha\s+vida|casa\s+verde\s+e\s+amarela|programa\s+habitacional)\b/.test(
      hay
    ) ||
    /\bfaixa\s*[123]\b/.test(hay)
  ) {
    return 'MCMV';
  }

  if (
    /\b(loteamento|loteamentos|condominio\s+de\s+lotes|lote\s+urbano)\b/.test(hay) ||
    /\b(lotes?\b|terreno|terrenos|comprar\s+(?:um\s+)?lote|lote\s+em\s+condominio)\b/.test(hay)
  ) {
    return 'LOTEAMENTO';
  }

  if (
    /\b(apartamento|cobertura|flat|studio|stúdio|kitnet)\b/.test(hay) ||
    /\bapt[o.]?\b/.test(hay) ||
    /\bap\s+\d/.test(hay)
  ) {
    return 'APARTAMENTO';
  }

  return 'INDEFINIDO';
}
