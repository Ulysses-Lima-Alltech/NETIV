import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { getMobileTeam } from '../services/mobileTeamService.js';

const router = Router();

router.get('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const payload = await getMobileTeam(user);
    res.json(payload);
  } catch (error) {
    console.error('[mobile-team] GET /', error);
    res.status(500).json({ error: 'Erro ao carregar equipe mobile.' });
  }
});

export default router;
