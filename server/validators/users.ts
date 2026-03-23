import { z } from 'zod';
import { ALL_APP_USER_ROLES } from '../constants/roles.js';

const roleSchema = z.enum(ALL_APP_USER_ROLES);

export const createUserSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255),
  email: z.string().min(1, 'E-mail é obrigatório').email('E-mail inválido'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  role: roleSchema,
  active: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email('E-mail inválido').optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});

export const updatePasswordSchema = z.object({
  newPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});
