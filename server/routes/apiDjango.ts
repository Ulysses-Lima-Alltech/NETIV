import { Router, type Request, type Response } from 'express';
import { requireServiceJwt, type JwtRequest } from '../middleware/jwtAuth.js';
import {
  listConversationsWithPreview,
  getConversationById,
  type ConversationRow,
  type ListConversationsFilters,
} from '../repositories/conversationRepository.js';
import {
  listAppointments,
  getAppointmentById,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import {
  listCorretoresWithEnterprises,
  listCorretoresByEnterprise,
  getCorretorById,
  type CorretorWithEnterprises,
} from '../repositories/corretorRepository.js';
import {
  listEnterprises,
  getEnterpriseById,
  enterpriseToPublic,
  getVariablesMap,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';

const router = Router();

function parseRouteId(idParam: string | string[] | undefined): number {
  const raw = Array.isArray(idParam) ? idParam[0] : idParam;
  return parseInt(String(raw ?? ''), 10);
}

// Helper functions for serialization
function serializeConversation(conv: ConversationRow) {
  return {
    id: conv.id,
    channel: conv.channel,
    external_contact_id: conv.external_contact_id,
    contact_phone: conv.contact_phone,
    customer_name: conv.customer_name,
    enterprise_id: conv.enterprise_id,
    classification: conv.classification,
    lead_temperature: conv.lead_temperature,
    handoff: conv.handoff,
    assigned_broker_id: conv.assigned_broker_id,
    meta_phone_number_id: conv.meta_phone_number_id,
    last_message_at: conv.last_message_at?.toISOString() || null,
    created_at: conv.created_at.toISOString(),
    updated_at: conv.updated_at.toISOString(),
  };
}

function serializeAppointment(apt: AppointmentRow) {
  return {
    id: apt.id,
    customer_name: apt.customer_name,
    customer_phone: apt.customer_phone,
    enterprise_id: apt.enterprise_id,
    broker_id: apt.broker_id,
    city: apt.city,
    start_at: apt.start_at.toISOString(),
    end_at: apt.end_at.toISOString(),
    status: apt.status,
    source: apt.source,
    notes: apt.notes,
    conversation_id: apt.conversation_id,
    created_at: apt.created_at.toISOString(),
    updated_at: apt.updated_at.toISOString(),
  };
}

function serializeCorretor(corretor: CorretorWithEnterprises) {
  return {
    id: corretor.id,
    full_name: corretor.full_name,
    city: corretor.city,
    phone: corretor.phone,
    real_estate_agency: corretor.real_estate_agency,
    active: corretor.active,
    enterprise_ids: corretor.enterprise_ids,
    created_at: corretor.created_at.toISOString(),
    updated_at: corretor.updated_at.toISOString(),
  };
}

function serializeEnterprise(emp: EnterpriseRow, variables: Record<string, string>) {
  return {
    id: emp.id,
    name: emp.name,
    slug: emp.slug,
    status: emp.status,
    language_style: emp.language_style,
    tipo: emp.tipo,
    exclusivo: emp.exclusivo,
    city: emp.city,
    state_uf: emp.state_uf,
    commercial_region: emp.commercial_region,
    ibge_code: emp.ibge_code,
    variables,
    created_at: emp.created_at.toISOString(),
    updated_at: emp.updated_at.toISOString(),
  };
}

// === Conversations ===
router.get('/conversations', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const {
      enterprise_id,
      classification,
      lead_temperature,
      handoff,
      page = '1',
      page_size = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(page_size as string) || 50));
    const offset = (pageNum - 1) * pageSize;

    // Build filters - traduzir snake_case para camelCase esperado pelos repositórios
    const filters: any = {
      limit: pageSize,
      offset,
    };
    if (enterprise_id) filters.enterpriseId = parseInt(enterprise_id as string);
    if (classification) filters.status = classification as string;  // classification → status
    if (lead_temperature) filters.leadTemperature = lead_temperature as string;  // lead_temperature → leadTemperature
    if (handoff !== undefined) filters.mode = handoff === 'true' ? 'handoff' : 'all';  // handoff → mode

    // Get conversations - buscar total real para paginação correta
    const allConversations = await listConversationsWithPreview('whatsapp', 99999, {
      ...filters,
    });
    const total = allConversations.length;
    const conversations = allConversations.slice(offset, offset + pageSize);

    res.json({
      conversations: conversations.map(serializeConversation),
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[API Django] GET /conversations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/conversations/:id', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await getConversationById(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(serializeConversation(conversation));
  } catch (error) {
    console.error('[API Django] GET /conversations/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Appointments ===
router.get('/appointments', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const {
      enterprise_id,
      broker_id,
      status,
      date_from,
      date_to,
      page = '1',
      page_size = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(page_size as string) || 50));
    const offset = (pageNum - 1) * pageSize;

    // Build filters - traduzir snake_case para camelCase esperado pelos repositórios
    const filters: any = {
      limit: pageSize,
      offset,
    };
    if (enterprise_id) filters.enterpriseId = parseInt(enterprise_id as string);
    if (broker_id) filters.brokerId = parseInt(broker_id as string);
    if (status) filters.status = status as string;
    if (date_from || date_to) {
      // Se houver range de datas, usar o formato esperado pelo repositório
      if (date_from && date_to) {
        filters.date = `${date_from}:${date_to}`;
      } else if (date_from) {
        filters.date = `${date_from}:`;
      } else if (date_to) {
        filters.date = `:${date_to}`;
      }
    }

    // Get appointments - buscar total real para paginação correta
    const allAppointments = await listAppointments({
      ...filters,
      limit: 99999,  // Buscar todos para contar
      offset: 0,
    });
    const total = allAppointments.length;
    const appointments = allAppointments.slice(offset, offset + pageSize);

    res.json({
      appointments: appointments.map(serializeAppointment),
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[API Django] GET /appointments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/appointments/:id', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid appointment ID' });
    }

    const appointment = await getAppointmentById(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.json(serializeAppointment(appointment));
  } catch (error) {
    console.error('[API Django] GET /appointments/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Corretores ===
router.get('/corretores', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const { active_only = 'false', enterprise_id } = req.query;

    let corretores;
    if (enterprise_id) {
      const enterpriseId = parseInt(enterprise_id as string);
      if (isNaN(enterpriseId)) {
        return res.status(400).json({ error: 'Invalid enterprise_id' });
      }
      corretores = await listCorretoresByEnterprise(enterpriseId);
    } else {
      corretores = await listCorretoresWithEnterprises(active_only === 'true');
    }

    res.json({
      corretores: corretores.map(serializeCorretor),
      count: corretores.length,
    });
  } catch (error) {
    console.error('[API Django] GET /corretores error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/corretores/:id', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid corretor ID' });
    }

    const corretor = await getCorretorById(id);
    if (!corretor) {
      return res.status(404).json({ error: 'Corretor not found' });
    }

    // Get enterprise IDs for this corretor
    const corretoresWithEnterprises = await listCorretoresWithEnterprises(false);
    const corretorWithEnterprises = corretoresWithEnterprises.find(c => c.id === id);

    res.json(serializeCorretor(corretorWithEnterprises || { ...corretor, enterprise_ids: [] }));
  } catch (error) {
    console.error('[API Django] GET /corretores/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Enterprises ===
router.get('/enterprises', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const { active_only = 'true', tipo, exclusivo } = req.query;

    const filters: any = {};
    if (tipo) filters.tipo = (tipo as string).toUpperCase();
    if (exclusivo !== undefined) filters.exclusivo = exclusivo === 'true';

    const enterprises = await listEnterprises(active_only === 'true', Object.keys(filters).length ? filters : undefined);

    // Get variables for each enterprise
    const enterprisesWithVars = await Promise.all(
      enterprises.map(async (emp) => {
        const vars = await getVariablesMap(emp.id);
        return serializeEnterprise(emp, vars);
      })
    );

    res.json({
      enterprises: enterprisesWithVars,
      count: enterprises.length,
    });
  } catch (error) {
    console.error('[API Django] GET /enterprises error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/enterprises/:id', requireServiceJwt(['django']), async (req: JwtRequest, res: Response) => {
  try {
    const id = parseRouteId(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid enterprise ID' });
    }

    const enterprise = await getEnterpriseById(id);
    if (!enterprise) {
      return res.status(404).json({ error: 'Enterprise not found' });
    }

    const vars = await getVariablesMap(id);
    res.json(serializeEnterprise(enterprise, vars));
  } catch (error) {
    console.error('[API Django] GET /enterprises/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
