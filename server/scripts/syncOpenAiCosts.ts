import { syncOpenAiCosts } from '../services/openaiCostSyncService.js';

function parseDateArg(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida: ${raw}`);
  }
  return parsed;
}

function parseNumberArg(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

async function main() {
  const args = new Map<string, string>();
  for (const token of process.argv.slice(2)) {
    const [k, v] = token.split('=');
    if (!k?.startsWith('--')) continue;
    args.set(k.slice(2), v ?? 'true');
  }

  const endTime = parseDateArg(args.get('end'), new Date());
  const startTime = parseDateArg(args.get('start'), new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000));
  const maxPages = parseNumberArg(args.get('max-pages'), 20);

  const result = await syncOpenAiCosts({
    startTime,
    endTime,
    groupBy: ['api_key_id', 'project_id', 'line_item'],
    bucketWidth: '1d',
    maxPages,
  });

  console.log('[OPENAI_COST_SYNC_RESULT]', {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    ...result,
  });
}

main().catch((error) => {
  console.error('[OPENAI_COST_SYNC_FAILED]', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
