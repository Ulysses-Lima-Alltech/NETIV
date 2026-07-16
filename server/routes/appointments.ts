import { Router, type Response } from 'express';
import {
  APPOINTMENT_STATUSES,
  deleteAppointment,
  getAppointmentById,
  listAppointments,
  updateAppointmentStatus,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import { assignAppointment, assignPendingAppointment, checkAvailability } from '../services/appointmentService.js';
import {
  assignAppointmentSchema,
  createAppointmentSchema,
  checkAvailabilitySchema,
  updateAppointmentStatusSchema,
} from '../validators/appointments.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  canAccessAppointment,
  canAccessBroker,
  canAccessEnterprise,
  getAccessibleAppointmentIds,
} from '../services/authorizationService.js';

const router = Router();

function dto(row: AppointmentRow) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    enterpriseId: row.enterprise_id,
    brokerId: row.broker_id,
    city: row.city,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    status: row.status,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function assertAppointment(req: AuthenticatedRequest, res: Response, id: number) {
  if (await canAccessAppointment(req.user, id)) return true;
  res.status(404).json({ error: 'Agendamento não encontrado no seu escopo.', code: 'OUT_OF_SCOPE' });
  return false;
}

function assertManagerOrAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user.role === 'ADMIN' || req.user.role === 'MANAGERIAL') return true;
  res.status(403).json({ error: 'Operação restrita a gestores e administradores.', code: 'ROLE_FORBIDDEN' });
  return false;
}

async function assertAssignmentScope(req: AuthenticatedRequest, enterpriseId: number, brokerId: number | null | undefined): Promise<boolean> {
  if (!(await canAccessEnterprise(req.user, enterpriseId))) return false;
  if (req.user.role !== 'ADMIN' && (brokerId == null || !(await canAccessBroker(req.user, brokerId)))) return false;
  return brokerId == null || canAccessBroker(req.user, brokerId);
}

router.post('/check-availability', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!assertManagerOrAdmin(authReq, res)) return;
    const parsed = checkAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    if (!(await canAccessEnterprise(authReq.user, parsed.data.enterpriseId))) return res.status(403).json({ error: 'Empreendimento fora do escopo.' });
    res.json(await checkAvailability(parsed.data.enterpriseId, new Date(parsed.data.startAt), new Date(parsed.data.endAt)));
  } catch (error) {
    console.error('[Appointments] availability', error);
    res.status(500).json({ error: 'Erro ao consultar disponibilidade.' });
  }
});

router.post('/assign', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!assertManagerOrAdmin(authReq, res)) return;
    const parsed = assignAppointmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    const data = parsed.data;
    if (!(await assertAssignmentScope(authReq, data.enterpriseId, data.brokerId))) return res.status(403).json({ error: 'Empreendimento ou corretor fora do escopo.' });
    res.status(201).json(await assignAppointment({
      customerName: data.customerName, customerPhone: data.customerPhone, enterpriseId: data.enterpriseId,
      city: data.city, startAt: new Date(data.startAt), endAt: new Date(data.endAt), notes: data.notes,
      source: data.source, brokerId: data.brokerId,
    }));
  } catch (error) {
    console.error('[Appointments] assign', error);
    res.status(500).json({ error: 'Erro ao confirmar agendamento.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const appointmentIds = authReq.user.role === 'ADMIN' ? undefined : await getAccessibleAppointmentIds(authReq.user);
    const enterpriseId = req.query.enterpriseId == null ? undefined : Number(req.query.enterpriseId);
    const brokerId = req.query.brokerId == null ? undefined : Number(req.query.brokerId);
    const rows = await listAppointments({
      appointmentIds,
      enterpriseId: Number.isSafeInteger(enterpriseId) ? enterpriseId : undefined,
      brokerId: Number.isSafeInteger(brokerId) ? brokerId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    });
    res.json({ appointments: rows.map(dto) });
  } catch (error) {
    console.error('[Appointments] list', error);
    res.status(500).json({ error: 'Erro ao listar agendamentos.' });
  }
});

router.post('/:id/assign', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    const brokerId = Number(req.body?.brokerId);
    if (!assertManagerOrAdmin(authReq, res)) return;
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(brokerId)) return res.status(400).json({ error: 'IDs inválidos.' });
    if (!(await assertAppointment(authReq, res, id))) return;
    if (!(await canAccessBroker(authReq.user, brokerId))) return res.status(403).json({ error: 'Corretor fora do escopo.' });
    const result = await assignPendingAppointment(id, brokerId);
    res.json({ appointment: dto(result.appointment), broker: result.broker });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao atribuir.' });
  }
});

router.get('/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
  if (!(await assertAppointment(authReq, res, id))) return;
  const row = await getAppointmentById(id);
  if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  res.json(dto(row));
});

router.post('/', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!assertManagerOrAdmin(authReq, res)) return;
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    const data = parsed.data;
    if (!(await assertAssignmentScope(authReq, data.enterpriseId, data.brokerId))) return res.status(403).json({ error: 'Empreendimento ou corretor fora do escopo.' });
    res.status(201).json(await assignAppointment({
      customerName: data.customerName, customerPhone: data.customerPhone, enterpriseId: data.enterpriseId,
      city: data.city, startAt: new Date(data.startAt), endAt: new Date(data.endAt), notes: data.notes,
      source: data.source, brokerId: data.brokerId,
    }));
  } catch (error) {
    console.error('[Appointments] create', error);
    res.status(500).json({ error: 'Erro ao criar agendamento.' });
  }
});

async function updateStatus(req: AuthenticatedRequest, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
  if (!(await assertAppointment(req, res, id))) return;
  const parsed = updateAppointmentStatusSchema.safeParse(req.body);
  if (!parsed.success || !APPOINTMENT_STATUSES.includes(parsed.data.status)) return res.status(400).json({ error: 'Status inválido.' });
  const updated = await updateAppointmentStatus(id, parsed.data.status);
  if (!updated) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  res.json(dto(updated));
}

router.patch('/:id', (req, res) => void updateStatus(req as AuthenticatedRequest, res));
router.patch('/:id/status', (req, res) => void updateStatus(req as AuthenticatedRequest, res));

router.delete('/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const id = Number(req.params.id);
  if (!assertManagerOrAdmin(authReq, res)) return;
  if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
  if (!(await assertAppointment(authReq, res, id))) return;
  if (!(await deleteAppointment(id))) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  res.status(204).send();
});

export default router;
