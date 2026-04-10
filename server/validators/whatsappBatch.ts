import { z } from 'zod';

export const VariableMappingSchema = z.object({
  type: z.enum(['column', 'fixed', 'enterprise']),
  columnName: z.string().optional(),
  fixedValue: z.string().optional(),
});

export const BatchMappingDtoSchema = z.object({
  templateKey: z.string().min(1, 'Template é obrigatório'),
  phoneColumn: z.string().min(1, 'Coluna de telefone é obrigatória'),
  selectedEnterpriseId: z.number().nullable(),
  selectedBrokerId: z.number().nullable(),
  variableMappings: z.record(z.string(), VariableMappingSchema),
});

/** Só o template ao fazer parse inicial da planilha (outros campos vêm depois). */
export const parseBatchConfigSchema = z.object({
  templateKey: z.string().optional(),
});

export const batchSendSchema = z.object({
  mapping: BatchMappingDtoSchema,
});

export const batchTestSchema = z.object({
  mapping: BatchMappingDtoSchema,
  testPhone: z.string().min(1, 'Telefone de teste é obrigatório'),
  mode: z.enum(['row', 'manual']),
  sampleRowIndex: z.number().int().nonnegative().optional(),
  manualVariables: z.record(z.string(), z.string()).optional(),
});

export type BatchMappingDto = z.infer<typeof BatchMappingDtoSchema>;
export type VariableMapping = z.infer<typeof VariableMappingSchema>;
