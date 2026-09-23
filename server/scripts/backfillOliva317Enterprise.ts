import { query } from '../db/pg.js';
import {
  getConversationById,
  getConversationManualClassificationOverrides,
  setConversationEnterpriseIdPreservingCommercialState,
} from '../repositories/conversationRepository.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import {
  listEnterpriseAliasRowsForActiveEnterprises,
  OLIVA317_ENTERPRISE_ID,
  resolveOliva317EnterpriseFromMessage,
} from '../repositories/enterpriseMatch.js';

type Mode = 'dry-run' | 'execute';

type Options = {
  mode: Mode;
  limit: number;
  ids: number[];
};

type Candidate = {
  conversation_id: number;
  enterprise_id: number | null;
  classification: string | null;
  lead_temperature: string | null;
  handoff: boolean | null;
  commercial_flow_state: unknown;
  created_at: Date;
  last_message_at: Date | null;
  customer_name: string | null;
  masked_phone: string | null;
  message_id: number;
  message_created_at: Date;
  message_content: string;
};

type Decision = {
  candidate: Candidate;
  matchedAlias: string | null;
  manualEnterpriseOverride: boolean;
  result: 'JA_CORRETO' | 'ELEGIVEL' | 'IGNORADO_OVERRIDE_MANUAL' | 'IGNORADO_SEM_MATCH_INEQUIVOCO' | 'ERRO';
  error?: string;
};

