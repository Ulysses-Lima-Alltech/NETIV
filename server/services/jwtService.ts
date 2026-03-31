import { createHmac, timingSafeEqual } from 'crypto';

// Reutiliza a mesma lógica de sso.ts para consistência
const JWT_EXPIRY_SECONDS = 30; // 30 segundos para chamadas de serviço

function base64UrlEncode(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data);
  }
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(data: string): string {
  data += '='.repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

/**
 * Create JWT signed with HMAC-SHA256 (same as sso.ts)
 */
export function createServiceJwt(
  issuer: string,
  extraClaims: Record<string, unknown> = {}
): string {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) {
    throw new Error('SSO_SHARED_SECRET not configured');
  }

  const now = Math.floor(Date.now() / 1000);

  // Header
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));

  // Payload with standard claims
  const payload = {
    iss: issuer,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
    ...extraClaims,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  // Signature
  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest();
  const signatureB64 = base64UrlEncode(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verify JWT signed with HMAC-SHA256 (same as sso.ts)
 */
export function verifyServiceJwt(token: string): Record<string, unknown> | null {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) {
    console.error('[JWT] SSO_SHARED_SECRET not configured');
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const signatureInput = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac('sha256', secret)
      .update(signatureInput)
      .digest();
    const expectedSigB64 = base64UrlEncode(expectedSig);

    // Timing-safe compare
    const sigBuffer = Buffer.from(signatureB64, 'base64');
    const expectedBuffer = Buffer.from(expectedSigB64, 'base64');
    if (sigBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;

    // Decode and validate payload
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);

    // Validate expiration and issued at
    if (typeof payload.exp === 'number' && now > payload.exp) return null;
    if (typeof payload.iat === 'number' && payload.iat > now + 60) return null; // 60s clock skew

    return payload;
  } catch (error) {
    console.error('[JWT] Error verifying token:', error);
    return null;
  }
}
