import { z } from 'zod';

export const templateVariableSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('column'),
    columnName: z.string().min(1, 'columnName é obrigatório para type=column'),
  }),
  z.object({
    type: z.literal('fixed'),
    fixedValue: z.string().min(1, 'fixedValue é obrigatório para type=fixed'),
  }),
  z.object({
    type: z.literal('enterprise'),
    enterpriseField: z.enum(['name']).default('name'),
  }),
]);

export const batchMappingSchema = z.object({
  templateKey: z.string().min(1),
  phoneColumn: z.string().min(1, 'Selecione a coluna de telefone.'),
  selectedEnterpriseId: z.number().int().positive().nullable().optional(),
  variableMappings: z.record(z.string(), templateVariableSourceSchema),
});

export const parseBatchConfigSchema = z.object({
  templateKey: z.string().optional(),
});

export const batchTestSchema = z.object({
  mapping: batchMappingSchema,
  testPhone: z.string().min(1),
  sampleRowIndex: z.number().int().min(0).optional(),
});

export const batchSendSchema = z.object({
  mapping: batchMappingSchema,
});

export type BatchMappingDto = z.infer<typeof batchMappingSchema>;
export type BatchTestDto = z.infer<typeof batchTestSchema>;
export type BatchSendDto = z.infer<typeof batchSendSchema>;
