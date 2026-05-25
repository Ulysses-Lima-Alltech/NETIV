import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { getMobileEnterprises } from '../services/mobileEnterprisesService.js';

const router = Router();

router.get('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    if (user.role === 'CORRETOR') {
      res.status(403).json({ error: 'Sem permissao para listar empreendimentos.' });
      return;
    }

    const payload = await getMobileEnterprises(user);
    res.json(payload);
  } catch (error) {
    console.error('[mobile-enterprises] GET /', error);
    res.status(500).json({ error: 'Erro ao carregar empreendimentos mobile.' });
  }
});

export default router;
