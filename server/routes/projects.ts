import { Router } from 'express';
import {
  listProjects,
  createProject,
  updateProject,
  inactivateProject,
  getProjectById,
} from '../repositories/projectRepository.js';
import { createProjectSchema, updateProjectSchema } from '../validators/projects.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const activeOnly = req.query.active !== '0' && req.query.active !== 'false';
    const rows = listProjects(activeOnly);
    res.json({
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        active: r.active === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    console.error('[Projects] GET:', e);
    res.status(500).json({ error: 'Erro ao listar projetos.' });
  }
});

router.post('/', (req, res) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const project = createProject(parsed.data.name.trim());
    res.status(201).json({
      id: project.id,
      name: project.name,
      active: project.active === 1,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao criar projeto.';
    if (msg.includes('obrigatório') || msg.includes('Já existe')) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] POST:', e);
    res.status(500).json({ error: 'Erro ao criar projeto.' });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const update: { name?: string; active?: number } = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
    if (parsed.data.active !== undefined) update.active = parsed.data.active ? 1 : 0;
    const project = updateProject(id, update);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
    res.json({
      id: project.id,
      name: project.name,
      active: project.active === 1,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao atualizar projeto.';
    if (msg.includes('obrigatório') || msg.includes('Já existe')) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] PATCH:', e);
    res.status(500).json({ error: msg });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const project = inactivateProject(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
    res.json({
      id: project.id,
      name: project.name,
      active: false,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    });
  } catch (e) {
    console.error('[Projects] DELETE:', e);
    res.status(500).json({ error: 'Erro ao inativar projeto.' });
  }
});

export default router;
