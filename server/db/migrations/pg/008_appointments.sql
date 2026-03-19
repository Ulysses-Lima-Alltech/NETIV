-- Agendamentos
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL DEFAULT '',
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE RESTRICT,
  broker_id INT REFERENCES corretores(id) ON DELETE SET NULL,
  city VARCHAR(120) NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'CONFIRMADO' CHECK (status IN ('PENDENTE_CONFIRMACAO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO', 'NO_SHOW')),
  source VARCHAR(40) NOT NULL DEFAULT 'ANA',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_appointments_time CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_enterprise ON appointments(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_appointments_broker ON appointments(broker_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_at ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
