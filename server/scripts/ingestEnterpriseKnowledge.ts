import 'dotenv/config';
import {
  downloadFromKnowledgeS3,
  getKnowledgeS3Bucket,
  isKnowledgeS3Configured,
  putObjectToKnowledgeS3,
} from '../services/s3Storage.js';
import {
  canConflictWithCanonicalFacts,
  classifyMaterialForIngestion,
} from '../services/knowledgeIngestionPolicy.js';
import {
  extractTextFromBufferV1,
  normalizeKnowledgeText,
} from '../services/knowledgeTextExtraction.js';
import { buildKnowledgeChunks, hashNormalizedText } from '../services/knowledgeChunking.js';
import {
  findHigherPriorityCanonicalForEnterprise,
  listEnterpriseFileVersionIngestionTargets,
  markVersionFailed,
  markVersionProcessing,
  markVersionSkipped,
  replaceVersionChunksAndMarkProcessed,
  type ChunkInsertRow,
  type IngestionTarget,
} from '../repositories/enterpriseKnowledgeIngestionRepository.js';
import { classifyKnowledgeChunk } from '../utils/knowledgeChunkClassifier.js';

interface CliOptions {
  enterpriseId?: number;
  fileVersionId?: number;
  limit: number;
  reprocess: boolean;
  dryRun: boolean;
}

interface ProcessingSummary {
  scanned: number;
  processed: number;
  skipped: number;
  failed: number;
}

function parsePositiveInt(raw: string | undefined, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`Valor inválido para ${flag}: ${raw ?? '<vazio>'}`);
  }
  return n;
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    limit: 100,
    reprocess: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--enterpriseId') {
      opts.enterpriseId = parsePositiveInt(argv[++i], '--enterpriseId');
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

    if (arg === '--reprocess') {
      opts.reprocess = true;
      continue;
    }

    if (arg === '--dry-run') {
      opts.dryRun = true;
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
  console.log('  tsx scripts/ingestEnterpriseKnowledge.ts [opções]');
  console.log('');
  console.log('Opções:');
  console.log('  --enterpriseId <id>    Processa versões do empreendimento informado');
  console.log('  --fileVersionId <id>   Processa somente a versão informada');
  console.log('  --limit <n>            Limita quantidade de versões (padrão: 100)');
  console.log('  --reprocess            Reprocessa mesmo que já esteja PROCESSED');
  console.log('  --dry-run              Simula sem gravar Postgres/S3');
  console.log('  --help, -h             Exibe esta ajuda');
}

function buildArtifactKeys(target: IngestionTarget): {
  raw: string;
  extracted: string;
  normalized: string;
  manifest: string;
  failed: string;
} {
  const base = `prod/enterprise/${target.enterpriseId}/file/${target.enterpriseFileId}/version/${target.versionNumber}`;
  return {
    raw: `raw/${base}/original`,
    extracted: `extracted/${base}/extracted.txt`,
    normalized: `normalized/${base}/normalized.txt`,
    manifest: `manifests/${base}/manifest.json`,
    failed: `failed/${base}/error.json`,
  };
}

async function loadSourceBuffer(target: IngestionTarget): Promise<Buffer> {
  const provider = String(target.storageProvider || '').toLowerCase();

  if (provider !== 's3') {
    throw new Error(
      `Vers�o n�o eleg�vel para ingest�o S3-only. fileVersionId=${target.fileVersionId} provider=${target.storageProvider ?? 'NULL'}`
    );
  }
  if (!target.storageKey) {
    throw new Error(`storage_key ausente para vers�o S3. fileVersionId=${target.fileVersionId}`);
  }
  const fromS3 = await downloadFromKnowledgeS3(target.storageKey);
  if (!fromS3) throw new Error(`Falha ao baixar do S3. key=${target.storageKey}`);
  return fromS3;
}

function toChunkInsertRows(chunks: string[], enterpriseName: string): ChunkInsertRow[] {
  return chunks.map((content, chunkIndex) => {
    const meta = classifyKnowledgeChunk(content, { enterpriseName, enterpriseCity: null });
    return {
      chunkIndex,
      content,
      knowledgeBlock: meta.knowledge_block,
      blockPriority: meta.block_priority,
      cityHint: meta.city_hint ?? null,
      enterpriseHint: meta.enterprise_hint ?? null,
      intentTags: meta.intent_tags,
      temporalStatus: meta.temporal_status,
      sourceConfidence: meta.source_confidence,
    };
  });
}

