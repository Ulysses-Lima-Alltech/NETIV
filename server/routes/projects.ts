import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { isR2Configured, uploadToR2 } from '../services/r2Storage.js';
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
  updateEnterpriseFilePermissions,
  FILE_CATEGORIES,
  ENTERPRISE_TIPOS,
  type FileCategory,
  type EnterpriseTipo,
  parseAddons,
} from '../repositories/enterpriseRepository.js';
import { createProjectSchema, updateProjectSchema, patchKnowledgeFileSchema } from '../validators/projects.js';
import { insertPromptAddonsHistory, listPromptAddonsHistory } from '../repositories/promptAddonsHistoryRepository.js';

const router = Router();

function mapKnowledgeFileRow(f: {
  id: number;
  category: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  is_active: boolean;
  can_be_used_as_knowledge: boolean;
  can_be_sent_by_ana: boolean;
  created_at: Date;
}) {
  return {
    id: f.id,
    category: f.category,
    originalName: f.original_name,
    mime: f.mime_type,
    size: Number(f.size_bytes),
    isActive: f.is_active,
    canBeUsedAsKnowledge: f.can_be_used_as_knowledge !== false,
    canBeSentByAna: f.can_be_sent_by_ana === true,
    createdAt: f.created_at.toISOString(),
  };
}

/** multipart/form: valores opcionais como string */
function parseUploadBool(v: unknown, defaultVal: boolean): boolean {
  if (v === undefined || v === null || v === '') return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(s)) return true;
  if (['false', '0', 'off', 'no'].includes(s)) return false;
  return defaultVal;
}

