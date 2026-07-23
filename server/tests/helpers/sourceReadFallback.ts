import fs, { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const originalReadFileSync = fs.readFileSync.bind(fs);

function resolveSourceFallback(value: unknown): string | null {
  let requested: string;
  if (value instanceof URL) requested = fileURLToPath(value);
  else if (typeof value === 'string') requested = value;
  else return null;

  const candidates = new Set<string>();
  if (requested.endsWith('.js')) candidates.add(`${requested.slice(0, -3)}.ts`);

  const distMarker = `${sep}dist${sep}`;
  if (requested.includes(distMarker)) {
    const sourcePath = requested.replace(distMarker, sep);
    candidates.add(sourcePath);
    if (sourcePath.endsWith('.js')) candidates.add(`${sourcePath.slice(0, -3)}.ts`);
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

fs.readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
  try {
    return originalReadFileSync(path, ...(args as []));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const fallback = resolveSourceFallback(path);
    if (!fallback) throw error;
    return originalReadFileSync(fallback, ...(args as []));
  }
}) as typeof fs.readFileSync;

syncBuiltinESMExports();
