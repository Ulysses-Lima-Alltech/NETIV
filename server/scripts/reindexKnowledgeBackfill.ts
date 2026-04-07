import 'dotenv/config';
import { getPool } from '../db/pg.js';
import {
  listKnowledgeFilesForBackfill,
  reindexKnowledgeFileForBackfill,
} from '../repositories/enterpriseRepository.js';

function parseArgs(argv: string[]): {
  dryRun: boolean;
  enterpriseId: number | undefined;
  fileId: number | undefined;
  includeInactive: boolean;
} {
  const out = {
    dryRun: false,
    enterpriseId: undefined as number | undefined,
    fileId: undefined as number | undefined,
    includeInactive: false,
  };
  for (const raw of argv) {
    const a = String(raw || '').trim();
    if (!a) continue;
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--include-inactive') out.includeInactive = true;
    else if (a.startsWith('--enterprise-id=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) out.enterpriseId = Math.trunc(n);
    } else if (a.startsWith('--file-id=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) out.fileId = Math.trunc(n);
    }
  }
  return out;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  console.log('[KB_BACKFILL] start', args);

  const targets = await listKnowledgeFilesForBackfill({
    enterpriseId: args.enterpriseId,
    fileId: args.fileId,
    includeInactive: args.includeInactive,
  });
  console.log('[KB_BACKFILL] targets', { total: targets.length });

  let ok = 0;
  let fail = 0;
  let emptyText = 0;
  let chunksTotal = 0;

  for (const t of targets) {
    const r = await reindexKnowledgeFileForBackfill(t.fileId, { dryRun: args.dryRun });
    if (r.success) {
      ok++;
      chunksTotal += r.chunksGenerated;
      if (r.reason === 'empty_extracted_text') emptyText++;
      console.log('[KB_BACKFILL_FILE_OK]', {
        enterprise_id: r.enterpriseId,
        enterprise_name: r.enterpriseName,
        file_id: r.fileId,
        original_name: r.originalName,
        dry_run: r.dryRun,
        chunks_generated: r.chunksGenerated,
        extracted_chars: r.extractedChars,
        note: r.reason ?? null,
      });
    } else {
      fail++;
      console.error('[KB_BACKFILL_FILE_FAIL]', {
        enterprise_id: r.enterpriseId || t.enterpriseId,
        enterprise_name: r.enterpriseName || t.enterpriseName,
        file_id: r.fileId || t.fileId,
        original_name: r.originalName || t.originalName,
        dry_run: r.dryRun,
        chunks_generated: r.chunksGenerated,
        extracted_chars: r.extractedChars,
        reason: r.reason ?? 'unknown_error',
      });
    }
  }

  console.log('[KB_BACKFILL] done', {
    dry_run: args.dryRun,
    scanned_files: targets.length,
    success_files: ok,
    failed_files: fail,
    empty_extracted_text_files: emptyText,
    total_chunks_generated: chunksTotal,
    elapsed_ms: Date.now() - startedAt,
  });
}

run()
  .catch((e) => {
    console.error('[KB_BACKFILL] fatal', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      // ignore
    }
  });

