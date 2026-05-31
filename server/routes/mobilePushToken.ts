import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { upsertMobileUserDeviceToken } from '../repositories/mobileDeviceTokenRepository.js';

const router = Router();

const registerPushTokenSchema = z.object({
  token: z.string().min(1, 'Token e obrigatorio.').max(500, 'Token invalido.'),
  platform: z.string().trim().max(40, 'Platform invalida.').optional().nullable(),
});

router.post('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const parsed = registerPushTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue) => issue.message).join('; ') || 'Payload invalido.';
      res.status(400).json({ error: msg });
      return;
    }

    const saved = await upsertMobileUserDeviceToken({
      userId: user.id,
      token: parsed.data.token,
      platform: parsed.data.platform ?? null,
    });

    res.status(201).json({
      success: true,
      tokenId: String(saved.id),
      active: saved.active,
      updatedAt: saved.updated_at.toISOString(),
    });
  } catch (error) {
    console.error('[mobile-push-token] POST /', error);
    res.status(500).json({ error: 'Erro ao registrar push token mobile.' });
  }
});

export default router;