type Summary = {
  encontrados: number;
  matchInequivoco: number;
  jaCorretos: number;
  enterpriseNull: number;
  enterpriseDiferente: number;
  overrideManual: number;
  elegiveis: number;
  corrigidos: number;
  ambiguidades: number;
  erros: number;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    mode: 'dry-run',
    limit: 200,
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

async function loadCandidates(opts: Options): Promise<Candidate[]> {
  const values: Array<number | number[]> = [];
  const where = [
    `m.role = 'user'`,
    `COALESCE(trim(m.content), '') <> ''`,
    `(
      lower(m.content) LIKE '%oliva317%'
      OR lower(m.content) LIKE '%oliva 317%'
      OR lower(m.content) LIKE '%oliva-317%'
      OR lower(m.content) LIKE '%oliva%'
    )`,
  ];
  let idx = 1;
  if (opts.ids.length > 0) {
    values.push(opts.ids);
    where.push(`c.id = ANY($${idx++}::int[])`);
  }
  values.push(opts.limit);

  const sql = `
    SELECT DISTINCT ON (c.id)
      c.id AS conversation_id,
      c.enterprise_id,
      c.classification,
      c.lead_temperature,
      c.handoff,
      c.commercial_flow_state,
      c.created_at,
      c.last_message_at,
      c.customer_name,
      CASE
        WHEN COALESCE(c.contact_phone, c.external_contact_id, '') = '' THEN NULL
        ELSE repeat('*', greatest(length(regexp_replace(COALESCE(c.contact_phone, c.external_contact_id), '\\D', '', 'g')) - 4, 0))
          || right(regexp_replace(COALESCE(c.contact_phone, c.external_contact_id), '\\D', '', 'g'), 4)
      END AS masked_phone,
      m.id AS message_id,
      m.created_at AS message_created_at,
      left(m.content, 500) AS message_content
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    WHERE ${where.join(' AND ')}
    ORDER BY c.id, m.created_at DESC, m.id DESC
    LIMIT $${idx}
  `;
  const { rows } = await query<Candidate>(sql, values);
  return rows;
}

function sameCommercialFields(before: Candidate, after: Awaited<ReturnType<typeof getConversationById>>): boolean {
  if (!after) return false;
  return (
    (after.classification ?? null) === (before.classification ?? null) &&
    (after.lead_temperature ?? null) === (before.lead_temperature ?? null) &&
    (after.handoff ?? null) === (before.handoff ?? null) &&
    JSON.stringify(after.commercial_flow_state ?? null) === JSON.stringify(before.commercial_flow_state ?? null)
  );
}

async function decide(
  candidate: Candidate,
  activeEnterprises: Awaited<ReturnType<typeof listEnterprises>>,
  aliasRows: Awaited<ReturnType<typeof listEnterpriseAliasRowsForActiveEnterprises>>
): Promise<Decision> {
  const match = resolveOliva317EnterpriseFromMessage(candidate.message_content, activeEnterprises, aliasRows);
  const matchedAliases = match.candidates.find((item) => item.enterpriseId === OLIVA317_ENTERPRISE_ID)
    ?.matchedAliases ?? [];
  const matchedAlias = matchedAliases.find((alias) => /317/.test(alias)) ?? matchedAliases[0] ?? null;
  const manualEnterpriseOverride =
    getConversationManualClassificationOverrides(candidate.commercial_flow_state).enterprise;

  if (match.source !== 'message_alias' || match.enterpriseId !== OLIVA317_ENTERPRISE_ID) {
    return {
      candidate,
      matchedAlias,
      manualEnterpriseOverride,
      result: 'IGNORADO_SEM_MATCH_INEQUIVOCO',
    };
  }
  if (candidate.enterprise_id === OLIVA317_ENTERPRISE_ID) {
    return { candidate, matchedAlias, manualEnterpriseOverride, result: 'JA_CORRETO' };
  }
  if (manualEnterpriseOverride) {
    return { candidate, matchedAlias, manualEnterpriseOverride, result: 'IGNORADO_OVERRIDE_MANUAL' };
  }
  return { candidate, matchedAlias, manualEnterpriseOverride, result: 'ELEGIVEL' };
}

async function execute(decision: Decision): Promise<Decision> {
  const before = decision.candidate;
  try {
    await setConversationEnterpriseIdPreservingCommercialState(before.conversation_id, OLIVA317_ENTERPRISE_ID);
    const after = await getConversationById(before.conversation_id);
    if ((after?.enterprise_id ?? null) !== OLIVA317_ENTERPRISE_ID) {
      return { ...decision, result: 'ERRO', error: 'enterprise_id_not_updated' };
    }
    if (!sameCommercialFields(before, after)) {
      return { ...decision, result: 'ERRO', error: 'commercial_fields_changed' };
    }
    return decision;
  } catch (error) {
    return {
      ...decision,
      result: 'ERRO',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(decisions: Decision[]): Summary {
  return {
    encontrados: decisions.length,
    matchInequivoco: decisions.filter((d) => d.result !== 'IGNORADO_SEM_MATCH_INEQUIVOCO').length,
    jaCorretos: decisions.filter((d) => d.result === 'JA_CORRETO').length,
    enterpriseNull: decisions.filter((d) => d.result === 'ELEGIVEL' && d.candidate.enterprise_id == null).length,
    enterpriseDiferente: decisions.filter((d) => d.result === 'ELEGIVEL' && d.candidate.enterprise_id != null).length,
    overrideManual: decisions.filter((d) => d.result === 'IGNORADO_OVERRIDE_MANUAL').length,
    elegiveis: decisions.filter((d) => d.result === 'ELEGIVEL').length,
    corrigidos: 0,
    ambiguidades: decisions.filter((d) => d.result === 'IGNORADO_SEM_MATCH_INEQUIVOCO').length,
    erros: decisions.filter((d) => d.result === 'ERRO').length,
  };
}

function printable(decision: Decision): Record<string, unknown> {
  const c = decision.candidate;
  return {
    conversation_id: c.conversation_id,
    enterprise_id_atual: c.enterprise_id,
    enterprise_id_proposto: OLIVA317_ENTERPRISE_ID,
    classification: c.classification,
    lead_temperature: c.lead_temperature,
    handoff: c.handoff,
    last_message_at: c.last_message_at,
    masked_phone: c.masked_phone,
    message_id: c.message_id,
    message_created_at: c.message_created_at,
    matched_alias: decision.matchedAlias,
    manualEnterpriseOverride: decision.manualEnterpriseOverride,
    resultado: decision.result,
    erro: decision.error ?? null,
    mensagem_preview: c.message_content.slice(0, 220),
  };
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const [activeEnterprises, candidates] = await Promise.all([listEnterprises(true), loadCandidates(opts)]);
  const aliasRows =
    activeEnterprises.length > 0
      ? await listEnterpriseAliasRowsForActiveEnterprises(activeEnterprises.map((item) => item.id))
      : [];

  const decisions: Decision[] = [];
  for (const candidate of candidates) {
    decisions.push(await decide(candidate, activeEnterprises, aliasRows));
  }

  const initialSummary = summarize(decisions);
  console.log('[OLIVA317_ENTERPRISE_BACKFILL_DRY_RUN]', {
    mode: opts.mode,
    summary: initialSummary,
    exemplosElegiveis: decisions.filter((d) => d.result === 'ELEGIVEL').slice(0, 20).map(printable),
    exemplosIgnorados: decisions.filter((d) => d.result !== 'ELEGIVEL').slice(0, 20).map(printable),
  });

  if (opts.mode !== 'execute') return;

  let corrected = 0;
  for (const decision of decisions) {
    if (decision.result !== 'ELEGIVEL') continue;
    const executed = await execute(decision);
    if (executed.result === 'ELEGIVEL') corrected += 1;
    else decisions[decisions.indexOf(decision)] = executed;
    console.log('[OLIVA317_ENTERPRISE_BACKFILL_EXECUTE]', printable(executed));
  }

  const finalSummary = summarize(decisions);
  finalSummary.corrigidos = corrected;
  console.log('[OLIVA317_ENTERPRISE_BACKFILL_SUMMARY]', finalSummary);
}

run().catch((error) => {
  console.error('[OLIVA317_ENTERPRISE_BACKFILL_FATAL]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
