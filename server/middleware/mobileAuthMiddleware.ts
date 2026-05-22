import { Request, Response, NextFunction } from 'express';
import { getMobileUserFromAuthToken, type MobileAuthUser } from '../services/mobileAuthService.js';

export type AuthenticatedMobileRequest = Request & { mobileUser: MobileAuthUser };

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;

  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireMobileAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Token nao informado.' });
    return;
  }

  const validation = await getMobileUserFromAuthToken(token);
  if (!validation.ok) {
    if (validation.code === 'USER_INACTIVE') {
      res.status(403).json({ error: 'Usuario inativo.' });
      return;
    }

    if (validation.code === 'TOKEN_SECRET_MISSING') {
      res.status(500).json({ error: 'Configuracao de token mobile ausente.' });
      return;
    }

    res.status(401).json({ error: 'Token invalido ou expirado.' });
    return;
  }

  req.mobileUser = validation.user;
  next();
}
