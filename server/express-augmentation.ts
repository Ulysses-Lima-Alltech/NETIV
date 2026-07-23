import type { AppUser } from './repositories/userRepository.js';
import type { MobileAuthUser } from './services/mobileAuthService.js';

/**
 * Extends Express Request typing for authenticated contexts used by the backend.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` (web platform auth). */
      user?: AppUser;
      /** Set by `requireMobileAuth` (mobile auth endpoints). */
      mobileUser?: MobileAuthUser;
      /** Exact payload bytes used for Meta webhook HMAC validation. */
      rawBody?: Buffer;
    }
  }
}

export {};
