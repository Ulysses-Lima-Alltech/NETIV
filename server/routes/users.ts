import { Router, Response } from 'express';
import {
  listAllUsers,
  createUser,
  updateUser,
  updatePassword,
  findByEmailIncludingInactive,
  findByIdIncludingInactive,
  type AppUser,
  type AppUserPublic,
} from '../repositories/userRepository.js';
import { createUserSchema, updateUserSchema, updatePasswordSchema } from '../validators/users.js';
import {
  assertManagerialCanChangePassword,
  assertManagerialCanCreateUser,
  assertManagerialCanUpdateUser,
  UserManagementPolicyError,
} from '../lib/userManagementPolicy.js';

const router = Router();

function toPublicWithActive(u: AppUser): AppUserPublic & { active: boolean; createdAt: string; updatedAt: string } {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    createdAt: u.created_at.toISOString(),
    updatedAt: u.updated_at.toISOString(),
  };
}

router.get('/', async (_req, res: Response) => {
  try {
    const users = await listAllUsers();
    res.json({
      users: users.map((u) => toPublicWithActive(u)),
    });
  } catch (e) {
    console.error('[Users] GET:', e);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

router.post('/', async (req, res: Response) => {
  try {
    const currentUser = req.user;
    if (!currentUser) return res.status(401).json({ error: 'Não autenticado.' });
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const data = parsed.data;
    assertManagerialCanCreateUser(currentUser.role, data.role);
    const existing = await findByEmailIncludingInactive(data.email);
    if (existing) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }
    const user = await createUser({
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role,
      active: data.active,
    });
    res.status(201).json({ user: toPublicWithActive(user) });
  } catch (e) {
    if (e instanceof UserManagementPolicyError) {
      return res.status(403).json({ error: e.message });
    }
    if ((e as Error).message?.includes('unique') || (e as Error).message?.includes('duplicate')) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }
    console.error('[Users] POST:', e);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

router.patch('/:id', async (req, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const currentUser = req.user;
    if (!currentUser) return res.status(401).json({ error: 'Não autenticado.' });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const data = parsed.data;
    const targetBefore = await findByIdIncludingInactive(id);
    if (!targetBefore) return res.status(404).json({ error: 'Usuário não encontrado.' });
    assertManagerialCanUpdateUser(currentUser.role, targetBefore, data);
    if (currentUser.id === id && data.role !== undefined && data.role !== currentUser.role) {
      return res.status(403).json({ error: 'Você não pode alterar seu próprio perfil de acesso.' });
    }
    if (data.email !== undefined) {
      const existing = await findByEmailIncludingInactive(data.email);
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'E-mail já cadastrado.' });
      }
    }
    const user = await updateUser(id, {
      name: data.name,
      email: data.email,
      role: data.role,
      active: data.active,
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user: toPublicWithActive(user) });
  } catch (e) {
    if (e instanceof UserManagementPolicyError) {
      return res.status(403).json({ error: e.message });
    }
    console.error('[Users] PATCH:', e);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

router.patch('/:id/password', async (req, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const currentUser = req.user;
    if (!currentUser) return res.status(401).json({ error: 'Não autenticado.' });
    const targetUser = await findByIdIncludingInactive(id);
    if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado.' });
    assertManagerialCanChangePassword(currentUser.role, targetUser);
    const parsed = updatePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const ok = await updatePassword(id, parsed.data.newPassword);
    if (!ok) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof UserManagementPolicyError) {
      return res.status(403).json({ error: e.message });
    }
    console.error('[Users] PATCH password:', e);
    res.status(500).json({ error: 'Erro ao alterar senha.' });
  }
});

export default router;
