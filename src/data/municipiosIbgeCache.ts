import type { MunicipioIbge } from '../types/municipioIbge';

let cache: Promise<MunicipioIbge[]> | null = null;

/** Lista local única (public/data/municipios-ibge.json), cacheada após o primeiro fetch. */
export function loadMunicipiosIbge(): Promise<MunicipioIbge[]> {
  if (!cache) {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    cache = fetch(`${base}data/municipios-ibge.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<MunicipioIbge[]>;
      })
      .catch(() => {
        cache = null;
        throw new Error('Falha ao carregar municípios IBGE');
      });
  }
  return cache;
}

export function findMunicipioByIbge(list: MunicipioIbge[], ibge: number): MunicipioIbge | undefined {
  return list.find((m) => m.i === ibge);
}
