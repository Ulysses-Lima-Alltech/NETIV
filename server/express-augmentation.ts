import type { AppUser } from './repositories/userRepository.js';

/**
 * Estende o tipo do Express para que rotas após `requireAuth` acessem `req.user`
 * sem conversões para tipos incompatíveis (params de rota vs Request base).
 */
declare global {
  namespace Express {
    interface Request {
      /** Definido por `requireAuth` (sessão Bearer ou usuário embutido sem token). */
      user?: AppUser;
    }
  }
}

export {};
