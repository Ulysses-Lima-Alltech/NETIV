import { Router } from 'express';
import { processAnaReengagementScan } from '../services/anaReengagementService.js';

const router = Router();

/**
 * POST /reengagement/scan
 * 
 * Endpoint para executar uma varredura de reengajamento.
 * Pode ser chamado manualmente ou por um agendador (cron job).
 * 
 * Exemplo de uso:
 * curl -X POST http://localhost:3001/reengagement/scan
 */
router.post('/scan', async (req, res) => {
  try {
    console.log('[REENGAGEMENT_SCAN_START]', { timestamp: new Date().toISOString() });
    
    await processAnaReengagementScan();
    
    console.log('[REENGAGEMENT_SCAN_COMPLETE]', { timestamp: new Date().toISOString() });
    
    res.json({ 
      success: true, 
      message: 'Varredura de reengajamento concluída com sucesso',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[REENGAGEMENT_SCAN_ERROR]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro durante varredura de reengajamento',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /reengagement/status
 * 
 * Endpoint simples para verificar se o serviço está ativo.
 */
router.get('/status', (_req, res) => {
  res.json({ 
    active: true, 
    service: 'ana-reengagement',
    timestamp: new Date().toISOString()
  });
});

export default router;
