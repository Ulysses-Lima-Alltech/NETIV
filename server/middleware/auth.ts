import type { NextFunction, Request, Response } from 'express';
import { getSessionUser, type AppUser, type UserRole } from '../repositories/userRepository.js';

export type AuthenticatedRequest = Request & { user: AppUser; authToken: string };

export function getTokenFromRequest(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  if (req.method.toUpperCase() === 'GET' && req.path === '/whatsapp/events') {
    const queryToken = req.query?.access_token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHENTICATED' });
      return;
    }
    const user = await getSessionUser(token);
    if (!user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.', code: 'SESSION_INVALID' });
      return;
    }
    req.user = user;
    (req as AuthenticatedRequest).authToken = token;
    next();
  } catch (error) {
    console.error('[auth] session validation failed', error);
    res.status(503).json({ error: 'Não foi possível validar a sessão.', code: 'AUTH_VALIDATION_FAILED' });
  }
}

export function requirePasswordChangeComplete(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHENTICATED' });
    return;
  }
  if (req.user.must_change_password) {
    res.status(403).json({
      error: 'Altere sua senha antes de continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHENTICATED' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: 'Acesso negado.', code: 'ROLE_FORBIDDEN' });
      return;
    }
    next();
  };
}
