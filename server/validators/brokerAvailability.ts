import { z } from 'zod';

const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/;

export const createBrokerAvailabilitySchema = z.object({
  weekday: z.number().int().min(0, 'Dia da semana deve ser 0-6 (0=domingo)').max(6),
  startTime: z.string().min(1, 'Hora início obrigatória').refine(
    (v) => timeRegex.test(v) || /^\d{1,2}:\d{2}$/.test(v),
    'Formato inválido (use HH:mm ou HH:mm:ss)'
  ),
  endTime: z.string().min(1, 'Hora fim obrigatória').refine(
    (v) => timeRegex.test(v) || /^\d{1,2}:\d{2}$/.test(v),
    'Formato inválido (use HH:mm ou HH:mm:ss)'
  ),
  active: z.boolean().optional().default(true),
}).refine((d) => {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return toMin(d.startTime) < toMin(d.endTime);
}, { message: 'Hora início deve ser menor que hora fim', path: ['endTime'] });

export const updateBrokerAvailabilitySchema = z.object({
  weekday: z.number().int().min(0).max(6).optional(),
  startTime: z.string().refine(
    (v) => !v || timeRegex.test(v) || /^\d{1,2}:\d{2}$/.test(v),
    'Formato inválido (use HH:mm ou HH:mm:ss)'
  ).optional(),
  endTime: z.string().refine(
    (v) => !v || timeRegex.test(v) || /^\d{1,2}:\d{2}$/.test(v),
    'Formato inválido (use HH:mm ou HH:mm:ss)'
  ).optional(),
  active: z.boolean().optional(),
});

export type CreateBrokerAvailabilityDto = z.infer<typeof createBrokerAvailabilitySchema>;
export type UpdateBrokerAvailabilityDto = z.infer<typeof updateBrokerAvailabilitySchema>;
