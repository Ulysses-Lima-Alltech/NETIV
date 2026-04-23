import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { query } from '../db/pg.js';
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

  const canBeUsedAsKnowledge = opts?.canBeUsedAsKnowledge !== false;
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
  if (canBeUsedAsKnowledge && (extracted || '').trim()) {
    try {
      const enterprise = await getEnterpriseById(enterpriseId);
      await replaceEnterpriseFileChunks(enterpriseId, fileId, extracted, {
        enterpriseName: enterprise?.name ?? null,
        enterpriseCity: enterprise?.city ?? null,
      });
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
  const { rows } = await query<{
    storage_path: string;
    storage_provider: string | null;
  }>(
    `SELECT storage_path, storage_provider FROM enterprise_files WHERE id = $1 AND enterprise_id = $2`,
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

  if (rows[0].storage_provider === 'r2') {
    console.error('[KNOWLEDGE_DELETE_LEGACY_R2_REFERENCE]', {
      enterpriseId,
      enterpriseFileId: fileId,
      message: 'Referência legada em R2 detectada. Remoção remota não é executada no runtime S3-only.',
    });
  }
  // Remove cache local (pode não existir em FS efêmero — ok ignorar).
  const p = join(enterpriseDir(enterpriseId), rows[0].storage_path);
  if (existsSync(p)) unlinkSync(p);
  await query(`DELETE FROM enterprise_files WHERE id = $1`, [fileId]);
  return { ok: true, mode: 'removed' };
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
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.enterprise_id = $1
       AND f.is_active = true
       AND f.can_be_used_as_knowledge = true
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
    table: 'enterprise_files + enterprise_file_versions',
    filters: {
      enterprise_id: enterpriseId,
      category: catNorm,
      is_active: true,
      can_be_sent_by_ana: true,
      current_version_required: true,
      current_version_storage_provider: 's3',
    },
  });

  const { rows } = await query<{
    enterprise_file_id: number;
    current_version_id: number | null;
    file_version_id: number | null;
    storage_path: string;
    original_name: string;
    mime_type: string;
    storage_provider: string | null;
    storage_key: string | null;
  }>(
    `SELECT
        f.id AS enterprise_file_id,
        f.current_version_id,
        v.id AS file_version_id,
        COALESCE(v.storage_path, f.storage_path) AS storage_path,
        COALESCE(v.original_name, f.original_name) AS original_name,
        COALESCE(v.mime_type, f.mime_type) AS mime_type,
        COALESCE(v.storage_provider, f.storage_provider) AS storage_provider,
        COALESCE(v.storage_key, f.storage_key) AS storage_key
     FROM enterprise_files f
     LEFT JOIN enterprise_file_versions v
       ON v.id = f.current_version_id
      AND v.enterprise_file_id = f.id
     WHERE f.enterprise_id = $1 AND f.category = $2 AND f.is_active = true AND f.can_be_sent_by_ana = true
     ORDER BY f.created_at DESC, f.id DESC
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

  if (r.current_version_id == null || r.file_version_id == null) {
    console.error('[ANA_DOC_CURRENT_VERSION_INVALID]', {
      enterpriseId,
      category: catNorm,
      enterpriseFileId: r.enterprise_file_id,
      currentVersionId: r.current_version_id,
      reason: 'current_version_missing_or_not_found',
    });
    console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
    return null;
  }
  if (r.storage_provider !== 's3') {
    console.error('[ANA_DOC_CURRENT_VERSION_NOT_S3]', {
      enterpriseId,
      category: catNorm,
      enterpriseFileId: r.enterprise_file_id,
      currentVersionId: r.current_version_id,
      fileVersionId: r.file_version_id,
      storageProvider: r.storage_provider,
      message: 'Envio de material exige current_version em S3. Fallback para R2 está bloqueado.',
    });
    console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
    return null;
  }
  if (!r.storage_key) {
    console.error('[ANA_DOC_CURRENT_VERSION_S3_KEY_MISSING]', {
      enterpriseId,
      category: catNorm,
      enterpriseFileId: r.enterprise_file_id,
      currentVersionId: r.current_version_id,
      fileVersionId: r.file_version_id,
    });
    console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
    return null;
  }

  const resolvedPath = join(enterpriseDir(enterpriseId), r.storage_path);
  const fileExistsOnDisk = existsSync(resolvedPath);

  console.log('[ENTERPRISE_FILE_EXISTS_CHECK]', {
    enterpriseId,
    fileId: r.enterprise_file_id,
    currentVersionId: r.current_version_id,
    fileVersionId: r.file_version_id,
    storageProvider: r.storage_provider,
    storageKey: r.storage_key,
    relativeStoragePath: r.storage_path,
    absolutePath: resolvedPath,
    existsOnDisk: fileExistsOnDisk,
  });

  if (!fileExistsOnDisk) {
    const buf = await downloadFromKnowledgeS3(r.storage_key);
    if (!buf) {
      console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
        enterpriseId,
        category: catNorm,
        enterpriseFileId: r.enterprise_file_id,
        currentVersionId: r.current_version_id,
        fileVersionId: r.file_version_id,
        reason: 's3_download_failed',
        storageProvider: r.storage_provider,
        storageKey: r.storage_key,
        relativeStoragePath: r.storage_path,
        absolutePath: resolvedPath,
      });
      console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
      return null;
    }
    try {
      writeFileSync(resolvedPath, buf);
      console.log('[ENTERPRISE_FILE_RESTORED_FROM_S3]', {
        enterpriseId,
        fileId: r.enterprise_file_id,
        currentVersionId: r.current_version_id,
        fileVersionId: r.file_version_id,
        storageKey: r.storage_key,
        bytes: buf.length,
        cachedAt: resolvedPath,
      });
    } catch (writeErr) {
      console.error('[ENTERPRISE_FILE_RESTORE_FAILED]', {
        enterpriseId,
        fileId: r.enterprise_file_id,
        source: 's3',
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
      console.log('[ANA_DOC_LOOKUP_RESULT]', { enterpriseId, category: catNorm, found: false });
      return null;
    }
  }

  console.log('[ANA_DOC_LOOKUP_RESULT]', {
    enterpriseId,
    category: catNorm,
    found: true,
    enterpriseFileId: r.enterprise_file_id,
    currentVersionId: r.current_version_id,
    fileVersionId: r.file_version_id,
    originalName: r.original_name,
    relativeStoragePath: r.storage_path,
    existsOnDisk: true,
    restoredFromDb: !fileExistsOnDisk,
  });
  return {
    id: r.enterprise_file_id,
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
