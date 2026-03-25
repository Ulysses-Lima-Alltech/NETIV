/** Formato compacto em public/data/municipios-ibge.json */
export interface MunicipioIbge {
  i: number;
  n: string;
  u: string;
  /** Região geográfica imediata (IBGE) */
  ri: string;
  /**
   * Região geográfica intermediária (IBGE) — persistida em `commercialRegion` para a ANA
   * fazer fallback quando não houver empreendimento na cidade exata.
   */
  rint: string;
}

export function formatMunicipioLabel(m: MunicipioIbge): string {
  return `${m.n} / ${m.u}`;
}
