import { query } from '../db/pg.js';
import {
  getOpenAiCostSettings,
  registerOpenAiCostSyncStatus,
  resolveOpenAiCostsApiKey,
} from '../repositories/openaiCostSettingsRepository.js';

type GroupByField = 'api_key_id' | 'project_id' | 'line_item';

type CostsResult = {
  amount?: { value?: number | string; currency?: string } | null;
  api_key_id?: string | null;
  project_id?: string | null;
  line_item?: string | null;
  [key: string]: unknown;
};

type CostsBucket = {
  start_time?: number;
  end_time?: number;
  results?: CostsResult[];
};

type CostsPageResponse = {
  data?: CostsBucket[];
  next_page?: string | null;
  has_more?: boolean;
};

export interface OpenAiCostSyncOptions {
  startTime: Date;
  endTime: Date;
  groupBy?: GroupByField[];
  bucketWidth?: '1d';
  maxPages?: number;
}

export interface OpenAiCostSnapshotRow {
  periodStart: Date;
  periodEnd: Date;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  lineItem: string | null;
  enterpriseId: number | null;
  amountUsd: number;
  rawPayload: Record<string, unknown>;
}

export interface OpenAiCostSyncResult {
  syncedRows: number;
  savedRows: number;
  unknownApiKeyRows: number;
  source: 'openai_costs_api';
}

function normalizeTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function resolveOpenAiApiRoot(baseUrl: string | null | undefined): string {
  const raw = (baseUrl ?? '').trim();
  if (!raw) return 'https://api.openai.com';
  const cleaned = raw.replace(/\/+$/, '');
  if (cleaned.endsWith('/v1')) return cleaned.slice(0, -3);
  return cleaned;
}

function extractProviderErrorMessage(rawText: string): string {
  const text = rawText.trim();
  if (!text) return 'Erro sem detalhes retornado pela OpenAI.';
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    const fromError = normalizeTrimmed(parsed?.error?.message);
    if (fromError) return fromError;
  } catch {
    // no-op
  }
  return text.slice(0, 500);
}

function isMissingUsageReadScope(status: number, rawText: string): boolean {
  if (status !== 403) return false;
  return /api\.usage\.read|missing scopes?/i.test(rawText);
}

async function getEnterpriseByApiKeyIdMap(): Promise<Map<string, number>> {
  const { rows } = await query<{ openai_api_key_id: string | null; enterprise_id: number }>(
    `SELECT openai_api_key_id, enterprise_id
     FROM enterprise_ai_settings
     WHERE openai_api_key_id IS NOT NULL
       AND TRIM(openai_api_key_id) <> ''`
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeTrimmed(row.openai_api_key_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, row.enterprise_id);
  }
  return map;
}

function buildCostsUrl(params: {
  apiRoot: string;
  startTimeSec: number;
  endTimeSec: number;
  bucketWidth: '1d';
  groupBy: GroupByField[];
  page: string | null;
}): string {
  const url = new URL('/v1/organization/costs', params.apiRoot);
  url.searchParams.set('start_time', String(params.startTimeSec));
  url.searchParams.set('end_time', String(params.endTimeSec));
  url.searchParams.set('bucket_width', params.bucketWidth);
  for (const field of params.groupBy) {
    url.searchParams.append('group_by', field);
  }
  if (params.page) url.searchParams.set('page', params.page);
  return url.toString();
}

function flattenCostRows(payload: CostsPageResponse): OpenAiCostSnapshotRow[] {
  const rows: OpenAiCostSnapshotRow[] = [];
  for (const bucket of payload.data ?? []) {
    if (!bucket || typeof bucket !== 'object') continue;
    const startSec = toFiniteNumber(bucket.start_time);
    const endSec = toFiniteNumber(bucket.end_time);
    if (startSec == null || endSec == null || endSec <= startSec) continue;
    const periodStart = new Date(startSec * 1000);
    const periodEnd = new Date(endSec * 1000);
    for (const result of bucket.results ?? []) {
      const amountUsd = toFiniteNumber(result?.amount?.value);
      const currency = normalizeTrimmed(result?.amount?.currency)?.toLowerCase();
      if (amountUsd == null || amountUsd < 0) continue;
      if (currency && currency !== 'usd') continue;
      rows.push({
        periodStart,
        periodEnd,
        openaiApiKeyId: normalizeTrimmed(result?.api_key_id),
        openaiProjectId: normalizeTrimmed(result?.project_id),
        lineItem: normalizeTrimmed(result?.line_item),
        enterpriseId: null,
        amountUsd,
        rawPayload: {
          bucket: {
            start_time: bucket.start_time ?? null,
            end_time: bucket.end_time ?? null,
          },
          result: result ?? {},
        },
      });
    }
  }
  return rows;
}

