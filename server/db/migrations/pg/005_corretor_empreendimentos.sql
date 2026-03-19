-- Vínculo corretor-empreendimento: define quais corretores atendem quais empreendimentos.
CREATE TABLE IF NOT EXISTS corretor_empreendimentos (
  corretor_id INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (corretor_id, enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_corretor_empreendimentos_enterprise ON corretor_empreendimentos(enterprise_id);
