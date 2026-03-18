import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import {
  listEnterprises,
  createEnterprise,
  updateEnterprise,
  inactivateEnterprise,
  getEnterpriseById,
  enterpriseToPublic,
  getVariablesMap,
  setVariables,
  listEnterpriseFiles,
  registerEnterpriseFile,
  deleteEnterpriseFile,
  FILE_CATEGORIES,
  type FileCategory,
} from '../repositories/enterpriseRepository.js';
import { createProjectSchema, updateProjectSchema } from '../validators/projects.js';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return cb(new Error('ID inválido'), '');
      const dir = join(config.storageEmpreendimentos, String(id));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = file.originalname.includes('.') ? file.originalname.slice(file.originalname.lastIndexOf('.')) : '';
      cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isTxt = file.mimetype.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md');
    if (!isPdf && !isTxt) {
      (req as unknown as { fileValidationError?: string }).fileValidationError = 'Tipo inválido. Envie PDF, TXT ou MD.';
      return cb(null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.active !== '0' && req.query.active !== 'false';
    const rows = await listEnterprises(activeOnly);
    const out = await Promise.all(
      rows.map(async (r) => enterpriseToPublic(r, await getVariablesMap(r.id)))
    );
    res.json({ projects: out });
  } catch (e) {
    console.error('[Projects] GET:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const project = await getEnterpriseById(id);
    if (!project) return res.status(404).json({ error: 'Não encontrado.' });
    const vars = await getVariablesMap(id);
    const files = await listEnterpriseFiles(id);
    res.json({
      ...enterpriseToPublic(project, vars),
      knowledgeFiles: files.map((f) => ({
        id: f.id,
        category: f.category,
        originalName: f.original_name,
        mime: f.mime_type,
        size: Number(f.size_bytes),
        isActive: f.is_active,
        createdAt: f.created_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[Projects] GET :id:', e);
    res.status(500).json({ error: 'Erro ao carregar.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const ent = await createEnterprise(parsed.data.name.trim(), {
      slug: parsed.data.slug,
      languageStyle: parsed.data.languageStyle,
    });
    const vars = await getVariablesMap(ent.id);
    res.status(201).json(enterpriseToPublic(ent, vars));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao criar.';
    if (msg.includes('obrigatório') || msg.includes('Já existe')) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] POST:', e);
    res.status(500).json({ error: 'Erro ao criar.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    let status: 'ativo' | 'inativo' | undefined;
    if (d.status === 'ativo' || d.status === 'inativo') status = d.status;
    else if (d.active !== undefined) status = d.active ? 'ativo' : 'inativo';

    const variables = d.variables
      ? {
          priceLabel: d.variables.priceLabel ?? '',
          commercialConditions: d.variables.commercialConditions ?? '',
          availability: d.variables.availability ?? '',
          observations: d.variables.observations ?? d.variables.notes ?? '',
        }
      : undefined;

    const ent = await updateEnterprise(id, {
      name: d.name,
      status,
      slug: d.slug,
      languageStyle: d.languageStyle,
      promptAddons: d.promptAddons,
    });
    if (!ent) return res.status(404).json({ error: 'Não encontrado.' });
    if (variables) await setVariables(id, variables);
    const vars = await getVariablesMap(id);
    res.json(enterpriseToPublic(ent, vars));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro.';
    if (msg.includes('obrigatório') || msg.includes('Já existe')) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] PATCH:', e);
    res.status(500).json({ error: msg });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const ent = await inactivateEnterprise(id);
    if (!ent) return res.status(404).json({ error: 'Não encontrado.' });
    const vars = await getVariablesMap(id);
    res.json(enterpriseToPublic(ent, vars));
  } catch (e) {
    console.error('[Projects] DELETE:', e);
    res.status(500).json({ error: 'Erro.' });
  }
});

function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'Arquivo muito grande. Limite: 100 MB.' });
    return;
  }
  next(err);
}

router.post('/:id/knowledge', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const project = await getEnterpriseById(id);
    if (!project) return res.status(404).json({ error: 'Não encontrado.' });
    const fv = (req as unknown as { fileValidationError?: string }).fileValidationError;
    if (!req.file) {
      return res.status(400).json({ error: fv || 'Envie o campo file.' });
    }
    if (!req.file.mimetype || (!req.file.mimetype.includes('pdf') && !req.file.mimetype.startsWith('text/'))) {
      return res.status(400).json({ error: 'Tipo inválido. Envie PDF, TXT ou MD.' });
    }
    const cat = (req.body?.category as string) || 'outro';
    if (!FILE_CATEGORIES.includes(cat as FileCategory)) {
      return res.status(400).json({ error: 'Categoria inválida: book | unidades | tabela_comercial | outro' });
    }
    const fid = await registerEnterpriseFile(
      id,
      cat as FileCategory,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype || 'application/octet-stream',
      req.file.size
    );
    const files = await listEnterpriseFiles(id);
    const f = files.find((x) => x.id === fid)!;
    res.status(201).json({
      id: f.id,
      category: f.category,
      originalName: f.original_name,
      mime: f.mime_type,
      size: Number(f.size_bytes),
      createdAt: f.created_at.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro no upload.';
    if (typeof msg === 'string' && (msg.includes('Tipo inválido') || msg.toLowerCase().includes('file too large'))) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] knowledge POST:', e);
    res.status(500).json({ error: msg });
  }
});

router.delete('/:id/knowledge/:fileId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }
    const ok = await deleteEnterpriseFile(projectId, fileId);
    if (!ok) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Projects] knowledge DELETE:', e);
    res.status(500).json({ error: 'Erro ao remover.' });
  }
});

export default router;
