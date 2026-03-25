/**
 * Gera public/data/municipios-ibge.json a partir da API oficial do IBGE (executar offline).
 *
 * Formato compacto por município:
 * - i: id IBGE
 * - n: nome
 * - u: UF (sigla)
 * - ri: nome da região geográfica imediata (RGI)
 * - rint: nome da região geográfica intermediária (RGINT) — usada no campo commercialRegion
 *        para fallback de busca (conjunto maior de municípios que a RGI).
 *
 * Uso: node scripts/fetch-municipios-ibge.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'data');
const outFile = join(outDir, 'municipios-ibge.json');

const url = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';

async function main() {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const compact = raw.map((m) => {
    const rgi = m['regiao-imediata'];
    const rint = rgi?.['regiao-intermediaria'];
    return {
      i: m.id,
      n: m.nome,
      u: m.microrregiao?.mesorregiao?.UF?.sigla ?? '',
      ri: rgi?.nome ?? '',
      rint: rint?.nome ?? '',
    };
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(compact), 'utf-8');
  console.log('OK', outFile, compact.length, 'municípios');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
