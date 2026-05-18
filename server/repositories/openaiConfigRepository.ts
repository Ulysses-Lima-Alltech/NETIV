import type { OpenAIConfig, OpenAIConfigPublic, OpenAIConfigUpdate } from '../types/ai.js';
import { query } from '../db/pg.js';
import {
  getDefaultOpenAiModelCold,
  getDefaultOpenAiModelHot,
  isAllowedOpenAiModel,
  OPENAI_ALLOWED_MODELS,
} from '../catalogs/aiModels.js';

type Row = {
  openai_api_key: string;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_cold_lead: string;
  model_hot_lead: string;
  temperature: number;
  max_tokens: number;
  lead_score_threshold: number;
  /** PostgreSQL BOOLEAN ou INTEGER (0/1) em migrações legadas */
  ai_enabled: boolean | number;
  updated_at: Date;
};

function rowToConfig(row: Row): OpenAIConfig {
  return {
    openaiApiKey: row.openai_api_key ?? '',
    openaiApiKeyId: row.openai_api_key_id ?? null,
    openaiProjectId: row.openai_project_id ?? null,
    openaiBaseUrl: row.openai_base_url,
    modelColdLead: row.model_cold_lead ?? getDefaultOpenAiModelCold(),
    modelHotLead: row.model_hot_lead ?? getDefaultOpenAiModelHot(),
    temperature: Number(row.temperature) ?? 0.5,
    maxTokens: row.max_tokens ?? 700,
    leadScoreThreshold: Number(row.lead_score_threshold) ?? 0.75,
    aiEnabled: row.ai_enabled === true || row.ai_enabled === 1,
    updatedAt: row.updated_at?.toISOString?.() ?? new Date().toISOString(),
  };
}

export async function getOpenAIConfig(): Promise<OpenAIConfig | null> {
  const { rows } = await query<Row>(
    `SELECT openai_api_key, openai_api_key_id, openai_project_id, openai_base_url, model_cold_lead, model_hot_lead, temperature, max_tokens, lead_score_threshold, ai_enabled, updated_at
     FROM integration_settings WHERE id = 1`
  );
  if (!rows[0]) return null;
  return rowToConfig(rows[0]);
}

export async function updateOpenAIConfig(update: OpenAIConfigUpdate): Promise<OpenAIConfig> {
  const current = await getOpenAIConfig();
  const removeApiKey = update.removeApiKey === true;
  const openaiApiKey = removeApiKey
    ? ''
    : update.openaiApiKey != null && update.openaiApiKey.trim() !== ''
      ? update.openaiApiKey
      : current?.openaiApiKey ?? '';
  const openaiApiKeyId =
    update.openaiApiKeyId !== undefined ? update.openaiApiKeyId : current?.openaiApiKeyId ?? null;
  const openaiProjectId =
    update.openaiProjectId !== undefined ? update.openaiProjectId : current?.openaiProjectId ?? null;
  const openaiBaseUrl = update.openaiBaseUrl !== undefined ? update.openaiBaseUrl : current?.openaiBaseUrl ?? null;
  const modelColdLead = update.modelColdLead ?? current?.modelColdLead ?? getDefaultOpenAiModelCold();
  const modelHotLead = update.modelHotLead ?? current?.modelHotLead ?? getDefaultOpenAiModelHot();
  if (modelColdLead && !isAllowedOpenAiModel(modelColdLead)) {
    const error = new Error('Modelo invalido para modelColdLead.');
    (error as Error & { code?: string }).code = 'INVALID_OPENAI_MODEL';
    throw error;
  }
  if (modelHotLead && !isAllowedOpenAiModel(modelHotLead)) {
    const error = new Error('Modelo invalido para modelHotLead.');
    (error as Error & { code?: string }).code = 'INVALID_OPENAI_MODEL';
    throw error;
  }
  const temperature = update.temperature ?? current?.temperature ?? 0.5;
  const maxTokens = update.maxTokens ?? current?.maxTokens ?? 700;
  const leadScoreThreshold = update.leadScoreThreshold ?? current?.leadScoreThreshold ?? 0.75;
  const aiEnabled = update.aiEnabled !== undefined ? update.aiEnabled : (current?.aiEnabled ?? false);

  await query(
    `UPDATE integration_settings SET
      openai_api_key = $1, openai_api_key_id = $2, openai_project_id = $3, openai_base_url = $4, model_cold_lead = $5, model_hot_lead = $6,
      temperature = $7, max_tokens = $8, lead_score_threshold = $9, ai_enabled = $10, updated_at = NOW()
     WHERE id = 1`,
    [
      openaiApiKey,
      openaiApiKeyId,
      openaiProjectId,
      openaiBaseUrl,
      modelColdLead,
      modelHotLead,
      temperature,
      maxTokens,
      leadScoreThreshold,
      aiEnabled,
    ]
  );
  return (await getOpenAIConfig())!;
}

/** Valores crus das colunas (sem defaults de rowToConfig) para precedência Ana: DB → env → default. */
export async function getIntegrationModelStringsRaw(): Promise<{
  modelColdLead: string | null;
  modelHotLead: string | null;
}> {
  const { rows } = await query<{ model_cold_lead: string | null; model_hot_lead: string | null }>(
    `SELECT model_cold_lead, model_hot_lead FROM integration_settings WHERE id = 1`
  );
  const r = rows[0];
  if (!r) return { modelColdLead: null, modelHotLead: null };
  const trim = (v: string | null) =>
    v != null && String(v).trim() !== '' ? String(v).trim() : null;
  return { modelColdLead: trim(r.model_cold_lead), modelHotLead: trim(r.model_hot_lead) };
}

export async function getOpenAIConfigPublic(): Promise<OpenAIConfigPublic | null> {
  const c = await getOpenAIConfig();
  if (!c) return null;
  return {
    openaiApiKeyMasked: c.openaiApiKey.length > 0,
    openaiApiKeyId: c.openaiApiKeyId ?? null,
    openaiProjectId: c.openaiProjectId ?? null,
    openaiBaseUrl: c.openaiBaseUrl,
    modelColdLead: c.modelColdLead,
    modelHotLead: c.modelHotLead,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    leadScoreThreshold: c.leadScoreThreshold,
    aiEnabled: c.aiEnabled,
    updatedAt: c.updatedAt,
    availableModels: OPENAI_ALLOWED_MODELS,
  };
}
