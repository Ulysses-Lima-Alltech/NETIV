-- Garante colunas de IA em integration_settings (caso 007 não tenha sido aplicada).
ALTER TABLE integration_settings ADD COLUMN openai_api_key TEXT;
ALTER TABLE integration_settings ADD COLUMN openai_base_url TEXT;
ALTER TABLE integration_settings ADD COLUMN model_cold_lead TEXT;
ALTER TABLE integration_settings ADD COLUMN model_hot_lead TEXT;
ALTER TABLE integration_settings ADD COLUMN temperature REAL;
ALTER TABLE integration_settings ADD COLUMN max_tokens INTEGER;
ALTER TABLE integration_settings ADD COLUMN lead_score_threshold REAL;
ALTER TABLE integration_settings ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
UPDATE integration_settings SET
  model_cold_lead = COALESCE(model_cold_lead, 'gpt-4'),
  model_hot_lead = COALESCE(model_hot_lead, 'gpt-4o'),
  temperature = COALESCE(temperature, 0.4),
  max_tokens = COALESCE(max_tokens, 500),
  lead_score_threshold = COALESCE(lead_score_threshold, 0.75),
  ai_enabled = COALESCE(ai_enabled, 0)
WHERE id = 1;
