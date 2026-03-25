import { Request, Response, NextFunction } from 'express';
import {
  findEmbeddedDefaultUser,
  getSessionUser,
  type AppUser,
  type UserRole,
} from '../repositories/userRepository.js';

/** Requisição já autenticada (`user` garantido pelos middlewares `requireAuth` + `requireRole`). */
export type AuthenticatedRequest = Request & { user: AppUser };

function getToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/**
 * Com Bearer válido: `req.user` vem da sessão.
 * Sem Bearer: contexto embutido (ANA integrada na plataforma principal, sem login local) — primeiro ADMIN ou `ANA_EMBEDDED_USER_ID`.
 * Bearer inválido/expirado: 401 (não faz fallback embutido).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (token) {
    const user = await getSessionUser(token);
    if (!user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
    req.user = user;
    next();
    return;
  }
  const embedded = await findEmbeddedDefaultUser();
  if (!embedded) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  req.user = embedded;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: 'Acesso negado.' });
      return;
    }
    next();
  };
}
