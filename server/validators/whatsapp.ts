import { z } from 'zod';
import { RESERVE_INTEREST_TYPES, RESERVE_REASONS } from '../constants/reserveSegmentation.js';

const normalizedPhone = z.string().transform((s) => s.replace(/\D/g, '')).refine((s) => s.length >= 10, 'Número inválido');

export const sendMessageSchema = z.object({
  to: z.string().min(1, 'Campo "to" é obrigatório').pipe(normalizedPhone),
  message: z.string().min(1, 'Campo "message" é obrigatório').max(4096),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

const classificationStatusValues = ['Novo', 'Qualificado', 'Carteira', 'Handoff'] as const;

export const reserveSegmentationPatchSchema = z
  .object({
    reason: z.enum(RESERVE_REASONS).nullable().optional(),
    desiredCity: z.string().trim().max(500).nullable().optional(),
    desiredPriceMin: z.number().nonnegative().nullable().optional(),
    desiredPriceMax: z.number().nonnegative().nullable().optional(),
    propertyType: z.string().trim().max(200).nullable().optional(),
    bedrooms: z.number().int().min(0).max(50).nullable().optional(),
    interestType: z.enum(RESERVE_INTEREST_TYPES).nullable().optional(),
    followUpMoment: z.string().trim().max(500).nullable().optional(),
    commercialNotes: z.string().trim().max(5000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const a = data.desiredPriceMin;
    const b = data.desiredPriceMax;
    if (a != null && b != null && b < a) {
      ctx.addIssue({
        code: 'custom',
        message: 'Valor máximo não pode ser menor que o mínimo.',
        path: ['desiredPriceMax'],
      });
    }
  });

export type ReserveSegmentationPatchDto = z.infer<typeof reserveSegmentationPatchSchema>;

export const updateClassificationSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  classification_status: z
    .preprocess((v) => (v === 'Reserva' ? 'Carteira' : v), z.enum(classificationStatusValues))
    .optional(),
  handoff: z.boolean().optional(),
  /** frio/morno/quente apenas; null no JSON é ignorado (compatível com clientes antigos). Não é permitido persistir NULL via API. */
  lead_temperature: z.preprocess(
    (v) => (v === null ? undefined : v),
    z.enum(['quente', 'morno', 'frio']).optional()
  ),
  reserve: reserveSegmentationPatchSchema.optional(),
  /** Corretor fixo do lead; null remove (volta à distribuição automática nos próximos passos). */
  assigned_broker_id: z.number().int().positive().nullable().optional(),
});
export type UpdateClassificationDto = z.infer<typeof updateClassificationSchema>;
