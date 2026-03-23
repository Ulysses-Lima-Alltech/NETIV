import { Request, Response, NextFunction } from 'express';
import { getSessionUser, type AppUser, type UserRole } from '../repositories/userRepository.js';

export type AuthenticatedRequest = Request & { user: AppUser };

function getToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return;
  }
  (req as AuthenticatedRequest).user = user;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
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