async function uploadTextIfNeeded(opts: {
  dryRun: boolean;
  key: string;
  contentType: string;
  body: string | Buffer;
}): Promise<void> {
  if (opts.dryRun) return;
  const result = await putObjectToKnowledgeS3(opts.key, opts.body, opts.contentType);
  if (!result.ok) {
    throw new Error(`Falha upload S3 (${opts.key}): ${result.error}`);
  }
}

async function processTarget(
  target: IngestionTarget,
  cli: CliOptions,
  s3Bucket: string,
  summary: ProcessingSummary
): Promise<void> {
  const keys = buildArtifactKeys(target);

  const classification = classifyMaterialForIngestion({
    enterpriseName: target.enterpriseName,
    originalName: target.originalName,
    mimeType: target.mimeType,
    storageProvider: target.storageProvider,
    existingSource: target.source,
    existingSourcePriority: target.sourcePriority,
    existingCanBeSentByAna: target.canBeSentByAna,
    existingCanBeUsedAsKnowledge: target.canBeUsedAsKnowledge,
    existingIsActive: target.isActive,
  });

  let canBeUsedAsKnowledge = classification.canBeUsedAsKnowledge;
  let processingError: string | null = null;

  if (canBeUsedAsKnowledge && canConflictWithCanonicalFacts(classification.fileKind)) {
    const higherCanonical = await findHigherPriorityCanonicalForEnterprise({
      enterpriseId: target.enterpriseId,
      fileVersionId: target.fileVersionId,
      sourcePriority: classification.sourcePriority,
    });
    if (higherCanonical) {
      canBeUsedAsKnowledge = false;
      processingError =
        `blocked_by_higher_priority_canonical_source:` +
        `version=${higherCanonical.fileVersionId},priority=${higherCanonical.sourcePriority},source=${higherCanonical.source}`;
    }
  }

  if (!cli.dryRun) {
    await markVersionProcessing(target.fileVersionId);
  }

  const startedAt = new Date().toISOString();

  try {
    const sourceBuffer = await loadSourceBuffer(target);

    await uploadTextIfNeeded({
      dryRun: cli.dryRun,
      key: keys.raw,
      contentType: target.mimeType || 'application/octet-stream',
      body: sourceBuffer,
    });

    const extraction = await extractTextFromBufferV1(sourceBuffer, target.mimeType, target.originalName);
    const normalizedText = normalizeKnowledgeText(extraction.text);

    await uploadTextIfNeeded({
      dryRun: cli.dryRun,
      key: keys.extracted,
      contentType: 'text/plain; charset=utf-8',
      body: extraction.text,
    });

    await uploadTextIfNeeded({
      dryRun: cli.dryRun,
      key: keys.normalized,
      contentType: 'text/plain; charset=utf-8',
      body: normalizedText,
    });

    const textHash = normalizedText ? hashNormalizedText(normalizedText) : null;
    const alreadyEvaluatedStatus =
      target.processingStatus === 'PROCESSED' || target.processingStatus === 'SKIPPED';

    const unchangedHash =
      !cli.reprocess &&
      alreadyEvaluatedStatus &&
      target.textHash != null &&
      textHash != null &&
      target.textHash === textHash;

    const emptyText = normalizedText.length === 0;

    if (unchangedHash || emptyText) {
      const skipReason = unchangedHash
        ? 'skip_same_text_hash'
        : 'skip_empty_normalized_text';

      const manifest = {
        ingestionVersion: 'v1',
        startedAt,
        finishedAt: new Date().toISOString(),
        dryRun: cli.dryRun,
        fileVersionId: target.fileVersionId,
        enterpriseId: target.enterpriseId,
        enterpriseFileId: target.enterpriseFileId,
        versionNumber: target.versionNumber,
        originalName: target.originalName,
        mimeType: target.mimeType,
        classification,
        status: 'SKIPPED',
        reason: skipReason,
        processingError,
        extractedTextSource: extraction.source,
        normalizedChars: normalizedText.length,
        textHash,
        chunkCount: 0,
        rawS3Key: keys.raw,
        extractedS3Key: keys.extracted,
        normalizedS3Key: keys.normalized,
      };

      await uploadTextIfNeeded({
        dryRun: cli.dryRun,
        key: keys.manifest,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(manifest, null, 2),
      });

      if (!cli.dryRun) {
        const shouldDeactivateChunks = skipReason === 'skip_empty_normalized_text';
        await markVersionSkipped({
          fileVersionId: target.fileVersionId,
          fileKind: classification.fileKind,
          source: classification.source,
          sourcePriority: classification.sourcePriority,
          canBeSentByAna: classification.canBeSentByAna,
          canBeUsedAsKnowledge,
          isActive: classification.isActive,
          extractedTextSource: extraction.source,
          textHash,
          chunkCount: shouldDeactivateChunks ? 0 : target.chunkCount,
          rawS3Key: keys.raw,
          extractedS3Key: keys.extracted,
          normalizedS3Key: keys.normalized,
          manifestS3Key: keys.manifest,
          failedS3Key: null,
          processingError,
          s3Bucket,
          deactivateActiveChunks: shouldDeactivateChunks,
        });
      }

      summary.skipped += 1;
      console.log(
        `[INGEST][SKIPPED] version=${target.fileVersionId} enterprise=${target.enterpriseId} reason=${skipReason}`
      );
      return;
    }

    const chunks = buildKnowledgeChunks(normalizedText, { chunkSize: 1400, overlap: 180 });
    const chunkRows = toChunkInsertRows(chunks, target.enterpriseName);

    const manifest = {
      ingestionVersion: 'v1',
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: cli.dryRun,
      fileVersionId: target.fileVersionId,
      enterpriseId: target.enterpriseId,
      enterpriseFileId: target.enterpriseFileId,
      versionNumber: target.versionNumber,
      originalName: target.originalName,
      mimeType: target.mimeType,
      classification,
      status: 'PROCESSED',
      processingError: null,
      extractedTextSource: extraction.source,
      normalizedChars: normalizedText.length,
      textHash,
      chunkCount: chunkRows.length,
      rawS3Key: keys.raw,
      extractedS3Key: keys.extracted,
      normalizedS3Key: keys.normalized,
    };

    await uploadTextIfNeeded({
      dryRun: cli.dryRun,
      key: keys.manifest,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(manifest, null, 2),
    });

    if (!cli.dryRun) {
      await replaceVersionChunksAndMarkProcessed({
        fileVersionId: target.fileVersionId,
        enterpriseId: target.enterpriseId,
        enterpriseFileId: target.enterpriseFileId,
        fileKind: classification.fileKind,
        source: classification.source,
        sourcePriority: classification.sourcePriority,
        canBeSentByAna: classification.canBeSentByAna,
        canBeUsedAsKnowledge,
        isActive: classification.isActive,
        extractedTextSource: extraction.source,
        textHash: textHash ?? hashNormalizedText(''),
        rawS3Key: keys.raw,
        extractedS3Key: keys.extracted,
        normalizedS3Key: keys.normalized,
        manifestS3Key: keys.manifest,
        failedS3Key: null,
        s3Bucket,
        chunks: chunkRows,
      });
    }

    summary.processed += 1;
    console.log(
      `[INGEST][PROCESSED] version=${target.fileVersionId} enterprise=${target.enterpriseId} chunks=${chunkRows.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorPayload = {
      ingestionVersion: 'v1',
      at: new Date().toISOString(),
      fileVersionId: target.fileVersionId,
      enterpriseId: target.enterpriseId,
      enterpriseFileId: target.enterpriseFileId,
      versionNumber: target.versionNumber,
      originalName: target.originalName,
      mimeType: target.mimeType,
      error: message,
    };

    if (!cli.dryRun) {
      let failedS3Key: string | null = null;
      try {
        const uploadFailed = await putObjectToKnowledgeS3(
          keys.failed,
          JSON.stringify(errorPayload, null, 2),
          'application/json; charset=utf-8'
        );
        if (uploadFailed.ok) {
          failedS3Key = uploadFailed.key;
        }
      } catch {
        // Se falhar upload do erro, ainda marcamos no banco.
      }

      await markVersionFailed({
        fileVersionId: target.fileVersionId,
        processingError: message,
        failedS3Key,
      });
    }

    summary.failed += 1;
    console.error(
      `[INGEST][FAILED] version=${target.fileVersionId} enterprise=${target.enterpriseId} error=${message}`
    );
  }
}

function sortTargetsByPriority(targets: IngestionTarget[]): IngestionTarget[] {
  return [...targets].sort((a, b) => {
    if (a.enterpriseId !== b.enterpriseId) return a.enterpriseId - b.enterpriseId;

    const kindA = classifyMaterialForIngestion({
      enterpriseName: a.enterpriseName,
      originalName: a.originalName,
      mimeType: a.mimeType,
      storageProvider: a.storageProvider,
      existingSource: a.source,
      existingSourcePriority: a.sourcePriority,
      existingCanBeSentByAna: a.canBeSentByAna,
      existingCanBeUsedAsKnowledge: a.canBeUsedAsKnowledge,
      existingIsActive: a.isActive,
    });

    const kindB = classifyMaterialForIngestion({
      enterpriseName: b.enterpriseName,
      originalName: b.originalName,
      mimeType: b.mimeType,
      storageProvider: b.storageProvider,
      existingSource: b.source,
      existingSourcePriority: b.sourcePriority,
      existingCanBeSentByAna: b.canBeSentByAna,
      existingCanBeUsedAsKnowledge: b.canBeUsedAsKnowledge,
      existingIsActive: b.isActive,
    });

    if (kindA.sourcePriority !== kindB.sourcePriority) {
      return kindB.sourcePriority - kindA.sourcePriority;
    }

    return a.fileVersionId - b.fileVersionId;
  });
}

function formatTargetPreview(target: IngestionTarget): string {
  const classification = classifyMaterialForIngestion({
    enterpriseName: target.enterpriseName,
    originalName: target.originalName,
    mimeType: target.mimeType,
    storageProvider: target.storageProvider,
    existingSource: target.source,
    existingSourcePriority: target.sourcePriority,
    existingCanBeSentByAna: target.canBeSentByAna,
    existingCanBeUsedAsKnowledge: target.canBeUsedAsKnowledge,
    existingIsActive: target.isActive,
  });

  return [
    `versionId=${target.fileVersionId}`,
    `enterpriseId=${target.enterpriseId}`,
    `enterprise="${target.enterpriseName}"`,
    `file="${target.originalName}"`,
    `provider=${target.storageProvider ?? 'NULL'}`,
    `kind=${classification.fileKind}`,
    `priority=${classification.sourcePriority}`,
    `knowledge=${classification.canBeUsedAsKnowledge}`,
  ].join(' | ');
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));

  if (!cli.dryRun && !isKnowledgeS3Configured()) {
    throw new Error('KNOWLEDGE_S3_BUCKET não configurado. Configure S3 antes da execução real.');
  }

  const s3Bucket = cli.dryRun ? 'dry-run' : getKnowledgeS3Bucket();

  const rawTargets = await listEnterpriseFileVersionIngestionTargets({
    enterpriseId: cli.enterpriseId,
    fileVersionId: cli.fileVersionId,
    limit: cli.limit,
    reprocess: cli.reprocess,
  });

  const targets = sortTargetsByPriority(rawTargets);

  if (targets.length === 0) {
    console.log('[INGEST] Nenhuma versão elegível encontrada.');
    return;
  }

  console.log('[INGEST] Início da ingestão v1');
  console.log(
    JSON.stringify(
      {
        dryRun: cli.dryRun,
        reprocess: cli.reprocess,
        enterpriseId: cli.enterpriseId ?? null,
        fileVersionId: cli.fileVersionId ?? null,
        limit: cli.limit,
        found: targets.length,
      },
      null,
      2
    )
  );

  for (const target of targets) {
    console.log(`[INGEST][TARGET] ${formatTargetPreview(target)}`);
  }

  const summary: ProcessingSummary = {
    scanned: targets.length,
    processed: 0,
    skipped: 0,
    failed: 0,
  };

  for (const target of targets) {
    await processTarget(target, cli, s3Bucket, summary);
  }

  console.log('[INGEST] Fim da execução');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[INGEST][FATAL]', message);
  process.exit(1);
});



