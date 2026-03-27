import type { RequestedProductType } from './anaRequestedProductType.js';

function normCtx(s?: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Texto único para listagem 📍 — usado por catálogo injetado e duplicate fallback (evita divergência). */
export function tipoLabelForCatalogHint(hint: RequestedProductType | undefined, recentContext?: string): string {
  if (hint === 'LOTEAMENTO') return ' de loteamento';
  if (hint === 'APARTAMENTO') return ' de apartamento';
  if (hint === 'MCMV') return ' na linha MCMV';
  const ctx = normCtx(recentContext);
  if (/\b(lote|lotes|loteamento|terreno|terrenos)\b/.test(ctx)) return ' de loteamento';
  return '';
}

export function buildCatalogListMessage(
  allEnterpriseNames: string[],
  opts?: { productTypeHint?: RequestedProductType; recentContext?: string; closingQuestion?: string }
): string {
  const names = allEnterpriseNames.slice(0, 5);
  if (names.length === 0) {
    return 'No momento não tenho empreendimentos ativos no sistema pra te passar aqui. Quer que eu te avise quando entrar coisa nova?';
  }
  const listText = names.map((n) => `📍 ${n}`).join('\n');
  const tipo = tipoLabelForCatalogHint(opts?.productTypeHint, opts?.recentContext);
  const moreText = allEnterpriseNames.length > 5 ? '\n\nTenho mais opções também.' : '';
  const close =
    opts?.closingQuestion?.trim() ||
    'Se quiser, eu te ajudo a filtrar. Em qual região você quer buscar?';
  return `Tenho sim. Hoje eu trabalho com estas opções${tipo}:\n\n${listText}${moreText}\n\n${close}`;
}
