import 'dotenv/config';
import { createHash } from 'crypto';
import { query, getPool } from '../db/pg.js';
import { downloadFromR2, isR2Configured } from '../services/r2Storage.js';
import {
  getKnowledgeS3Bucket,
  isKnowledgeS3Configured,
  putObjectToKnowledgeS3,
} from '../services/s3Storage.js';

type CliOptions = {
  enterpriseId?: number;
  fileId?: number;
  fileVersionId?: number;
  limit: number;
  dryRun: boolean;
  reprocess: boolean;
};

type MigrationTarget = {
  fileVersionId: number;
  enterpriseFileId: number;
  enterpriseId: number;
  enterpriseName: string;
  currentVersionId: number | null;
  versionNumber: number;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  fileData: Buffer | null;
  storageKey: string | null;
  bucketName: string | null;
  extractedText: string | null;
};

type MigrationOutcome =
  | {
      status: 'already_migrated';
      fileVersionId: number;
      enterpriseFileId: number;
      migratedVersionId: number;
      migratedVersionNumber: number;
      s3Key: string;
    }
  | {
      status: 'migrated';
      fileVersionId: number;
      enterpriseFileId: number;
      migratedVersionId: number;
      migratedVersionNumber: number;
      s3Key: string;
    }
  | {
      status: 'reprocessed';
      fileVersionId: number;
      enterpriseFileId: number;
      migratedVersionId: number;
      migratedVersionNumber: number;
      s3Key: string;
    };

type ExistingMigratedVersion = {
  id: number;
  version_number: number;
  storage_key: string | null;
};

type Summary = {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  reprocessed: number;
  failed: number;
};

async function recordMigrationFailureBestEffort(fileVersionId: number, errorMessage: string): Promise<void> {
  try {
    await query(
      `UPDATE enterprise_file_versions
       SET processing_status = 'FAILED',
           processing_error = $2,
           processed_at = NOW()
       WHERE id = $1`,
      [fileVersionId, `r2_to_s3_migration_failed: ${errorMessage}`.slice(0, 4000)]
    );
  } catch {
    // Compatibilidade com ambientes sem colunas operacionais da ingestão.
  }
}

function parsePositiveInt(raw: string | undefined, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Valor inválido para ${flag}: ${raw ?? '<vazio>'}`);
  }
  return n;
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    limit: 100,
    dryRun: false,
    reprocess: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--enterpriseId') {
      opts.enterpriseId = parsePositiveInt(argv[++i], '--enterpriseId');
      continue;
    }

    if (arg === '--fileId') {
      opts.fileId = parsePositiveInt(argv[++i], '--fileId');
      continue;
    }

    if (arg === '--fileVersionId') {
      opts.fileVersionId = parsePositiveInt(argv[++i], '--fileVersionId');
      continue;
    }

    if (arg === '--limit') {
      opts.limit = parsePositiveInt(argv[++i], '--limit');
      continue;
    }

    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }

    if (arg === '--reprocess') {
      opts.reprocess = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Parâmetro não reconhecido: ${arg}`);
  }

  if (opts.fileVersionId != null) {
    opts.limit = 1;
  }

  return opts;
}

function printUsage(): void {
  console.log('Uso:');
  console.log('  tsx scripts/migrateKnowledgeStorageR2ToS3.ts [opções]');
  console.log('');
  console.log('Opções:');
  console.log('  --enterpriseId <id>   Filtra por empreendimento');
  console.log('  --fileId <id>         Filtra por enterprise_file_id');
  console.log('  --fileVersionId <id>  Migra uma versão específica');
  console.log('  --limit <n>           Limita a quantidade (padrão 100)');
  console.log('  --dry-run             Simula sem escrever no S3/DB');
  console.log('  --reprocess           Reenvia para S3 mesmo já migrado');
  console.log('  --help, -h            Exibe esta ajuda');
}

