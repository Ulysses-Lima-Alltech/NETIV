import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { getMobileConversationDetail, getMobileConversations } from '../services/mobileConversationsService.js';

const router = Router();

router.get('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const payload = await getMobileConversations(user);
    res.json(payload);
  } catch (error) {
    console.error('[mobile-conversations] GET /', error);
    res.status(500).json({ error: 'Erro ao carregar conversas mobile.' });
  }
});

router.get('/:id', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const conversationId = Number(req.params.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      res.status(404).json({ error: 'Conversa nao encontrada.' });
      return;
    }

    const payload = await getMobileConversationDetail(user, conversationId);
    if (!payload) {
      res.status(404).json({ error: 'Conversa nao encontrada.' });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error('[mobile-conversations] GET /:id', error);
    res.status(500).json({ error: 'Erro ao carregar detalhe da conversa mobile.' });
  }
});

export default router;
