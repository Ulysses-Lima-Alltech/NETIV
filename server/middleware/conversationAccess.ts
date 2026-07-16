import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import { canAccessConversation } from '../services/authorizationService.js';

export async function assertCanAccessConversation(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: number
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Não autenticado.', code: 'UNAUTHENTICATED' });
    return false;
  }
  if (!(await canAccessConversation(req.user, conversationId))) {
    res.status(404).json({ error: 'Conversa não encontrada no seu escopo.', code: 'OUT_OF_SCOPE' });
    return false;
  }
  return true;
}
