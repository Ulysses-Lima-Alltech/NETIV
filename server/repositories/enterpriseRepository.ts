import { mkdirSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pg.js';

export const FILE_CATEGORIES = ['book', 'unidades', 'tabela_comercial', 'outro'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

const FILE_CATEGORY_SET = new Set<string>(FILE_CATEGORIES);

/** Sinônimos comuns devolvidos pelo modelo (fora do enum exato) → categoria do banco. */
const FILE_CATEGORY_ALIASES: Record<string, FileCategory> = {
  material: 'book',
  materials: 'book',
  catalogo: 'book',
  catalog: 'book',
  pdf: 'book',
  brochure: 'book',
  planta: 'unidades',
  plantas: 'unidades',
  unidade: 'unidades',
  tabela: 'tabela_comercial',
  precos: 'tabela_comercial',
  preco: 'tabela_comercial',
  comercial: 'tabela_comercial',
};

/**
 * Alinha o valor vindo da ANA/JSON com as categorias do banco (`enterprise_files.category`).
 * Corrige espaços, caixa, hífen vs underscore, plural acidental "books" e sinônimos (ex.: material → book).
 */
export function normalizeFileCategory(input: string | null | undefined): FileCategory | null {
  if (input == null || typeof input !== 'string') return null;
  let s = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (s === 'books') s = 'book';
  if (FILE_CATEGORY_SET.has(s)) return s as FileCategory;
  const mapped = FILE_CATEGORY_ALIASES[s];
  if (mapped) return mapped;
  return null;
}

const VAR_KEYS = ['preco', 'condicoes', 'disponibilidade', 'observacoes'] as const;

export type LanguageStyle = 'informal' | 'natural' | 'formal' | 'culta';

export interface EnterpriseRow {
  id: number;
  name: string;
  slug: string;
  status: string;
  language_style: string;
  prompt_addons: string;
  created_at: Date;
  updated_at: Date;
}

function enterpriseDir(id: number): string {
  const d = join(config.storageEmpreendimentos, String(id));
  mkdirSync(d, { recursive: true });
  return d;
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'empreendimento'
  );
}

export async function listEnterprises(activeOnly: boolean): Promise<EnterpriseRow[]> {
  const sql = activeOnly
    ? `SELECT * FROM enterprises WHERE status = 'ativo' ORDER BY name`
    : `SELECT * FROM enterprises ORDER BY name`;
  const { rows } = await query<EnterpriseRow>(sql);
  return rows;
}

export async function getEnterpriseById(id: number): Promise<EnterpriseRow | null> {
  const { rows } = await query<EnterpriseRow>(`SELECT * FROM enterprises WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getActiveEnterpriseById(id: number): Promise<EnterpriseRow | null> {
  const { rows } = await query<EnterpriseRow>(
    `SELECT * FROM enterprises WHERE id = $1 AND status = 'ativo'`,
    [id]
  );
  return rows[0] ?? null;
}

async function ensureUniqueSlug(base: string, excludeId?: number): Promise<string> {
  let s = base;
  let n = 0;
  for (;;) {
    const { rows } = await query<{ id: number }>(
      excludeId != null
        ? `SELECT id FROM enterprises WHERE slug = $1 AND id != $2`
        : `SELECT id FROM enterprises WHERE slug = $1`,
      excludeId != null ? [s, excludeId] : [s]
    );
    if (rows.length === 0) return s;
    n += 1;
    s = `${base}-${n}`;
  }
}

export async function createEnterprise(
  name: string,
  opts?: { slug?: string; languageStyle?: LanguageStyle }
): Promise<EnterpriseRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nome obrigatório.');
  const dup = await query(`SELECT id FROM enterprises WHERE name = $1`, [trimmed]);
  if (dup.rows.length) throw new Error('Já existe empreendimento com esse nome.');
  const base = opts?.slug?.trim() ? slugify(opts.slug) : slugify(trimmed);
  const slug = await ensureUniqueSlug(base);
  const lang = opts?.languageStyle ?? 'natural';
  const { rows } = await query<EnterpriseRow>(
    `INSERT INTO enterprises (name, slug, status, language_style, prompt_addons)
     VALUES ($1, $2, 'ativo', $3, '[]') RETURNING *`,
    [trimmed, slug, lang]
  );
  const ent = rows[0];
  for (const k of VAR_KEYS) {
    await query(`INSERT INTO enterprise_variables (enterprise_id, var_key, value) VALUES ($1, $2, '')`, [
      ent.id,
      k,
    ]);
  }
  return ent;
}

export async function updateEnterprise(
  id: number,
  u: {
    name?: string;
    status?: 'ativo' | 'inativo';
    slug?: string;
    languageStyle?: LanguageStyle;
    promptAddons?: string[];
  }
): Promise<EnterpriseRow | null> {
  const cur = await getEnterpriseById(id);
  if (!cur) return null;
  const name = u.name !== undefined ? u.name.trim() : cur.name;
  let slug = cur.slug;
  if (u.slug !== undefined) {
    const s = slugify(u.slug);
    if (s) slug = await ensureUniqueSlug(s, id);
  }
  const status = u.status ?? cur.status;
  const language_style = u.languageStyle ?? cur.language_style;
  const prompt_addons = u.promptAddons !== undefined ? JSON.stringify(u.promptAddons) : cur.prompt_addons;
  if (u.name !== undefined && !name) throw new Error('Nome obrigatório.');
  if (u.name !== undefined && name !== cur.name) {
    const d = await query(`SELECT id FROM enterprises WHERE name = $1 AND id != $2`, [name, id]);
    if (d.rows.length) throw new Error('Já existe empreendimento com esse nome.');
  }
  const { rows } = await query<EnterpriseRow>(
    `UPDATE enterprises SET name = $1, slug = $2, status = $3, language_style = $4, prompt_addons = $5, updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [name, slug, status, language_style, prompt_addons, id]
  );
  return rows[0] ?? null;
}

export async function inactivateEnterprise(id: number): Promise<EnterpriseRow | null> {
  return updateEnterprise(id, { status: 'inativo' });
}

export function varsToFrontend(row: Record<string, string>) {
  return {
    priceLabel: row.preco ?? '',
    commercialConditions: row.condicoes ?? '',
    availability: row.disponibilidade ?? '',
    observations: row.observacoes ?? '',
  };
}

export async function getVariablesMap(enterpriseId: number): Promise<Record<string, string>> {
  const { rows } = await query<{ var_key: string; value: string }>(
    `SELECT var_key, value FROM enterprise_variables WHERE enterprise_id = $1`,
    [enterpriseId]
  );
  const m: Record<string, string> = {};
  for (const r of rows) m[r.var_key] = r.value ?? '';
  return m;
}

export async function setVariables(
  enterpriseId: number,
  v: { priceLabel?: string; commercialConditions?: string; availability?: string; observations?: string; notes?: string }
): Promise<void> {
  const map: [string, string][] = [
    ['preco', v.priceLabel ?? ''],
    ['condicoes', v.commercialConditions ?? ''],
    ['disponibilidade', v.availability ?? ''],
    ['observacoes', v.observations ?? v.notes ?? ''],
  ];
  for (const [key, value] of map) {
    await query(
      `INSERT INTO enterprise_variables (enterprise_id, var_key, value) VALUES ($1, $2, $3)
       ON CONFLICT (enterprise_id, var_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [enterpriseId, key, value]
    );
  }
}

export function parseAddons(json: string): string[] {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function sanitizeOriginalName(name: string): string {
  const s = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>:"/\\|?*\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = s || 'arquivo';
  return base.length > 180 ? base.slice(0, 180).trim() : base;
}

function normalizeExtractedText(s: string): string {
  return String(s || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function listEnterpriseFiles(enterpriseId: number): Promise<
  {
    id: number;
    category: string;
    original_name: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    is_active: boolean;
    created_at: Date;
  }[]
> {
  const { rows } = await query(
    `SELECT id, category, original_name, storage_path, mime_type, size_bytes, is_active, created_at
     FROM enterprise_files WHERE enterprise_id = $1 ORDER BY created_at`,
    [enterpriseId]
  );
  return rows as never[];
}

async function extractText(filePath: string, mime: string, originalName: string): Promise<string> {
  try {
    const buf = readFileSync(filePath);
    const lower = originalName.toLowerCase();
    if (mime.includes('text') || lower.endsWith('.txt') || lower.endsWith('.md')) {
      return normalizeExtractedText(buf.toString('utf-8')).slice(0, 500_000);
    }
    if (mime.includes('pdf') || lower.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default;
      const d = await pdfParse(buf);
      return normalizeExtractedText(d.text || '').slice(0, 500_000);
    }
    return '';
  } catch {
    return '';
  }
}

/** Arquivo já salvo em storage/empreendimentos/{id}/{storedFilename} (ex.: multer). */
export async function registerEnterpriseFile(
  enterpriseId: number,
  category: FileCategory,
  storedFilename: string,
  originalName: string,
  mime: string,
  size: number
): Promise<number> {
  const fullPath = join(enterpriseDir(enterpriseId), storedFilename);
  const safeOriginal = sanitizeOriginalName(originalName);
  const extracted = await extractText(fullPath, mime, safeOriginal);
  const { rows } = await query<{ id: number }>(
    `INSERT INTO enterprise_files (enterprise_id, category, original_name, storage_path, mime_type, size_bytes, extracted_text, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
    [enterpriseId, category, safeOriginal, storedFilename, mime, size, extracted || null]
  );
  return rows[0].id;
}

export type DeleteEnterpriseFileResult =
  | { ok: false; reason: 'not_found' }
  | { ok: true; mode: 'removed' }
  | { ok: true; mode: 'deactivated'; message: string };

const MSG_DEACTIVATED_HISTORICO =
  'Arquivo já utilizado em envios. Ele foi desativado, mas mantido no histórico.';

/**
 * Remove o arquivo do disco e do banco apenas se nunca entrou em `sent_files_log`.
 * Se já houver envios registrados, mantém a linha (FK) e o arquivo no storage, apenas `is_active = false`.
 */
export async function deleteEnterpriseFile(
  enterpriseId: number,
  fileId: number
): Promise<DeleteEnterpriseFileResult> {
  const { rows } = await query<{ storage_path: string }>(
    `SELECT storage_path FROM enterprise_files WHERE id = $1 AND enterprise_id = $2`,
    [fileId, enterpriseId]
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };

  const { rows: usedRows } = await query<{ used: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM sent_files_log WHERE enterprise_file_id = $1) AS used`,
    [fileId]
  );
  const hasSendHistory = usedRows[0]?.used === true;

  if (hasSendHistory) {
    await query(
      `UPDATE enterprise_files SET is_active = false WHERE id = $1 AND enterprise_id = $2`,
      [fileId, enterpriseId]
    );
    return { ok: true, mode: 'deactivated', message: MSG_DEACTIVATED_HISTORICO };
  }

  const p = join(enterpriseDir(enterpriseId), rows[0].storage_path);
  if (existsSync(p)) unlinkSync(p);
  await query(`DELETE FROM enterprise_files WHERE id = $1`, [fileId]);
  return { ok: true, mode: 'removed' };
}

const MAX_KNOWLEDGE = 48_000;

export async function loadAgentKnowledgeText(enterpriseId: number): Promise<string> {
  const { rows } = await query<{ original_name: string; extracted_text: string | null }>(
    `SELECT original_name, extracted_text FROM enterprise_files WHERE enterprise_id = $1 AND is_active = true ORDER BY category, id`,
    [enterpriseId]
  );
  const parts: string[] = [];
  let n = 0;
  for (const r of rows) {
    if (n >= MAX_KNOWLEDGE) break;
    const t = (r.extracted_text || '').trim();
    if (!t) continue;
    const h = `\n--- ${r.original_name} ---\n`;
    const piece = h + t.slice(0, MAX_KNOWLEDGE - n - h.length);
    parts.push(piece);
    n += piece.length;
  }
  return parts.join('\n').trim();
}

export async function getFileForSend(
  enterpriseId: number,
  category: FileCategory | string
): Promise<{ id: number; path: string; originalName: string; mime: string; relativeStoragePath: string } | null> {
  const catNorm = normalizeFileCategory(String(category));
  if (!catNorm) {
    console.warn('[getFileForSend] categoria inválida após normalização', { enterpriseId, category });
    return null;
  }

  const { rows } = await query<{ id: number; storage_path: string; original_name: string; mime_type: string }>(
    `SELECT id, storage_path, original_name, mime_type FROM enterprise_files
     WHERE enterprise_id = $1 AND category = $2 AND is_active = true
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [enterpriseId, catNorm]
  );
  const r = rows[0];
  if (!r) {
    const { rows: byEnt } = await query<{ category: string; n: string }>(
      `SELECT category, COUNT(*)::text AS n FROM enterprise_files WHERE enterprise_id = $1 GROUP BY category ORDER BY category`,
      [enterpriseId]
    );
    console.warn('[getFileForSend] nenhuma linha ativa para a categoria pedida', {
      enterpriseId,
      categoryRequested: catNorm,
      categoriesPresentInDb: byEnt.map((x) => `${x.category}(${x.n})`),
    });
    return null;
  }
  const path = join(enterpriseDir(enterpriseId), r.storage_path);
  if (!existsSync(path)) {
    console.warn('[getFileForSend] linha no banco mas arquivo ausente no disco', {
      enterpriseId,
      category: catNorm,
      enterprise_file_id: r.id,
      storage_path: r.storage_path,
      absolutePath: path,
    });
    return null;
  }
  return {
    id: r.id,
    path,
    originalName: r.original_name,
    mime: r.mime_type,
    relativeStoragePath: r.storage_path,
  };
}

export async function logSentFile(conversationId: number, enterpriseFileId: number): Promise<void> {
  await query(`INSERT INTO sent_files_log (conversation_id, enterprise_file_id) VALUES ($1, $2)`, [
    conversationId,
    enterpriseFileId,
  ]);
}

export function enterpriseToPublic(e: EnterpriseRow, vars: Record<string, string>) {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    status: e.status as 'ativo' | 'inativo',
    languageStyle: e.language_style as LanguageStyle,
    variables: varsToFrontend(vars),
    promptAddons: parseAddons(e.prompt_addons),
    createdAt: e.created_at.toISOString(),
    updatedAt: e.updated_at.toISOString(),
  };
}
