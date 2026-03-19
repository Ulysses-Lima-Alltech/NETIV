import { z } from 'zod';

const APPOINTMENT_STATUSES = ['PENDENTE_CONFIRMACAO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO', 'NO_SHOW', 'PENDENTE_DISTRIBUICAO'] as const;

export const checkAvailabilitySchema = z.object({
  enterpriseId: z.number().int().positive('Empreendimento obrigatório'),
  city: z.string().max(120).optional().default(''),
  startAt: z.string().datetime().or(z.coerce.date()),
  endAt: z.string().datetime().or(z.coerce.date()),
}).refine(
  (d) => new Date(d.startAt).getTime() < new Date(d.endAt).getTime(),
  { message: 'Data/hora início deve ser anterior à data/hora fim', path: ['endAt'] }
);

export const assignAppointmentSchema = z.object({
  customerName: z.string().min(1, 'Nome do cliente obrigatório').max(255),
  customerPhone: z.string().max(32).optional().default(''),
  enterpriseId: z.number().int().positive('Empreendimento obrigatório'),
  city: z.string().max(120).optional().default(''),
  startAt: z.string().datetime().or(z.coerce.date()),
  endAt: z.string().datetime().or(z.coerce.date()),
  notes: z.string().max(2000).optional().default(''),
  source: z.string().max(40).optional().default('ANA'),
  brokerId: z.number().int().positive().nullable().optional(),
}).refine(
  (d) => new Date(d.startAt).getTime() < new Date(d.endAt).getTime(),
  { message: 'Data/hora início deve ser anterior à data/hora fim', path: ['endAt'] }
);

export const createAppointmentSchema = z.object({
  customerName: z.string().min(1, 'Nome do cliente obrigatório').max(255),
  customerPhone: z.string().max(32).optional().default(''),
  enterpriseId: z.number().int().positive('Empreendimento obrigatório'),
  brokerId: z.number().int().positive().nullable().optional(),
  city: z.string().max(120).optional().default(''),
  startAt: z.string().datetime().or(z.coerce.date()),
  endAt: z.string().datetime().or(z.coerce.date()),
  status: z.enum(APPOINTMENT_STATUSES).optional().default('CONFIRMADO'),
  source: z.string().max(40).optional().default('ANA'),
  notes: z.string().max(2000).optional().default(''),
}).refine(
  (d) => new Date(d.startAt).getTime() < new Date(d.endAt).getTime(),
  { message: 'Data/hora início deve ser anterior à data/hora fim', path: ['endAt'] }
);

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
});

export const assignPendingSchema = z.object({
  brokerId: z.number().int().positive('Selecione um corretor'),
});

export const assignPendingSchema = z.object({
  brokerId: z.number().int().positive('Corretor obrigatório'),
});

export const assignPendingSchema = z.object({
  brokerId: z.number().int().positive('Corretor obrigatório'),
});

export const assignPendingSchema = z.object({
  brokerId: z.number().int().positive('Selecione um corretor'),
});

export const updateAppointmentSchema = z.object({
  customerName: z.string().min(1).max(255).optional(),
  customerPhone: z.string().max(32).optional(),
  enterpriseId: z.number().int().positive().optional(),
  brokerId: z.number().int().positive().nullable().optional(),
  city: z.string().max(120).optional(),
  startAt: z.string().datetime().or(z.coerce.date()).optional(),
  endAt: z.string().datetime().or(z.coerce.date()).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: z.string().max(2000).optional(),
});

export type CheckAvailabilityDto = z.infer<typeof checkAvailabilitySchema>;
export type AssignAppointmentDto = z.infer<typeof assignAppointmentSchema>;
export type CreateAppointmentDto = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentStatusDto = z.infer<typeof updateAppointmentStatusSchema>;
