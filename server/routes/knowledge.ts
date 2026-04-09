import { Router } from 'express';
import {
  startKnowledgeBackfill,
  getKnowledgeBackfillJob,
  listKnowledgeBackfillJobs,
  deleteKnowledgeBackfillJob,
} from '../services/knowledgeBackfillService.js';
import { listKnowledgeFilesForBackfill } from '../repositories/enterpriseRepository.js';

const router = Router();

router.post('/reindex/start', (req, res) => {
  try {
    const { dryRun, enterpriseId, fileId, maxFiles } = req.body;
    
    const jobId = startKnowledgeBackfill({
      dryRun: Boolean(dryRun),
      enterpriseId: enterpriseId ? Number(enterpriseId) : undefined,
      fileId: fileId ? Number(fileId) : undefined,
      maxFiles: maxFiles ? Number(maxFiles) : undefined,
      includeInactive: false,
    });

    res.json({ 
      success: true, 
      jobId,
      message: 'Job de reindexação iniciado com sucesso'
    });
  } catch (error) {
    console.error('[KNOWLEDGE_REINDEX_START_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao iniciar reindexação',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get('/reindex/jobs', (_req, res) => {
  try {
    const jobs = listKnowledgeBackfillJobs();
    res.json({ success: true, jobs });
  } catch (error) {
    console.error('[KNOWLEDGE_REINDEX_JOBS_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao listar jobs',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get('/reindex/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = getKnowledgeBackfillJob(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        error: 'Job não encontrado'
      });
    }
    
    res.json({ success: true, job });
  } catch (error) {
    console.error('[KNOWLEDGE_REINDEX_JOB_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao obter job',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.delete('/reindex/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const deleted = deleteKnowledgeBackfillJob(jobId);
    
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'Job não encontrado'
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Job removido com sucesso'
    });
  } catch (error) {
    console.error('[KNOWLEDGE_REINDEX_DELETE_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao remover job',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get('/files', async (req, res) => {
  try {
    const { enterpriseId, includeInactive } = req.query;
    
    const files = await listKnowledgeFilesForBackfill({
      enterpriseId: enterpriseId ? Number(enterpriseId) : undefined,
      includeInactive: Boolean(includeInactive),
    });
    
    res.json({ success: true, files });
  } catch (error) {
    console.error('[KNOWLEDGE_FILES_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao listar arquivos',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
