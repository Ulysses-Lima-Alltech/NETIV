CREATE TABLE IF NOT EXISTS integration_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  openai_api_key TEXT NOT NULL DEFAULT '',
  openai_base_url TEXT,
  model_cold_lead TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  model_hot_lead TEXT NOT NULL DEFAULT 'gpt-4o',
  temperature REAL NOT NULL DEFAULT 0.5,
  max_tokens INT NOT NULL DEFAULT 700,
  lead_score_threshold REAL NOT NULL DEFAULT 0.75,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  meta_access_token TEXT NOT NULL DEFAULT '',
  whatsapp_phone_number_id TEXT NOT NULL DEFAULT '',
  whatsapp_business_account_id TEXT NOT NULL DEFAULT '',
  api_version TEXT NOT NULL DEFAULT 'v21.0',
  webhook_verify_token TEXT NOT NULL DEFAULT '',
  default_send_phone_number TEXT,
  default_country_code TEXT,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO integration_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS enterprises (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(160) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  language_style VARCHAR(20) NOT NULL DEFAULT 'natural' CHECK (language_style IN ('informal', 'natural', 'formal', 'culta')),
  prompt_addons TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enterprise_variables (
  id SERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  var_key VARCHAR(64) NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enterprise_id, var_key)
);

CREATE TABLE IF NOT EXISTS enterprise_files (
  id SERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  category VARCHAR(32) NOT NULL CHECK (category IN ('book', 'unidades', 'tabela_comercial', 'outro')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  extracted_text TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_files_enterprise ON enterprise_files(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_files_cat ON enterprise_files(enterprise_id, category) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
  external_contact_id VARCHAR(64) NOT NULL,
  contact_phone VARCHAR(64),
  customer_name TEXT,
  enterprise_id INT REFERENCES enterprises(id) ON DELETE SET NULL,
  classification VARCHAR(32) NOT NULL DEFAULT 'Novo',
  lead_temperature VARCHAR(16) NOT NULL DEFAULT 'frio',
  handoff BOOLEAN NOT NULL DEFAULT false,
  meta_phone_number_id VARCHAR(64),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel, external_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_list ON conversations(channel, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT,
  meta_message_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_meta ON messages(meta_message_id) WHERE meta_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sent_files_log (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  enterprise_file_id INT NOT NULL REFERENCES enterprise_files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  meta_message_id VARCHAR(128),
  direction VARCHAR(16),
  payload TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
