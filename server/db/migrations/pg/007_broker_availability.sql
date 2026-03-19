-- Disponibilidade semanal dos corretores (0=domingo ... 6=sábado)
CREATE TABLE IF NOT EXISTS broker_availability (
  id SERIAL PRIMARY KEY,
  broker_id INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_broker_availability_time CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_broker_availability_broker ON broker_availability(broker_id);
