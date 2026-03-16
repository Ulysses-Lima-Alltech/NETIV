import { Router, Request, Response } from 'express';
import { generateText, OpenAIResponsesError } from '../services/openaiResponsesService.js';

const router = Router();

function safeErrorMessage(e: unknown): string {
  if (e instanceof OpenAIResponsesError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Erro interno ao chamar a OpenAI.';
}

router.post('/test', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ ok: false, error: 'Campo "message" é obrigatório.' });
  }

  try {
    const response = await generateText(message);
    return res.json({ ok: true, response });
  } catch (e) {
    const msg = safeErrorMessage(e);
    console.error('[OpenAI Test]', msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
