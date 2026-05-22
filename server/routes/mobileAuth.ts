import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import { loginMobileUser, toMobileAuthPublicUser } from '../services/mobileAuthService.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario e obrigatorio.'),
  password: z.string().min(1, 'Senha e obrigatoria.'),
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue) => issue.message).join('; ') || 'Dados invalidos.';
      res.status(400).json({ error: msg });
      return;
    }

    const { username, password } = parsed.data;
    const result = await loginMobileUser(username, password);

    if (!result.ok) {
      if (result.code === 'INVALID_CREDENTIALS') {
        res.status(401).json({ error: 'Usuario ou senha invalidos.' });
        return;
      }
      if (result.code === 'USER_INACTIVE') {
        res.status(403).json({ error: 'Usuario inativo.' });
        return;
      }

      res.status(500).json({ error: 'Configuracao de token mobile ausente.' });
      return;
    }

    res.json({
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    console.error('[mobile-auth] POST /login', error);
    res.status(500).json({ error: 'Erro ao fazer login mobile.' });
  }
});

router.get('/me', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    res.json({
      user: toMobileAuthPublicUser(user),
    });
  } catch (error) {
    console.error('[mobile-auth] GET /me', error);
    res.status(500).json({ error: 'Erro ao carregar usuario mobile.' });
  }
});

export default router;
