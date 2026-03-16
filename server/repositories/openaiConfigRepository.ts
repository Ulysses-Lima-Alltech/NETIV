import type { OpenAIConfig, OpenAIConfigPublic, OpenAIConfigUpdate } from '../types/ai.js';
import { getDb } from '../db/index.js';

type OpenAIRow = {
  openai_api_key: string;
  openai_base_url: string | null;
  model_cold_lead: string;
  model_hot_lead: string;
  temperature: number;
  max_tokens: number;
  lead_score_threshold: number;
  ai_enabled: number;
  updated_at: string;
};

const SELECT_COLS = `openai_api_key, openai_base_url, model_cold_lead, model_hot_lead,
  temperature, max_tokens, lead_score_threshold, ai_enabled, updated_at`;

function rowToConfig(row: OpenAIRow): OpenAIConfig {
  return {
    openaiApiKey: row.openai_api_key,
    openaiBaseUrl: row.openai_base_url,
    modelColdLead: row.model_cold_lead ?? 'gpt-4',
    modelHotLead: row.model_hot_lead ?? 'gpt-4o',
    temperature: row.temperature ?? 0.4,
    maxTokens: row.max_tokens ?? 500,
    leadScoreThreshold: row.lead_score_threshold ?? 0.75,
    aiEnabled: row.ai_enabled === 1,
    updatedAt: row.updated_at,
  };
}

export function getOpenAIConfig(): OpenAIConfig | null {
  const database = getDb();
  const row = database
    .prepare(`SELECT ${SELECT_COLS} FROM integration_settings WHERE id = 1 LIMIT 1`)
    .get() as OpenAIRow | undefined;
  if (!row) return null;
  return rowToConfig(row);
}

export function updateOpenAIConfig(update: OpenAIConfigUpdate): OpenAIConfig {
  const database = getDb();
  const current = getOpenAIConfig();
  const openaiApiKey = update.openaiApiKey ?? current?.openaiApiKey ?? '';
  const openaiBaseUrl = update.openaiBaseUrl !== undefined ? update.openaiBaseUrl : current?.openaiBaseUrl ?? null;
  const modelColdLead = update.modelColdLead ?? current?.modelColdLead ?? 'gpt-4';
  const modelHotLead = update.modelHotLead ?? current?.modelHotLead ?? 'gpt-4o';
  const temperature = update.temperature ?? current?.temperature ?? 0.4;
  const maxTokens = update.maxTokens ?? current?.maxTokens ?? 500;
  const leadScoreThreshold = update.leadScoreThreshold ?? current?.leadScoreThreshold ?? 0.75;
  const aiEnabled = update.aiEnabled !== undefined ? (update.aiEnabled ? 1 : 0) : (current?.aiEnabled ? 1 : 0);

  database
    .prepare(
      `UPDATE integration_settings SET
        openai_api_key = ?, openai_base_url = ?, model_cold_lead = ?, model_hot_lead = ?,
        temperature = ?, max_tokens = ?, lead_score_threshold = ?, ai_enabled = ?,
        updated_at = datetime('now')
       WHERE id = 1`
    )
    .run(openaiApiKey, openaiBaseUrl, modelColdLead, modelHotLead, temperature, maxTokens, leadScoreThreshold, aiEnabled);

  const row = database.prepare(`SELECT ${SELECT_COLS} FROM integration_settings WHERE id = 1 LIMIT 1`).get() as OpenAIRow;
  return rowToConfig(row);
}

export function getOpenAIConfigPublic(): OpenAIConfigPublic | null {
  const c = getOpenAIConfig();
  if (!c) return null;
  return {
    openaiApiKeyMasked: c.openaiApiKey.length > 0,
    openaiBaseUrl: c.openaiBaseUrl,
    modelColdLead: c.modelColdLead,
    modelHotLead: c.modelHotLead,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    leadScoreThreshold: c.leadScoreThreshold,
    aiEnabled: c.aiEnabled,
    updatedAt: c.updatedAt,
  };
}
