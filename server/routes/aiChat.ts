import { Router, Request, Response } from 'express';
import { generateText, OpenAIResponsesError } from '../services/openaiResponsesService.js';

const router = Router();

// Se no futuro houver middleware de autenticação, proteja esta rota aqui (ex.: router.post('/chat', authMiddleware, handler)).

function safeErrorMessage(e: unknown): string {
  if (e instanceof OpenAIResponsesError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Erro interno ao processar o chat.';
}

router.post('/chat', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ ok: false, error: 'Campo "message" é obrigatório.' });
  }

  const systemPrompt = typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt.trim() : undefined;

  try {
    const response = await generateText(message, { systemPrompt: systemPrompt || undefined });
    return res.json({ ok: true, response });
  } catch (e) {
    const msg = safeErrorMessage(e);
    console.error('[AI Chat]', msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
