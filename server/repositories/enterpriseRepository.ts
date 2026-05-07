import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { getPool, query } from '../db/pg.js';
import { replaceEnterpriseFileChunks, splitTextIntoChunks } from './enterpriseKnowledgeChunkRepository.js';
import { downloadFromKnowledgeS3 } from '../services/s3Storage.js';

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
  allowedEnterpriseIds?: number[];
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
  if (filters?.allowedEnterpriseIds !== undefined) {
    if (filters.allowedEnterpriseIds.length === 0) {
      conds.push('FALSE');
    } else {
      conds.push(`id = ANY($${i++}::int[])`);
      params.push(filters.allowedEnterpriseIds);
    }
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
    return await extractTextFromBuffer(buf, mime, originalName);
  } catch {
    return '';
  }
}

async function extractTextFromBuffer(buf: Buffer, mime: string, originalName: string): Promise<string> {
  try {
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

type KnowledgeFileBackfillRow = {
  enterprise_id: number;
  enterprise_name: string;
  enterprise_city: string | null;
  file_id: number;
  current_version_id: number | null;
  file_version_id: number | null;
  original_name: string;
  storage_path: string;
  mime_type: string;
  can_be_used_as_knowledge: boolean;
  is_active: boolean;
  storage_provider: string | null;
  storage_key: string | null;
};

export interface KnowledgeFileBackfillTarget {
  enterpriseId: number;
  enterpriseName: string;
  enterpriseCity: string | null;
  fileId: number;
  originalName: string;
  mimeType: string;
  storagePath: string;
  isActive: boolean;
}

export interface ReindexKnowledgeBackfillResult {
  enterpriseId: number;
  enterpriseName: string;
  fileId: number;
  originalName: string;
  success: boolean;
  dryRun: boolean;
  chunksGenerated: number;
  extractedChars: number;
  reason?: string;
}

async function loadKnowledgeFileBufferForBackfill(
  row: KnowledgeFileBackfillRow
): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: string }> {
  if (row.current_version_id == null) {
    console.error('[KNOWLEDGE_CURRENT_VERSION_MISSING]', {
      enterpriseId: row.enterprise_id,
      enterpriseFileId: row.file_id,
      reason: 'current_version_id_is_null',
    });
    return { ok: false, reason: 'current_version_missing' };
  }
  if (row.file_version_id == null) {
    console.error('[KNOWLEDGE_CURRENT_VERSION_NOT_FOUND]', {
      enterpriseId: row.enterprise_id,
      enterpriseFileId: row.file_id,
      currentVersionId: row.current_version_id,
      reason: 'current_version_row_not_found',
    });
    return { ok: false, reason: 'current_version_not_found' };
  }
  if (row.storage_provider !== 's3') {
    console.error('[KNOWLEDGE_CURRENT_VERSION_NOT_S3]', {
      enterpriseId: row.enterprise_id,
      enterpriseFileId: row.file_id,
      fileVersionId: row.file_version_id,
      currentVersionId: row.current_version_id,
      storageProvider: row.storage_provider,
      message: 'Leitura operacional exige current_version em S3.',
    });
    return { ok: false, reason: 'current_version_not_s3' };
  }
  if (!row.storage_key) {
    console.error('[KNOWLEDGE_CURRENT_VERSION_S3_KEY_MISSING]', {
      enterpriseId: row.enterprise_id,
      enterpriseFileId: row.file_id,
      fileVersionId: row.file_version_id,
      currentVersionId: row.current_version_id,
      storageProvider: row.storage_provider,
    });
    return { ok: false, reason: 'current_version_s3_key_missing' };
  }

  const abs = join(enterpriseDir(row.enterprise_id), row.storage_path);
  if (existsSync(abs)) {
    try {
      return { ok: true, buffer: readFileSync(abs) };
    } catch (e) {
      return {
        ok: false,
        reason: `read_local_failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  const buf = await downloadFromKnowledgeS3(row.storage_key);
  if (buf) {
    try {
      writeFileSync(abs, buf);
    } catch {
      // cache local opcional; segue com o buffer em memória
    }
    return { ok: true, buffer: buf };
  }
  return { ok: false, reason: 's3_download_failed' };
}

export async function listKnowledgeFilesForBackfill(opts?: {
  enterpriseId?: number;
  fileId?: number;
  includeInactive?: boolean;
}): Promise<KnowledgeFileBackfillTarget[]> {
  const params: unknown[] = [];
  let i = 1;
  const where: string[] = [`f.can_be_used_as_knowledge = true`];
  if (!opts?.includeInactive) where.push(`f.is_active = true`);
  if (opts?.enterpriseId != null) {
    where.push(`f.enterprise_id = $${i++}`);
    params.push(opts.enterpriseId);
  }
  if (opts?.fileId != null) {
    where.push(`f.id = $${i++}`);
    params.push(opts.fileId);
  }
  const { rows } = await query<KnowledgeFileBackfillRow>(
    `SELECT
        f.enterprise_id,
        e.name AS enterprise_name,
        e.city AS enterprise_city,
        f.id AS file_id,
        f.current_version_id,
        v.id AS file_version_id,
        COALESCE(v.original_name, f.original_name) AS original_name,
        COALESCE(v.storage_path, f.storage_path) AS storage_path,
        COALESCE(v.mime_type, f.mime_type) AS mime_type,
        f.can_be_used_as_knowledge,
        f.is_active,
        COALESCE(v.storage_provider, f.storage_provider) AS storage_provider,
        COALESCE(v.storage_key, f.storage_key) AS storage_key
     FROM enterprise_files f
     INNER JOIN enterprises e ON e.id = f.enterprise_id
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE ${where.join(' AND ')}
     ORDER BY f.enterprise_id, f.id`,
    params
  );
  return rows.map((r) => ({
    enterpriseId: r.enterprise_id,
    enterpriseName: r.enterprise_name,
    enterpriseCity: r.enterprise_city,
    fileId: r.file_id,
    originalName: r.original_name,
    mimeType: r.mime_type,
    storagePath: r.storage_path,
    isActive: r.is_active,
  }));
}

export async function reindexKnowledgeFileForBackfill(
  fileId: number,
  opts?: { dryRun?: boolean }
): Promise<ReindexKnowledgeBackfillResult> {
  const { rows } = await query<KnowledgeFileBackfillRow>(
    `SELECT
        f.enterprise_id,
        e.name AS enterprise_name,
        e.city AS enterprise_city,
        f.id AS file_id,
        f.current_version_id,
        v.id AS file_version_id,
        COALESCE(v.original_name, f.original_name) AS original_name,
        COALESCE(v.storage_path, f.storage_path) AS storage_path,
        COALESCE(v.mime_type, f.mime_type) AS mime_type,
        f.can_be_used_as_knowledge,
        f.is_active,
        COALESCE(v.storage_provider, f.storage_provider) AS storage_provider,
        COALESCE(v.storage_key, f.storage_key) AS storage_key
     FROM enterprise_files f
     INNER JOIN enterprises e ON e.id = f.enterprise_id
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.id = $1
       AND f.can_be_used_as_knowledge = true
     LIMIT 1`,
    [fileId]
  );
  const row = rows[0];
  if (!row) {
    return {
      enterpriseId: 0,
      enterpriseName: '',
      fileId,
      originalName: '',
      success: false,
      dryRun: opts?.dryRun === true,
      chunksGenerated: 0,
      extractedChars: 0,
      reason: 'file_not_found_or_knowledge_disabled',
    };
  }

  const loaded = await loadKnowledgeFileBufferForBackfill(row);
  if (!loaded.ok) {
    return {
      enterpriseId: row.enterprise_id,
      enterpriseName: row.enterprise_name,
      fileId: row.file_id,
      originalName: row.original_name,
      success: false,
      dryRun: opts?.dryRun === true,
      chunksGenerated: 0,
      extractedChars: 0,
      reason: loaded.reason,
    };
  }

  const extracted = await extractTextFromBuffer(loaded.buffer, row.mime_type, row.original_name);
  const chunks = splitTextIntoChunks((extracted || '').trim(), 1800);
  if (opts?.dryRun === true) {
    return {
      enterpriseId: row.enterprise_id,
      enterpriseName: row.enterprise_name,
      fileId: row.file_id,
      originalName: row.original_name,
      success: true,
      dryRun: true,
      chunksGenerated: chunks.length,
      extractedChars: extracted.length,
      reason: extracted.trim() ? undefined : 'empty_extracted_text',
    };
  }

  try {
    await query(
      `UPDATE enterprise_files
       SET extracted_text = $1
       WHERE id = $2`,
      [extracted || null, row.file_id]
    );
    await replaceEnterpriseFileChunks(row.enterprise_id, row.file_id, extracted, {
      enterpriseName: row.enterprise_name,
      enterpriseCity: row.enterprise_city,
    });
    return {
      enterpriseId: row.enterprise_id,
      enterpriseName: row.enterprise_name,
      fileId: row.file_id,
      originalName: row.original_name,
      success: true,
      dryRun: false,
      chunksGenerated: chunks.length,
      extractedChars: extracted.length,
      reason: extracted.trim() ? undefined : 'empty_extracted_text',
    };
  } catch (e) {
    return {
      enterpriseId: row.enterprise_id,
      enterpriseName: row.enterprise_name,
      fileId: row.file_id,
      originalName: row.original_name,
      success: false,
      dryRun: false,
      chunksGenerated: chunks.length,
      extractedChars: extracted.length,
      reason: e instanceof Error ? e.message : String(e),
    };
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
  opts?: {
    canBeUsedAsKnowledge?: boolean;
    canBeSentByAna?: boolean;
    /** 's3' para uploads novos (storage oficial); 'local' mantido por compatibilidade legada. */
    storageProvider?: 's3' | 'local';
    /** Chave do objeto no bucket S3 (ex.: empreendimentos/7/1735-abc.pdf). */
    storageKey?: string;
    /** Nome do bucket S3. */
    bucketName?: string;
    /** URL pública do objeto (se bucket público ou custom domain). */
    publicUrl?: string | null;
  }
): Promise<number> {
  const fullPath = join(enterpriseDir(enterpriseId), storedFilename);
  const safeOriginal = sanitizeOriginalName(originalName);
  const storageProvider = opts?.storageProvider ?? 's3';

  console.log('[ENTERPRISE_FILE_UPLOAD_START]', {
    enterpriseId,
    storedFilename,
    originalName: safeOriginal,
    mime,
    sizeBytes: size,
    storageProvider,
    storageKey: opts?.storageKey ?? null,
    fullPath,
  });

  const extracted = await extractText(fullPath, mime, safeOriginal);

  // Para storage externo (S3): bytes já estão no bucket; não duplicar em BYTEA.
  // Para local (legado): guarda BYTEA como fallback para FS efêmero.
  let fileData: Buffer | null = null;
  if (storageProvider === 'local') {
    try {
      fileData = readFileSync(fullPath);
      console.log('[ENTERPRISE_FILE_UPLOAD_SAVED]', {
        enterpriseId,
        storedFilename,
        bytes: fileData.length,
        fileDataWillBePersisted: true,
        storageProvider,
      });
    } catch (readErr) {
      console.error('[ENTERPRISE_FILE_UPLOAD_SAVED] falha ao ler bytes para BYTEA', {
        enterpriseId,
        storedFilename,
        error: readErr instanceof Error ? readErr.message : String(readErr),
      });
    }
  } else {
    console.log('[ENTERPRISE_FILE_UPLOAD_SAVED]', {
      enterpriseId,
      storedFilename,
      storageProvider,
      storageKey: opts?.storageKey,
      note: 'Storage externo é fonte de verdade — BYTEA omitido',
    });
  }

  const canBeUsedAsKnowledge = opts?.canBeUsedAsKnowledge === true;
  const canBeSentByAna = opts?.canBeSentByAna === true;
  const { rows } = await query<{ id: number }>(
    `INSERT INTO enterprise_files
       (enterprise_id, category, original_name, storage_path, mime_type, size_bytes,
        extracted_text, is_active, can_be_used_as_knowledge, can_be_sent_by_ana,
        file_data, storage_provider, storage_key, bucket_name, public_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
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
      storageProvider,
      opts?.storageKey ?? null,
      opts?.bucketName ?? null,
      opts?.publicUrl ?? null,
    ]
  );
  const fileId = rows[0].id;
  console.log('[ENTERPRISE_FILE_DB_SAVED]', {
    enterpriseId,
    fileId,
    storedFilename,
    category,
    canBeSentByAna,
    storageProvider,
    storageKey: opts?.storageKey ?? null,
    fileDataStored: fileData != null,
    fileDataBytes: fileData?.length ?? 0,
  });
  await syncCurrentFileVersionAfterUploadOrPermissionChange({
    enterpriseId,
    enterpriseFileId: fileId,
    category,
    originalName: safeOriginal,
    mime,
    extractedText: extracted,
    canBeSentByAna,
    canBeUsedAsKnowledge,
  });
  return fileId;
}

async function syncCurrentFileVersionAfterUploadOrPermissionChange(opts: {
  enterpriseId: number;
  enterpriseFileId: number;
  category: FileCategory;
  originalName: string;
  mime: string;
  extractedText: string;
  canBeSentByAna: boolean;
  canBeUsedAsKnowledge: boolean;
}): Promise<void> {
  const { rows } = await query<{
    current_version_id: number | null;
    storage_key: string | null;
    bucket_name: string | null;
  }>(
    `SELECT f.current_version_id,
            COALESCE(v.storage_key, f.storage_key) AS storage_key,
            COALESCE(v.bucket_name, f.bucket_name) AS bucket_name
     FROM enterprise_files f
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.id = $1
       AND f.enterprise_id = $2`,
    [opts.enterpriseFileId, opts.enterpriseId]
  );
  const currentVersionId = rows[0]?.current_version_id ?? null;
  if (currentVersionId == null) {
    console.error('[KNOWLEDGE_UPLOAD_PROCESSING_DEBUG]', {
      enterpriseId: opts.enterpriseId,
      enterpriseFileId: opts.enterpriseFileId,
      fileVersionId: null,
      mimeType: opts.mime,
      extractedTextLength: opts.extractedText.length,
      chunksCreated: 0,
      processingStatus: 'FAILED',
      processingError: 'current_version_id_missing',
    });
    return;
  }

  let processingStatus: 'PROCESSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
  let processingError: string | null = null;
  let chunksCreated = 0;

  if (!opts.canBeUsedAsKnowledge) {
    await query(
      `UPDATE enterprise_knowledge_chunks
       SET is_active = false
       WHERE enterprise_file_version_id = $1
         AND is_active = true`,
      [currentVersionId]
    );
  } else if (opts.extractedText.trim()) {
    try {
      const enterprise = await getEnterpriseById(opts.enterpriseId);
      chunksCreated = await replaceEnterpriseFileChunks(opts.enterpriseId, opts.enterpriseFileId, opts.extractedText, {
        enterpriseName: enterprise?.name ?? null,
        enterpriseCity: enterprise?.city ?? null,
      });
      processingStatus = chunksCreated > 0 ? 'PROCESSED' : 'FAILED';
      processingError = chunksCreated > 0 ? null : 'no_chunks_created';
    } catch (e) {
      processingStatus = 'FAILED';
      processingError = e instanceof Error ? e.message : String(e);
      console.error('[knowledge_chunks] falha ao indexar arquivo', {
        enterpriseId: opts.enterpriseId,
        fileId: opts.enterpriseFileId,
        fileVersionId: currentVersionId,
        err: processingError,
      });
    }
  } else {
    processingStatus = 'FAILED';
    processingError = 'empty_extracted_text';
    await query(
      `UPDATE enterprise_knowledge_chunks
       SET is_active = false
       WHERE enterprise_file_version_id = $1
         AND is_active = true`,
      [currentVersionId]
    );
  }

  await query(
    `UPDATE enterprise_file_versions
     SET can_be_sent_by_ana = $2,
         can_be_used_as_knowledge = $3,
         is_active = true,
         processing_status = $4,
         processing_error = $5,
         processed_at = NOW(),
         chunk_count = $6,
         extracted_text = $7,
         storage_provider = 's3',
         storage_key = COALESCE(storage_key, $8),
         bucket_name = COALESCE(bucket_name, $9),
         file_kind = CASE
           WHEN $3 = false THEN file_kind
           WHEN $10 = 'book' THEN 'brochure'
           WHEN $10 = 'unidades' THEN 'floorplan'
           WHEN $10 = 'tabela_comercial' THEN 'price_table'
           ELSE 'unknown'
         END,
         source = COALESCE(NULLIF(source, ''), 'ui_upload'),
         source_priority = COALESCE(source_priority, 10)
     WHERE id = $1`,
    [
      currentVersionId,
      opts.canBeSentByAna,
      opts.canBeUsedAsKnowledge,
      processingStatus,
      processingError,
      chunksCreated,
      opts.extractedText || null,
      rows[0]?.storage_key ?? null,
      rows[0]?.bucket_name ?? null,
      opts.category,
    ]
  );

  const { rows: debugRows } = await query<{
    file_can_be_sent_by_ana: boolean;
    version_can_be_sent_by_ana: boolean;
    file_can_be_used_as_knowledge: boolean;
    version_can_be_used_as_knowledge: boolean;
    processing_status: string;
    chunk_count: number;
  }>(
    `SELECT
       f.can_be_sent_by_ana AS file_can_be_sent_by_ana,
       v.can_be_sent_by_ana AS version_can_be_sent_by_ana,
       f.can_be_used_as_knowledge AS file_can_be_used_as_knowledge,
       v.can_be_used_as_knowledge AS version_can_be_used_as_knowledge,
       v.processing_status,
       v.chunk_count
     FROM enterprise_files f
     INNER JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.id = $1
       AND f.enterprise_id = $2`,
    [opts.enterpriseFileId, opts.enterpriseId]
  );
  const debug = debugRows[0];
  console.error('[KNOWLEDGE_UPLOAD_FLAGS_DEBUG]', {
    enterpriseId: opts.enterpriseId,
    enterpriseFileId: opts.enterpriseFileId,
    fileVersionId: currentVersionId,
    originalName: opts.originalName,
    category: opts.category,
    fileCanBeSentByAna: debug?.file_can_be_sent_by_ana ?? opts.canBeSentByAna,
    versionCanBeSentByAna: debug?.version_can_be_sent_by_ana ?? opts.canBeSentByAna,
    fileCanBeUsedAsKnowledge: debug?.file_can_be_used_as_knowledge ?? opts.canBeUsedAsKnowledge,
    versionCanBeUsedAsKnowledge: debug?.version_can_be_used_as_knowledge ?? opts.canBeUsedAsKnowledge,
    processingStatus: debug?.processing_status ?? processingStatus,
    chunkCount: Number(debug?.chunk_count ?? chunksCreated),
  });
  console.error('[KNOWLEDGE_UPLOAD_PROCESSING_DEBUG]', {
    enterpriseId: opts.enterpriseId,
    enterpriseFileId: opts.enterpriseFileId,
    fileVersionId: currentVersionId,
    mimeType: opts.mime,
    extractedTextLength: opts.extractedText.length,
    chunksCreated,
    processingStatus,
    processingError,
  });
}

export async function updateEnterpriseFilePermissions(
  enterpriseId: number,
  fileId: number,
  patch: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean }
): Promise<boolean> {
  const { rows } = await query<{
    id: number;
    category: FileCategory;
    original_name: string;
    storage_path: string;
    mime_type: string;
    extracted_text: string | null;
    can_be_sent_by_ana: boolean;
    can_be_used_as_knowledge: boolean;
  }>(
    `UPDATE enterprise_files
     SET can_be_used_as_knowledge = COALESCE($3, can_be_used_as_knowledge),
         can_be_sent_by_ana = COALESCE($4, can_be_sent_by_ana)
     WHERE enterprise_id = $1
       AND id = $2
     RETURNING id, category, original_name, storage_path, mime_type, extracted_text,
               can_be_sent_by_ana, can_be_used_as_knowledge`,
    [enterpriseId, fileId, patch.canBeUsedAsKnowledge ?? null, patch.canBeSentByAna ?? null]
  );
  const updated = rows[0];
  if (!updated) return false;

  let extracted = updated.extracted_text ?? '';
  if (updated.can_be_used_as_knowledge && !extracted.trim()) {
    extracted = await extractText(join(enterpriseDir(enterpriseId), updated.storage_path), updated.mime_type, updated.original_name);
    await query(`UPDATE enterprise_files SET extracted_text = $1 WHERE id = $2`, [extracted || null, fileId]);
  }

  await syncCurrentFileVersionAfterUploadOrPermissionChange({
    enterpriseId,
    enterpriseFileId: fileId,
    category: updated.category,
    originalName: updated.original_name,
    mime: updated.mime_type,
    extractedText: extracted,
    canBeSentByAna: updated.can_be_sent_by_ana,
    canBeUsedAsKnowledge: updated.can_be_used_as_knowledge,
  });

  return true;
}

export type DeleteEnterpriseFileResult =
  | { ok: false; reason: 'not_found' }
  | {
      ok: true;
      removed: true;
      mode: 'hard_deleted';
      storageDeleteAttempted: boolean;
      storageDeleted: boolean;
      orphanedStorageKeys: string[];
    };

export async function deleteEnterpriseFile(
  enterpriseId: number,
  fileId: number
): Promise<DeleteEnterpriseFileResult> {
  const pool = getPool();
  const client = await pool.connect();

  let enterpriseFileId = fileId;
  let currentVersionId: number | null = null;
  let originalName = '';
  let category: string | null = null;
  let versionIds: number[] = [];
  let fileStorageRef: {
    storageProvider: string | null;
    bucketName: string | null;
    storageKey: string | null;
  } | null = null;
  let versionStorageRefs: Array<{
    versionId: number;
    storageProvider: string | null;
    bucketName: string | null;
    storageKey: string | null;
  }> = [];
  let chunksDeleted = 0;
  let sentFilesLogDeleted = 0;
  let currentVersionCleared = false;
  let versionsDeleted = 0;
  let filesDeleted = 0;
  const orphanedStorageKeySet = new Set<string>();

  try {
    await client.query('BEGIN');

    const { rows: fileRows } = await client.query<{
      id: number;
      current_version_id: number | null;
      original_name: string;
      category: string;
      storage_provider: string | null;
      bucket_name: string | null;
      storage_key: string | null;
    }>(
      `SELECT id, current_version_id, original_name, category, storage_provider, bucket_name, storage_key
       FROM enterprise_files
       WHERE enterprise_id = $1
         AND id = $2
       FOR UPDATE`,
      [enterpriseId, fileId]
    );

    const fileRow = fileRows[0];
    if (!fileRow) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    enterpriseFileId = fileRow.id;
    currentVersionId = fileRow.current_version_id;
    originalName = fileRow.original_name;
    category = fileRow.category;
    fileStorageRef = {
      storageProvider: fileRow.storage_provider,
      bucketName: fileRow.bucket_name,
      storageKey: fileRow.storage_key,
    };

    if ((fileRow.storage_key ?? '').trim()) {
      orphanedStorageKeySet.add((fileRow.storage_key ?? '').trim());
    }

    const { rows: versionRows } = await client.query<{
      id: number;
      storage_provider: string | null;
      bucket_name: string | null;
      storage_key: string | null;
    }>(
      `SELECT id, storage_provider, bucket_name, storage_key
       FROM enterprise_file_versions
       WHERE enterprise_file_id = $1
       ORDER BY id`,
      [enterpriseFileId]
    );

    versionIds = versionRows.map((row) => row.id);
    versionStorageRefs = versionRows.map((row) => ({
      versionId: row.id,
      storageProvider: row.storage_provider,
      bucketName: row.bucket_name,
      storageKey: row.storage_key,
    }));
    for (const row of versionRows) {
      if ((row.storage_key ?? '').trim()) {
        orphanedStorageKeySet.add((row.storage_key ?? '').trim());
      }
    }

    const chunksDeleteResult = await client.query(
      `DELETE FROM enterprise_knowledge_chunks
       WHERE enterprise_id = $1
         AND (
           enterprise_file_id = $2
           OR enterprise_file_version_id = ANY($3::int[])
         )`,
      [enterpriseId, enterpriseFileId, versionIds]
    );
    chunksDeleted = chunksDeleteResult.rowCount ?? 0;

    const sentFilesLogDeleteResult = await client.query(
      `DELETE FROM sent_files_log WHERE enterprise_file_id = $1`,
      [enterpriseFileId]
    );
    sentFilesLogDeleted = sentFilesLogDeleteResult.rowCount ?? 0;

    const clearCurrentVersionResult = await client.query(
      `UPDATE enterprise_files
          SET current_version_id = NULL
       WHERE enterprise_id = $1
         AND id = $2`,
      [enterpriseId, enterpriseFileId]
    );
    currentVersionCleared = (clearCurrentVersionResult.rowCount ?? 0) > 0;

    const versionsDeleteResult = await client.query(
      `DELETE FROM enterprise_file_versions WHERE enterprise_file_id = $1`,
      [enterpriseFileId]
    );
    versionsDeleted = versionsDeleteResult.rowCount ?? 0;

    const fileDeleteResult = await client.query(
      `DELETE FROM enterprise_files WHERE enterprise_id = $1 AND id = $2`,
      [enterpriseId, enterpriseFileId]
    );
    filesDeleted = fileDeleteResult.rowCount ?? 0;

    if (filesDeleted < 1) {
      throw new Error('Falha ao remover arquivo principal em hard delete.');
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignora rollback secundario
    }
    const fallbackOrphanedStorageKeys = Array.from(orphanedStorageKeySet);
    console.error('[FILE_HARD_DELETE_DEBUG]', {
      enterpriseId,
      enterpriseFileId,
      originalName,
      category,
      currentVersionId,
      versionIds,
      fileStorageRef,
      versionStorageRefs,
      chunksDeleted,
      sentFilesLogDeleted,
      currentVersionCleared,
      versionsDeleted,
      filesDeleted,
      storageDeleteAttempted: false,
      storageDeleted: false,
      orphanedStorageKeys: fallbackOrphanedStorageKeys,
      mode: 'hard_deleted',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }

  const orphanedStorageKeys = Array.from(orphanedStorageKeySet);
  console.error('[FILE_HARD_DELETE_DEBUG]', {
    enterpriseId,
    enterpriseFileId,
    originalName,
    category,
    currentVersionId,
    versionIds,
    fileStorageRef,
    versionStorageRefs,
    chunksDeleted,
    sentFilesLogDeleted,
    currentVersionCleared,
    versionsDeleted,
    filesDeleted,
    storageDeleteAttempted: false,
    storageDeleted: false,
    orphanedStorageKeys,
    mode: 'hard_deleted',
  });

  return {
    ok: true,
    removed: true,
    mode: 'hard_deleted',
    storageDeleteAttempted: false,
    storageDeleted: false,
    orphanedStorageKeys,
  };
}

const MAX_KNOWLEDGE = 48_000;

export async function loadAgentKnowledgeText(enterpriseId: number): Promise<string> {
  const { rows } = await query<{
    file_id: number;
    current_version_id: number | null;
    file_version_id: number | null;
    original_name: string;
    extracted_text: string | null;
    storage_provider: string | null;
  }>(
    `SELECT
        f.id AS file_id,
        f.current_version_id,
        v.id AS file_version_id,
        COALESCE(v.original_name, f.original_name) AS original_name,
        COALESCE(v.extracted_text, f.extracted_text) AS extracted_text,
        COALESCE(v.storage_provider, f.storage_provider) AS storage_provider
     FROM enterprise_files f
     INNER JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.enterprise_id = $1
       AND f.is_active = true
       AND f.can_be_used_as_knowledge = true
       AND v.is_active = true
       AND v.can_be_used_as_knowledge = true
       AND v.storage_provider = 's3'
       AND v.processing_status IN ('PROCESSED', 'SKIPPED')
     ORDER BY CASE f.category WHEN 'book' THEN 0 WHEN 'unidades' THEN 1 WHEN 'tabela_comercial' THEN 2 ELSE 3 END, f.id`,
    [enterpriseId]
  );
  const parts: string[] = [];
  let n = 0;
  for (const r of rows) {
    if (r.current_version_id == null || r.file_version_id == null) {
      console.error('[KNOWLEDGE_CURRENT_VERSION_INVALID]', {
        enterpriseId,
        enterpriseFileId: r.file_id,
        currentVersionId: r.current_version_id,
        reason: 'current_version_missing_or_not_found',
      });
      continue;
    }
    if (r.storage_provider !== 's3') {
      console.error('[KNOWLEDGE_CURRENT_VERSION_NOT_S3]', {
        enterpriseId,
        enterpriseFileId: r.file_id,
        fileVersionId: r.file_version_id,
        currentVersionId: r.current_version_id,
        storageProvider: r.storage_provider,
        message: 'Leitura operacional exige current_version em S3.',
      });
      continue;
    }
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

export type MaterialFileResolveFailureReason =
  | 'category_mismatch'
  | 'no_files_for_enterprise'
  | 'no_current_version'
  | 'file_not_sendable'
  | 'version_not_sendable'
  | 'missing_storage_key'
  | 's3_object_not_found';

type EnterpriseFileSendCandidateRow = {
  enterprise_file_id: number;
  file_category: string;
  file_is_active: boolean;
  file_can_be_sent_by_ana: boolean;
  current_version_id: number | null;
  file_version_id: number | null;
  version_enterprise_file_id: number | null;
  version_is_active: boolean | null;
  version_can_be_sent_by_ana: boolean | null;
  storage_path: string | null;
  original_name: string | null;
  mime_type: string | null;
  storage_provider: string | null;
  storage_key: string | null;
  bucket_name: string | null;
  created_at: Date;
};

export interface ResolvedSendableEnterpriseFile {
  id: number;
  versionId: number;
  category: FileCategory;
  path: string;
  originalName: string;
  mime: string;
  relativeStoragePath: string;
  storageProvider: string;
  storageKey: string;
  bucketName: string;
}
export interface ResolveSendableEnterpriseFileResult {
  category: FileCategory | null;
  candidateFilesCount: number;
  candidateVersionsCount: number;
  failureReason: MaterialFileResolveFailureReason | null;
  file: ResolvedSendableEnterpriseFile | null;
}

export async function resolveSendableEnterpriseFileCurrentVersion(
  enterpriseId: number,
  category: FileCategory | string
): Promise<ResolveSendableEnterpriseFileResult> {
  const catNorm = normalizeFileCategory(String(category));
  if (!catNorm) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      rawCategory: category,
      reason: 'category_mismatch',
    });
    return {
      category: null,
      candidateFilesCount: 0,
      candidateVersionsCount: 0,
      failureReason: 'category_mismatch',
      file: null,
    };
  }

  console.log('[ANA_DOC_LOOKUP_QUERY]', {
    enterpriseId,
    category: catNorm,
    table: 'enterprise_files + enterprise_file_versions',
    filters: {
      enterprise_id: enterpriseId,
      category: catNorm,
      file_is_active: true,
      file_can_be_sent_by_ana: true,
      version_is_active: true,
      version_can_be_sent_by_ana: true,
      storage_provider: 's3',
      current_version_required: true,
      storage_key_required: true,
      bucket_required: true,
    },
  });

  const { rows } = await query<EnterpriseFileSendCandidateRow>(
    `SELECT
       f.id AS enterprise_file_id,
       f.category AS file_category,
       f.is_active AS file_is_active,
       f.can_be_sent_by_ana AS file_can_be_sent_by_ana,
       f.current_version_id,
       v.id AS file_version_id,
       v.enterprise_file_id AS version_enterprise_file_id,
       v.is_active AS version_is_active,
       v.can_be_sent_by_ana AS version_can_be_sent_by_ana,
       COALESCE(v.storage_path, f.storage_path) AS storage_path,
       COALESCE(v.original_name, f.original_name) AS original_name,
       COALESCE(v.mime_type, f.mime_type) AS mime_type,
       COALESCE(v.storage_provider, f.storage_provider) AS storage_provider,
       COALESCE(v.storage_key, f.storage_key) AS storage_key,
       COALESCE(v.bucket_name, f.bucket_name) AS bucket_name,
       f.created_at
     FROM enterprise_files f
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.enterprise_id = $1
       AND f.category = $2
     ORDER BY f.created_at DESC, f.id DESC`,
    [enterpriseId, catNorm]
  );

  const candidateFilesCount = rows.length;
  const candidateVersionsCount = rows.filter((row) => row.file_version_id != null).length;

  if (candidateFilesCount === 0) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      category: catNorm,
      reason: 'no_files_for_enterprise',
    });
    return {
      category: catNorm,
      candidateFilesCount,
      candidateVersionsCount,
      failureReason: 'no_files_for_enterprise',
      file: null,
    };
  }

  const withCurrentVersion = rows.filter(
    (row) =>
      row.current_version_id != null &&
      row.file_version_id != null &&
      row.version_enterprise_file_id === row.enterprise_file_id
  );
  if (withCurrentVersion.length === 0) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      category: catNorm,
      reason: 'no_current_version',
      candidateFilesCount,
      candidateVersionsCount,
    });
    return {
      category: catNorm,
      candidateFilesCount,
      candidateVersionsCount,
      failureReason: 'no_current_version',
      file: null,
    };
  }

  const fileSendable = withCurrentVersion.filter((row) => row.file_is_active && row.file_can_be_sent_by_ana);
  if (fileSendable.length === 0) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      category: catNorm,
      reason: 'file_not_sendable',
      candidateFilesCount,
      candidateVersionsCount,
    });
    return {
      category: catNorm,
      candidateFilesCount,
      candidateVersionsCount,
      failureReason: 'file_not_sendable',
      file: null,
    };
  }

  const versionSendable = fileSendable.filter(
    (row) => row.version_is_active === true && row.version_can_be_sent_by_ana === true
  );
  if (versionSendable.length === 0) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      category: catNorm,
      reason: 'version_not_sendable',
      candidateFilesCount,
      candidateVersionsCount,
    });
    return {
      category: catNorm,
      candidateFilesCount,
      candidateVersionsCount,
      failureReason: 'version_not_sendable',
      file: null,
    };
  }

  const withValidStorage = versionSendable.filter(
    (row) =>
      String(row.storage_provider ?? '').toLowerCase() === 's3' &&
      Boolean(row.storage_key) &&
      Boolean(row.bucket_name) &&
      Boolean(row.storage_path) &&
      Boolean(row.original_name) &&
      Boolean(row.mime_type)
  );
  if (withValidStorage.length === 0) {
    console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
      enterpriseId,
      category: catNorm,
      reason: 'missing_storage_key',
      candidateFilesCount,
      candidateVersionsCount,
    });
    return {
      category: catNorm,
      candidateFilesCount,
      candidateVersionsCount,
      failureReason: 'missing_storage_key',
      file: null,
    };
  }

  const selected = withValidStorage[0]!;
  const storagePath = selected.storage_path!;
  const originalName = selected.original_name!;
  const mimeType = selected.mime_type!;
  const storageKey = selected.storage_key!;
  const bucketName = selected.bucket_name!;
  const versionId = selected.file_version_id!;
  const resolvedPath = join(enterpriseDir(enterpriseId), storagePath);
  const existsOnDisk = existsSync(resolvedPath);

  console.log('[ENTERPRISE_FILE_EXISTS_CHECK]', {
    enterpriseId,
    fileId: selected.enterprise_file_id,
    currentVersionId: selected.current_version_id,
    fileVersionId: versionId,
    storageProvider: selected.storage_provider,
    storageKey,
    bucketName,
    relativeStoragePath: storagePath,
    absolutePath: resolvedPath,
    existsOnDisk,
  });

  if (!existsOnDisk) {
    const buf = await downloadFromKnowledgeS3(storageKey, { bucket: bucketName });
    if (!buf) {
      console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
        enterpriseId,
        category: catNorm,
        reason: 's3_object_not_found',
        selectedFileId: selected.enterprise_file_id,
        selectedFileVersionId: versionId,
        selectedStorageKey: storageKey,
        selectedBucket: bucketName,
      });
      return {
        category: catNorm,
        candidateFilesCount,
        candidateVersionsCount,
        failureReason: 's3_object_not_found',
        file: null,
      };
    }
    try {
      writeFileSync(resolvedPath, buf);
      console.log('[ENTERPRISE_FILE_RESTORED_FROM_S3]', {
        enterpriseId,
        fileId: selected.enterprise_file_id,
        currentVersionId: selected.current_version_id,
        fileVersionId: versionId,
        storageKey,
        bucketName,
        bytes: buf.length,
        cachedAt: resolvedPath,
      });
    } catch (error) {
      console.error('[ENTERPRISE_FILE_RESTORE_FAILED]', {
        enterpriseId,
        fileId: selected.enterprise_file_id,
        source: 's3',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        category: catNorm,
        candidateFilesCount,
        candidateVersionsCount,
        failureReason: 's3_object_not_found',
        file: null,
      };
    }
  }

  const file: ResolvedSendableEnterpriseFile = {
    id: selected.enterprise_file_id,
    versionId,
    category: catNorm,
    path: resolvedPath,
    originalName,
    mime: mimeType,
    relativeStoragePath: storagePath,
    storageProvider: String(selected.storage_provider ?? 's3'),
    storageKey,
    bucketName,
  };

  console.log('[ANA_DOC_LOOKUP_RESULT]', {
    enterpriseId,
    category: catNorm,
    found: true,
    enterpriseFileId: file.id,
    currentVersionId: selected.current_version_id,
    fileVersionId: file.versionId,
    originalName: file.originalName,
    bucketName: file.bucketName,
    relativeStoragePath: file.relativeStoragePath,
    candidateFilesCount,
    candidateVersionsCount,
  });

  return {
    category: catNorm,
    candidateFilesCount,
    candidateVersionsCount,
    failureReason: null,
    file,
  };
}
export async function getFileForSend(
  enterpriseId: number,
  category: FileCategory | string
): Promise<ResolvedSendableEnterpriseFile | null> {
  const result = await resolveSendableEnterpriseFileCurrentVersion(enterpriseId, category);
  return result.file;
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
