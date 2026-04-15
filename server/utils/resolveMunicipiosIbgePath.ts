import { existsSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILE_NAME = 'municipios-ibge.json';
const REL = ['public', 'data', FILE_NAME] as const;
let cachedPath: string | null = null;
let warnedMissingOnce = false;
let loggedChosenPath: string | null = null;

/** Path absoluto incorreto visto em produção quando cwd ou "raiz" resolvem para `/`. */
function isPoisonousRootPublicPath(p: string): boolean {
  return normalize(p).replace(/\\/g, '/') === '/public/data/municipios-ibge.json';
}

/**
 * Raiz do repo (inbox-app), onde vive `public/data/municipios-ibge.json`.
 * - `server/dist/utils` → 3 níveis acima.
 * - `dist/utils` na raiz do deploy (ex.: `/app/dist/utils`) → 2 níveis (evita subir até `/`).
 */
function monorepoRootFromModuleDir(): string {
  const normalized = __dirname.replace(/\\/g, '/');
  if (normalized.includes('/server/dist/')) {
    return join(__dirname, '..', '..', '..');
  }
  if (normalized.includes('/dist/')) {
    return join(__dirname, '..', '..');
  }
  return join(__dirname, '..', '..');
}

function uniquePush(list: string[], p: string, seen: Set<string>): void {
  const key = normalize(p);
  if (seen.has(key)) return;
  seen.add(key);
  list.push(p);
}

/**
 * Resolve o JSON IBGE para leitura no Node. Único ponto de entrada no backend.
 */
export function resolveMunicipiosIbgePath(): string | null {
  if (cachedPath && existsSync(cachedPath)) return cachedPath;

  const cwd = process.cwd();

  const candidates: string[] = [];
  const seen = new Set<string>();

  // 1) cwd — ignorar raiz do filesystem (`/` no Linux), que gera `/public/data/...` por engano.
  if (cwd && cwd !== '/' && cwd !== '\\') {
    uniquePush(candidates, join(cwd, ...REL), seen);
  }

  // 2) Raiz inferida a partir de `utils` compilado (dev e Docker em /app).
  const fromMonorepo = join(monorepoRootFromModuleDir(), ...REL);
  uniquePush(candidates, fromMonorepo, seen);

  // 3) Relativo ao ficheiro: cobre `dist/utils` e `server/dist/utils` sem depender só de monorepoRoot.
  uniquePush(candidates, join(__dirname, '..', '..', ...REL), seen);
  uniquePush(candidates, join(__dirname, '..', '..', '..', ...REL), seen);

  let chosenPath: string | null = null;
  for (const candidate of candidates) {
    if (isPoisonousRootPublicPath(candidate)) {
      continue;
    }
    if (existsSync(candidate)) {
      chosenPath = candidate;
      break;
    }
  }

  if (chosenPath) {
    cachedPath = chosenPath;
    if (loggedChosenPath !== chosenPath) {
      console.log('[MUNICIPIOS_PATH] usando', chosenPath);
      loggedChosenPath = chosenPath;
    }
    warnedMissingOnce = false;
    return chosenPath;
  }

  cachedPath = null;
  if (!warnedMissingOnce) {
    console.warn(
      `[MUNICIPIOS_PATH] ${FILE_NAME} ausente; seguindo sem enriquecimento de municipio. cwd=${cwd} tried=${JSON.stringify(candidates)}`
    );
    warnedMissingOnce = true;
  }
  return null;
}
