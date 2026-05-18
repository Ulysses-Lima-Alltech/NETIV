import { query } from '../db/pg.js';
import {
  getConversationById,
  getConversationManualClassificationOverrides,
  saveLeadClassificationAudit,
  setConversationEnterpriseId,
  setConversationFunnelStatusAutomatic,
  setConversationLeadTemperature,
} from '../repositories/conversationRepository.js';
import {
  getLastUserMessageRow,
  getRecentConversationMessages,
} from '../repositories/messageRepository.js';
import { classifyLeadConversation } from '../services/leadClassificationService.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import { listEnterpriseAliasRowsForActiveEnterprises } from '../repositories/enterpriseMatch.js';

type CliOptions = {
  apply: boolean;
  limit: number;
  conversationId: number | null;
  onlyMissingEnterprise: boolean;
  onlyMissingTemperature: boolean;
  since: string | null;
  concurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
};

type ConversationCandidate = {
  id: number;
  contact_id: number | null;
  enterprise_id: number | null;
  lead_temperature: string | null;
  classification: string;
  commercial_flow_state: unknown;
  handoff: boolean;
  updated_at: Date;
};

type Summary = {
  analyzed: number;
  sourceAi: number;
  sourceFallback: number;
  updatedTemperature: number;
  updatedEnterprise: number;
  updatedFunnel: number;
  ignoredManualOverride: number;
  ignoredLowConfidence: number;
  errors: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apply: false,
    limit: 50,
    conversationId: null,
    onlyMissingEnterprise: false,
    onlyMissingTemperature: false,
    since: null,
    concurrency: 1,
    minDelayMs: 300,
    maxDelayMs: 800,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--only-missing-enterprise') opts.onlyMissingEnterprise = true;
    else if (arg === '--only-missing-temperature') opts.onlyMissingTemperature = true;
    else if (arg === '--limit') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.floor(n);
      i += 1;
    } else if (arg === '--conversation-id') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.conversationId = Math.floor(n);
      i += 1;
    } else if (arg === '--since') {
      const raw = String(argv[i + 1] ?? '').trim();
      if (raw) opts.since = raw;
      i += 1;
    } else if (arg === '--concurrency') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.concurrency = Math.min(2, Math.max(1, Math.floor(n)));
      i += 1;
    } else if (arg === '--min-delay-ms') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 0) opts.minDelayMs = Math.floor(n);
      i += 1;
    } else if (arg === '--max-delay-ms') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 0) opts.maxDelayMs = Math.floor(n);
      i += 1;
    }
  }
  if (opts.maxDelayMs < opts.minDelayMs) opts.maxDelayMs = opts.minDelayMs;
  return opts;
}