// memoryStorage: o buffer fica em RAM. O handler escreve em disco (cache local)
// e, se R2 estiver configurado, faz upload para o R2 como fonte de verdade.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isTxt = file.mimetype.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md');
    const isDocx =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx');
    if (!isPdf && !isTxt && !isDocx) {
      (req as unknown as { fileValidationError?: string }).fileValidationError =
        'Tipo inválido. Envie PDF, DOCX, TXT ou MD.';
      return cb(null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

function parseListFilters(req: Request): { tipo?: EnterpriseTipo; exclusivo?: boolean } {
  const tipoRaw = typeof req.query.tipo === 'string' ? req.query.tipo.toUpperCase() : '';
  const tipo = ENTERPRISE_TIPOS.includes(tipoRaw as EnterpriseTipo) ? (tipoRaw as EnterpriseTipo) : undefined;
  let exclusivo: boolean | undefined;
  if (req.query.exclusivo === '1' || req.query.exclusivo === 'true') exclusivo = true;
  else if (req.query.exclusivo === '0' || req.query.exclusivo === 'false') exclusivo = false;
  return { ...(tipo ? { tipo } : {}), ...(exclusivo !== undefined ? { exclusivo } : {}) };
}

router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.active !== '0' && req.query.active !== 'false';
    const filters = parseListFilters(req);
    const rows = await listEnterprises(activeOnly, Object.keys(filters).length ? filters : undefined);
    const out = await Promise.all(
      rows.map(async (r) => enterpriseToPublic(r, await getVariablesMap(r.id)))
    );
    res.json({ projects: out });
  } catch (e) {
    console.error('[Projects] GET:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

router.get('/:id/prompt-addons-history', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const project = await getEnterpriseById(id);
    if (!project) return res.status(404).json({ error: 'Não encontrado.' });
    const rows = await listPromptAddonsHistory(id);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        ruleText: r.rule_text,
        createdAt: r.created_at.toISOString(),
        createdByUserId: r.created_by_user_id,
        createdByName: r.creator_name ?? null,
      })),
    });
  } catch (e) {
    console.error('[Projects] GET prompt-addons-history:', e);
    res.status(500).json({ error: 'Erro ao listar histórico.' });
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
      knowledgeFiles: files.map(mapKnowledgeFileRow),
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
      tipo: parsed.data.tipo,
      exclusivo: parsed.data.exclusivo,
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
    const authUser = req.user;
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

    const before = await getEnterpriseById(id);
    if (d.promptAddons !== undefined && before) {
      const oldLines = parseAddons(before.prompt_addons);
      const same = JSON.stringify(oldLines) === JSON.stringify(d.promptAddons);
      if (!same) {
        const prevText = oldLines.length ? oldLines.join('\n') : '(nenhuma regra anterior)';
        await insertPromptAddonsHistory(id, prevText, authUser?.id ?? null);
      }
    }

    console.log('[TIPO_DEBUG] PATCH request body.tipo:', d.tipo, '| id:', id);
    const ent = await updateEnterprise(id, {
      name: d.name,
      status,
      slug: d.slug,
      languageStyle: d.languageStyle,
      tipo: d.tipo,
      exclusivo: d.exclusivo,
      promptAddons: d.promptAddons,
      city: d.city,
      stateUf: d.stateUf,
      commercialRegion: d.commercialRegion,
      ibgeCode: d.ibgeCode,
    });
    if (!ent) return res.status(404).json({ error: 'Não encontrado.' });
    console.log('[TIPO_DEBUG] PATCH saved tipo:', ent.tipo, '| id:', id);
    if (variables) await setVariables(id, variables);
    const vars = await getVariablesMap(id);
    const pub = enterpriseToPublic(ent, vars);
    console.log('[TIPO_DEBUG] PATCH response tipo:', pub.tipo, '| id:', id);
    res.json(pub);
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

router.post('/:id/knowledge', upload.single('file'), handleMulterError, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const project = await getEnterpriseById(id);
    if (!project) return res.status(404).json({ error: 'Não encontrado.' });
    const fv = (req as unknown as { fileValidationError?: string }).fileValidationError;
    if (!req.file) {
      return res.status(400).json({ error: fv || 'Envie o campo file.' });
    }
    const origName = (req.file.originalname || '').toLowerCase();
    const mime = req.file.mimetype || '';
    const isPdf = mime.includes('pdf') || origName.endsWith('.pdf');
    const isTxt = mime.startsWith('text/') || origName.endsWith('.txt') || origName.endsWith('.md');
    const isDocx =
      mime.includes('wordprocessingml') || mime.includes('msword') || origName.endsWith('.docx');
    if (!isPdf && !isTxt && !isDocx) {
      return res.status(400).json({ error: 'Tipo inválido. Envie PDF, DOCX, TXT ou MD.' });
    }
    const tipoDoc = String(req.body?.tipoDocumento ?? req.body?.tipo_documento ?? '')
      .trim()
      .toUpperCase();
    let cat = (req.body?.category as string) || 'outro';
    if (tipoDoc === 'BOOK') cat = 'book';
    if (!FILE_CATEGORIES.includes(cat as FileCategory)) {
      return res.status(400).json({ error: 'Categoria inválida: book | unidades | tabela_comercial | outro' });
    }
    const canBeUsedAsKnowledge = parseUploadBool(req.body?.canBeUsedAsKnowledge, true);
    const canBeSentByAna = parseUploadBool(req.body?.canBeSentByAna, false);

    // Gera nome do arquivo (mesmo padrão do diskStorage anterior).
    const ext = req.file.originalname.includes('.')
      ? req.file.originalname.slice(req.file.originalname.lastIndexOf('.'))
      : '';
    const storedFilename = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;

    // Grava em disco como cache local (necessário para extractText + fallback local).
    const dir = join(config.storageEmpreendimentos, String(id));
    mkdirSync(dir, { recursive: true });
    const localPath = join(dir, storedFilename);
    writeFileSync(localPath, req.file.buffer);

    // Tenta upload para R2 se configurado.
    let storageProvider: 'r2' | 'local' = 'local';
    let storageKey: string | undefined;
    let bucketName: string | undefined;
    let publicUrl: string | null = null;

    if (isR2Configured()) {
      const r2Key = `empreendimentos/${id}/${storedFilename}`;
      const r2Res = await uploadToR2(r2Key, req.file.buffer, mime || 'application/octet-stream');
      if (r2Res.ok) {
        storageProvider = 'r2';
        storageKey = r2Res.key;
        bucketName = r2Res.bucket;
        publicUrl = r2Res.publicUrl;
      } else {
        // Fallback: R2 falhou, arquivo continua salvo apenas em disco local + BYTEA.
        console.error('[R2_UPLOAD_FALLBACK]', {
          enterpriseId: id,
          storedFilename,
          error: r2Res.error,
          note: 'Arquivo salvo localmente como fallback',
        });
      }
    }

    const fid = await registerEnterpriseFile(
      id,
      cat as FileCategory,
      storedFilename,
      req.file.originalname,
      mime || 'application/octet-stream',
      req.file.size,
      { canBeUsedAsKnowledge, canBeSentByAna, storageProvider, storageKey, bucketName, publicUrl }
    );
    const files = await listEnterpriseFiles(id);
    const f = files.find((x) => x.id === fid)!;
    res.status(201).json(mapKnowledgeFileRow(f));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro no upload.';
    if (typeof msg === 'string' && (msg.includes('Tipo inválido') || msg.toLowerCase().includes('file too large'))) {
      return res.status(400).json({ error: msg });
    }
    console.error('[Projects] knowledge POST:', e);
    res.status(500).json({ error: msg });
  }
});

router.patch('/:id/knowledge/:fileId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }
    const parsed = patchKnowledgeFileSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const project = await getEnterpriseById(projectId);
    if (!project) return res.status(404).json({ error: 'Não encontrado.' });
    const ok = await updateEnterpriseFilePermissions(projectId, fileId, parsed.data);
    if (!ok) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    const files = await listEnterpriseFiles(projectId);
    const f = files.find((x) => x.id === fileId);
    if (!f) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.json(mapKnowledgeFileRow(f));
  } catch (e) {
    console.error('[Projects] knowledge PATCH:', e);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

router.delete('/:id/knowledge/:fileId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }
    const result = await deleteEnterpriseFile(projectId, fileId);
    if (!result.ok) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }
    if (result.mode === 'deactivated') {
      return res.status(200).json({
        ok: true,
        deactivated: true,
        message: result.message,
      });
    }
    res.json({ ok: true, removed: true });
  } catch (e) {
    console.error('[Projects] knowledge DELETE:', e);
    res.status(500).json({ error: 'Erro ao remover.' });
  }
});

export default router;
