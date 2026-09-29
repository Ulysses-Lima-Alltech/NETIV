import { z } from 'zod';
import { ALL_APP_USER_ROLES } from '../constants/roles.js';

const roleSchema = z.enum(ALL_APP_USER_ROLES);
const usernameSchema = z.string().trim().toLowerCase().min(3).max(120).regex(/^[a-z0-9._-]+$/, 'Username inválido');
const optionalEmailSchema = z.union([z.string().trim().email('E-mail inválido'), z.literal(''), z.null()]).optional();
const idArray = z.array(z.number().int().positive()).default([]).transform((ids) => [...new Set(ids)]);

export const DEFAULT_TEMPORARY_PASSWORD = 'ia@123';

export const userScopeSchema = z.object({
  managerId: z.number().int().positive().nullable().default(null),
  enterpriseIds: idArray,
  brokerIds: idArray,
  conversationIds: idArray,
  contactIds: idArray,
  appointmentIds: idArray,
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(255),
  username: usernameSchema,
  email: optionalEmailSchema,
  password: z.string().min(1, 'Senha é obrigatória'),
  useDefaultTemporaryPassword: z.boolean().default(false),
  role: roleSchema,
  active: z.boolean().default(true),
  managerId: z.number().int().positive().nullable().default(null),
  enterpriseIds: idArray,
  brokerIds: idArray,
  conversationIds: idArray,
  contactIds: idArray,
  appointmentIds: idArray,
  allowDirectAssignment: z.boolean().default(false),
  createBrokerAccess: z.boolean().default(false),
}).refine(
  (data) => data.useDefaultTemporaryPassword
    ? data.password === DEFAULT_TEMPORARY_PASSWORD
    : data.password.length >= 8,
  {
    message: 'Senha deve ter pelo menos 8 caracteres.',
    path: ['password'],
  }
);

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  username: usernameSchema.nullable().optional(),
  email: optionalEmailSchema,
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});

export const updatePasswordSchema = z.object({
  newPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});
