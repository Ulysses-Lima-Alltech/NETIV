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
