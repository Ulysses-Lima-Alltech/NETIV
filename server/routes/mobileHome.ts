import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { getMobileHomeSummary } from '../services/mobileHomeService.js';

const router = Router();

router.get('/summary', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const payload = getMobileHomeSummary(user);
    res.json(payload);
  } catch (error) {
    console.error('[mobile-home] GET /summary', error);
    res.status(500).json({ error: 'Erro ao carregar resumo da Home mobile.' });
  }
});

export default router;
