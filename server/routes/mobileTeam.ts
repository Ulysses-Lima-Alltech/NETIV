import { Router, Request, Response } from 'express';
import { requireMobileAuth } from '../middleware/mobileAuthMiddleware.js';
import {
  addEnterpriseToMobileTeamMember,
  createMobileAccessForTeamMember,
  getMobileTeam,
  removeEnterpriseFromMobileTeamMember,
  updateMobileTeamMember,
  type CreateMobileTeamAccessPayload,
  type UpdateMobileTeamMemberPayload,
} from '../services/mobileTeamService.js';

const router = Router();

router.get('/', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const payload = await getMobileTeam(user);
    res.json(payload);
  } catch (error) {
    console.error('[mobile-team] GET /', error);
    res.status(500).json({ error: 'Erro ao carregar equipe mobile.' });
  }
});

router.patch('/:id', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set(['name', 'phone', 'active']);
    const keys = Object.keys(body);
    if (keys.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um campo para atualizar.' });
      return;
    }

    const hasForbiddenField = keys.some((key) => !allowedFields.has(key));
    if (hasForbiddenField || 'role' in body) {
      res.status(400).json({ error: 'Payload contem campos nao permitidos.' });
      return;
    }

    const payload: UpdateMobileTeamMemberPayload = {};

    if ('name' in body) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ error: 'Campo name invalido.' });
        return;
      }
      payload.name = body.name.trim();
    }

    if ('phone' in body) {
      if (typeof body.phone !== 'string') {
        res.status(400).json({ error: 'Campo phone invalido.' });
        return;
      }
      payload.phone = body.phone;
    }

    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        res.status(400).json({ error: 'Campo active invalido.' });
        return;
      }
      payload.active = body.active;
    }

    if (
      payload.name === undefined &&
      payload.phone === undefined &&
      payload.active === undefined
    ) {
      res.status(400).json({ error: 'Informe ao menos um campo para atualizar.' });
      return;
    }

    const result = await updateMobileTeamMember(user, String(req.params.id ?? ''), payload);
    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        res.status(403).json({ error: result.message });
        return;
      }
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: result.message });
        return;
      }
      res.status(400).json({ error: result.message });
      return;
    }

    res.json({ member: result.member });
  } catch (error) {
    console.error('[mobile-team] PATCH /:id', error);
    res.status(500).json({ error: 'Erro ao atualizar membro da equipe mobile.' });
  }
});

router.post('/:id/enterprises', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set(['enterpriseId']);
    const keys = Object.keys(body);

    if (keys.length === 0 || !('enterpriseId' in body)) {
      res.status(400).json({ error: 'Campo enterpriseId e obrigatorio.' });
      return;
    }

    const hasForbiddenField = keys.some((key) => !allowedFields.has(key));
    if (hasForbiddenField || 'can_manage' in body || 'canManage' in body || 'role' in body) {
      res.status(400).json({ error: 'Payload contem campos nao permitidos.' });
      return;
    }

    let enterpriseIdNumber: number | null = null;
    if (typeof body.enterpriseId === 'string') {
      const parsed = Number(body.enterpriseId.trim());
      enterpriseIdNumber = Number.isInteger(parsed) ? parsed : null;
    } else if (typeof body.enterpriseId === 'number' && Number.isInteger(body.enterpriseId)) {
      enterpriseIdNumber = body.enterpriseId;
    }

    if (!enterpriseIdNumber || enterpriseIdNumber <= 0) {
      res.status(400).json({ error: 'Campo enterpriseId invalido.' });
      return;
    }

    const result = await addEnterpriseToMobileTeamMember(
      user,
      String(req.params.id ?? ''),
      enterpriseIdNumber
    );

    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        res.status(403).json({ error: result.message });
        return;
      }
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: result.message });
        return;
      }
      res.status(400).json({ error: result.message });
      return;
    }

    res.json({ member: result.member });
  } catch (error) {
    console.error('[mobile-team] POST /:id/enterprises', error);
    res.status(500).json({ error: 'Erro ao vincular empreendimento ao membro da equipe mobile.' });
  }
});

router.delete('/:id/enterprises/:enterpriseId', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const memberId = String(req.params.id ?? '');
    const enterpriseIdRaw = String(req.params.enterpriseId ?? '');
    const enterpriseIdNumber = Number(enterpriseIdRaw);
    if (!Number.isInteger(enterpriseIdNumber) || enterpriseIdNumber <= 0) {
      res.status(400).json({ error: 'Campo enterpriseId invalido.' });
      return;
    }

    const result = await removeEnterpriseFromMobileTeamMember(user, memberId, enterpriseIdNumber);
    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        res.status(403).json({ error: result.message });
        return;
      }
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: result.message });
        return;
      }
      res.status(400).json({ error: result.message });
      return;
    }

    res.json({ member: result.member });
  } catch (error) {
    console.error('[mobile-team] DELETE /:id/enterprises/:enterpriseId', error);
    res.status(500).json({ error: 'Erro ao remover vinculo de empreendimento no mobile.' });
  }
});

router.post('/:id/access', requireMobileAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.mobileUser;
    if (!user) {
      res.status(401).json({ error: 'Nao autenticado.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set(['username', 'temporaryPassword', 'role', 'active']);
    const keys = Object.keys(body);

    if (keys.length === 0) {
      res.status(400).json({ error: 'Informe username, temporaryPassword, role e active.' });
      return;
    }

    const hasForbiddenField = keys.some((key) => !allowedFields.has(key));
    if (hasForbiddenField) {
      res.status(400).json({ error: 'Payload contem campos nao permitidos.' });
      return;
    }

    if (typeof body.username !== 'string' || body.username.trim().length === 0) {
      res.status(400).json({ error: 'Campo username invalido.' });
      return;
    }

    if (typeof body.temporaryPassword !== 'string' || body.temporaryPassword.trim().length === 0) {
      res.status(400).json({ error: 'Campo temporaryPassword invalido.' });
      return;
    }

    if (body.role !== 'CORRETOR' && body.role !== 'GESTOR') {
      res.status(400).json({ error: 'Campo role invalido. Use CORRETOR ou GESTOR.' });
      return;
    }

    if (typeof body.active !== 'boolean') {
      res.status(400).json({ error: 'Campo active invalido.' });
      return;
    }

    const payload: CreateMobileTeamAccessPayload = {
      username: body.username.trim(),
      temporaryPassword: body.temporaryPassword,
      role: body.role,
      active: body.active,
    };

    const result = await createMobileAccessForTeamMember(user, String(req.params.id ?? ''), payload);
    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        res.status(403).json({ error: result.message });
        return;
      }
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: result.message });
        return;
      }
      res.status(400).json({ error: result.message });
      return;
    }

    res.status(201).json({ user: result.user, member: result.member });
  } catch (error) {
    console.error('[mobile-team] POST /:id/access', error);
    res.status(500).json({ error: 'Erro ao criar acesso mobile para membro da equipe.' });
  }
});

export default router;
