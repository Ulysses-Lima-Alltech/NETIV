import { z } from 'zod';

export const createCorretorSchema = z.object({
  fullName: z.string().min(1, 'Nome completo é obrigatório').max(255),
  city: z.string().max(120).optional().default(''),
  phone: z.string().max(32).optional().default(''),
  realEstateAgency: z.string().max(255).optional().default(''),
  enterpriseIds: z.array(z.number().int().positive()).optional().default([]),
});

export const updateCorretorSchema = z.object({
  fullName: z.string().min(1, 'Nome completo é obrigatório').max(255).optional(),
  city: z.string().max(120).optional(),
  phone: z.string().max(32).optional(),
  realEstateAgency: z.string().max(255).optional(),
  active: z.boolean().optional(),
  enterpriseIds: z.array(z.number().int().positive()).optional(),
});

export type CreateCorretorDto = z.infer<typeof createCorretorSchema>;
export type UpdateCorretorDto = z.infer<typeof updateCorretorSchema>;
