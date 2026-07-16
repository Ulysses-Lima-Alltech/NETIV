import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { query } from '../db/pg.js';
import {
  createSession,
  createUser,
  findByEmail,
  findByEmailIncludingInactive,
  isValidUsername,
  revokeAllSessions,
  updateUser,
  type AppUser,
  type SessionScope,
} from '../repositories/userRepository.js';
import { upsertCorretorAndEnterprise } from '../repositories/corretorRepository.js';
import { recordAccessAudit } from '../services/authorizationService.js';
import { disconnectUserSockets } from '../realtime/socketServer.js';
import { disconnectSseUser } from '../services/whatsappEvents.js';
import { ssoRateLimit } from '../middleware/rateLimit.js';

const router = Router();

function decodeJsonPart(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function audienceMatches(raw: unknown, expected: string): boolean {
  return typeof raw === 'string' ? raw === expected : Array.isArray(raw) && raw.includes(expected);
}

function verifyJwt(token: string, secret: string, issuer: string, audience: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonPart(headerPart);
  const payload = decodeJsonPart(payloadPart);
  if (!header || !payload || header.alg !== 'HS256' || (header.typ != null && header.typ !== 'JWT')) return null;
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  const supplied = Buffer.from(signaturePart, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  const iat = payload.iat;
  const jti = payload.jti;
  const maxTtl = Math.max(60, Number.parseInt(process.env.SSO_MAX_TOKEN_TTL_SECONDS ?? '300', 10) || 300);
  if (typeof exp !== 'number' || typeof iat !== 'number' || typeof jti !== 'string' || !jti.trim()) return null;
  if (exp <= now || iat > now + 60 || exp - iat > maxTtl) return null;
  if (payload.iss !== issuer || !audienceMatches(payload.aud, audience)) return null;
  return payload;
}

async function consumeJti(jti: string, exp: number): Promise<boolean> {
  await query(`DELETE FROM app_sso_token_uses WHERE expires_at <= NOW()`);
  const result = await query(
    `INSERT INTO app_sso_token_uses (jti, expires_at)
     VALUES ($1, TO_TIMESTAMP($2))
     ON CONFLICT (jti) DO NOTHING`,
    [jti, exp]
  );
  return (result.rowCount ?? 0) === 1;
}

router.post('/', ssoRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const jwtToken = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!jwtToken) {
      res.status(400).json({ error: 'Token JWT é obrigatório.' });
      return;
    }
    const secret = process.env.SSO_SHARED_SECRET?.trim();
    const issuer = process.env.SSO_EXPECTED_ISSUER?.trim();
    const audience = process.env.SSO_EXPECTED_AUDIENCE?.trim();
    if (!secret || !issuer || !audience) {
      res.status(503).json({ error: 'SSO não configurado.' });
      return;
    }
    const payload = verifyJwt(jwtToken, secret, issuer, audience);
    if (!payload) {
      res.status(401).json({ error: 'JWT inválido ou expirado.' });
      return;
    }
    if (!(await consumeJti(String(payload.jti), Number(payload.exp)))) {
      res.status(401).json({ error: 'JWT já utilizado.', code: 'SSO_REPLAY' });
      return;
    }

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const usernameRaw = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : null;
    const username = usernameRaw && isValidUsername(usernameRaw) ? usernameRaw : null;
    const requestedRole = typeof payload.role === 'string' ? payload.role : null;
    const djangoUserId = typeof payload.django_user_id === 'number' ? payload.django_user_id : null;
    let effectiveBrokerId = typeof payload.broker_id === 'number' ? payload.broker_id : null;
    if (!email) {
      res.status(400).json({ error: 'Email é obrigatório no JWT.' });
      return;
    }

    const inactive = await findByEmailIncludingInactive(email);
    if (inactive && !inactive.active) {
      res.status(403).json({ error: 'Usuário inativo.', code: 'USER_INACTIVE' });
      return;
    }
    // O SSO autentica a identidade, mas não é uma via paralela para elevar ou
    // rebaixar perfis locais. Novas identidades entram com privilégio mínimo.
    const localRole = inactive?.role ?? 'COLLABORATOR';

    const brokerInfo = payload.broker && typeof payload.broker === 'object'
      ? payload.broker as Record<string, unknown>
      : null;
    if (localRole === 'COLLABORATOR' && brokerInfo && typeof brokerInfo.enterprise_id === 'number') {
      effectiveBrokerId = await upsertCorretorAndEnterprise({
        existingBrokerId: effectiveBrokerId ?? inactive?.broker_id ?? null,
        fullName: String(brokerInfo.full_name ?? (name || email)),
        phone: typeof brokerInfo.phone === 'string' ? brokerInfo.phone : null,
        email: typeof brokerInfo.email === 'string' ? brokerInfo.email : email,
        realEstateAgency: String(brokerInfo.real_estate_agency ?? ''),
        enterpriseId: brokerInfo.enterprise_id,
      });
    }

    let user: AppUser | null = await findByEmail(email);
    if (user) {
      const securityChanged = user.broker_id !== effectiveBrokerId;
      user = await updateUser(user.id, {
        username: user.username ?? username,
        name: name || user.name,
        broker_id: effectiveBrokerId,
        django_user_id: djangoUserId,
      });
      if (securityChanged && user) {
        await revokeAllSessions(user.id);
        disconnectUserSockets(user.id, 'sso_identity_changed');
        disconnectSseUser(user.id);
      }
    } else {
      user = await createUser({
        username,
        name: name || email.split('@')[0],
        email,
        password: randomBytes(32).toString('hex'),
        role: 'COLLABORATOR',
        active: true,
        must_change_password: false,
        broker_id: effectiveBrokerId,
        django_user_id: djangoUserId,
      });
    }
    if (!user) {
      res.status(500).json({ error: 'Falha ao provisionar usuário.' });
      return;
    }

    // Mantém a compatibilidade do broker_id legado por uma atribuição explícita.
    // Atribuições feitas por ADMIN ou gestor nunca são removidas por este fluxo.
    await query(
      `DELETE FROM app_user_brokers
       WHERE user_id = $1
         AND assignment_source = 'LEGACY'
         AND ($2::int IS NULL OR broker_id <> $2)`,
      [user.id, effectiveBrokerId]
    );
    if (effectiveBrokerId != null) {
      await query(
        `INSERT INTO app_user_brokers (user_id, broker_id, assigned_by_user_id, assignment_source)
         VALUES ($1, $2, NULL, 'LEGACY')
         ON CONFLICT (user_id, broker_id) DO NOTHING`,
        [user.id, effectiveBrokerId]
      );
    }

    const rawIds = payload.allowed_conversation_ids;
    const scopeKind = payload.scope_kind === 'broker_portfolio' ? 'broker_portfolio' : null;
    const totalSize = typeof payload.total_portfolio_size === 'number' ? payload.total_portfolio_size : undefined;
    let scope: SessionScope | null = null;
    if (scopeKind) {
      const convIds = Array.isArray(rawIds)
        ? [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
        : [];
      scope = { kind: scopeKind, convIds, totalSize };
    }
    const sessionToken = await createSession(user.id, scope);
    await recordAccessAudit({
      actorUserId: user.id,
      targetUserId: user.id,
      action: 'SSO_SESSION_CREATED',
      resourceType: 'session',
      metadata: { scopeKind, scopeSize: scope?.convIds.length ?? null, roleClaimIgnored: requestedRole },
    });
    res.json({ sessionToken, brokerId: effectiveBrokerId });
  } catch (error) {
    console.error('[SSO]', error);
    res.status(500).json({ error: 'Erro interno no SSO.' });
  }
});

export default router;
