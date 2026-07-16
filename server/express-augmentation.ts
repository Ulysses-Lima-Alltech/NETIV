import type { AppUser } from './repositories/userRepository.js';
import type { MobileAuthUser } from './services/mobileAuthService.js';

/**
 * Extends Express Request typing for authenticated contexts used by the backend.
 */
declare global {
  // Express exposes Request through a global namespace; module augmentation requires this syntax.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth` (web platform auth). */
      user?: AppUser;
      /** Raw web session token for explicit revocation/logout. */
      authToken?: string;
      /** Exact request bytes used to validate signed webhooks. */
      rawBody?: Buffer;
      /** Set by `requireMobileAuth` (mobile auth endpoints). */
      mobileUser?: MobileAuthUser;
    }
  }
}

export {};
