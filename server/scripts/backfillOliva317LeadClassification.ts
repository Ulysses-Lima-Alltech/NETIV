import { query } from '../db/pg.js';
import {
  getConversationById,
  getConversationManualClassificationOverrides,
  saveLeadClassificationAudit,
  setConversationFunnelStatusAutomatic,
  setConversationLeadTemperature,
} from '../repositories/conversationRepository.js';
import {
  getLastUserMessageRow,
  getRecentConversationMessages,
} from '../repositories/messageRepository.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import { listEnterpriseAliasRowsForActiveEnterprises } from '../repositories/enterpriseMatch.js';
import { classifyLeadConversation } from '../services/leadClassificationService.js';

const OLIVA317_ENTERPRISE_ID = 12;

type Mode = 'dry-run' | 'execute';

type CliOptions = {
  mode: Mode;
  limit: number;
  since: string | null;
  ids: number[];
};

type CandidateRow = {
  conversation_id: number;
  contact_id: number | null;
  masked_phone: string | null;
  created_at: Date;
  last_message_at: Date | null;
  classification: string | null;
  lead_temperature: string | null;
  enterprise_id: number | null;
  commercial_flow_state: unknown;
  handoff: boolean | null;
  message_count: number;
  latest_inbound_message: string | null;
  last_lead_classification_audit: unknown;
};

type Summary = {
  found: number;
  analyzed: number;
  eligible: number;
  processed: number;
  classified: number;
  ignored: number;
  errors: number;
  ignoredReasons: Record<string, number>;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    mode: 'dry-run',
    limit: 50,
    since: null,
    ids: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.mode = 'dry-run';
    else if (arg === '--execute') opts.mode = 'execute';
    else if (arg === '--limit') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.floor(n);
      i += 1;
    } else if (arg === '--since') {
      const raw = String(argv[i + 1] ?? '').trim();
      if (raw) opts.since = raw;
      i += 1;
    } else if (arg === '--conversation-id') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.ids.push(Math.floor(n));
      i += 1;
    } else if (arg === '--ids') {
      const raw = String(argv[i + 1] ?? '');
      opts.ids.push(
        ...raw
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
          .map((n) => Math.floor(n))
      );
      i += 1;
    }
  }

  opts.ids = [...new Set(opts.ids)];
  return opts;
}

function count(summary: Summary, reason: string): void {
  summary.ignored += 1;
  summary.ignoredReasons[reason] = (summary.ignoredReasons[reason] ?? 0) + 1;
}

function hasManualOverride(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const state = raw as Record<string, unknown>;
  return (
    state.manualTemperatureOverride === true ||
    state.manualEnterpriseOverride === true ||
    state.manualClassificationOverride === true ||
    state.manualFunnelOverride === true
  );
}

function normalizeTemperature(raw: string | null | undefined): 'frio' | 'morno' | 'quente' | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'frio' || value === 'morno' || value === 'quente') return value;
  return null;
}

async function loadCandidates(opts: CliOptions): Promise<CandidateRow[]> {
  const values: Array<number | string | number[]> = [OLIVA317_ENTERPRISE_ID];
  const where = [
    'c.enterprise_id = $1',
    `EXISTS (
      SELECT 1
      FROM messages inbound
      WHERE inbound.conversation_id = c.id
        AND inbound.role = 'user'
        AND COALESCE(trim(inbound.content), '') <> ''
    )`,
  ];
  let idx = 2;

  if (opts.ids.length > 0) {
    values.push(opts.ids);
    where.push(`c.id = ANY($${idx++}::int[])`);
  }

  if (opts.since) {
    values.push(opts.since);
    where.push(`COALESCE(c.last_message_at, c.updated_at, c.created_at) >= $${idx++}::timestamptz`);
  }

  values.push(opts.limit);

  const sql = `
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      CASE
        WHEN COALESCE(c.contact_phone, c.external_contact_id, '') = '' THEN NULL
        ELSE repeat('*', greatest(length(regexp_replace(COALESCE(c.contact_phone, c.external_contact_id), '\\D', '', 'g')) - 4, 0))
          || right(regexp_replace(COALESCE(c.contact_phone, c.external_contact_id), '\\D', '', 'g'), 4)
      END AS masked_phone,
      c.created_at,
      c.last_message_at,
      c.classification,
      c.lead_temperature,
      c.enterprise_id,
      c.commercial_flow_state,
      c.handoff,
      (
        SELECT count(*)::int
        FROM messages m
        WHERE m.conversation_id = c.id
      ) AS message_count,
      (
        SELECT left(m.content, 500)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.role = 'user'
          AND COALESCE(trim(m.content), '') <> ''
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) AS latest_inbound_message,
      c.commercial_flow_state #> '{lastLeadClassificationAudit}' AS last_lead_classification_audit
    FROM conversations c
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC, c.id DESC
    LIMIT $${idx}
  `;

  const { rows } = await query<CandidateRow>(sql, values);
  return rows;
}

