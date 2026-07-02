import 'dotenv/config';
import { getPool } from '../db/pg.js';
import {
  DEFAULT_AUTO_WALLET_INACTIVE_DAYS,
  applyInactiveWallet,
  getInactiveWalletDryRun,
} from '../services/inactiveConversationWalletService.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!found) return null;
  if (found === name) return '';
  return found.slice(prefix.length);
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function shouldShowHelp(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

function printHelp(): void {
  console.log(`
Usage:
  npm run wallet:auto-dry-run
  npm run wallet:auto-apply -- --apply
  tsx scripts/autoWalletInactiveConversations.ts --dry-run
  tsx scripts/autoWalletInactiveConversations.ts --apply

Options:
  --dry-run       Show counts and sample only. Default.
  --apply         Update eligible conversations inside one transaction.
  --days=N        Inactivity threshold. Default: ${DEFAULT_AUTO_WALLET_INACTIVE_DAYS}.
  --limit=N       Optional apply limit. Omit to update all eligible rows.
`);
}

function serializeDate(value: Date | null): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

async function main(): Promise<void> {
  if (shouldShowHelp()) {
    printHelp();
    return;
  }

  const apply = process.argv.includes('--apply');
  const days = parsePositiveInt(argValue('--days'), DEFAULT_AUTO_WALLET_INACTIVE_DAYS);
  const limitRaw = argValue('--limit');
  const limit = limitRaw == null ? null : parsePositiveInt(limitRaw, 0);

  if (!apply) {
    const dryRun = await getInactiveWalletDryRun({ inactiveDays: days });
    console.log(JSON.stringify({
      mode: 'dry-run',
      inactiveDays: days,
      totalEligible: dryRun.totalEligible,
      byBucket: dryRun.byBucket,
      sample: dryRun.sample.map((row) => ({
        ...row,
        lastActivityAt: serializeDate(row.lastActivityAt),
        updatedAt: serializeDate(row.updatedAt),
      })),
    }, null, 2));
    return;
  }

  const result = await applyInactiveWallet({
    inactiveDays: days,
    limit: limit && limit > 0 ? limit : null,
  });
  console.log(JSON.stringify({
    mode: 'apply',
    inactiveDays: days,
    limit: limit && limit > 0 ? limit : null,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[AUTO_WALLET_SCRIPT_ERROR]', error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => {});
  });
