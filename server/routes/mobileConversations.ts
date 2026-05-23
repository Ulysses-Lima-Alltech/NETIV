import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import {
  createMobileConversationMessage,
  getMobileConversationDetail,
  getMobileConversations,
  setMobileConversationHandoff,
} from '../services/mobileConversationsService.js';

const router = Router();

router.get('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const typeRaw = String(req.query.type ?? 'CLIENT').toUpperCase();
    const type = typeRaw === 'INTERNO' ? 'INTERNO' : 'CLIENT';
    const payload = await getMobileConversations(user, type);
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

router.patch('/:id/handoff', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
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

    const handoff = req.body?.handoff;
    if (typeof handoff !== 'boolean') {
      res.status(400).json({ error: 'Campo handoff deve ser boolean.' });
      return;
    }

    const payload = await setMobileConversationHandoff(user, conversationId, handoff);
    if (!payload) {
      res.status(404).json({ error: 'Conversa nao encontrada.' });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error('[mobile-conversations] PATCH /:id/handoff', error);
    res.status(500).json({ error: 'Erro ao atualizar handoff mobile.' });
  }
});

router.post('/:id/messages', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
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

    const textRaw = typeof req.body?.text === 'string' ? req.body.text : '';
    const text = textRaw.trim();
    if (!text) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: 'Mensagem excede o limite de 2000 caracteres.' });
      return;
    }

    const payload = await createMobileConversationMessage(user, conversationId, text);
    if (!payload.ok) {
      res.status(payload.status).json({ error: payload.message, code: payload.code });
      return;
    }

    res.json(payload.payload);
  } catch (error) {
    console.error('[mobile-conversations] POST /:id/messages', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem mobile.' });
  }
});

export default router;
