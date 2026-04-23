import { getPool, query } from '../db/pg.js';
import type { FileKind, ProcessingStatus } from '../services/knowledgeIngestionPolicy.js';

export interface IngestionTarget {
  fileVersionId: number;
  enterpriseFileId: number;
  enterpriseId: number;
  enterpriseName: string;
  versionNumber: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string | null;
  storageKey: string | null;
  bucketName: string | null;
  fileData: Buffer | null;
  processingStatus: ProcessingStatus | null;
  textHash: string | null;
  chunkCount: number;
  source: string | null;
  sourcePriority: number | null;
  canBeSentByAna: boolean;
  canBeUsedAsKnowledge: boolean;
  isActive: boolean;
}

interface IngestionTargetRow {
  file_version_id: number;
  enterprise_file_id: number;
  enterprise_id: number;
  enterprise_name: string;
  version_number: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_provider: string | null;
  storage_key: string | null;
  bucket_name: string | null;
  file_data: Buffer | null;
  processing_status: ProcessingStatus | null;
  text_hash: string | null;
  chunk_count: number;
  source: string | null;
  source_priority: number | null;
  can_be_sent_by_ana: boolean;
  can_be_used_as_knowledge: boolean;
  is_active: boolean;
}

export async function listEnterpriseFileVersionIngestionTargets(opts?: {
  enterpriseId?: number;
  fileVersionId?: number;
  limit?: number;
  reprocess?: boolean;
}): Promise<IngestionTarget[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (opts?.enterpriseId != null) {
    where.push(`f.enterprise_id = $${i++}`);
    params.push(opts.enterpriseId);
  }

  if (opts?.fileVersionId != null) {
    where.push(`v.id = $${i++}`);
    params.push(opts.fileVersionId);
  }

  where.push(`COALESCE(v.storage_provider, '') = 's3'`);
  where.push(`f.current_version_id = v.id`);

  if (!opts?.reprocess) {
    where.push(`COALESCE(v.processing_status, 'PENDING') IN ('PENDING', 'FAILED', 'SKIPPED')`);
  }

  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 500));
  params.push(limit);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query<IngestionTargetRow>(
    `SELECT
        v.id AS file_version_id,
        v.enterprise_file_id,
        f.enterprise_id,
        e.name AS enterprise_name,
        v.version_number,
        v.original_name,
        v.mime_type,
        v.size_bytes,
        v.storage_provider,
        v.storage_key,
        v.bucket_name,
        v.file_data,
        v.processing_status,
        v.text_hash,
        v.chunk_count,
        v.source,
        v.source_priority,
        COALESCE(v.can_be_sent_by_ana, f.can_be_sent_by_ana, false) AS can_be_sent_by_ana,
        COALESCE(v.can_be_used_as_knowledge, f.can_be_used_as_knowledge, true) AS can_be_used_as_knowledge,
        COALESCE(v.is_active, f.is_active, true) AS is_active
     FROM enterprise_file_versions v
     INNER JOIN enterprise_files f ON f.id = v.enterprise_file_id
     INNER JOIN enterprises e ON e.id = f.enterprise_id
     ${whereSql}
     ORDER BY f.enterprise_id, v.id
     LIMIT $${i}`,
    params
  );

  return rows.map((row) => ({
    fileVersionId: row.file_version_id,
    enterpriseFileId: row.enterprise_file_id,
    enterpriseId: row.enterprise_id,
    enterpriseName: row.enterprise_name,
    versionNumber: row.version_number,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    bucketName: row.bucket_name,
    fileData: row.file_data,
    processingStatus: row.processing_status,
    textHash: row.text_hash,
    chunkCount: Number(row.chunk_count ?? 0),
    source: row.source,
    sourcePriority: row.source_priority,
    canBeSentByAna: row.can_be_sent_by_ana,
    canBeUsedAsKnowledge: row.can_be_used_as_knowledge,
    isActive: row.is_active,
  }));
}