function migrationChangeReason(sourceFileVersionId: number): string {
  return `r2_to_s3_mig_v${sourceFileVersionId}`;
}

function buildRawS3Key(input: {
  enterpriseId: number;
  enterpriseFileId: number;
  targetVersionNumber: number;
}): string {
  return `raw/prod/enterprise/${input.enterpriseId}/file/${input.enterpriseFileId}/version/${input.targetVersionNumber}/original`;
}

function buildMigrationManifestKey(input: {
  enterpriseId: number;
  enterpriseFileId: number;
  targetVersionNumber: number;
}): string {
  return `manifests/prod/enterprise/${input.enterpriseId}/file/${input.enterpriseFileId}/version/${input.targetVersionNumber}/migration-manifest.json`;
}

function isValidSha256(input: string | null | undefined): boolean {
  return typeof input === 'string' && /^[0-9a-f]{64}$/.test(input);
}

function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

type TargetRow = {
  file_version_id: number;
  enterprise_file_id: number;
  enterprise_id: number;
  enterprise_name: string;
  current_version_id: number | null;
  version_number: number;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  file_data: Buffer | null;
  storage_key: string | null;
  bucket_name: string | null;
  extracted_text: string | null;
};

async function listR2Targets(opts: CliOptions): Promise<MigrationTarget[]> {
  const where: string[] = [`COALESCE(v.storage_provider, '') = 'r2'`];
  const params: unknown[] = [];
  let p = 1;

  if (opts.enterpriseId != null) {
    where.push(`f.enterprise_id = $${p++}`);
    params.push(opts.enterpriseId);
  }

  if (opts.fileId != null) {
    where.push(`v.enterprise_file_id = $${p++}`);
    params.push(opts.fileId);
  }

  if (opts.fileVersionId != null) {
    where.push(`v.id = $${p++}`);
    params.push(opts.fileVersionId);
  } else {
    // Segurança operacional: migra por padrão apenas versões atuais em R2.
    where.push(`f.current_version_id = v.id`);
  }

  params.push(Math.max(1, Math.min(opts.limit, 1000)));

  const { rows } = await query<TargetRow>(
    `SELECT
        v.id AS file_version_id,
        v.enterprise_file_id,
        f.enterprise_id,
        e.name AS enterprise_name,
        f.current_version_id,
        v.version_number,
        v.original_name,
        v.storage_path,
        v.mime_type,
        v.size_bytes,
        v.checksum_sha256,
        v.file_data,
        v.storage_key,
        v.bucket_name,
        v.extracted_text
     FROM enterprise_file_versions v
     INNER JOIN enterprise_files f ON f.id = v.enterprise_file_id
     INNER JOIN enterprises e ON e.id = f.enterprise_id
     WHERE ${where.join(' AND ')}
     ORDER BY f.enterprise_id, v.enterprise_file_id, v.id
     LIMIT $${p}`,
    params
  );

  return rows.map((r) => ({
    fileVersionId: r.file_version_id,
    enterpriseFileId: r.enterprise_file_id,
    enterpriseId: r.enterprise_id,
    enterpriseName: r.enterprise_name,
    currentVersionId: r.current_version_id,
    versionNumber: r.version_number,
    originalName: r.original_name,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes ?? 0),
    checksumSha256: r.checksum_sha256,
    fileData: r.file_data,
    storageKey: r.storage_key,
    bucketName: r.bucket_name,
    extractedText: r.extracted_text,
  }));
}

async function loadSourceBuffer(target: MigrationTarget): Promise<Buffer> {
  if (target.storageKey) {
    const downloaded = await downloadFromR2(target.storageKey);
    if (downloaded) return downloaded;
  }

  if (target.fileData) return target.fileData;

  throw new Error(
    `Não foi possível carregar bytes da versão ${target.fileVersionId} (sem storage_key válido e sem file_data).`
  );
}

