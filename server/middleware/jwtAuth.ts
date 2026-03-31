import { Request, Response, NextFunction } from 'express';
import { verifyServiceJwt } from '../services/jwtService.js';

export interface JwtRequest extends Request {
  jwtPayload?: Record<string, unknown>;
}

/**
 * Middleware to verify JWT for service-to-service communication
 */
export function requireServiceJwt(allowedIssuers: string[] = ['django']) {
  return (req: JwtRequest, res: Response, next: NextFunction) => {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    // Verify JWT
    const payload = verifyServiceJwt(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired JWT' });
    }

    // Verify issuer
    const issuer = payload.iss;
    if (!issuer || !allowedIssuers.includes(issuer as string)) {
      return res.status(401).json({ error: 'Invalid JWT issuer' });
    }

    // Attach payload to request for use in route handlers
    req.jwtPayload = payload;
    next();
  };
}
