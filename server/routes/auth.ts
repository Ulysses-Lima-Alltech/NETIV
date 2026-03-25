import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  findByEmail,
  findByEmailIncludingInactive,
  verifyPassword,
  createSession,
  deleteSession,
  toPublic,
} from '../repositories/userRepository.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().min(1, 'E-mail é obrigatório').email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      res.status(400).json({ error: msg });
      return;
    }
    const { email, password } = parsed.data;
    const normalized = email.trim().toLowerCase();
    console.log('[Auth][login] e-mail recebido (normalizado):', normalized);

    const user = await findByEmail(email);
    if (!user) {
      const any = await findByEmailIncludingInactive(email);
      if (any) {
        console.log('[Auth][login] usuário existe mas está inativo, id:', any.id);
      } else {
        console.log('[Auth][login] nenhum usuário ativo encontrado para este e-mail');
      }
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    console.log('[Auth][login] usuário ativo encontrado, id:', user.id, 'role:', user.role);
    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk) {
      console.log('[Auth][login] senha inválida para user id:', user.id);
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    const token = await createSession(user.id);
    console.log('[Auth][login] sessão criada, token (prefixo):', token.slice(0, 8), '… user id:', user.id);
    res.json({
      token,
      user: toPublic(user),
    });
  } catch (e) {
    console.error('[Auth][login] erro completo:', e instanceof Error ? e.stack ?? e.message : e);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    res.json({ user: toPublic(user) });
  } catch (e) {
    console.error('[Auth] GET me:', e);
    res.status(500).json({ error: 'Erro ao obter usuário.' });
  }
});

router.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (token) await deleteSession(token);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Auth] POST logout:', e);
    res.status(500).json({ error: 'Erro ao sair.' });
  }
});

export default router;
