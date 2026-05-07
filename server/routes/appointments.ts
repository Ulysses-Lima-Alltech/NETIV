import { Router } from 'express';
import {
  listAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  deleteAppointment,
} from '../repositories/appointmentRepository.js';
import { checkAvailability, assignAppointment, assignPendingAppointment } from '../services/appointmentService.js';
import {
  checkAvailabilitySchema,
  assignAppointmentSchema,
  createAppointmentSchema,
  updateAppointmentStatusSchema,
} from '../validators/appointments.js';
import { APPOINTMENT_STATUSES } from '../repositories/appointmentRepository.js';
import { applyTeamScope } from '../services/teamScope.js';

const router = Router();

function toAppointmentDto(row: {
  id: number;
  customer_name: string;
  customer_phone: string;
  enterprise_id: number;
  broker_id: number | null;
  city: string;
  start_at: Date;
  end_at: Date;
  status: string;
  source: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    enterpriseId: row.enterprise_id,
    brokerId: row.broker_id,
    city: row.city,
    startAt: row.start_at instanceof Date ? row.start_at.toISOString() : String(row.start_at),
    endAt: row.end_at instanceof Date ? row.end_at.toISOString() : String(row.end_at),
    status: row.status,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// POST /check-availability — antes de /:id
router.post('/check-availability', async (req, res) => {
  try {
    const parsed = checkAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const { enterpriseId, startAt, endAt } = parsed.data;
    const result = await checkAvailability(
      enterpriseId,
      new Date(startAt),
      new Date(endAt)
    );
    res.json(result);
  } catch (e) {
    console.error('[Appointments] check-availability:', e);
    res.status(500).json({ error: 'Erro ao consultar disponibilidade.' });
  }
});

// POST /assign — antes de /:id
router.post('/assign', async (req, res) => {
  try {
    const parsed = assignAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    const result = await assignAppointment({
      customerName: d.customerName,
      customerPhone: d.customerPhone ?? '',
      enterpriseId: d.enterpriseId,
      city: d.city ?? '',
      startAt: new Date(d.startAt),
      endAt: new Date(d.endAt),
      notes: d.notes,
      source: d.source,
      brokerId: d.brokerId ?? undefined,
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao confirmar agendamento.';
    console.error('[Appointments] assign:', e);
    res.status(500).json({ error: msg });
  }
});

// GET /
router.get('/', async (req, res) => {
  try {
    const enterpriseId = req.query.enterpriseId != null ? parseInt(String(req.query.enterpriseId), 10) : undefined;
    const brokerId = req.query.brokerId != null ? parseInt(String(req.query.brokerId), 10) : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    
    const params: { enterpriseId?: number; brokerId?: number; status?: string; date?: string; allowedEnterpriseIds?: number[] } = {
      enterpriseId,
      brokerId,
      status,
      date,
    };
    
    // NOVO: aplicar escopo de equipe (se a flag estiver ligada)
    const u = (req as any).user;
    if (u) applyTeamScope(params, u);
    
    const rows = await listAppointments(params);
    res.json({
      appointments: rows.map(toAppointmentDto),
    });
  } catch (e) {
    console.error('[Appointments] GET:', e);
    res.status(500).json({ error: 'Erro ao listar agendamentos.' });
  }
});

// POST /:id/assign — atribuição manual para PENDENTE_DISTRIBUICAO (antes de /:id)
router.post('/:id/assign', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const body = req.body as { brokerId?: number };
    const brokerId = body?.brokerId;
    if (brokerId == null || typeof brokerId !== 'number' || brokerId < 1) {
      return res.status(400).json({ error: 'brokerId é obrigatório.' });
    }
    const result = await assignPendingAppointment(id, brokerId);
    res.json({
      appointment: {
        id: result.appointment.id,
        customerName: result.appointment.customer_name,
        customerPhone: result.appointment.customer_phone,
        enterpriseId: result.appointment.enterprise_id,
        brokerId: result.appointment.broker_id,
        city: result.appointment.city,
        startAt: result.appointment.start_at instanceof Date ? result.appointment.start_at.toISOString() : String(result.appointment.start_at),
        endAt: result.appointment.end_at instanceof Date ? result.appointment.end_at.toISOString() : String(result.appointment.end_at),
        status: result.appointment.status,
        source: result.appointment.source,
        notes: result.appointment.notes,
        createdAt: result.appointment.created_at instanceof Date ? result.appointment.created_at.toISOString() : String(result.appointment.created_at),
        updatedAt: result.appointment.updated_at instanceof Date ? result.appointment.updated_at.toISOString() : String(result.appointment.updated_at),
      },
      broker: result.broker,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao atribuir.';
    console.error('[Appointments] assign :id:', e);
    res.status(400).json({ error: msg });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const row = await getAppointmentById(id);
    if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(toAppointmentDto(row));
  } catch (e) {
    console.error('[Appointments] GET :id:', e);
    res.status(500).json({ error: 'Erro ao carregar agendamento.' });
  }
});

// POST / — criação manual (usa assign internamente ou cria sem corretor)
router.post('/', async (req, res) => {
  try {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    // Usa assign para seleção automática do corretor
    const result = await assignAppointment({
      customerName: d.customerName,
      customerPhone: d.customerPhone ?? '',
      enterpriseId: d.enterpriseId,
      city: d.city ?? '',
      startAt: new Date(d.startAt),
      endAt: new Date(d.endAt),
      notes: d.notes,
      source: d.source ?? 'ANA',
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao criar agendamento.';
    console.error('[Appointments] POST:', e);
    res.status(500).json({ error: msg });
  }
});

// PATCH /:id
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const body = req.body as Record<string, unknown>;
    if (body.status != null && typeof body.status === 'string') {
      if (!APPOINTMENT_STATUSES.includes(body.status as typeof APPOINTMENT_STATUSES[number])) {
        return res.status(400).json({ error: `Status inválido. Use: ${APPOINTMENT_STATUSES.join(', ')}` });
      }
      const updated = await updateAppointmentStatus(id, body.status);
      if (!updated) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      return res.json(toAppointmentDto(updated));
    }
    return res.status(400).json({ error: 'Use PATCH /:id/status para alterar status.' });
  } catch (e) {
    console.error('[Appointments] PATCH :id:', e);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

// PATCH /:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateAppointmentStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const updated = await updateAppointmentStatus(id, parsed.data.status);
    if (!updated) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(toAppointmentDto(updated));
  } catch (e) {
    console.error('[Appointments] PATCH :id/status:', e);
    res.status(500).json({ error: 'Erro ao atualizar status.' });
  }
});

// DELETE /:id — exclusão real (não é cancelamento; use PATCH /:id/status para cancelar)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const deleted = await deleteAppointment(id);
    if (!deleted) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.status(204).send();
  } catch (e) {
    console.error('[Appointments] DELETE:', e);
    res.status(500).json({ error: 'Erro ao excluir.' });
  }
});

export default router;
