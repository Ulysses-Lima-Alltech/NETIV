// server/routes/sso.ts
import { Router, Request, Response } from 'express';
import {
  findByEmail,
  findByEmailIncludingInactive,
  createUser,
  updateUser,
  createSession,
  type AppUser,
} from '../repositories/userRepository.js';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isUserRole, type UserRole } from '../constants/roles.js';

const router = Router();

// ── Funções auxiliares para verificar JWT (sem dependência externa) ──

/**
 * Decodifica Base64-URL para string.
 *
 * Base64-URL é como Base64 normal, mas troca + por -, / por _, e remove o = final.
 * Isso é necessário porque + e / têm significados especiais em URLs.
 */
function base64UrlDecode(str: string): string {
  // Restaurar os caracteres originais do Base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Adicionar padding (=) se necessário (Base64 precisa de múltiplos de 4)
  while (base64.length % 4 !== 0) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Verifica e decodifica um JWT assinado com HMAC-SHA256.
 *
 * Retorna o payload se válido, ou null se:
 * - A assinatura não bater (token foi adulterado)
 * - O token expirou (exp < agora)
 * - O iat está no futuro (clock skew / replay)
 */
function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  // JWT tem 3 partes: header.payload.signature
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  // Recriar a assinatura esperada usando o secret
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  // Comparar assinaturas com timingSafeEqual (previne timing attacks)
  // Timing attack: um atacante mede o tempo da comparação para adivinhar a assinatura byte a byte
  const sigBuffer = Buffer.from(signatureB64, 'base64url');
  const expectedBuffer = Buffer.from(expectedSig, 'base64url');
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  // Assinatura ok! Agora decodificar o payload
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // Verificar expiração
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && now > payload.exp) {
      console.log('[SSO] JWT expirado:', { exp: payload.exp, now });
      return null; // Token expirado
    }

    // Verificar iat (issued at) — não aceitar tokens do "futuro" (clock skew > 60s)
    if (typeof payload.iat === 'number' && payload.iat > now + 60) {
      console.log('[SSO] JWT iat no futuro:', { iat: payload.iat, now });
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ── Rota SSO ──

// POST /api/auth/sso
// Chamado pelo Django server-to-server (NÃO pelo navegador!)
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // ── PASSO 1: Ler o JWT do body ──
    const { token: jwtToken } = req.body;
    if (!jwtToken || typeof jwtToken !== 'string') {
      res.status(400).json({ error: 'Token JWT é obrigatório.' });
      return;
    }

    // ── PASSO 2: Verificar o JWT ──
    const secret = process.env.SSO_SHARED_SECRET;
    if (!secret) {
      console.error('[SSO] SSO_SHARED_SECRET não configurado no ambiente.');
      res.status(500).json({ error: 'SSO não configurado.' });
      return;
    }

    const payload = verifyJwt(jwtToken, secret);
    if (!payload) {
      // Assinatura inválida, expirado, ou mal-formado
      res.status(401).json({ error: 'JWT inválido ou expirado.' });
      return;
    }

    // ── PASSO 3: Extrair dados do payload ──
    const email = typeof payload.email === 'string' ? payload.email : '';
    const name = typeof payload.name === 'string' ? payload.name : '';
    const role = typeof payload.role === 'string' ? payload.role : '';
    const brokerId = typeof payload.broker_id === 'number' ? payload.broker_id : null;
    const djangoUserId = typeof payload.django_user_id === 'number' ? payload.django_user_id : null;

    if (!email) {
      res.status(400).json({ error: 'Email é obrigatório no JWT.' });
      return;
    }

    // Se o role não for válido (ADMIN, MANAGERIAL, COLLABORATOR), usa COLLABORATOR
    const safeRole: UserRole = isUserRole(role) ? role : 'COLLABORATOR';

    // ── PASSO 4: Buscar ou criar o usuário ──
    let user: AppUser | null = await findByEmail(email);

    if (user) {
      // Usuário já existe → atualizar nome, role, broker_id e django_user_id
      await updateUser(user.id, {
        name: name || user.name,
        role: safeRole,
        active: true,
        broker_id: brokerId,
        django_user_id: djangoUserId,
      });
    } else {
      // Verificar se existe mas está inativo
      const inactive = await findByEmailIncludingInactive(email);
      if (inactive) {
        // Reativar o usuário
        await updateUser(inactive.id, {
          name: name || inactive.name,
          role: safeRole,
          active: true,
          broker_id: brokerId,
          django_user_id: djangoUserId,
        });
        user = await findByEmail(email);
      } else {
        // Criar usuário novo com senha aleatória (nunca vai fazer login manual)
        const randomPassword = randomBytes(32).toString('hex');
        user = await createUser({
          name: name || email.split('@')[0],
          email,
          password: randomPassword,
          role: safeRole,
          active: true,
        });
        // Após criar, atualizar broker_id e django_user_id
        await updateUser(user.id, {
          broker_id: brokerId,
          django_user_id: djangoUserId,
        });
      }
    }

    if (!user) {
      res.status(500).json({ error: 'Falha ao criar/buscar usuário.' });
      return;
    }

    // ── PASSO 5: Criar sessão (token) ──
    // Isso é a mesma função que o login normal usa.
    // O token gerado funciona exatamente como se o usuário tivesse digitado email+senha.
    // É um randomBytes(32) = 256 bits de entropia → impossível adivinhar (anti-IDOR)
    const sessionToken = await createSession(user.id);

    // ── PASSO 6: Retornar o session token para o Django ──
    res.json({ sessionToken });

  } catch (e) {
    console.error('[SSO] Erro:', e);
    res.status(500).json({ error: 'Erro interno no SSO.' });
  }
});

export default router;