async function upsertSnapshotRow(row: OpenAiCostSnapshotRow): Promise<void> {
  await query(
    `INSERT INTO openai_cost_snapshots (
      period_start,
      period_end,
      openai_api_key_id,
      openai_project_id,
      line_item,
      enterprise_id,
      amount_usd,
      raw_payload,
      synced_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
    ON CONFLICT (
      period_start,
      period_end,
      (COALESCE(openai_api_key_id, '')),
      (COALESCE(openai_project_id, '')),
      (COALESCE(line_item, ''))
    )
    DO UPDATE SET
      enterprise_id = EXCLUDED.enterprise_id,
      amount_usd = EXCLUDED.amount_usd,
      raw_payload = EXCLUDED.raw_payload,
      synced_at = NOW()`,
    [
      row.periodStart,
      row.periodEnd,
      row.openaiApiKeyId,
      row.openaiProjectId,
      row.lineItem,
      row.enterpriseId,
      row.amountUsd,
      JSON.stringify(row.rawPayload),
    ]
  );
}

export async function syncOpenAiCosts(options: OpenAiCostSyncOptions): Promise<OpenAiCostSyncResult> {
  try {
    const settings = await getOpenAiCostSettings();
    const costsApiKey = await resolveOpenAiCostsApiKey({ requireEnabled: true });
    const groupBy = (options.groupBy && options.groupBy.length > 0 ? options.groupBy : ['api_key_id']) as GroupByField[];
    const bucketWidth = options.bucketWidth ?? '1d';
    const maxPages = options.maxPages ?? 20;
    const startTimeSec = Math.floor(options.startTime.getTime() / 1000);
    const endTimeSec = Math.floor(options.endTime.getTime() / 1000);
    if (!Number.isFinite(startTimeSec) || !Number.isFinite(endTimeSec) || endTimeSec <= startTimeSec) {
      throw new Error('Período inválido para sincronização de custos.');
    }

    const apiRoot = resolveOpenAiApiRoot('https://api.openai.com');
    const apiKeyEnterpriseMap = await getEnterpriseByApiKeyIdMap();

    let page: string | null = null;
    let syncedRows = 0;
    let savedRows = 0;
    let unknownApiKeyRows = 0;
    let pageCount = 0;

    do {
      const url = buildCostsUrl({
        apiRoot,
        startTimeSec,
        endTimeSec,
        bucketWidth,
        groupBy,
        page,
      });
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${costsApiKey}`,
          'Content-Type': 'application/json',
          ...(settings.openaiProjectId ? { 'OpenAI-Project': settings.openaiProjectId } : {}),
        },
      });
      if (!response.ok) {
        const bodyText = await response.text();
        if (isMissingUsageReadScope(response.status, bodyText)) {
          throw new Error('A chave de custos não possui permissão api.usage.read.');
        }
        throw new Error(
          `Falha ao consultar OpenAI Costs API (${response.status}): ${extractProviderErrorMessage(bodyText)}`
        );
      }
      const payload = (await response.json()) as CostsPageResponse;
      const rows = flattenCostRows(payload);
      syncedRows += rows.length;

      for (const row of rows) {
        const mappedEnterpriseId = row.openaiApiKeyId ? (apiKeyEnterpriseMap.get(row.openaiApiKeyId) ?? null) : null;
        if (row.openaiApiKeyId && mappedEnterpriseId == null) unknownApiKeyRows += 1;
        row.enterpriseId = mappedEnterpriseId;
        await upsertSnapshotRow(row);
        savedRows += 1;
      }

      page = normalizeTrimmed(payload.next_page) ?? null;
      pageCount += 1;
    } while (page && pageCount < maxPages);

    await registerOpenAiCostSyncStatus({
      status: 'success',
      error: null,
    });

    return {
      syncedRows,
      savedRows,
      unknownApiKeyRows,
      source: 'openai_costs_api',
    };
  } catch (error) {
    const err = error as Error & { code?: string };
    const message =
      err.code === 'OPENAI_COSTS_API_KEY_NOT_CONFIGURED'
        ? 'Chave de custos OpenAI não configurada.'
        : err.code === 'OPENAI_COSTS_SYNC_DISABLED'
          ? 'Sincronização de custos OpenAI está desativada.'
          : err.message || 'Erro ao sincronizar custos OpenAI.';

    await registerOpenAiCostSyncStatus({
      status: 'failed',
      error: message,
    });
    throw new Error(message);
  }
}

export async function listOpenAiCostSnapshots(params: {
  startTime?: Date | null;
  endTime?: Date | null;
  enterpriseId?: number | null;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (params.startTime) {
    conditions.push(`period_end >= $${i++}`);
    values.push(params.startTime);
  }
  if (params.endTime) {
    conditions.push(`period_start < $${i++}`);
    values.push(params.endTime);
  }
  if (params.enterpriseId != null) {
    conditions.push(`enterprise_id = $${i++}`);
    values.push(params.enterpriseId);
  }
  const limit = Math.max(1, Math.min(params.limit ?? 200, 1000));
  values.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query<Record<string, unknown>>(
    `SELECT
      id,
      period_start,
      period_end,
      openai_api_key_id,
      openai_project_id,
      line_item,
      enterprise_id,
      amount_usd,
      synced_at,
      created_at
    FROM openai_cost_snapshots
    ${where}
    ORDER BY period_start DESC, id DESC
    LIMIT $${i}`,
    values
  );
  return rows;
}
