import { Router, Response } from 'express';
import {
  listAllUsers,
  createUser,
  updateUser,
  updatePassword,
  findByEmailIncludingInactive,
  type AppUserPublic,
} from '../repositories/userRepository.js';
import { createUserSchema, updateUserSchema, updatePasswordSchema } from '../validators/users.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

function toPublicWithActive(u: { id: number; name: string; email: string; role: string; active: boolean; created_at: Date; updated_at: Date }): AppUserPublic & { active: boolean; createdAt: string; updatedAt: string } {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as 'ADMIN' | 'COLLABORATOR',
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
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const data = parsed.data;
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
    const currentUser = (req as unknown as AuthenticatedRequest).user;
    if (currentUser.id === id) {
      const parsed = updateUserSchema.safeParse(req.body);
      if (parsed.success && parsed.data.role !== undefined && parsed.data.role !== currentUser.role) {
        return res.status(403).json({ error: 'Você não pode alterar seu próprio perfil de acesso.' });
      }
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const data = parsed.data;
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
    console.error('[Users] PATCH:', e);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

router.patch('/:id/password', async (req, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updatePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const ok = await updatePassword(id, parsed.data.newPassword);
    if (!ok) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Users] PATCH password:', e);
    res.status(500).json({ error: 'Erro ao alterar senha.' });
  }
});

export default router;
