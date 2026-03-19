import { Router } from 'express';
import {
  listCorretoresWithEnterprises,
  listCorretoresByEnterprise,
  getCorretorById,
  getCorretorEnterpriseIds,
  createCorretor,
  updateCorretor,
  inactivateCorretor,
  deleteCorretor,
} from '../repositories/corretorRepository.js';
import { createCorretorSchema, updateCorretorSchema } from '../validators/corretores.js';
import {
  listByBroker,
  getById,
  create,
  update,
  deleteAvailability,
} from '../repositories/brokerAvailabilityRepository.js';
import {
  createBrokerAvailabilitySchema,
  updateBrokerAvailabilitySchema,
} from '../validators/brokerAvailability.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const enterpriseId = req.query.enterpriseId != null ? parseInt(String(req.query.enterpriseId), 10) : null;
    const rows = enterpriseId != null && !Number.isNaN(enterpriseId)
      ? await listCorretoresByEnterprise(enterpriseId)
      : await listCorretoresWithEnterprises(false);
    res.json({
      corretores: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        city: r.city,
        phone: r.phone,
        realEstateAgency: r.real_estate_agency,
        active: r.active,
        enterpriseIds: (r as { enterprise_ids?: number[] }).enterprise_ids ?? [],
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[Corretores] GET:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

// Rotas de disponibilidade — antes de /:id
router.get('/:id/availability', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const broker = await getCorretorById(id);
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado.' });
    const rows = await listByBroker(id);
    res.json({
      availability: rows.map((r) => ({
        id: r.id,
        weekday: r.weekday,
        startTime: r.start_time,
        endTime: r.end_time,
        active: r.active,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[Corretores] GET availability:', e);
    res.status(500).json({ error: 'Erro ao listar disponibilidade.' });
  }
});

router.post('/:id/availability', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const broker = await getCorretorById(id);
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado.' });
    const parsed = createBrokerAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    const r = await create({
      brokerId: id,
      weekday: d.weekday,
      startTime: d.startTime.includes(':') ? d.startTime : `${d.startTime}:00`,
      endTime: d.endTime.includes(':') ? d.endTime : `${d.endTime}:00`,
      active: d.active,
    });
    res.status(201).json({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      active: r.active,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    });
  } catch (e) {
    console.error('[Corretores] POST availability:', e);
    res.status(500).json({ error: 'Erro ao criar disponibilidade.' });
  }
});

router.patch('/:id/availability/:availabilityId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const availabilityId = parseInt(req.params.availabilityId, 10);
    if (Number.isNaN(id) || Number.isNaN(availabilityId)) return res.status(400).json({ error: 'ID inválido.' });
    const broker = await getCorretorById(id);
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado.' });
    const slot = await getById(availabilityId);
    if (!slot || slot.broker_id !== id) return res.status(404).json({ error: 'Disponibilidade não encontrada.' });
    const parsed = updateBrokerAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    const r = await update(availabilityId, {
      weekday: d.weekday,
      startTime: d.startTime,
      endTime: d.endTime,
      active: d.active,
    });
    if (!r) return res.status(404).json({ error: 'Disponibilidade não encontrada.' });
    res.json({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      active: r.active,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    });
  } catch (e) {
    console.error('[Corretores] PATCH availability:', e);
    res.status(500).json({ error: 'Erro ao atualizar disponibilidade.' });
  }
});

router.delete('/:id/availability/:availabilityId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const availabilityId = parseInt(req.params.availabilityId, 10);
    if (Number.isNaN(id) || Number.isNaN(availabilityId)) return res.status(400).json({ error: 'ID inválido.' });
    const slot = await getById(availabilityId);
    if (!slot || slot.broker_id !== id) return res.status(404).json({ error: 'Disponibilidade não encontrada.' });
    const ok = await deleteAvailability(availabilityId);
    if (!ok) return res.status(404).json({ error: 'Disponibilidade não encontrada.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Corretores] DELETE availability:', e);
    res.status(500).json({ error: 'Erro ao remover disponibilidade.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await getCorretorById(id);
    if (!r) return res.status(404).json({ error: 'Não encontrado.' });
    const enterpriseIds = await getCorretorEnterpriseIds(id);
    res.json({
      id: r.id,
      fullName: r.full_name,
      city: r.city,
      phone: r.phone,
      realEstateAgency: r.real_estate_agency,
      active: r.active,
      enterpriseIds,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    });
  } catch (e) {
    console.error('[Corretores] GET :id:', e);
    res.status(500).json({ error: 'Erro ao carregar.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsed = createCorretorSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    const r = await createCorretor({
      fullName: d.fullName,
      city: d.city ?? '',
      phone: d.phone ?? '',
      realEstateAgency: d.realEstateAgency ?? '',
      enterpriseIds: d.enterpriseIds ?? [],
    });
    const enterpriseIds = await getCorretorEnterpriseIds(r.id);
    res.status(201).json({
      id: r.id,
      fullName: r.full_name,
      city: r.city,
      phone: r.phone,
      realEstateAgency: r.real_estate_agency,
      active: r.active,
      enterpriseIds,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao criar.';
    if (msg.includes('obrigatório')) return res.status(400).json({ error: msg });
    console.error('[Corretores] POST:', e);
    res.status(500).json({ error: msg });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateCorretorSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const d = parsed.data;
    const r = await updateCorretor(id, {
      fullName: d.fullName,
      city: d.city,
      phone: d.phone,
      realEstateAgency: d.realEstateAgency,
      active: d.active,
      enterpriseIds: d.enterpriseIds,
    });
    if (!r) return res.status(404).json({ error: 'Não encontrado.' });
    const enterpriseIds = await getCorretorEnterpriseIds(id);
    res.json({
      id: r.id,
      fullName: r.full_name,
      city: r.city,
      phone: r.phone,
      realEstateAgency: r.real_estate_agency,
      active: r.active,
      enterpriseIds,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro.';
    if (msg.includes('obrigatório')) return res.status(400).json({ error: msg });
    console.error('[Corretores] PATCH:', e);
    res.status(500).json({ error: msg });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const inactivate = req.query.permanent !== '1';
    if (inactivate) {
      const r = await inactivateCorretor(id);
      if (!r) return res.status(404).json({ error: 'Não encontrado.' });
      res.json({
        id: r.id,
        fullName: r.full_name,
        city: r.city,
        phone: r.phone,
        realEstateAgency: r.real_estate_agency,
        active: false,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      });
    } else {
      const ok = await deleteCorretor(id);
      if (!ok) return res.status(404).json({ error: 'Não encontrado.' });
      res.json({ ok: true });
    }
  } catch (e) {
    console.error('[Corretores] DELETE:', e);
    res.status(500).json({ error: 'Erro ao excluir.' });
  }
});

export default router;
