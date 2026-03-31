import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pg.js';
import { replaceEnterpriseFileChunks } from './enterpriseKnowledgeChunkRepository.js';

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

export const ENTERPRISE_TIPOS = ['LOTEAMENTO', 'APARTAMENTO', 'MCMV'] as const;
export type EnterpriseTipo = (typeof ENTERPRISE_TIPOS)[number];

export interface EnterpriseRow {
  id: number;
  name: string;
  slug: string;
  status: string;
  language_style: string;
  prompt_addons: string;
  tipo: EnterpriseTipo;
  exclusivo: boolean;
  city?: string | null;
  state_uf?: string | null;
  commercial_region?: string | null;
  ibge_code?: string | null;
  created_at: Date;
  updated_at: Date;
}

function coerceEnterpriseTipo(raw: string | null | undefined): EnterpriseTipo {
  const u = String(raw || '').toUpperCase();
  return ENTERPRISE_TIPOS.includes(u as EnterpriseTipo) ? (u as EnterpriseTipo) : 'APARTAMENTO';
}

function rowEnterprise(r: EnterpriseRow): EnterpriseRow {
  const x = r as unknown as { tipo?: string; exclusivo?: boolean | null };
  return {
    ...r,
    tipo: coerceEnterpriseTipo(x.tipo),
    exclusivo: x.exclusivo === true,
  };
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

export interface ListEnterprisesFilters {
  tipo?: EnterpriseTipo;
  exclusivo?: boolean;
}

export async function listEnterprises(
  activeOnly: boolean,
  filters?: ListEnterprisesFilters
): Promise<EnterpriseRow[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (activeOnly) {
    conds.push(`status = 'ativo'`);
  }
  if (filters?.tipo) {
    conds.push(`tipo = $${i++}`);
    params.push(filters.tipo);
  }
  if (filters?.exclusivo !== undefined) {
    conds.push(`exclusivo = $${i++}`);
    params.push(filters.exclusivo);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const sql = `SELECT * FROM enterprises ${where} ORDER BY name`;
  const { rows } = await query<EnterpriseRow>(sql, params);
  return rows.map(rowEnterprise);
}

export async function getEnterpriseById(id: number): Promise<EnterpriseRow | null> {
  const { rows } = await query<EnterpriseRow>(`SELECT * FROM enterprises WHERE id = $1`, [id]);
  return rows[0] ? rowEnterprise(rows[0]) : null;
}

export async function getActiveEnterpriseById(id: number): Promise<EnterpriseRow | null> {
  const { rows } = await query<EnterpriseRow>(
    `SELECT * FROM enterprises WHERE id = $1 AND status = 'ativo'`,
    [id]
  );
  return rows[0] ? rowEnterprise(rows[0]) : null;
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
  opts?: { slug?: string; languageStyle?: LanguageStyle; tipo?: EnterpriseTipo; exclusivo?: boolean }
): Promise<EnterpriseRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nome obrigatório.');
  const dup = await query(`SELECT id FROM enterprises WHERE name = $1`, [trimmed]);
  if (dup.rows.length) throw new Error('Já existe empreendimento com esse nome.');
  const base = opts?.slug?.trim() ? slugify(opts.slug) : slugify(trimmed);
  const slug = await ensureUniqueSlug(base);
  const lang = opts?.languageStyle ?? 'natural';
  const tipo = opts?.tipo != null ? coerceEnterpriseTipo(opts.tipo) : 'APARTAMENTO';
  const exclusivo = opts?.exclusivo === true;
  const { rows } = await query<EnterpriseRow>(
    `INSERT INTO enterprises (name, slug, status, language_style, prompt_addons, tipo, exclusivo)
     VALUES ($1, $2, 'ativo', $3, '[]', $4, $5) RETURNING *`,
    [trimmed, slug, lang, tipo, exclusivo]
  );
  const ent = rowEnterprise(rows[0]);
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
    tipo?: EnterpriseTipo;
    exclusivo?: boolean;
    city?: string | null;
    stateUf?: string | null;
    commercialRegion?: string | null;
    ibgeCode?: string | null;
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
  const tipo = u.tipo !== undefined ? coerceEnterpriseTipo(u.tipo) : cur.tipo;
  const exclusivo = u.exclusivo !== undefined ? u.exclusivo : cur.exclusivo;
  console.log('[TIPO_DEBUG] updateEnterprise', { id, inputTipo: u.tipo, curTipo: cur.tipo, resolvedTipo: tipo });

  const city =
    u.city !== undefined ? ((u.city ?? '').trim() || null) : (cur.city ?? null);
  const state_uf =
    u.stateUf !== undefined
      ? ((u.stateUf ?? '').trim().toUpperCase().slice(0, 2) || null)
      : (cur.state_uf ?? null);
  const commercial_region =
    u.commercialRegion !== undefined
      ? ((u.commercialRegion ?? '').trim() || null)
      : (cur.commercial_region ?? null);
  const ibge_code =
    u.ibgeCode !== undefined
      ? ((u.ibgeCode ?? '').replace(/\D/g, '').slice(0, 12) || null)
      : (cur.ibge_code ?? null);

  if (u.name !== undefined && !name) throw new Error('Nome obrigatório.');
  if (u.name !== undefined && name !== cur.name) {
    const d = await query(`SELECT id FROM enterprises WHERE name = $1 AND id != $2`, [name, id]);
    if (d.rows.length) throw new Error('Já existe empreendimento com esse nome.');
  }
  const { rows } = await query<EnterpriseRow>(
    `UPDATE enterprises SET name = $1, slug = $2, status = $3, language_style = $4, prompt_addons = $5,
     city = $7, state_uf = $8, commercial_region = $9, ibge_code = $10, tipo = $11, exclusivo = $12,
     updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [name, slug, status, language_style, prompt_addons, id, city, state_uf, commercial_region, ibge_code, tipo, exclusivo]
  );
  return rows[0] ? rowEnterprise(rows[0]) : null;
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
    can_be_used_as_knowledge: boolean;
    can_be_sent_by_ana: boolean;
    created_at: Date;
  }[]
> {
  const { rows } = await query(
    `SELECT id, category, original_name, storage_path, mime_type, size_bytes, is_active,
            can_be_used_as_knowledge, can_be_sent_by_ana, created_at
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
    if (
      mime.includes('wordprocessingml') ||
      mime.includes('application/msword') ||
      lower.endsWith('.docx')
    ) {
      const mammoth = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer: buf });
      return normalizeExtractedText(r.value || '').slice(0, 500_000);
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
  size: number,
  opts?: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean }
): Promise<number> {
  const fullPath = join(enterpriseDir(enterpriseId), storedFilename);
  const safeOriginal = sanitizeOriginalName(originalName);

  console.log('[ENTERPRISE_FILE_UPLOAD_START]', {
    enterpriseId,
    storedFilename,
    originalName: safeOriginal,
    mime,
    sizeBytes: size,
    fullPath,
  });

  const extracted = await extractText(fullPath, mime, safeOriginal);

  // Lê os bytes do arquivo para persistir no PostgreSQL.
  // Resolve o problema de FS efêmero (Render sem Persistent Disk): mesmo após
  // restart/redeploy o arquivo pode ser restaurado automaticamente em disco.
  let fileData: Buffer | null = null;
  try {
    fileData = readFileSync(fullPath);
    console.log('[ENTERPRISE_FILE_UPLOAD_SAVED]', {
      enterpriseId,
      storedFilename,
      fullPath,
      bytes: fileData.length,
      fileDataWillBePersisted: true,
    });
  } catch (readErr) {
    console.error('[ENTERPRISE_FILE_UPLOAD_SAVED] falha ao ler bytes do arquivo para persistência no DB', {
      enterpriseId,
      storedFilename,
      fullPath,
      error: readErr instanceof Error ? readErr.message : String(readErr),
    });
  }

  const canBeUsedAsKnowledge = opts?.canBeUsedAsKnowledge !== false;
  const canBeSentByAna = opts?.canBeSentByAna === true;
  const { rows } = await query<{ id: number }>(
    `INSERT INTO enterprise_files (enterprise_id, category, original_name, storage_path, mime_type, size_bytes, extracted_text, is_active,
      can_be_used_as_knowledge, can_be_sent_by_ana, file_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10) RETURNING id`,
    [
      enterpriseId,
      category,
      safeOriginal,
      storedFilename,
      mime,
      size,
      extracted || null,
      canBeUsedAsKnowledge,
      canBeSentByAna,
      fileData,
    ]
  );
  const fileId = rows[0].id;
  console.log('[ENTERPRISE_FILE_DB_SAVED]', {
    enterpriseId,
    fileId,
    storedFilename,
    category,
    canBeSentByAna,
    fileDataStored: fileData != null,
    fileDataBytes: fileData?.length ?? 0,
  });
  if (canBeUsedAsKnowledge && (extracted || '').trim()) {
    try {
      await replaceEnterpriseFileChunks(enterpriseId, fileId, extracted);
    } catch (e) {
      console.error('[knowledge_chunks] falha ao indexar arquivo', {
        enterpriseId,
        fileId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return fileId;
}

export async function updateEnterpriseFilePermissions(
  enterpriseId: number,
  fileId: number,
  patch: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean }
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.canBeUsedAsKnowledge !== undefined) {
    sets.push(`can_be_used_as_knowledge = $${i++}`);
    vals.push(patch.canBeUsedAsKnowledge);
  }
  if (patch.canBeSentByAna !== undefined) {
    sets.push(`can_be_sent_by_ana = $${i++}`);
    vals.push(patch.canBeSentByAna);
  }
  if (sets.length === 0) return true;
  const idxEnt = i++;
  const idxFile = i++;
  vals.push(enterpriseId, fileId);
  const { rowCount } = await query(
    `UPDATE enterprise_files SET ${sets.join(', ')} WHERE enterprise_id = $${idxEnt} AND id = $${idxFile}`,
    vals
  );
  return (rowCount ?? 0) > 0;
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
    `SELECT original_name, extracted_text FROM enterprise_files
     WHERE enterprise_id = $1 AND is_active = true AND can_be_used_as_knowledge = true
     ORDER BY CASE category WHEN 'book' THEN 0 WHEN 'unidades' THEN 1 WHEN 'tabela_comercial' THEN 2 ELSE 3 END, id`,
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

/**
 * Inventário completo de `enterprise_files` para comparar UI vs elegibilidade de envio.
 * Base de conhecimento usa `can_be_used_as_knowledge`; envio exige também `can_be_sent_by_ana`.
 */
export async function logAnaDocInventoryForEnterprise(enterpriseId: number): Promise<void> {
  const { rows } = await query<{
    id: number;
    enterprise_id: number;
    category: string;
    original_name: string;
    storage_path: string;
    mime_type: string;
    is_active: boolean;
    can_be_used_as_knowledge: boolean;
    can_be_sent_by_ana: boolean;
    created_at: Date;
  }>(
    `SELECT id, enterprise_id, category, original_name, storage_path, mime_type, is_active,
            can_be_used_as_knowledge, can_be_sent_by_ana, created_at
     FROM enterprise_files WHERE enterprise_id = $1 ORDER BY id`,
    [enterpriseId]
  );
  const root = enterpriseDir(enterpriseId);
  const files = rows.map((r) => {
    const abs = join(root, r.storage_path);
    const onDisk = existsSync(abs);
    const mismatchKnowledgeVsSend =
      r.can_be_used_as_knowledge === true &&
      r.can_be_sent_by_ana === false &&
      r.is_active === true;
    return {
      id: r.id,
      enterpriseId: r.enterprise_id,
      category: r.category,
      originalName: r.original_name,
      relativeStoragePath: r.storage_path,
      mimeType: r.mime_type,
      isActive: r.is_active,
      useAsKnowledge: r.can_be_used_as_knowledge,
      canBeSentByAna: r.can_be_sent_by_ana,
      createdAt: r.created_at.toISOString(),
      existsOnDisk: onDisk,
      matchesSendQuery: r.is_active && r.can_be_sent_by_ana,
      /** Se true, a Ana usa o texto na base mas `getFileForSend` ignora a linha. */
      knowledgeOnlyNoSendFlag: mismatchKnowledgeVsSend,
    };
  });
  console.log('[ANA_DOC_INVENTORY]', {
    enterpriseId,
    fileCount: files.length,
    files,
  });
}

export async function getFileForSend(
  enterpriseId: number,
  category: FileCategory | string
): Promise<{ id: number; path: string; originalName: string; mime: string; relativeStoragePath: string } | null> {
  const catNorm = normalizeFileCategory(String(category));
  if (!catNorm) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      rawCategory: category,
      reason: 'invalid_category_after_normalize',
    });
    console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: String(category), found: false });
    return null;
  }

  console.log('[ENTERPRISE_FILE_RESOLVE_PATH]', { enterpriseId, category: catNorm });
  console.log('[ANA_DOC_LOOKUP_QUERY]', {
    enterpriseId,
    category: catNorm,
    table: 'enterprise_files',
    filters: {
      enterprise_id: enterpriseId,
      category: catNorm,
      is_active: true,
      can_be_sent_by_ana: true,
    },
  });

  const { rows } = await query<{
    id: number;
    storage_path: string;
    original_name: string;
    mime_type: string;
    file_data: Buffer | null;
  }>(
    `SELECT id, storage_path, original_name, mime_type, file_data FROM enterprise_files
     WHERE enterprise_id = $1 AND category = $2 AND is_active = true AND can_be_sent_by_ana = true
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [enterpriseId, catNorm]
  );
  const r = rows[0];
  if (!r) {
    const { rows: sameCatActive } = await query<{
      id: number;
      is_active: boolean;
      can_be_sent_by_ana: boolean;
      can_be_used_as_knowledge: boolean;
      original_name: string;
    }>(
      `SELECT id, is_active, can_be_sent_by_ana, can_be_used_as_knowledge, original_name
       FROM enterprise_files
       WHERE enterprise_id = $1 AND category = $2
       ORDER BY id DESC
       LIMIT 10`,
      [enterpriseId, catNorm]
    );
    if (sameCatActive.length === 0) {
      const { rows: byEnt } = await query<{ category: string; n: string }>(
        `SELECT category, COUNT(*)::text AS n FROM enterprise_files WHERE enterprise_id = $1 GROUP BY category ORDER BY category`,
        [enterpriseId]
      );
      console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
        enterpriseId,
        category: catNorm,
        reason: 'no_row_for_category',
        categoriesPresentInDb: byEnt.map((x) => `${x.category}(${x.n})`),
      });
    } else {
      const blocked = sameCatActive.filter((x) => !x.is_active || !x.can_be_sent_by_ana);
      console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
        enterpriseId,
        category: catNorm,
        reason: 'row_exists_but_fails_send_filters',
        detail:
          blocked.some((x) => !x.is_active) ? 'inactive_row' : 'can_be_sent_by_ana_false',
        rowsInCategory: sameCatActive,
        hint:
          sameCatActive.some((x) => x.can_be_used_as_knowledge && !x.can_be_sent_by_ana)
            ? 'Arquivo na base de conhecimento (can_be_used_as_knowledge) mas "Enviar ao cliente" desligado no banco (can_be_sent_by_ana=false). Ative no admin ou PATCH /projects/:id/knowledge/:fileId.'
            : undefined,
      });
    }
    console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
    return null;
  }

  const resolvedPath = join(enterpriseDir(enterpriseId), r.storage_path);
  const fileExistsOnDisk = existsSync(resolvedPath);

  console.log('[ENTERPRISE_FILE_EXISTS_CHECK]', {
    enterpriseId,
    fileId: r.id,
    relativeStoragePath: r.storage_path,
    absolutePath: resolvedPath,
    existsOnDisk: fileExistsOnDisk,
    fileDataAvailable: r.file_data != null,
    fileDataBytes: r.file_data?.length ?? 0,
  });

  if (!fileExistsOnDisk) {
    if (r.file_data) {
      // Arquivo não está no disco (FS efêmero após restart/redeploy).
      // Restaura a partir dos bytes persistidos no PostgreSQL.
      try {
        writeFileSync(resolvedPath, r.file_data);
        console.log('[ENTERPRISE_FILE_RESTORED_FROM_DB]', {
          enterpriseId,
          fileId: r.id,
          relativeStoragePath: r.storage_path,
          absolutePath: resolvedPath,
          bytes: r.file_data.length,
        });
      } catch (restoreErr) {
        console.error('[ENTERPRISE_FILE_RESTORE_FAILED]', {
          enterpriseId,
          fileId: r.id,
          relativeStoragePath: r.storage_path,
          absolutePath: resolvedPath,
          error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
        console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
        return null;
      }
    } else {
      // Registro antigo (antes da migration 027) sem file_data: não é possível restaurar.
      console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
        enterpriseId,
        category: catNorm,
        enterpriseFileId: r.id,
        reason: 'row_ok_but_file_missing_on_disk',
        relativeStoragePath: r.storage_path,
        absolutePath: resolvedPath,
        fileDataAvailable: false,
        hint: 'Registro anterior à migration 027 — sem file_data no banco. Reenvie o arquivo pelo admin para que fique persistente.',
      });
      console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
      return null;
    }
  }

  console.log('[ANA_DOC_LOOKUP_RESULT]', {
    enterpriseId,
    category: catNorm,
    found: true,
    enterpriseFileId: r.id,
    originalName: r.original_name,
    relativeStoragePath: r.storage_path,
    existsOnDisk: true,
    restoredFromDb: !fileExistsOnDisk,
  });
  return {
    id: r.id,
    path: resolvedPath,
    originalName: r.original_name,
    mime: r.mime_type,
    relativeStoragePath: r.storage_path,
  };
}

export async function logSentFile(conversationId: number, enterpriseFileId: number): Promise<void> {
  try {
    await query(`INSERT INTO sent_files_log (conversation_id, enterprise_file_id) VALUES ($1, $2)`, [
      conversationId,
      enterpriseFileId,
    ]);
    console.log('[DOC_FLOW] sent_files_log inserido', { conversationId, enterpriseFileId });
  } catch (e) {
    console.error('[DOC_FLOW] falha ao inserir sent_files_log', {
      conversationId,
      enterpriseFileId,
      err: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export function enterpriseToPublic(e: EnterpriseRow, vars: Record<string, string>) {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    status: e.status as 'ativo' | 'inativo',
    languageStyle: e.language_style as LanguageStyle,
    tipo: e.tipo,
    exclusivo: e.exclusivo,
    variables: varsToFrontend(vars),
    promptAddons: parseAddons(e.prompt_addons),
    city: e.city ?? '',
    stateUf: e.state_uf ?? '',
    commercialRegion: e.commercial_region ?? '',
    ibgeCode: e.ibge_code ?? '',
    createdAt: e.created_at.toISOString(),
    updatedAt: e.updated_at.toISOString(),
  };
}
