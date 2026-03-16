import { Router } from 'express';
import { z } from 'zod';
import { computeLeadAnalysis } from '../services/leadAnalyzer.js';

const router = Router();

const analyzeBodySchema = z.object({
  messages: z.array(z.string()),
});

/**
 * POST /api/lead/analyze
 * Analisa uma lista de mensagens (simuladas) e retorna classificação sem OpenAI.
 */
router.post('/analyze', (req, res) => {
  try {
    const parsed = analyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const { messages } = parsed.data;
    const result = computeLeadAnalysis(messages);
    return res.json({
      leadScore: result.leadScore,
      leadStage: result.leadStage,
      leadIntentNow: result.leadIntentNow,
      reason: result.reason,
    });
  } catch (e) {
    console.error('[Lead] POST /analyze:', e);
    return res.status(500).json({ error: 'Erro ao analisar lead.' });
  }
});

export default router;
