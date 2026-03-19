-- Corretores: cadastro para uso futuro na fila de atendimentos/agendamentos.
CREATE TABLE IF NOT EXISTS corretores (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  city VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  real_estate_agency VARCHAR(255) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corretores_active ON corretores(active) WHERE active = true;
