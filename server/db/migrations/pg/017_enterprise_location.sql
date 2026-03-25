-- Localização cadastral do empreendimento (cidade, UF, região comercial, IBGE opcional).
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS city VARCHAR(160);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS state_uf VARCHAR(2);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS commercial_region VARCHAR(240);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS ibge_code VARCHAR(12);
