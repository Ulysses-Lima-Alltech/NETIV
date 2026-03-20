-- Segmentação comercial / motivo da classificação Reserva (campanhas futuras).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_reason VARCHAR(64);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_desired_city TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_price_min NUMERIC(15, 2);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_price_max NUMERIC(15, 2);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_property_type TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_bedrooms SMALLINT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_interest_type VARCHAR(32);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_follow_up_moment TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserve_commercial_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_reserve_reason ON conversations (reserve_reason)
  WHERE classification = 'Reserva' AND reserve_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_reserve_city ON conversations (reserve_desired_city)
  WHERE classification = 'Reserva' AND reserve_desired_city IS NOT NULL;
