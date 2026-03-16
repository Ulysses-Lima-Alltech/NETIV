-- Tabela de projetos/empreendimentos (cadastro dinâmico).
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

INSERT INTO projects (name, active, created_at, updated_at)
SELECT 'Evora', 1, datetime('now'), datetime('now') WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Evora');
INSERT INTO projects (name, active, created_at, updated_at)
SELECT 'Montaresa', 1, datetime('now'), datetime('now') WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Montaresa');

-- Relacionamento: conversa -> projeto (mantém referência mesmo se projeto for inativado).
ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id);

UPDATE conversations SET project_id = (SELECT id FROM projects WHERE name = conversations.project LIMIT 1)
WHERE project IS NOT NULL AND TRIM(COALESCE(project, '')) != '';
