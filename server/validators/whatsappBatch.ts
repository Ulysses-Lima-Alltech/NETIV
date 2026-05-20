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
  selectedBrokerId: z.number().nullable().optional(),
  selectedBrokerIds: z.array(z.number().int().positive()).default([]),
  variableMappings: z.record(z.string(), VariableMappingSchema),
});

/** Só o template ao fazer parse inicial da planilha (outros campos vêm depois). */
export const parseBatchConfigSchema = z.object({
  templateKey: z.string().optional(),
});

export const batchSendSchema = z.object({
  mapping: BatchMappingDtoSchema,
});

export const batchConversationTypeSchema = z.enum(['CLIENT', 'ADMIN']);
export const batchPostSendModeSchema = z.enum(['ANA', 'HANDOFF']);
export const batchSendModeSchema = z.enum(['NOW', 'SCHEDULED']);

/** Planilha já parseada (inclui todas as linhas para preview/envio). */
export const SpreadsheetPayloadSchema = z.object({
  headers: z.array(z.string()),
  rowCount: z.number().int().nonnegative().optional(),
  sampleRows: z.array(z.record(z.string(), z.string())).optional(),
  rows: z.array(z.record(z.string(), z.string())).min(1, 'Planilha sem linhas'),
});

export const BatchSpreadsheetOperationSchema = z.object({
  spreadsheet: SpreadsheetPayloadSchema,
  mapping: BatchMappingDtoSchema,
  conversationType: batchConversationTypeSchema.default('CLIENT'),
  postSendMode: batchPostSendModeSchema.default('ANA'),
  sendMode: batchSendModeSchema.default('NOW'),
  scheduledAt: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.sendMode !== 'SCHEDULED') return;
  const scheduledAtRaw = String(value.scheduledAt ?? '').trim();
  if (!scheduledAtRaw) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduledAt'],
      message: 'scheduledAt é obrigatório quando sendMode=SCHEDULED.',
    });
    return;
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduledAt'],
      message: 'scheduledAt inválido.',
    });
    return;
  }
  if (scheduledAt.getTime() <= Date.now()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduledAt'],
      message: 'scheduledAt deve estar no futuro.',
    });
  }
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
export type BatchConversationType = z.infer<typeof batchConversationTypeSchema>;
export type BatchPostSendMode = z.infer<typeof batchPostSendModeSchema>;
export type BatchSendMode = z.infer<typeof batchSendModeSchema>;
