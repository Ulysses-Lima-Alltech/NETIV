-- Empreendimento: linguagem, variáveis, addons; arquivos de conhecimento.
ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE projects ADD COLUMN language_style TEXT NOT NULL DEFAULT 'natural';
ALTER TABLE projects ADD COLUMN variables_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN prompt_addons_json TEXT NOT NULL DEFAULT '[]';

UPDATE projects SET slug = lower(replace(replace(trim(name), ' ', '-'), '''', '')) WHERE slug IS NULL OR slug = '';

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

CREATE TABLE IF NOT EXISTS project_knowledge_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stored_filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_project_knowledge_files_project ON project_knowledge_files(project_id);
