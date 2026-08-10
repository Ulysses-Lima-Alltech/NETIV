import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PACKAGE_NAME = 'inbox-app-server';
const REQUIRED_SERVER_DIRECTORIES = ['services', 'utils', 'tests'] as const;

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isServerRoot(candidate: string): boolean {
  const root = path.resolve(candidate);
  const packagePath = path.join(root, 'package.json');
  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (!existsSync(packagePath) || !existsSync(tsconfigPath)) return false;
  if (!REQUIRED_SERVER_DIRECTORIES.every((directory) => isDirectory(path.join(root, directory)))) return false;

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown };
    return packageJson.name === SERVER_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function directoryForSearchStart(start: string): string {
  const resolved = path.resolve(start);
  try {
    return statSync(resolved).isFile() ? path.dirname(resolved) : resolved;
  } catch {
    return path.extname(resolved) ? path.dirname(resolved) : resolved;
  }
}

function collectRootCandidates(startLocations: readonly string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const startLocation of startLocations) {
    let current = directoryForSearchStart(startLocation);
    while (true) {
      for (const candidate of [current, path.join(current, 'server')]) {
        const resolved = path.resolve(candidate);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(resolved);
        }
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return candidates;
}

export function resolveServerRoot(startLocations?: readonly string[]): string {
  const helperLocation = fileURLToPath(import.meta.url);
  const starts = startLocations?.length
    ? startLocations
    : [process.cwd(), helperLocation];
  const candidates = collectRootCandidates(starts);
  const serverRoot = candidates.find(isServerRoot);
  if (serverRoot) return serverRoot;

  throw new Error(
    [
      'Não foi possível localizar a raiz real do backend server.',
      `Pontos de partida: ${starts.map((item) => path.resolve(item)).join(', ')}`,
      `Caminhos verificados: ${candidates.join(', ')}`,
      `Marcadores esperados: package.json(name=${SERVER_PACKAGE_NAME}), tsconfig.json, ${REQUIRED_SERVER_DIRECTORIES.join(', ')}.`,
    ].join('\n'),
  );
}

function normalizeServerRelativePath(relativePath: string): string {
  const raw = String(relativePath ?? '').trim().replace(/[\\/]+/g, path.sep);
  if (!raw) throw new Error('O caminho relativo do arquivo-fonte não pode ser vazio.');
  if (path.isAbsolute(raw)) throw new Error(`O caminho deve ser relativo à raiz de server: ${relativePath}`);

  const normalized = path.normalize(raw).replace(new RegExp(`^server\\${path.sep}`), '');
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`O caminho não pode sair da raiz de server: ${relativePath}`);
  }
  return normalized;
}

export function resolveServerSourceFile(relativePath: string): string {
  const serverRoot = resolveServerRoot();
  const normalized = normalizeServerRelativePath(relativePath);
  const sourcePath = path.resolve(serverRoot, normalized);
  const triedPaths = [sourcePath];

  if (existsSync(sourcePath) && statSync(sourcePath).isFile()) return sourcePath;

  if (sourcePath.endsWith('.js')) {
    const typescriptPath = sourcePath.slice(0, -3) + '.ts';
    triedPaths.push(typescriptPath);
    if (existsSync(typescriptPath) && statSync(typescriptPath).isFile()) return typescriptPath;
  }

  throw new Error(
    `Arquivo-fonte do backend não encontrado: ${relativePath}\nCaminhos verificados: ${triedPaths.join(', ')}`,
  );
}

export function readServerSourceFile(relativePath: string): string {
  return readFileSync(resolveServerSourceFile(relativePath), 'utf8');
}

export function resolveWorkspaceFile(relativePath: string): string {
  const serverRoot = resolveServerRoot();
  const workspaceRoot = path.dirname(serverRoot);
  const normalized = String(relativePath ?? '').trim().replace(/[\\/]+/g, path.sep);
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error(`O caminho deve ser relativo à raiz do workspace: ${relativePath}`);
  }
  const resolved = path.resolve(workspaceRoot, path.normalize(normalized));
  const relativeToWorkspace = path.relative(workspaceRoot, resolved);
  if (relativeToWorkspace === '..' || relativeToWorkspace.startsWith(`..${path.sep}`)) {
    throw new Error(`O caminho não pode sair da raiz do workspace: ${relativePath}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`Arquivo do workspace não encontrado: ${relativePath}\nCaminho verificado: ${resolved}`);
  }
  return resolved;
}

export function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolveWorkspaceFile(relativePath), 'utf8');
}
