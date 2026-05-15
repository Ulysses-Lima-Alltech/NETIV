import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import { getConversationById } from '../repositories/conversationRepository.js';

/**
 * Autoriza ações por ID de conversa.
 *  - ADMIN / MANAGERIAL: passa direto.
 *  - COLLABORATOR: precisa ter broker_id e ser o assigned_broker_id da conversa.
 * Responde 403/404 e retorna false em caso negativo.
 *
 * Mitigação temporária (ver planos/fix-operador-leads-bot-404-e-isolamento-netiv-7c4c93.md)
 * para impedir que um corretor (Operador) acesse/modifique conversas que não lhe pertencem
 * via enumeração de ID, enquanto a branch qmape-sso-backend não entra.
 */
export async function assertCanAccessConversation(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: number,
): Promise<boolean> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Não autenticado.' });
    return false;
  }
  if (user.role !== 'COLLABORATOR') return true;

  const conv = await getConversationById(conversationId);
  if (!conv) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return false;
  }

  if (user.broker_id == null || conv.assigned_broker_id !== user.broker_id) {
    console.warn('[conversationAccess] acesso negado', {
      userId: user.id,
      role: user.role,
      userBrokerId: user.broker_id,
      conversationId,
      assigned_broker_id: conv.assigned_broker_id,
    });
    res.status(403).json({ error: 'Acesso negado a esta conversa.' });
    return false;
  }
  return true;
}
