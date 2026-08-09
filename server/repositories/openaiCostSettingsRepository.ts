import { query } from '../db/pg.js';

type OpenAiCostSettingsRow = {
  id: number;
  provider: string;
  openai_costs_api_key: string | null;
  openai_costs_api_key_id: string | null;
  openai_project_id: string | null;
  enabled: boolean;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export interface OpenAiCostSettings {
  id: number;
  provider: 'openai';
  openaiCostsApiKey: string | null;
  openaiCostsApiKeyId: string | null;
  openaiProjectId: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAiCostSettingsUpdatePayload {
  provider?: 'openai';
  openai_costs_api_key?: string;
  remove_api_key?: boolean;
  openai_costs_api_key_id?: string | null;
  openai_project_id?: string | null;
  enabled?: boolean;
}

export interface OpenAiCostSettingsPublic {
  provider: 'openai';
  has_api_key: boolean;
  masked_api_key: string | null;
  openai_costs_api_key_id: string | null;
  openai_project_id: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  updated_at: string;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toSettings(row: OpenAiCostSettingsRow): OpenAiCostSettings {
  return {
    id: row.id,
    provider: 'openai',
    openaiCostsApiKey: trimOrNull(row.openai_costs_api_key),
    openaiCostsApiKeyId: trimOrNull(row.openai_costs_api_key_id),
    openaiProjectId: trimOrNull(row.openai_project_id),
    enabled: row.enabled === true,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastSyncStatus: trimOrNull(row.last_sync_status),
    lastSyncError: trimOrNull(row.last_sync_error),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function ensureOpenAiCostSettingsRow(): Promise<void> {
  await query(
    `INSERT INTO openai_cost_settings (provider, enabled, created_at, updated_at)
     VALUES ('openai', true, NOW(), NOW())
     ON CONFLICT (provider) DO NOTHING`
  );
}

function newRepositoryError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export function maskApiKey(apiKey: string | null | undefined): string | null {
  const value = trimOrNull(apiKey);
  if (!value) return null;
  if (value.length <= 8) return 'sk-...';
  const prefix = value.startsWith('sk-') ? 'sk-' : value.slice(0, 2);
  return `${prefix}...${value.slice(-4)}`;
}

export async function getOpenAiCostSettings(): Promise<OpenAiCostSettings> {
  await ensureOpenAiCostSettingsRow();
  const { rows } = await query<OpenAiCostSettingsRow>(
    `SELECT *
     FROM openai_cost_settings
     WHERE provider = 'openai'
     LIMIT 1`
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Falha ao carregar configuração de custos OpenAI.');
  }
  return toSettings(row);
}

export async function upsertOpenAiCostSettings(
  payload: OpenAiCostSettingsUpdatePayload
): Promise<OpenAiCostSettings> {
  const current = await getOpenAiCostSettings();
  const removeApiKey = payload.remove_api_key === true;
  const incomingApiKey = trimOrNull(payload.openai_costs_api_key);
  const nextApiKey = removeApiKey ? null : incomingApiKey ?? current.openaiCostsApiKey;
  const provider = payload.provider ?? current.provider;
  const openaiCostsApiKeyId =
    payload.openai_costs_api_key_id !== undefined
      ? trimOrNull(payload.openai_costs_api_key_id)
      : current.openaiCostsApiKeyId;
  const openaiProjectId =
    payload.openai_project_id !== undefined
      ? trimOrNull(payload.openai_project_id)
      : current.openaiProjectId;
  const enabled = payload.enabled !== undefined ? payload.enabled : current.enabled;

  await query(
    `UPDATE openai_cost_settings
        SET provider = $2,
            openai_costs_api_key = $3,
            openai_costs_api_key_id = $4,
            openai_project_id = $5,
            enabled = $6,
            updated_at = NOW()
      WHERE id = $1`,
    [current.id, provider, nextApiKey, openaiCostsApiKeyId, openaiProjectId, enabled]
  );

  return getOpenAiCostSettings();
}

export async function getSafeOpenAiCostSettingsForFrontend(): Promise<OpenAiCostSettingsPublic> {
  const settings = await getOpenAiCostSettings();
  return {
    provider: 'openai',
    has_api_key: trimOrNull(settings.openaiCostsApiKey) != null,
    masked_api_key: maskApiKey(settings.openaiCostsApiKey),
    openai_costs_api_key_id: trimOrNull(settings.openaiCostsApiKeyId),
    openai_project_id: trimOrNull(settings.openaiProjectId),
    enabled: settings.enabled,
    last_sync_at: settings.lastSyncAt,
    last_sync_status: settings.lastSyncStatus,
    last_sync_error: settings.lastSyncError,
    updated_at: settings.updatedAt,
  };
}

export async function resolveOpenAiCostsApiKey(options?: { requireEnabled?: boolean }): Promise<string> {
  const settings = await getOpenAiCostSettings();
  const requireEnabled = options?.requireEnabled === true;
  if (requireEnabled && settings.enabled !== true) {
    throw newRepositoryError(
      'Sincronização de custos OpenAI está desativada.',
      'OPENAI_COSTS_SYNC_DISABLED'
    );
  }
  const apiKey = trimOrNull(settings.openaiCostsApiKey);
  if (!apiKey) {
    throw newRepositoryError(
      'Chave de custos OpenAI não configurada.',
      'OPENAI_COSTS_API_KEY_NOT_CONFIGURED'
    );
  }
  return apiKey;
}

export async function registerOpenAiCostSyncStatus(payload: {
  status: 'success' | 'failed';
  error: string | null;
}): Promise<void> {
  await ensureOpenAiCostSettingsRow();
  await query(
    `UPDATE openai_cost_settings
        SET last_sync_at = NOW(),
            last_sync_status = $1,
            last_sync_error = $2,
            updated_at = NOW()
      WHERE provider = 'openai'`,
    [payload.status, trimOrNull(payload.error)]
  );
}

