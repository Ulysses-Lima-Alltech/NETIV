import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createSession,
  deleteSession,
  findByLogin,
  getSessionOwnerId,
  revokeAllSessions,
  toPublic,
  updatePassword,
  verifyPassword,
} from '../repositories/userRepository.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getAuthorizationSummary, recordAccessAudit } from '../services/authorizationService.js';
import { disconnectSessionSockets, disconnectUserSockets } from '../realtime/socketServer.js';
import { disconnectSseSession, disconnectSseUser } from '../services/whatsappEvents.js';
import { loginRateLimit } from '../middleware/rateLimit.js';

const router = Router();

async function toAuthorizedPublic(user: Parameters<typeof toPublic>[0]) {
  const scope = await getAuthorizationSummary(user);
  return { ...toPublic(user), managerId: scope.managerId, scope };
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  password: z.string().min(1, 'Senha é obrigatória'),
}).refine((body) => Boolean(body.identifier || body.email), {
  message: 'Usuário ou e-mail é obrigatório',
  path: ['identifier'],
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres'),
  confirmPassword: z.string().min(1, 'Confirme a nova senha'),
}).superRefine((body, ctx) => {
  if (body.newPassword !== body.confirmPassword) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'A confirmação não confere' });
  }
  if (body.newPassword === body.currentPassword) {
    ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'A nova senha deve ser diferente da atual' });
  }
});

router.post('/login', loginRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
      return;
    }
    const identifier = parsed.data.identifier ?? parsed.data.email ?? '';
    const user = await findByLogin(identifier, { includeInactive: true });
    const passwordOk = user ? await verifyPassword(user.password_hash, parsed.data.password) : false;
    if (!user || !user.active || !passwordOk) {
      res.status(401).json({ error: 'Usuário/e-mail ou senha incorretos.', code: 'INVALID_CREDENTIALS' });
      return;
    }
    const token = await createSession(user.id);
    res.json({ token, user: await toAuthorizedPublic(user) });
  } catch (error) {
    console.error('[Auth] POST login:', error);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHENTICATED' });
      return;
    }
    const legacyScope = user.sessionScope;
    res.json({
      user: await toAuthorizedPublic(user),
      session: {
        scopeKind: legacyScope?.kind ?? null,
        scopeSize: legacyScope?.convIds?.length ?? null,
        scopeTotal: legacyScope?.totalSize ?? null,
      },
    });
  } catch (error) {
    console.error('[Auth] GET me:', error);
    res.status(500).json({ error: 'Erro ao obter usuário.' });
  }
});

router.post('/change-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
      return;
    }
    const loginKey = authReq.user.username ?? authReq.user.email;
    if (!loginKey) {
      res.status(409).json({ error: 'Conta sem identificador de login.', code: 'ACCOUNT_IDENTIFIER_MISSING' });
      return;
    }
    const stored = await findByLogin(loginKey, { includeInactive: true });
    if (!stored || !(await verifyPassword(stored.password_hash, parsed.data.currentPassword))) {
      res.status(400).json({ error: 'Senha atual incorreta.', code: 'CURRENT_PASSWORD_INVALID' });
      return;
    }
    await updatePassword(authReq.user.id, parsed.data.newPassword, { mustChangePassword: false });
    await revokeAllSessions(authReq.user.id);
    disconnectUserSockets(authReq.user.id, 'password_changed');
    disconnectSseUser(authReq.user.id);
    const token = await createSession(authReq.user.id);
    const refreshed = { ...authReq.user, must_change_password: false };
    await recordAccessAudit({
      actorUserId: authReq.user.id,
      targetUserId: authReq.user.id,
      action: 'PASSWORD_CHANGED',
      resourceType: 'user',
      resourceId: authReq.user.id,
    });
    res.json({ token, user: await toAuthorizedPublic(refreshed) });
  } catch (error) {
    console.error('[Auth] POST change-password:', error);
    res.status(500).json({ error: 'Erro ao alterar senha.' });
  }
});

router.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const ownerId = await getSessionOwnerId(authReq.authToken);
    await deleteSession(authReq.authToken);
    disconnectSessionSockets(authReq.authToken, 'logout');
    disconnectSseSession(authReq.authToken);
    if (ownerId != null) {
      await recordAccessAudit({
        actorUserId: ownerId,
        targetUserId: ownerId,
        action: 'SESSION_LOGOUT',
        resourceType: 'session',
      });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[Auth] POST logout:', error);
    res.status(500).json({ error: 'Erro ao sair.' });
  }
});

export default router;
