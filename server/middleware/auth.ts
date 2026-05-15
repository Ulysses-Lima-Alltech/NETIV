import { Request, Response, NextFunction } from 'express';
import {
  findEmbeddedDefaultUser,
  getSessionUser,
  type AppUser,
  type UserRole,
} from '../repositories/userRepository.js';

/** Requisição já autenticada (`user` garantido pelos middlewares `requireAuth` + `requireRole`). */
export type AuthenticatedRequest = Request & { user: AppUser };

function isAuthBypassEnabled(): boolean {
  const raw = String(process.env.AUTH_BYPASS_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    return t.length > 0 ? t : null;
  }
  // EventSource não permite Authorization customizado em todos os cenários.
  // Permitimos token por query somente no stream SSE de WhatsApp.
  if (req.method.toUpperCase() === 'GET' && req.path === '/whatsapp/events') {
    const q = req.query?.access_token;
    if (typeof q === 'string' && q.trim().length > 0) return q.trim();
  }
  return null;
}

function isTemporaryPublicSettingsAiRoute(req: Request): boolean {
  const path = req.path;
  const method = req.method.toUpperCase();
  return (
    (method === 'PUT' && path === '/settings/ai') ||
    (method === 'POST' && path === '/settings/ai/test')
  );
}

/**
 * Com Bearer válido: `req.user` vem da sessão.
 * Sem Bearer: contexto embutido (ANA integrada na plataforma principal, sem login local) — primeiro ADMIN ou `ANA_EMBEDDED_USER_ID`.
 * Bearer inválido/expirado: 401 (não faz fallback embutido).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isTemporaryPublicSettingsAiRoute(req)) {
    next();
    return;
  }

  const bypassEnabled = isAuthBypassEnabled();
  const token = getToken(req);
  if (token) {
    const user = await getSessionUser(token);
    if (user) {
      req.user = user;
      next();
      return;
    }
    if (!bypassEnabled) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
  }

  if (bypassEnabled) {
    const embeddedUser = await findEmbeddedDefaultUser();
    if (!embeddedUser) {
      res.status(503).json({
        error: 'AUTH_BYPASS_ENABLED ativo, mas nenhum usuário ativo foi encontrado para contexto padrão.',
      });
      return;
    }
    req.user = embeddedUser;
    next();
    return;
  }

  // Sem Bearer token = não autenticado
  res.status(401).json({ error: 'Não autenticado.' });
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isTemporaryPublicSettingsAiRoute(req)) {
      next();
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      console.warn('[auth] requireRole: acesso negado', {
        path: req.path,
        method: req.method,
        userId: user.id,
        role: user.role,
        allowedRoles,
      });
      res.status(403).json({ error: 'Acesso negado.' });
      return;
    }
    next();
  };
}