function basicEligibility(row: CandidateRow): string | null {
  if (row.enterprise_id !== OLIVA317_ENTERPRISE_ID) return 'not_oliva317';
  if (row.handoff === true || row.classification === 'Handoff') return 'handoff';
  if (row.classification === 'Carteira') return 'carteira';
  if (hasManualOverride(row.commercial_flow_state)) return 'manual_override';
  if (row.last_lead_classification_audit) return 'already_has_classification_audit';
  if (row.classification && row.classification !== 'Novo') return 'already_classified';
  if (row.lead_temperature) return 'already_has_temperature';
  if (!row.latest_inbound_message?.trim()) return 'missing_latest_inbound_message';
  return null;
}

async function processCandidate(
  row: CandidateRow,
  opts: CliOptions,
  summary: Summary,
  availableEnterprises: Awaited<ReturnType<typeof listEnterprises>>,
  aliasRows: Awaited<ReturnType<typeof listEnterpriseAliasRowsForActiveEnterprises>>
): Promise<void> {
  const conversationId = row.conversation_id;
  const precheck = basicEligibility(row);
  if (precheck) {
    count(summary, precheck);
    console.log('[OLIVA317_LEAD_BACKFILL_SKIP]', { conversationId, reason: precheck, row });
    return;
  }

  try {
    const live = await getConversationById(conversationId);
    if (!live) {
      count(summary, 'conversation_not_found');
      return;
    }
    const liveRow: CandidateRow = {
      ...row,
      contact_id: live.contact_id ?? row.contact_id,
      classification: live.classification ?? row.classification,
      lead_temperature: live.lead_temperature ?? row.lead_temperature,
      enterprise_id: live.enterprise_id ?? row.enterprise_id,
      commercial_flow_state: live.commercial_flow_state,
      handoff: live.handoff ?? row.handoff,
    };
    const livePrecheck = basicEligibility(liveRow);
    if (livePrecheck) {
      count(summary, livePrecheck);
      console.log('[OLIVA317_LEAD_BACKFILL_SKIP]', { conversationId, reason: livePrecheck, row: liveRow });
      return;
    }

    const latestUser = await getLastUserMessageRow(conversationId);
    const latestCustomerMessage = String(latestUser?.content ?? '').trim();
    if (!latestCustomerMessage) {
      count(summary, 'missing_latest_customer_message');
      return;
    }

    const manualOverrides = getConversationManualClassificationOverrides(live.commercial_flow_state);
    const recentMessages = await getRecentConversationMessages(conversationId, 12);
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

    if (decision.shouldUpdateEnterprise && decision.enterpriseId !== OLIVA317_ENTERPRISE_ID) {
      count(summary, 'ambiguous_enterprise_decision');
      console.log('[OLIVA317_LEAD_BACKFILL_REVIEW]', {
        conversationId,
        reason: 'ambiguous_enterprise_decision',
        currentEnterpriseId: live.enterprise_id,
        proposedEnterpriseId: decision.enterpriseId,
        latestCustomerMessage,
      });
      return;
    }

    const proposedTemperature = normalizeTemperature(decision.temperature);
    const proposedFunnel = decision.funnelStatus ?? live.classification ?? null;
    const willUpdateTemperature = decision.shouldUpdateTemperature && proposedTemperature != null;
    const willUpdateFunnel = decision.shouldUpdateFunnel && proposedFunnel != null;

    if (!willUpdateTemperature && !willUpdateFunnel) {
      count(summary, decision.ignoredReasons.join(';') || 'classifier_no_applicable_update');
    } else {
      summary.eligible += 1;
    }

    const oldTemperature = live.lead_temperature ?? null;
    const oldEnterpriseId = live.enterprise_id ?? null;
    const oldFunnelStatus = live.classification ?? null;
    let appliedTemperature = false;
    let appliedFunnel = false;

    if (opts.mode === 'execute' && (willUpdateTemperature || willUpdateFunnel)) {
      if (willUpdateTemperature && proposedTemperature) {
        const updated = await setConversationLeadTemperature(conversationId, proposedTemperature);
        appliedTemperature = (updated?.lead_temperature ?? oldTemperature) !== oldTemperature;
      }
      if (willUpdateFunnel && proposedFunnel) {
        const updated = await setConversationFunnelStatusAutomatic(conversationId, proposedFunnel);
        appliedFunnel = (updated?.classification ?? oldFunnelStatus) !== oldFunnelStatus;
      }
    }

    const updated = opts.mode === 'execute' ? await getConversationById(conversationId) : live;
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
        enterprise: false,
        funnel: appliedFunnel,
      },
      ignoredReason: decision.ignoredReasons.length > 0 ? decision.ignoredReasons.join(';') : null,
      mainIntent: decision.mainIntent,
      classifierSource: decision.source,
    } as const;

    if (opts.mode === 'execute' && (willUpdateTemperature || willUpdateFunnel)) {
      await saveLeadClassificationAudit(conversationId, auditPayload);
      summary.processed += 1;
      if ((updated?.classification ?? oldFunnelStatus) !== oldFunnelStatus || (updated?.lead_temperature ?? oldTemperature) !== oldTemperature) {
        summary.classified += 1;
      }
    }

    console.log('[OLIVA317_LEAD_BACKFILL_RESULT]', {
      mode: opts.mode,
      conversationId,
      maskedPhone: row.masked_phone,
      current: {
        classification: oldFunnelStatus,
        leadTemperature: oldTemperature,
        enterpriseId: oldEnterpriseId,
      },
      proposed: {
        classification: proposedFunnel,
        leadTemperature: proposedTemperature,
        enterpriseId: OLIVA317_ENTERPRISE_ID,
      },
      shouldUpdate: {
        temperature: decision.shouldUpdateTemperature,
        funnel: decision.shouldUpdateFunnel,
      },
      applied: auditPayload.applied,
      confidence: auditPayload.confidence,
      ignoredReason: auditPayload.ignoredReason,
      latestInboundPreview: latestCustomerMessage.slice(0, 180),
    });
  } catch (error) {
    summary.errors += 1;
    console.error('[OLIVA317_LEAD_BACKFILL_ERROR]', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[OLIVA317_LEAD_BACKFILL_START]', opts);

  const [availableEnterprises, candidates] = await Promise.all([
    listEnterprises(true),
    loadCandidates(opts),
  ]);
  const aliasRows =
    availableEnterprises.length > 0
      ? await listEnterpriseAliasRowsForActiveEnterprises(availableEnterprises.map((item) => item.id))
      : [];

  console.log('[OLIVA317_LEAD_BACKFILL_CANDIDATES]', {
    found: candidates.length,
    rows: candidates,
  });

  const summary: Summary = {
    found: candidates.length,
    analyzed: 0,
    eligible: 0,
    processed: 0,
    classified: 0,
    ignored: 0,
    errors: 0,
    ignoredReasons: {},
  };

  for (const candidate of candidates) {
    await processCandidate(candidate, opts, summary, availableEnterprises, aliasRows);
  }

  console.log('[OLIVA317_LEAD_BACKFILL_SUMMARY]', summary);
}

run().catch((error) => {
  console.error('[OLIVA317_LEAD_BACKFILL_FATAL]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
