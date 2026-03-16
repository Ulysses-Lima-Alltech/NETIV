import { getDb } from '../db/index.js';

export interface ProjectRow {
  id: number;
  name: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export function listProjects(activeOnly: boolean = false): ProjectRow[] {
  const database = getDb();
  const sql = activeOnly
    ? 'SELECT * FROM projects WHERE active = 1 ORDER BY name ASC'
    : 'SELECT * FROM projects ORDER BY name ASC';
  return database.prepare(sql).all() as ProjectRow[];
}

export function getProjectById(id: number): ProjectRow | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return (row as ProjectRow) ?? null;
}

export function createProject(name: string): ProjectRow {
  const database = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nome do projeto é obrigatório.');
  const existing = database.prepare('SELECT id FROM projects WHERE name = ?').get(trimmed);
  if (existing) throw new Error('Já existe um projeto com esse nome.');
  const now = new Date().toISOString();
  const result = database
    .prepare('INSERT INTO projects (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)')
    .run(trimmed, now, now);
  return database.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as ProjectRow;
}

export function updateProject(
  id: number,
  update: { name?: string; active?: number }
): ProjectRow | null {
  const database = getDb();
  const current = database.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!current) return null;
  const name = update.name !== undefined ? update.name.trim() : current.name;
  const active = update.active !== undefined ? (update.active ? 1 : 0) : current.active;
  if (update.name !== undefined && !name) throw new Error('Nome do projeto é obrigatório.');
  if (update.name !== undefined && name !== current.name) {
    const existing = database.prepare('SELECT id FROM projects WHERE name = ? AND id != ?').get(name, id);
    if (existing) throw new Error('Já existe um projeto com esse nome.');
  }
  const now = new Date().toISOString();
  database.prepare('UPDATE projects SET name = ?, active = ?, updated_at = ? WHERE id = ?').run(name, active, now, id);
  return getProjectById(id);
}

/** Inativa o projeto (soft delete). Conversas mantêm project_id. */
export function inactivateProject(id: number): ProjectRow | null {
  return updateProject(id, { active: 0 });
}
