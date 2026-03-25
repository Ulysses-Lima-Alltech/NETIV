-- Nomenclatura: Reserva -> Carteira (valor persistido em classification)
UPDATE conversations SET classification = 'Carteira' WHERE classification = 'Reserva';

ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS allow_material_sending BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_broker_id INT REFERENCES corretores(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ana_customer_name_mentions INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_broker ON conversations(assigned_broker_id);

CREATE TABLE IF NOT EXISTS enterprise_prompt_addons_history (
  id SERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  rule_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_epah_enterprise_created ON enterprise_prompt_addons_history(enterprise_id, created_at DESC);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS conversation_id INT REFERENCES conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_conversation_start ON appointments(conversation_id, start_at);
