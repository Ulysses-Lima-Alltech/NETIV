import type { EnterpriseTipo } from '../repositories/enterpriseRepository.js';

/** Tipo comercial inferido no backend a partir da mensagem + contexto recente (triagem). */
export type RequestedProductType = EnterpriseTipo | 'INDEFINIDO';

/** Tipos cadastro tratados como o mesmo universo na oferta/triagem (temporário). */
export function expandCadastroTipoToPool(t: EnterpriseTipo): EnterpriseTipo[] {
  if (t === 'APARTAMENTO' || t === 'MCMV') return ['APARTAMENTO', 'MCMV'];
  return [t];
}

/** Expansão para filtro de empreendimentos; `null` = sem filtro (todos ativos). */
export function expandTiposForCommercialPool(t: RequestedProductType): EnterpriseTipo[] | null {
  if (t === 'INDEFINIDO') return null;
  return expandCadastroTipoToPool(t);
}

/** Inferência do cliente compatível com o tipo cadastrado do empreendimento em foco? */
export function tiposComercialEquivalentes(
  cadastroTipo: EnterpriseTipo,
  inferido: RequestedProductType
): boolean {
  if (inferido === 'INDEFINIDO') return true;
  if (cadastroTipo === inferido) return true;
  const apt = new Set<EnterpriseTipo>(['APARTAMENTO', 'MCMV']);
  return apt.has(cadastroTipo) && apt.has(inferido);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ProductTypeSignals {
  hasMcmv: boolean;
  hasLoteamento: boolean;
  hasApartamento: boolean;
}

function detectProductTypeSignals(text: string): ProductTypeSignals {
  const hay = norm(text);
  if (!hay) {
    return { hasMcmv: false, hasLoteamento: false, hasApartamento: false };
  }
  return {
    hasMcmv:
      /\b(mcmv|mc\s*mv|minha\s+casa|minha\s+casa\s+minha\s+vida|casa\s+verde\s+e\s+amarela|programa\s+habitacional)\b/.test(
        hay
      ) || /\bfaixa\s*[123]\b/.test(hay),
    hasLoteamento:
      /\b(loteamento|loteamentos|condominio\s+de\s+lotes|lote\s+urbano)\b/.test(hay) ||
      /\b(lotes?\b|terreno|terrenos|comprar\s+(?:um\s+)?lote|lote\s+em\s+condominio)\b/.test(hay),
    hasApartamento:
      /\b(apartamento|apartamentos|cobertura|flat|studio|stúdio|kitnet)\b/.test(hay) ||
      /\bapt[o.]?\b/.test(hay) ||
      /\bap\s+\d/.test(hay),
  };
}

function inferFromSignals(signals: ProductTypeSignals): RequestedProductType {
  if (signals.hasMcmv) return 'MCMV';
  if (signals.hasApartamento) return 'APARTAMENTO';
  if (signals.hasLoteamento) return 'LOTEAMENTO';
  return 'INDEFINIDO';
}

/**
 * Inferência determinística (regex) — não delega à IA.
 * Ordem: MCMV → LOTEAMENTO → APARTAMENTO; sem sinal claro → INDEFINIDO.
 */
export function inferRequestedProductType(
  currentMessage: string,
  conversationContext: string
): RequestedProductType {
  const currentSignals = detectProductTypeSignals(currentMessage || '');
  const currentInference = inferFromSignals(currentSignals);
  if (currentInference !== 'INDEFINIDO') return currentInference;

  // Só herda contexto quando ele aponta um único universo de produto.
  // Evita "contaminação" de loteamento antigo sobre uma nova pergunta.
  const contextSignals = detectProductTypeSignals(conversationContext || '');
  const activeSignals = [
    contextSignals.hasMcmv,
    contextSignals.hasApartamento,
    contextSignals.hasLoteamento,
  ].filter(Boolean).length;
  if (activeSignals !== 1) return 'INDEFINIDO';
  return inferFromSignals(contextSignals);
}
