-- Classificação por empreendimento e status.
ALTER TABLE conversations ADD COLUMN project TEXT;
ALTER TABLE conversations ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'Novo';