function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConversationCandidates(opts: CliOptions): Promise<ConversationCandidate[]> {
  const conditions: string[] = [];
  const values: Array<number | string> = [];
  let idx = 1;

  if (opts.conversationId != null) {
    conditions.push(`c.id = $${idx++}`);
    values.push(opts.conversationId);
  }
  if (opts.onlyMissingEnterprise) {
    conditions.push(`c.enterprise_id IS NULL`);
  }
  if (opts.onlyMissingTemperature) {
    conditions.push(`c.lead_temperature IS NULL`);
  }
  if (opts.since) {
    conditions.push(`c.updated_at >= $${idx++}::date`);
    values.push(opts.since);
  }
  conditions.push(`EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.role = 'user'
      AND m.deleted_at IS NULL
      AND COALESCE(trim(m.content), '') <> ''
  )`);

  values.push(opts.limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT
      c.id,
      c.contact_id,
      c.enterprise_id,
      c.lead_temperature,
      c.classification,
      c.commercial_flow_state,
      COALESCE(c.handoff, false) AS handoff,
      c.updated_at
    FROM conversations c
    ${where}
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT $${idx}
  `;
  const { rows } = await query<ConversationCandidate>(sql, values);
  return rows;
}

async function processOneConversation(
  row: ConversationCandidate,
  opts: CliOptions,
  summary: Summary,
  availableEnterprises: Awaited<ReturnType<typeof listEnterprises>>,
  aliasRows: Awaited<ReturnType<typeof listEnterpriseAliasRowsForActiveEnterprises>>
): Promise<void> {
  const conversationId = row.id;
  try {
    const live = (await getConversationById(conversationId)) ?? row;
    const manualOverrides = getConversationManualClassificationOverrides(live.commercial_flow_state);
    const recentMessages = await getRecentConversationMessages(conversationId, 12);
    const latestUser = await getLastUserMessageRow(conversationId);
    const latestCustomerMessage = (latestUser?.content || '').trim();
    if (!latestCustomerMessage) {
      console.log('[LEAD_CLASSIFIER_BACKFILL_SKIP]', {
        conversationId,
        reason: 'missing_latest_customer_message',
      });
      return;
    }

    const decision = await classifyLeadConversation({
      conversationId,
      contactId: live.contact_id ?? null,
      latestCustomerMessage,
      recentMessages,
      currentTemperature: live.lead_temperature ?? null,
      currentEnterpriseId: live.enterprise_id ?? null,
      currentFunnelStatus: live.classification ?? null,
      availableEnterprises,
      enterpriseAliasRows: aliasRows,
      manualOverrideFlags: manualOverrides,
    });

    summary.analyzed += 1;
    if (decision.source === 'ai') summary.sourceAi += 1;
    else summary.sourceFallback += 1;
    if (decision.ignoredReasons.some((r) => r.includes('manual_override'))) summary.ignoredManualOverride += 1;
    if (decision.ignoredReasons.some((r) => r.includes('low_confidence'))) summary.ignoredLowConfidence += 1;

    const oldTemperature = live.lead_temperature ?? null;
    const oldEnterpriseId = live.enterprise_id ?? null;
    const oldFunnelStatus = live.classification ?? null;
    let appliedTemperature = false;
    let appliedEnterprise = false;
    let appliedFunnel = false;

    if (opts.apply) {
      if (decision.shouldUpdateTemperature) {
        const tempLower = decision.temperature.toLowerCase();
        if (tempLower === 'frio' || tempLower === 'morno' || tempLower === 'quente') {
          await setConversationLeadTemperature(conversationId, tempLower);
          appliedTemperature = true;
        }
      }
      if (decision.shouldUpdateEnterprise && decision.enterpriseId != null) {
        await setConversationEnterpriseId(conversationId, decision.enterpriseId);
        appliedEnterprise = true;
      }
      if (decision.shouldUpdateFunnel && decision.funnelStatus != null) {
        await setConversationFunnelStatusAutomatic(conversationId, decision.funnelStatus);
        appliedFunnel = true;
      }
    }

    const updated = opts.apply ? await getConversationById(conversationId) : live;
    const auditPayload = {
      oldTemperature,
      newTemperature: updated?.lead_temperature ?? oldTemperature,
      oldEnterpriseId,
      newEnterpriseId: updated?.enterprise_id ?? oldEnterpriseId,
      oldFunnelStatus,
      newFunnelStatus: updated?.classification ?? oldFunnelStatus,
      confidence: {
        temperature: decision.temperatureConfidence,
        enterprise: decision.enterpriseConfidence,
        funnel: decision.funnelConfidence,
      },
      reason: {
        temperature: decision.temperatureReason,
        enterprise: decision.enterpriseReason,
        ignored: decision.ignoredReasons,
      },
      applied: {
        temperature: appliedTemperature,
        enterprise: appliedEnterprise,
        funnel: appliedFunnel,
      },
      ignoredReason: decision.ignoredReasons.length > 0 ? decision.ignoredReasons.join(';') : null,
      mainIntent: decision.mainIntent,
      classifierSource: decision.source,
    } as const;

    if (opts.apply) {
      await saveLeadClassificationAudit(conversationId, auditPayload);
    }

    if (appliedTemperature) summary.updatedTemperature += 1;
    if (appliedEnterprise) summary.updatedEnterprise += 1;
    if (appliedFunnel) summary.updatedFunnel += 1;

    console.log('[LEAD_CLASSIFIER_BACKFILL]', {
      conversationId,
      mode: opts.apply ? 'apply' : 'dry-run',
      handoff: live.handoff === true || live.classification === 'Handoff',
      source: decision.source,
      shouldUpdate: {
        temperature: decision.shouldUpdateTemperature,
        enterprise: decision.shouldUpdateEnterprise,
        funnel: decision.shouldUpdateFunnel,
      },
      applied: auditPayload.applied,
      old: {
        temperature: oldTemperature,
        enterpriseId: oldEnterpriseId,
        funnel: oldFunnelStatus,
      },
      next: {
        temperature: decision.temperature,
        enterpriseId: decision.enterpriseId,
        funnel: decision.funnelStatus,
      },
      confidence: auditPayload.confidence,
      ignoredReason: auditPayload.ignoredReason,
    });
  } catch (error) {
    summary.errors += 1;
    console.error('[LEAD_CLASSIFIER_BACKFILL_ERROR]', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[LEAD_CLASSIFIER_BACKFILL_START]', {
    mode: opts.apply ? 'apply' : 'dry-run',
    limit: opts.limit,
    conversationId: opts.conversationId,
    onlyMissingEnterprise: opts.onlyMissingEnterprise,
    onlyMissingTemperature: opts.onlyMissingTemperature,
    since: opts.since,
    concurrency: opts.concurrency,
    minDelayMs: opts.minDelayMs,
    maxDelayMs: opts.maxDelayMs,
  });

  const [availableEnterprises, candidates] = await Promise.all([
    listEnterprises(true),
    loadConversationCandidates(opts),
  ]);
  const aliasRows =
    availableEnterprises.length > 0
      ? await listEnterpriseAliasRowsForActiveEnterprises(availableEnterprises.map((item) => item.id))
      : [];

  console.log('[LEAD_CLASSIFIER_BACKFILL_SCOPE]', {
    conversations: candidates.length,
    enterprises: availableEnterprises.length,
    aliases: aliasRows.length,
  });

  const summary: Summary = {
    analyzed: 0,
    sourceAi: 0,
    sourceFallback: 0,
    updatedTemperature: 0,
    updatedEnterprise: 0,
    updatedFunnel: 0,
    ignoredManualOverride: 0,
    ignoredLowConfidence: 0,
    errors: 0,
  };

  let cursor = 0;
  const workers = new Array(opts.concurrency).fill(null).map(async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= candidates.length) return;
      const row = candidates[idx]!;
      await processOneConversation(row, opts, summary, availableEnterprises, aliasRows);
      await sleep(randomInt(opts.minDelayMs, opts.maxDelayMs));
    }
  });
  await Promise.all(workers);

  console.log('[LEAD_CLASSIFIER_BACKFILL_SUMMARY]', {
    mode: opts.apply ? 'apply' : 'dry-run',
    totalAnalisadas: summary.analyzed,
    totalSourceAi: summary.sourceAi,
    totalSourceFallback: summary.sourceFallback,
    temperaturasAtualizadas: summary.updatedTemperature,
    empreendimentosAtualizados: summary.updatedEnterprise,
    funisAtualizados: summary.updatedFunnel,
    ignoradasPorOverrideManual: summary.ignoredManualOverride,
    ignoradasPorBaixaConfianca: summary.ignoredLowConfidence,
    erros: summary.errors,
  });
}

run().catch((error) => {
  console.error('[LEAD_CLASSIFIER_BACKFILL_FATAL]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

