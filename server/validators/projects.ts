import { z } from 'zod';

const enterpriseTipoSchema = z.enum(['LOTEAMENTO', 'APARTAMENTO', 'MCMV']);

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
  slug: z.string().max(80).optional(),
  languageStyle: z.enum(['informal', 'natural', 'formal', 'culta']).optional(),
  tipo: enterpriseTipoSchema.optional(),
  exclusivo: z.boolean().optional(),
});

export const projectVariablesSchema = z.object({
  priceLabel: z.string().max(5000).optional(),
  commercialConditions: z.string().max(8000).optional(),
  availability: z.string().max(4000).optional(),
  observations: z.string().max(8000).optional(),
  notes: z.string().max(8000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
  active: z.boolean().optional(),
  status: z.enum(['ativo', 'inativo']).optional(),
  slug: z.string().max(80).optional(),
  languageStyle: z.enum(['informal', 'natural', 'formal', 'culta']).optional(),
  tipo: enterpriseTipoSchema.optional(),
  exclusivo: z.boolean().optional(),
  variables: projectVariablesSchema.optional(),
  promptAddons: z.array(z.string().max(4000)).max(50).optional(),
  city: z.string().max(160).optional(),
  stateUf: z.string().max(2).optional(),
  commercialRegion: z.string().max(240).optional(),
  ibgeCode: z.string().max(12).optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;

export const patchKnowledgeFileSchema = z
  .object({
    canBeUsedAsKnowledge: z.boolean().optional(),
    canBeSentByAna: z.boolean().optional(),
  })
  .refine((d) => d.canBeUsedAsKnowledge !== undefined || d.canBeSentByAna !== undefined, {
    message: 'Informe ao menos um campo.',
  });