export async function markVersionProcessing(fileVersionId: number): Promise<void> {
  await query(
    `UPDATE enterprise_file_versions
     SET processing_status = 'PROCESSING',
         processing_error = NULL,
         processed_at = NULL
     WHERE id = $1`,
    [fileVersionId]
  );
}

export async function markVersionFailed(opts: {
  fileVersionId: number;
  processingError: string;
  failedS3Key: string | null;
}): Promise<void> {
  await query(
    `UPDATE enterprise_file_versions
     SET processing_status = 'FAILED',
         processing_error = $2,
         failed_s3_key = $3,
         processed_at = NOW()
     WHERE id = $1`,
    [opts.fileVersionId, opts.processingError.slice(0, 4000), opts.failedS3Key]
  );
}

export async function markVersionSkipped(opts: {
  fileVersionId: number;
  fileKind: FileKind;
  source: string;
  sourcePriority: number;
  canBeSentByAna: boolean;
  canBeUsedAsKnowledge: boolean;
  isActive: boolean;
  extractedTextSource: string;
  textHash: string | null;
  chunkCount: number;
  rawS3Key: string | null;
  extractedS3Key: string | null;
  normalizedS3Key: string | null;
  manifestS3Key: string | null;
  failedS3Key: string | null;
  processingError: string | null;
  s3Bucket: string;
  deactivateActiveChunks: boolean;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (opts.deactivateActiveChunks) {
      await client.query(
        `UPDATE enterprise_knowledge_chunks
         SET is_active = false
         WHERE enterprise_file_version_id = $1
           AND is_active = true`,
        [opts.fileVersionId]
      );
    }

    await client.query(
      `UPDATE enterprise_file_versions
       SET file_kind = $2,
           source = $3,
           source_priority = $4,
           can_be_sent_by_ana = $5,
           can_be_used_as_knowledge = $6,
           is_active = $7,
           processing_status = 'SKIPPED',
           processing_error = $8,
           processed_at = NOW(),
           extracted_text_source = $9,
           text_hash = $10,
           chunk_count = $11,
           raw_s3_key = $12,
           extracted_s3_key = $13,
           normalized_s3_key = $14,
           manifest_s3_key = $15,
           failed_s3_key = $16,
           storage_provider = 's3',
           storage_key = $12,
           bucket_name = $17
       WHERE id = $1`,
      [
        opts.fileVersionId,
        opts.fileKind,
        opts.source,
        opts.sourcePriority,
        opts.canBeSentByAna,
        opts.canBeUsedAsKnowledge,
        opts.isActive,
        opts.processingError,
        opts.extractedTextSource,
        opts.textHash,
        opts.chunkCount,
        opts.rawS3Key,
        opts.extractedS3Key,
        opts.normalizedS3Key,
        opts.manifestS3Key,
        opts.failedS3Key,
        opts.s3Bucket,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface ChunkInsertRow {
  chunkIndex: number;
  content: string;
  knowledgeBlock: 'facts' | 'commercial_intent' | 'variable_data' | 'ana_rules';
  blockPriority: number;
  cityHint: string | null;
  enterpriseHint: string | null;
  intentTags: string[];
  temporalStatus: 'atemporal' | 'current' | 'time_sensitive' | 'expired';
  sourceConfidence: number;
}

export async function replaceVersionChunksAndMarkProcessed(opts: {
  fileVersionId: number;
  enterpriseId: number;
  enterpriseFileId: number;
  fileKind: FileKind;
  source: string;
  sourcePriority: number;
  canBeSentByAna: boolean;
  canBeUsedAsKnowledge: boolean;
  isActive: boolean;
  extractedTextSource: string;
  textHash: string;
  rawS3Key: string;
  extractedS3Key: string;
  normalizedS3Key: string;
  manifestS3Key: string;
  failedS3Key: string | null;
  s3Bucket: string;
  chunks: ChunkInsertRow[];
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE enterprise_knowledge_chunks
       SET is_active = false
       WHERE enterprise_file_version_id = $1
         AND is_active = true`,
      [opts.fileVersionId]
    );

    for (const chunk of opts.chunks) {
      await client.query(
        `INSERT INTO enterprise_knowledge_chunks (
           enterprise_id,
           enterprise_file_id,
           enterprise_file_version_id,
           chunk_index,
           content,
           is_active,
           knowledge_block,
           block_priority,
           city_hint,
           enterprise_hint,
           intent_tags,
           temporal_status,
           source_confidence
         )
         VALUES (
           $1, $2, $3, $4, $5, true,
           $6, $7, $8, $9, $10::text[], $11, $12
         )`,
        [
          opts.enterpriseId,
          opts.enterpriseFileId,
          opts.fileVersionId,
          chunk.chunkIndex,
          chunk.content,
          chunk.knowledgeBlock,
          chunk.blockPriority,
          chunk.cityHint,
          chunk.enterpriseHint,
          chunk.intentTags,
          chunk.temporalStatus,
          chunk.sourceConfidence,
        ]
      );
    }

    await client.query(
      `UPDATE enterprise_file_versions
       SET file_kind = $2,
           source = $3,
           source_priority = $4,
           can_be_sent_by_ana = $5,
           can_be_used_as_knowledge = $6,
           is_active = $7,
           processing_status = 'PROCESSED',
           processing_error = NULL,
           processed_at = NOW(),
           extracted_text_source = $8,
           text_hash = $9,
           chunk_count = $10,
           manifest_s3_key = $11,
           raw_s3_key = $12,
           extracted_s3_key = $13,
           normalized_s3_key = $14,
           failed_s3_key = $15,
           storage_provider = 's3',
           storage_key = $12,
           bucket_name = $16
       WHERE id = $1`,
      [
        opts.fileVersionId,
        opts.fileKind,
        opts.source,
        opts.sourcePriority,
        opts.canBeSentByAna,
        opts.canBeUsedAsKnowledge,
        opts.isActive,
        opts.extractedTextSource,
        opts.textHash,
        opts.chunks.length,
        opts.manifestS3Key,
        opts.rawS3Key,
        opts.extractedS3Key,
        opts.normalizedS3Key,
        opts.failedS3Key,
        opts.s3Bucket,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface HigherPriorityCanonicalResult {
  fileVersionId: number;
  sourcePriority: number;
  source: string;
  originalName: string;
}

interface HigherPriorityCanonicalRow {
  file_version_id: number;
  source_priority: number;
  source: string;
  original_name: string;
}

export async function findHigherPriorityCanonicalForEnterprise(opts: {
  enterpriseId: number;
  fileVersionId: number;
  sourcePriority: number;
}): Promise<HigherPriorityCanonicalResult | null> {
  const { rows } = await query<HigherPriorityCanonicalRow>(
    `SELECT
        v.id AS file_version_id,
        v.source_priority,
        v.source,
        v.original_name
     FROM enterprise_file_versions v
     INNER JOIN enterprise_files f ON f.id = v.enterprise_file_id
     WHERE f.enterprise_id = $1
       AND v.id <> $2
       AND COALESCE(v.is_active, true) = true
       AND COALESCE(v.can_be_used_as_knowledge, true) = true
       AND COALESCE(v.processing_status, 'PENDING') = 'PROCESSED'
       AND v.file_kind = 'canonical_sales_script'
       AND v.source_priority > $3
     ORDER BY v.source_priority DESC, v.id DESC
     LIMIT 1`,
    [opts.enterpriseId, opts.fileVersionId, opts.sourcePriority]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    fileVersionId: row.file_version_id,
    sourcePriority: row.source_priority,
    source: row.source,
    originalName: row.original_name,
  };
}

