import { query } from '../db/pg.js';
import { generateChatCompletion } from './openaiService.js';
import { sanitizeProviderErrorMessage } from '../utils/llmProviderDiagnostics.js';
import {
  getDefaultOpenAiModelCold,
  getDefaultOpenAiModelHot,
  isAllowedOpenAiModel,
  type OpenAiAllowedModelItem,
  OPENAI_ALLOWED_MODELS,
} from '../catalogs/aiModels.js';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL_HOT = getDefaultOpenAiModelHot();
const DEFAULT_MODEL_COLD = getDefaultOpenAiModelCold();

export type AiProvider = 'openai' | 'bedrock';
export type AiApiKeySource = 'enterprise' | 'global_fallback';
export type AiBlockedReason =
  | 'emergency_block'
  | 'ai_disabled'
  | 'ana_model_not_configured'
  | 'missing_enterprise_api_key'
  | 'missing_global_api_key';

interface GlobalAiSettingsRow {
  openai_api_key: string;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  temperature: number | null;
  max_tokens: number | null;
  lead_score_threshold: number | null;
  ai_enabled: boolean;
}

interface EnterpriseAiSettingsRow {
  id: number;
  enterprise_id: number;
  provider: string;
  openai_api_key: string | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  ai_enabled: boolean;
  emergency_block_enabled: boolean;
  emergency_block_message: string | null;
  cost_tracking_enabled: boolean;
  use_global_defaults: boolean;
  last_connection_test_at: Date | null;
  last_connection_test_status: string | null;
  last_connection_test_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EnterpriseNameRow {
  id: number;
  name: string;
}

export interface GlobalAiSettings {
  provider: AiProvider;
  openaiApiKey: string;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  openaiBaseUrl: string | null;
  modelHotLead: string | null;
  modelColdLead: string | null;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
}

export interface GlobalAiSettingsUpdatePayload {
  provider?: AiProvider;
  openai_api_key?: string;
  remove_api_key?: boolean;
  openai_api_key_id?: string | null;
  openai_project_id?: string | null;
  openai_base_url?: string | null;
  model_hot_lead?: string | null;
  model_cold_lead?: string | null;
  temperature?: number;
  max_tokens?: number;
  lead_score_threshold?: number;
  ai_enabled?: boolean;
}

export interface EnterpriseAiSettings {
  id: number;
  enterpriseId: number;
  provider: AiProvider;
  openaiApiKey: string | null;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  openaiBaseUrl: string | null;
  modelHotLead: string | null;
  modelColdLead: string | null;
  aiEnabled: boolean;
  emergencyBlockEnabled: boolean;
  emergencyBlockMessage: string | null;
  costTrackingEnabled: boolean;
  useGlobalDefaults: boolean;
  lastConnectionTestAt: string | null;
  lastConnectionTestStatus: string | null;
  lastConnectionTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseAiSettingsUpsertPayload {
  provider?: AiProvider;
  use_global_defaults?: boolean;
  openai_api_key?: string;
  remove_api_key?: boolean;
  openai_api_key_id?: string | null;
  openai_project_id?: string | null;
  openai_base_url?: string | null;
  model_hot_lead?: string | null;
  model_cold_lead?: string | null;
  ai_enabled?: boolean;
  emergency_block_enabled?: boolean;
  emergency_block_message?: string | null;
  cost_tracking_enabled?: boolean;
}

export interface ResolvedEnterpriseAiSettings {
  enterpriseId: number | null;
  provider: AiProvider;
  blocked: boolean;
  reason: AiBlockedReason | null;
  blockedMessage: string | null;
  apiKeySource: AiApiKeySource | null;
  openaiApiKey: string | null;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  openaiBaseUrl: string;
  modelHotLead: string;
  modelColdLead: string;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
  emergencyBlockEnabled: boolean;
  costTrackingEnabled: boolean;
  useGlobalDefaults: boolean;
  hasOwnApiKey: boolean;
}

export interface EnterpriseAiSettingsFrontendItem {
  enterprise_id: number;
  enterprise_name: string;
  provider: AiProvider;
  use_global_defaults: boolean;
  has_own_api_key: boolean;
  masked_api_key: string | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  effective_model_hot_lead: string;
  effective_model_cold_lead: string;
  ai_enabled: boolean;
  emergency_block_enabled: boolean;
  emergency_block_message: string | null;
  cost_tracking_enabled: boolean;
  last_connection_test_at: string | null;
  last_connection_test_status: string | null;
  last_connection_test_error: string | null;
  api_key_source_preview: AiApiKeySource | null;
}

export interface GlobalAiSettingsFrontend {
  provider: AiProvider;
  has_api_key: boolean;
  masked_api_key: string | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  ai_enabled: boolean;
  temperature: number;
  max_tokens: number;
  lead_score_threshold: number;
  available_models: readonly OpenAiAllowedModelItem[];
}

export interface EnterpriseAiConnectionTestResult {
  success: boolean;
  blocked: boolean;
  reason: AiBlockedReason | null;
  model: string | null;
  baseUrl: string | null;
  apiKeySource: AiApiKeySource | null;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  reply?: string;
  error?: string | null;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const normalized = trimOrNull(value);
  if (!normalized) return null;
  return normalized.replace(/\/$/, '');
}

function resolveRuntimeProvider(): AiProvider {
  return String(process.env.ANA_PROVIDER ?? '').trim().toLowerCase() === 'bedrock'
    ? 'bedrock'
    : 'openai';
}

function resolveBedrockModelId(): string {
  return (process.env.ANA_BEDROCK_MODEL_ID || 'qwen.qwen3-next-80b-a3b').trim();
}

function resolveAnaMaxTokens(fallback: number): number {
  const value = Number(process.env.ANA_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function assertAllowedModelOrNull(
  model: string | null | undefined,
  field: string,
  providerOrBaseUrl?: string | null
): void {
  const normalized = trimOrNull(model);
  if (!normalized) return;
  if (!isAllowedOpenAiModel(normalized, providerOrBaseUrl)) {
    const error = new Error(`Modelo inválido para ${field}.`);
    (error as Error & { code?: string }).code = 'INVALID_OPENAI_MODEL';
    throw error;
  }
}

function toGlobalSettings(row: GlobalAiSettingsRow | null): GlobalAiSettings {
  if (!row) {
    return {
      provider: 'openai',
      openaiApiKey: '',
      openaiApiKeyId: null,
      openaiProjectId: null,
      openaiBaseUrl: null,
      modelHotLead: null,
      modelColdLead: null,
      temperature: 0.5,
      maxTokens: 700,
      leadScoreThreshold: 0.75,
      aiEnabled: false,
    };
  }
  return {
    provider: 'openai',
    openaiApiKey: row.openai_api_key ?? '',
    openaiApiKeyId: trimOrNull(row.openai_api_key_id),
    openaiProjectId: trimOrNull(row.openai_project_id),
    openaiBaseUrl: normalizeBaseUrl(row.openai_base_url),
    modelHotLead: trimOrNull(row.model_hot_lead),
    modelColdLead: trimOrNull(row.model_cold_lead),
    temperature: Number.isFinite(Number(row.temperature)) ? Number(row.temperature) : 0.5,
    maxTokens: Number.isFinite(Number(row.max_tokens)) ? Number(row.max_tokens) : 700,
    leadScoreThreshold: Number.isFinite(Number(row.lead_score_threshold))
      ? Number(row.lead_score_threshold)
      : 0.75,
    aiEnabled: row.ai_enabled === true,
  };
}

function toEnterpriseSettings(row: EnterpriseAiSettingsRow): EnterpriseAiSettings {
  return {
    id: row.id,
    enterpriseId: row.enterprise_id,
    provider: 'openai',
    openaiApiKey: trimOrNull(row.openai_api_key),
    openaiApiKeyId: trimOrNull(row.openai_api_key_id),
    openaiProjectId: trimOrNull(row.openai_project_id),
    openaiBaseUrl: normalizeBaseUrl(row.openai_base_url),
    modelHotLead: trimOrNull(row.model_hot_lead),
    modelColdLead: trimOrNull(row.model_cold_lead),
    aiEnabled: row.ai_enabled === true,
    emergencyBlockEnabled: row.emergency_block_enabled === true,
    emergencyBlockMessage: trimOrNull(row.emergency_block_message),
    costTrackingEnabled: row.cost_tracking_enabled === true,
    useGlobalDefaults: row.use_global_defaults === true,
    lastConnectionTestAt: row.last_connection_test_at?.toISOString() ?? null,
    lastConnectionTestStatus: trimOrNull(row.last_connection_test_status),
    lastConnectionTestError: trimOrNull(row.last_connection_test_error),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function resolveFromRows(
  enterpriseId: number | null,
  global: GlobalAiSettings,
  enterprise: EnterpriseAiSettings | null
): ResolvedEnterpriseAiSettings {
  const provider: AiProvider = resolveRuntimeProvider();
  const useGlobalDefaults = enterprise?.useGlobalDefaults ?? true;
  const aiEnabled = enterprise?.aiEnabled ?? true;
  const emergencyBlockEnabled = enterprise?.emergencyBlockEnabled ?? false;
  const emergencyBlockMessage = enterprise?.emergencyBlockMessage ?? null;
  const costTrackingEnabled = enterprise?.costTrackingEnabled ?? true;
  const ownApiKey = trimOrNull(enterprise?.openaiApiKey);
  const globalApiKey = trimOrNull(global.openaiApiKey);
  const hasOwnApiKey = ownApiKey != null;
  const modelHotLeadRaw =
    provider === 'bedrock'
      ? resolveBedrockModelId()
      : trimOrNull(enterprise?.modelHotLead) ?? trimOrNull(global.modelHotLead);
  const modelColdLeadRaw =
    provider === 'bedrock'
      ? resolveBedrockModelId()
      : trimOrNull(enterprise?.modelColdLead) ?? trimOrNull(global.modelColdLead);


  const openaiBaseUrl =
    provider === 'bedrock'
      ? 'bedrock'
      : normalizeBaseUrl(enterprise?.openaiBaseUrl) ??
        normalizeBaseUrl(global.openaiBaseUrl) ??
        DEFAULT_OPENAI_BASE_URL;
  const modelHotLead = modelHotLeadRaw && isAllowedOpenAiModel(modelHotLeadRaw, openaiBaseUrl)
    ? modelHotLeadRaw
    : null;
  const modelColdLead = modelColdLeadRaw && isAllowedOpenAiModel(modelColdLeadRaw, openaiBaseUrl)
    ? modelColdLeadRaw
    : null;
  const resolvedModelHotLead = modelHotLead ?? DEFAULT_MODEL_HOT;
  const resolvedModelColdLead = modelColdLead ?? DEFAULT_MODEL_COLD;
  const temperature = global.temperature;
  const maxTokens = provider === 'bedrock' ? resolveAnaMaxTokens(global.maxTokens) : global.maxTokens;
  const leadScoreThreshold = global.leadScoreThreshold;

  if (emergencyBlockEnabled) {
    return {
      enterpriseId,
      provider,
      blocked: true,
      reason: 'emergency_block',
      blockedMessage:
        emergencyBlockMessage ??
        'No momento este empreendimento esta com atendimento de IA temporariamente bloqueado.',
      apiKeySource: null,
      openaiApiKey: null,
      openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId),
      openaiProjectId: trimOrNull(enterprise?.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (!aiEnabled) {
    return {
      enterpriseId,
      provider,
      blocked: true,
      reason: 'ai_disabled',
      blockedMessage: null,
      apiKeySource: null,
      openaiApiKey: null,
      openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId),
      openaiProjectId: trimOrNull(enterprise?.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (!modelHotLead || !modelColdLead) {
    return {
      enterpriseId,
      provider,
      blocked: true,
      reason: 'ana_model_not_configured',
      blockedMessage: null,
      apiKeySource: null,
      openaiApiKey: null,
      openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId) ?? trimOrNull(global.openaiApiKeyId),
      openaiProjectId: trimOrNull(enterprise?.openaiProjectId) ?? trimOrNull(global.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (provider === 'bedrock') {
    return {
      enterpriseId,
      provider,
      blocked: false,
      reason: null,
      blockedMessage: null,
      apiKeySource: null,
      openaiApiKey: 'bedrock',
      openaiApiKeyId: null,
      openaiProjectId: null,
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (!useGlobalDefaults) {
    if (!ownApiKey) {
      return {
        enterpriseId,
        provider,
        blocked: true,
        reason: 'missing_enterprise_api_key',
        blockedMessage: null,
        apiKeySource: null,
        openaiApiKey: null,
        openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId),
        openaiProjectId: trimOrNull(enterprise?.openaiProjectId),
        openaiBaseUrl,
        modelHotLead: resolvedModelHotLead,
        modelColdLead: resolvedModelColdLead,
        temperature,
        maxTokens,
        leadScoreThreshold,
        aiEnabled,
        emergencyBlockEnabled,
        costTrackingEnabled,
        useGlobalDefaults,
        hasOwnApiKey,
      };
    }
    return {
      enterpriseId,
      provider,
      blocked: false,
      reason: null,
      blockedMessage: null,
      apiKeySource: 'enterprise',
      openaiApiKey: ownApiKey,
      openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId),
      openaiProjectId: trimOrNull(enterprise?.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (ownApiKey) {
    return {
      enterpriseId,
      provider,
      blocked: false,
      reason: null,
      blockedMessage: null,
      apiKeySource: 'enterprise',
      openaiApiKey: ownApiKey,
      openaiApiKeyId: trimOrNull(enterprise?.openaiApiKeyId),
      openaiProjectId: trimOrNull(enterprise?.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  if (!globalApiKey) {
    return {
      enterpriseId,
      provider,
      blocked: true,
      reason: 'missing_global_api_key',
      blockedMessage: null,
      apiKeySource: null,
      openaiApiKey: null,
      openaiApiKeyId: trimOrNull(global.openaiApiKeyId),
      openaiProjectId: trimOrNull(global.openaiProjectId),
      openaiBaseUrl,
      modelHotLead: resolvedModelHotLead,
      modelColdLead: resolvedModelColdLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
      emergencyBlockEnabled,
      costTrackingEnabled,
      useGlobalDefaults,
      hasOwnApiKey,
    };
  }

  return {
    enterpriseId,
    provider,
    blocked: false,
    reason: null,
    blockedMessage: null,
    apiKeySource: 'global_fallback',
    openaiApiKey: globalApiKey,
    openaiApiKeyId: trimOrNull(global.openaiApiKeyId),
    openaiProjectId: trimOrNull(global.openaiProjectId),
    openaiBaseUrl,
    modelHotLead: resolvedModelHotLead,
    modelColdLead: resolvedModelColdLead,
    temperature,
    maxTokens,
    leadScoreThreshold,
    aiEnabled,
    emergencyBlockEnabled,
    costTrackingEnabled,
    useGlobalDefaults,
    hasOwnApiKey,
  };
}

export function __resolveAiSettingsForTest(
  enterpriseId: number | null,
  global: GlobalAiSettings,
  enterprise: EnterpriseAiSettings | null
): ResolvedEnterpriseAiSettings {
  return resolveFromRows(enterpriseId, global, enterprise);
}

export function maskApiKey(apiKey: string | null | undefined): string | null {
  const value = trimOrNull(apiKey);
  if (!value) return null;
  if (value.length <= 8) return 'sk-...';
  const prefix = value.startsWith('sk-') ? 'sk-' : value.slice(0, 2);
  return `${prefix}...${value.slice(-4)}`;
}

export async function getGlobalAiSettings(): Promise<GlobalAiSettings> {
  const { rows } = await query<GlobalAiSettingsRow>(
    `SELECT openai_api_key, openai_api_key_id, openai_project_id, openai_base_url,
            model_hot_lead, model_cold_lead, temperature, max_tokens, lead_score_threshold, ai_enabled
     FROM integration_settings
     WHERE id = 1`
  );
  return toGlobalSettings(rows[0] ?? null);
}

export async function getGlobalAiSettingsForFrontend(): Promise<GlobalAiSettingsFrontend> {
  const global = await getGlobalAiSettings();
  return {
    provider: 'openai',
    has_api_key: trimOrNull(global.openaiApiKey) != null,
    masked_api_key: maskApiKey(global.openaiApiKey),
    openai_api_key_id: trimOrNull(global.openaiApiKeyId),
    openai_project_id: trimOrNull(global.openaiProjectId),
    openai_base_url: normalizeBaseUrl(global.openaiBaseUrl),
    model_hot_lead: trimOrNull(global.modelHotLead),
    model_cold_lead: trimOrNull(global.modelColdLead),
    ai_enabled: global.aiEnabled,
    temperature: global.temperature,
    max_tokens: global.maxTokens,
    lead_score_threshold: global.leadScoreThreshold,
    available_models: OPENAI_ALLOWED_MODELS,
  };
}

export async function updateGlobalAiSettings(
  payload: GlobalAiSettingsUpdatePayload
): Promise<GlobalAiSettings> {
  const current = await getGlobalAiSettings();
  const removeApiKey = payload.remove_api_key === true;
  const incomingApiKey = trimOrNull(payload.openai_api_key);
  const nextApiKey = removeApiKey ? '' : incomingApiKey ?? current.openaiApiKey;

  const incomingApiKeyId = payload.openai_api_key_id !== undefined
    ? trimOrNull(payload.openai_api_key_id)
    : current.openaiApiKeyId;
  const incomingProjectId = payload.openai_project_id !== undefined
    ? trimOrNull(payload.openai_project_id)
    : current.openaiProjectId;
  const incomingBaseUrl = payload.openai_base_url !== undefined
    ? normalizeBaseUrl(payload.openai_base_url)
    : normalizeBaseUrl(current.openaiBaseUrl);
  const incomingModelHot = payload.model_hot_lead !== undefined
    ? trimOrNull(payload.model_hot_lead)
    : trimOrNull(current.modelHotLead);
  const incomingModelCold = payload.model_cold_lead !== undefined
    ? trimOrNull(payload.model_cold_lead)
    : trimOrNull(current.modelColdLead);
  assertAllowedModelOrNull(incomingModelHot, 'model_hot_lead', incomingBaseUrl);
  assertAllowedModelOrNull(incomingModelCold, 'model_cold_lead', incomingBaseUrl);
  const temperature = payload.temperature ?? current.temperature;
  const maxTokens = payload.max_tokens ?? current.maxTokens;
  const leadScoreThreshold = payload.lead_score_threshold ?? current.leadScoreThreshold;
  const aiEnabled = payload.ai_enabled !== undefined ? payload.ai_enabled : current.aiEnabled;

  await query(
    `UPDATE integration_settings
        SET openai_api_key = $1,
            openai_api_key_id = $2,
            openai_project_id = $3,
            openai_base_url = $4,
            model_hot_lead = $5,
            model_cold_lead = $6,
            temperature = $7,
            max_tokens = $8,
            lead_score_threshold = $9,
            ai_enabled = $10,
            updated_at = NOW()
      WHERE id = 1`,
    [
      nextApiKey,
      incomingApiKeyId,
      incomingProjectId,
      incomingBaseUrl,
      incomingModelHot,
      incomingModelCold,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
    ]
  );

  return getGlobalAiSettings();
}

async function ensureEnterpriseExists(enterpriseId: number): Promise<void> {
  const { rows } = await query<{ id: number }>(
    `SELECT id FROM enterprises WHERE id = $1 LIMIT 1`,
    [enterpriseId]
  );
  if (!rows[0]) {
    throw new Error('Empreendimento nao encontrado.');
  }
}

async function ensureEnterpriseAiSettingsRow(enterpriseId: number): Promise<void> {
  await query(
    `INSERT INTO enterprise_ai_settings (enterprise_id)
     VALUES ($1)
     ON CONFLICT (enterprise_id) DO NOTHING`,
    [enterpriseId]
  );
}

export async function getEnterpriseAiSettings(
  enterpriseId: number
): Promise<EnterpriseAiSettings | null> {
  const { rows } = await query<EnterpriseAiSettingsRow>(
    `SELECT *
     FROM enterprise_ai_settings
     WHERE enterprise_id = $1
     LIMIT 1`,
    [enterpriseId]
  );
  const row = rows[0] ?? null;
  return row ? toEnterpriseSettings(row) : null;
}

export async function upsertEnterpriseAiSettings(
  enterpriseId: number,
  payload: EnterpriseAiSettingsUpsertPayload
): Promise<EnterpriseAiSettings> {
  await ensureEnterpriseExists(enterpriseId);
  await ensureEnterpriseAiSettingsRow(enterpriseId);
  const current = await getEnterpriseAiSettings(enterpriseId);
  if (!current) {
    throw new Error('Falha ao carregar configuracao do empreendimento.');
  }

  const removeApiKey = payload.remove_api_key === true;
  const incomingApiKey = trimOrNull(payload.openai_api_key);
  const nextApiKey = removeApiKey ? null : incomingApiKey ?? current.openaiApiKey;

  const provider: AiProvider =
    payload.provider !== undefined ? payload.provider : current.provider;
  const useGlobalDefaults =
    payload.use_global_defaults !== undefined ? payload.use_global_defaults : current.useGlobalDefaults;
  const aiEnabled =
    payload.ai_enabled !== undefined ? payload.ai_enabled : current.aiEnabled;
  const emergencyBlockEnabled =
    payload.emergency_block_enabled !== undefined
      ? payload.emergency_block_enabled
      : current.emergencyBlockEnabled;
  const emergencyBlockMessage =
    payload.emergency_block_message !== undefined
      ? trimOrNull(payload.emergency_block_message)
      : current.emergencyBlockMessage;
  const costTrackingEnabled =
    payload.cost_tracking_enabled !== undefined
      ? payload.cost_tracking_enabled
      : current.costTrackingEnabled;

  const openaiApiKeyId =
    payload.openai_api_key_id !== undefined
      ? trimOrNull(payload.openai_api_key_id)
      : current.openaiApiKeyId;
  const openaiProjectId =
    payload.openai_project_id !== undefined
      ? trimOrNull(payload.openai_project_id)
      : current.openaiProjectId;
  const openaiBaseUrl =
    payload.openai_base_url !== undefined
      ? normalizeBaseUrl(payload.openai_base_url)
      : normalizeBaseUrl(current.openaiBaseUrl);
  const modelHotLead =
    payload.model_hot_lead !== undefined
      ? trimOrNull(payload.model_hot_lead)
      : trimOrNull(current.modelHotLead);
  const modelColdLead =
    payload.model_cold_lead !== undefined
      ? trimOrNull(payload.model_cold_lead)
      : trimOrNull(current.modelColdLead);
  assertAllowedModelOrNull(modelHotLead, 'model_hot_lead', openaiBaseUrl);
  assertAllowedModelOrNull(modelColdLead, 'model_cold_lead', openaiBaseUrl);

  await query(
    `UPDATE enterprise_ai_settings
        SET provider = $2,
            use_global_defaults = $3,
            openai_api_key = $4,
            openai_api_key_id = $5,
            openai_project_id = $6,
            openai_base_url = $7,
            model_hot_lead = $8,
            model_cold_lead = $9,
            ai_enabled = $10,
            emergency_block_enabled = $11,
            emergency_block_message = $12,
            cost_tracking_enabled = $13,
            updated_at = NOW()
      WHERE enterprise_id = $1`,
    [
      enterpriseId,
      provider,
      useGlobalDefaults,
      nextApiKey,
      openaiApiKeyId,
      openaiProjectId,
      openaiBaseUrl,
      modelHotLead,
      modelColdLead,
      aiEnabled,
      emergencyBlockEnabled,
      emergencyBlockMessage,
      costTrackingEnabled,
    ]
  );

  const updated = await getEnterpriseAiSettings(enterpriseId);
  if (!updated) {
    throw new Error('Falha ao atualizar configuracao do empreendimento.');
  }
  return updated;
}

export async function resolveAiSettingsForEnterprise(
  enterpriseId: number | null
): Promise<ResolvedEnterpriseAiSettings> {
  const [global, enterprise] = await Promise.all([
    getGlobalAiSettings(),
    enterpriseId != null ? getEnterpriseAiSettings(enterpriseId) : Promise.resolve(null),
  ]);
  return resolveFromRows(enterpriseId, global, enterprise);
}

export async function assertCanCallAiForEnterprise(
  enterpriseId: number | null
): Promise<ResolvedEnterpriseAiSettings> {
  const resolved = await resolveAiSettingsForEnterprise(enterpriseId);
  if (!resolved.blocked && resolved.openaiApiKey) {
    return resolved;
  }
  const error = new Error(resolved.reason ?? 'ai_blocked_for_enterprise');
  (error as Error & { code?: string }).code = resolved.reason ?? 'ai_blocked_for_enterprise';
  throw error;
}

async function registerConnectionTestStatus(params: {
  enterpriseId: number;
  status: 'success' | 'failed';
  error: string | null;
}): Promise<void> {
  await ensureEnterpriseAiSettingsRow(params.enterpriseId);
  await query(
    `UPDATE enterprise_ai_settings
        SET last_connection_test_at = NOW(),
            last_connection_test_status = $2,
            last_connection_test_error = $3,
            updated_at = NOW()
      WHERE enterprise_id = $1`,
    [params.enterpriseId, params.status, params.error]
  );
}

export async function testEnterpriseAiConnection(
  enterpriseId: number
): Promise<EnterpriseAiConnectionTestResult> {
  await ensureEnterpriseExists(enterpriseId);
  const resolved = await resolveAiSettingsForEnterprise(enterpriseId);
  if (resolved.blocked || !resolved.openaiApiKey) {
    const reason = resolved.reason ?? 'ai_disabled';
    const error = sanitizeProviderErrorMessage(
      resolved.blockedMessage ??
        (reason === 'missing_enterprise_api_key'
          ? 'API key propria do empreendimento nao configurada.'
          : reason === 'missing_global_api_key'
            ? 'API key global nao configurada.'
            : reason)
    );
    await registerConnectionTestStatus({
      enterpriseId,
      status: 'failed',
      error,
    });
    return {
      success: false,
      blocked: true,
      reason: resolved.reason,
      model: null,
      baseUrl: resolved.openaiBaseUrl,
      apiKeySource: resolved.apiKeySource,
      openaiApiKeyId: resolved.openaiApiKeyId,
      openaiProjectId: resolved.openaiProjectId,
      error,
    };
  }

  const model = resolved.modelColdLead || resolved.modelHotLead || DEFAULT_MODEL_COLD;
  const completion = await generateChatCompletion({
    apiKey: resolved.openaiApiKey,
    baseUrl: resolved.openaiBaseUrl,
    model,
    messages: [{ role: 'user', content: 'Responda apenas: OK' }],
    temperature: 0,
    maxTokens: 8,
    responseFormatJson: false,
    costTracking: resolved.costTrackingEnabled
      ? {
          purpose: 'enterprise_connection_test',
          modelReason: 'enterprise_admin_connection_test',
          enterpriseId,
          apiKeySource: resolved.apiKeySource ?? undefined,
          openaiApiKeyId: resolved.openaiApiKeyId ?? undefined,
          openaiProjectId: resolved.openaiProjectId ?? undefined,
          requestType: 'connection_test',
        }
      : undefined,
  });

  if (completion.success) {
    await registerConnectionTestStatus({
      enterpriseId,
      status: 'success',
      error: null,
    });
    return {
      success: true,
      blocked: false,
      reason: null,
      model,
      baseUrl: resolved.openaiBaseUrl,
      apiKeySource: resolved.apiKeySource,
      openaiApiKeyId: resolved.openaiApiKeyId,
      openaiProjectId: resolved.openaiProjectId,
      reply: completion.content?.trim() || 'OK',
    };
  }

  const error = sanitizeProviderErrorMessage(completion.error ?? 'Erro ao testar conexao com provider.');
  await registerConnectionTestStatus({
    enterpriseId,
    status: 'failed',
    error,
  });
  return {
    success: false,
    blocked: false,
    reason: null,
    model,
    baseUrl: resolved.openaiBaseUrl,
    apiKeySource: resolved.apiKeySource,
    openaiApiKeyId: resolved.openaiApiKeyId,
    openaiProjectId: resolved.openaiProjectId,
    error,
  };
}

export async function getSafeEnterpriseAiSettingsForFrontend(): Promise<EnterpriseAiSettingsFrontendItem[]> {
  const [global, enterpriseRows, enterprises] = await Promise.all([
    getGlobalAiSettings(),
    query<EnterpriseAiSettingsRow>(`SELECT * FROM enterprise_ai_settings`),
    query<EnterpriseNameRow>(`SELECT id, name FROM enterprises ORDER BY name`),
  ]);

  const byEnterpriseId = new Map<number, EnterpriseAiSettings>();
  for (const row of enterpriseRows.rows) {
    const mapped = toEnterpriseSettings(row);
    byEnterpriseId.set(mapped.enterpriseId, mapped);
  }

  return enterprises.rows.map((enterprise) => {
    const enterpriseSettings = byEnterpriseId.get(enterprise.id) ?? null;
    const resolved = resolveFromRows(enterprise.id, global, enterpriseSettings);
    return {
      enterprise_id: enterprise.id,
      enterprise_name: enterprise.name,
      provider: 'openai',
      use_global_defaults: enterpriseSettings?.useGlobalDefaults ?? true,
      has_own_api_key: trimOrNull(enterpriseSettings?.openaiApiKey) != null,
      masked_api_key: maskApiKey(enterpriseSettings?.openaiApiKey),
      openai_api_key_id: trimOrNull(enterpriseSettings?.openaiApiKeyId),
      openai_project_id: trimOrNull(enterpriseSettings?.openaiProjectId),
      openai_base_url: normalizeBaseUrl(enterpriseSettings?.openaiBaseUrl),
      model_hot_lead: trimOrNull(enterpriseSettings?.modelHotLead),
      model_cold_lead: trimOrNull(enterpriseSettings?.modelColdLead),
      effective_model_hot_lead: resolved.modelHotLead,
      effective_model_cold_lead: resolved.modelColdLead,
      ai_enabled: enterpriseSettings?.aiEnabled ?? true,
      emergency_block_enabled: enterpriseSettings?.emergencyBlockEnabled ?? false,
      emergency_block_message: trimOrNull(enterpriseSettings?.emergencyBlockMessage),
      cost_tracking_enabled: enterpriseSettings?.costTrackingEnabled ?? true,
      last_connection_test_at: enterpriseSettings?.lastConnectionTestAt ?? null,
      last_connection_test_status: enterpriseSettings?.lastConnectionTestStatus ?? null,
      last_connection_test_error: enterpriseSettings?.lastConnectionTestError ?? null,
      api_key_source_preview: resolved.blocked ? null : resolved.apiKeySource,
    };
  });
}

