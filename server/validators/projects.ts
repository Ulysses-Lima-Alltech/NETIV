import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
  active: z.boolean().optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