async function findExistingMigratedVersion(
  enterpriseFileId: number,
  sourceFileVersionId: number
): Promise<ExistingMigratedVersion | null> {
  const reason = migrationChangeReason(sourceFileVersionId);
  const { rows } = await query<ExistingMigratedVersion>(
    `SELECT id, version_number, storage_key
     FROM enterprise_file_versions
     WHERE enterprise_file_id = $1
       AND storage_provider = 's3'
       AND change_reason = $2
     ORDER BY id DESC
     LIMIT 1`,
    [enterpriseFileId, reason]
  );
  return rows[0] ?? null;
}

async function migrateOneTarget(target: MigrationTarget, opts: CliOptions): Promise<MigrationOutcome> {
  const sourceBytes = await loadSourceBuffer(target);
  const checksumSha256 = isValidSha256(target.checksumSha256)
    ? (target.checksumSha256 as string)
    : computeSha256(sourceBytes);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const lockFile = await client.query<{ id: number; current_version_id: number | null }>(
      `SELECT id, current_version_id
       FROM enterprise_files
       WHERE id = $1
       FOR UPDATE`,
      [target.enterpriseFileId]
    );
    if (lockFile.rows.length === 0) {
      throw new Error(`enterprise_file_id=${target.enterpriseFileId} não encontrado.`);
    }

    const sourceRow = await client.query<{
      id: number;
      enterprise_file_id: number;
      version_number: number;
      original_name: string;
      storage_path: string;
      mime_type: string;
      size_bytes: number;
      checksum_sha256: string | null;
      extracted_text: string | null;
      created_by_user_id: number | null;
      storage_provider: string | null;
    }>(
      `SELECT
          id,
          enterprise_file_id,
          version_number,
          original_name,
          storage_path,
          mime_type,
          size_bytes,
          checksum_sha256,
          extracted_text,
          created_by_user_id,
          storage_provider
       FROM enterprise_file_versions
       WHERE id = $1
         AND enterprise_file_id = $2
       FOR UPDATE`,
      [target.fileVersionId, target.enterpriseFileId]
    );
    if (sourceRow.rows.length === 0) {
      throw new Error(`file_version_id=${target.fileVersionId} não encontrada para file=${target.enterpriseFileId}.`);
    }

    const source = sourceRow.rows[0];
    if (source.storage_provider !== 'r2') {
      throw new Error(`file_version_id=${target.fileVersionId} não está mais em R2 (provider=${source.storage_provider}).`);
    }

    const reason = migrationChangeReason(target.fileVersionId);

    const existingRes = await client.query<ExistingMigratedVersion>(
      `SELECT id, version_number, storage_key
       FROM enterprise_file_versions
       WHERE enterprise_file_id = $1
         AND storage_provider = 's3'
         AND change_reason = $2
       ORDER BY id DESC
       LIMIT 1`,
      [target.enterpriseFileId, reason]
    );
    const existing = existingRes.rows[0] ?? null;

    const computedNextRes = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
       FROM enterprise_file_versions
       WHERE enterprise_file_id = $1`,
      [target.enterpriseFileId]
    );
    const nextVersion = Number(computedNextRes.rows[0]?.next_version ?? 1);
    const finalVersionNumber = existing ? existing.version_number : nextVersion;

    const rawS3Key = buildRawS3Key({
      enterpriseId: target.enterpriseId,
      enterpriseFileId: target.enterpriseFileId,
      targetVersionNumber: finalVersionNumber,
    });

    if (existing && !opts.reprocess) {
      await client.query(
        `UPDATE enterprise_files
         SET current_version_id = $2
         WHERE id = $1
           AND current_version_id IS DISTINCT FROM $2`,
        [target.enterpriseFileId, existing.id]
      );

      await client.query('COMMIT');
      return {
        status: 'already_migrated',
        fileVersionId: target.fileVersionId,
        enterpriseFileId: target.enterpriseFileId,
        migratedVersionId: existing.id,
        migratedVersionNumber: existing.version_number,
        s3Key: existing.storage_key ?? rawS3Key,
      };
    }

    const uploadRaw = await putObjectToKnowledgeS3(
      rawS3Key,
      sourceBytes,
      source.mime_type || 'application/octet-stream',
      {
        migration_source: 'r2',
        source_file_version_id: String(target.fileVersionId),
        enterprise_file_id: String(target.enterpriseFileId),
      }
    );
    if (!uploadRaw.ok) {
      throw new Error(`Falha ao subir arquivo no S3: ${uploadRaw.error}`);
    }

    const manifestKey = buildMigrationManifestKey({
      enterpriseId: target.enterpriseId,
      enterpriseFileId: target.enterpriseFileId,
      targetVersionNumber: finalVersionNumber,
    });

    const migrationManifest = {
      migrationVersion: 'r2-to-s3-v1',
      at: new Date().toISOString(),
      enterpriseId: target.enterpriseId,
      enterpriseName: target.enterpriseName,
      enterpriseFileId: target.enterpriseFileId,
      sourceFileVersionId: target.fileVersionId,
      sourceVersionNumber: source.version_number,
      targetVersionNumber: finalVersionNumber,
      sourceProvider: 'r2',
      targetProvider: 's3',
      sourceStorageKey: target.storageKey,
      targetStorageKey: rawS3Key,
      bytes: sourceBytes.length,
      checksumSha256,
      mode: existing ? 'reprocess' : 'create_new_version',
    };

    const uploadManifest = await putObjectToKnowledgeS3(
      manifestKey,
      JSON.stringify(migrationManifest, null, 2),
      'application/json; charset=utf-8'
    );
    if (!uploadManifest.ok) {
      throw new Error(`Falha ao subir migration-manifest no S3: ${uploadManifest.error}`);
    }

    if (existing) {
      await client.query(
        `UPDATE enterprise_file_versions
         SET storage_provider = 's3',
             storage_key = $2,
             bucket_name = $3,
             checksum_sha256 = $4,
             storage_path = $5
         WHERE id = $1`,
        [existing.id, rawS3Key, getKnowledgeS3Bucket(), checksumSha256, rawS3Key]
      );

      await client.query(
        `UPDATE enterprise_files
         SET current_version_id = $2
         WHERE id = $1
           AND current_version_id IS DISTINCT FROM $2`,
        [target.enterpriseFileId, existing.id]
      );

      await client.query('COMMIT');
      return {
        status: 'reprocessed',
        fileVersionId: target.fileVersionId,
        enterpriseFileId: target.enterpriseFileId,
        migratedVersionId: existing.id,
        migratedVersionNumber: existing.version_number,
        s3Key: rawS3Key,
      };
    }

    const insertRes = await client.query<{ id: number }>(
      `INSERT INTO enterprise_file_versions (
         enterprise_file_id,
         version_number,
         original_name,
         storage_path,
         mime_type,
         size_bytes,
         checksum_sha256,
         file_data,
         storage_provider,
         storage_key,
         bucket_name,
         public_url,
         extracted_text,
         change_reason,
         created_at,
         created_by_user_id
        )
        VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         NULL,
         's3',
         $8,
         $9,
         NULL,
         $10,
         $11,
         NOW(),
         $12
        )
        RETURNING id`,
      [
        target.enterpriseFileId,
        finalVersionNumber,
        source.original_name,
        rawS3Key,
        source.mime_type,
        sourceBytes.length,
        checksumSha256,
        rawS3Key,
        getKnowledgeS3Bucket(),
        source.extracted_text,
        reason,
        source.created_by_user_id,
      ]
    );

    const newVersionId = Number(insertRes.rows[0]?.id);
    if (!newVersionId) {
      throw new Error('Falha ao inserir nova versão S3 (id ausente).');
    }

    await client.query(
      `UPDATE enterprise_files
       SET current_version_id = $2
       WHERE id = $1
         AND current_version_id IS DISTINCT FROM $2`,
      [target.enterpriseFileId, newVersionId]
    );

    await client.query('COMMIT');

    return {
      status: 'migrated',
      fileVersionId: target.fileVersionId,
      enterpriseFileId: target.enterpriseFileId,
      migratedVersionId: newVersionId,
      migratedVersionNumber: finalVersionNumber,
      s3Key: rawS3Key,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processTarget(target: MigrationTarget, opts: CliOptions, summary: Summary): Promise<void> {
  const existing = await findExistingMigratedVersion(target.enterpriseFileId, target.fileVersionId);

  if (opts.dryRun) {
    if (existing && !opts.reprocess) {
      summary.alreadyMigrated += 1;
      console.log(
        `[MIGRATE][DRY-RUN][ALREADY] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${target.fileVersionId} migratedVersion=${existing.id}`
      );
      return;
    }

    const plannedVersion = existing?.version_number ?? target.versionNumber + 1;
    const plannedKey = buildRawS3Key({
      enterpriseId: target.enterpriseId,
      enterpriseFileId: target.enterpriseFileId,
      targetVersionNumber: plannedVersion,
    });
    const mode = existing ? 'REPROCESS' : 'MIGRATE';

    console.log(
      `[MIGRATE][DRY-RUN][${mode}] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${target.fileVersionId} targetVersion=${plannedVersion} key=${plannedKey}`
    );
    return;
  }

  const outcome = await migrateOneTarget(target, opts);

  if (outcome.status === 'already_migrated') {
    summary.alreadyMigrated += 1;
    console.log(
      `[MIGRATE][ALREADY] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${outcome.fileVersionId} migratedVersion=${outcome.migratedVersionId} key=${outcome.s3Key}`
    );
    return;
  }

  if (outcome.status === 'reprocessed') {
    summary.reprocessed += 1;
    console.log(
      `[MIGRATE][REPROCESSED] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${outcome.fileVersionId} migratedVersion=${outcome.migratedVersionId} key=${outcome.s3Key}`
    );
    return;
  }

  summary.migrated += 1;
  console.log(
    `[MIGRATE][MIGRATED] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${outcome.fileVersionId} newVersion=${outcome.migratedVersionId} key=${outcome.s3Key}`
  );
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  if (!opts.dryRun) {
    if (!isKnowledgeS3Configured()) {
      throw new Error('KNOWLEDGE_S3_BUCKET não configurado.');
    }
    if (!isR2Configured()) {
      throw new Error('Cloudflare R2 não está configurado.');
    }
  }

  const targets = await listR2Targets(opts);
  if (targets.length === 0) {
    console.log('[MIGRATE] Nenhuma versão elegível em R2 encontrada.');
    return;
  }

  console.log('[MIGRATE] Início migração R2 -> S3');
  console.log(
    JSON.stringify(
      {
        dryRun: opts.dryRun,
        reprocess: opts.reprocess,
        enterpriseId: opts.enterpriseId ?? null,
        fileId: opts.fileId ?? null,
        fileVersionId: opts.fileVersionId ?? null,
        limit: opts.limit,
        found: targets.length,
      },
      null,
      2
    )
  );

  const summary: Summary = {
    scanned: targets.length,
    migrated: 0,
    alreadyMigrated: 0,
    reprocessed: 0,
    failed: 0,
  };

  for (const target of targets) {
    try {
      await processTarget(target, opts, summary);
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await recordMigrationFailureBestEffort(target.fileVersionId, message);
      console.error(
        `[MIGRATE][FAILED] enterprise=${target.enterpriseId} file=${target.enterpriseFileId} sourceVersion=${target.fileVersionId} error=${message}`
      );
    }
  }

  console.log('[MIGRATE] Fim da execução');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[MIGRATE][FATAL]', message);
  process.exit(1);
});
