import { z } from 'zod';

const normalizedPhone = z.string().transform((s) => s.replace(/\D/g, '')).refine((s) => s.length >= 10, 'Número inválido');

export const sendMessageSchema = z.object({
  to: z.string().min(1, 'Campo "to" é obrigatório').pipe(normalizedPhone),
  message: z.string().min(1, 'Campo "message" é obrigatório').max(4096),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

const classificationStatusValues = ['Novo', 'Handoff'] as const;

export const updateClassificationSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  classification_status: z.enum(classificationStatusValues).optional(),
});
export type UpdateClassificationDto = z.infer<typeof updateClassificationSchema>;
