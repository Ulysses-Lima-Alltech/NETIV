import { z } from 'zod';
import { BatchMappingDtoSchema } from './whatsappBatch.js';

export const DispatchEventSchema = z.object({
  requestId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  sendMode: z.enum(['NOW', 'SCHEDULED']),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  postSendMode: z.enum(['ANA', 'HANDOFF']),
  mapping: BatchMappingDtoSchema.extend({
    selectedEnterpriseId: z.number().int().positive(),
    customerNameColumn: z.literal('NOME'),
    phoneColumn: z.literal('TELEFONE'),
  }),
  rows: z.array(z.object({
    NOME: z.string().trim().min(1).max(160),
    TELEFONE: z.string().trim().min(1).max(40),
  })).min(1).max(5000),
}).superRefine((value, ctx) => {
  if (value.sendMode === 'SCHEDULED' && !value.scheduledAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['scheduledAt'],
      message: 'Informe a data e hora do agendamento.',
    });
  }
});

export type DispatchEventInput = z.infer<typeof DispatchEventSchema>;
