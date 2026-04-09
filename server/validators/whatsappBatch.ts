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
  variableMappings: z.record(VariableMappingSchema),
});

export type BatchMappingDto = z.infer<typeof BatchMappingDtoSchema>;
export type VariableMapping = z.infer<typeof VariableMappingSchema>;
