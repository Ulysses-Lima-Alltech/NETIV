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
  mode: z.enum(['row', 'manual']),
  sampleRowIndex: z.number().int().min(0).optional(),
  manualVariables: z.record(z.string(), z.string()).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'row' && data.sampleRowIndex == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sampleRowIndex é obrigatório quando mode=row',
      path: ['sampleRowIndex'],
    });
  }
  if (data.mode === 'manual' && !data.manualVariables) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'manualVariables é obrigatório quando mode=manual',
      path: ['manualVariables'],
    });
  }
});

export const batchSendSchema = z.object({
  mapping: batchMappingSchema,
});

export type BatchMappingDto = z.infer<typeof batchMappingSchema>;
export type BatchTestDto = z.infer<typeof batchTestSchema>;
export type BatchSendDto = z.infer<typeof batchSendSchema>;
