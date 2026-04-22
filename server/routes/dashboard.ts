import { Router } from 'express';
import {
  getDashboardOverview,
  getDashboardCsvRows,
  getDashboardAttentionItems,
  parseDashboardAttentionType,
  type DashboardPeriod,
  type DashboardCsvRow,
} from '../repositories/dashboardRepository.js';

const router = Router();

const PERIODS = new Set<DashboardPeriod>(['today', '7d', '30d']);

/** RFC 4180: vírgula, aspas, CR/LF exigem campo entre aspas; aspas internas como `""`. */
function csvEscape(value: unknown): string {
  if (value == null) return '';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'bigint') s = value.toString();
  else if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildDashboardCsv(rows: DashboardCsvRow[]): string {
  const headers = [
    'conversation_id',
    'customer_name',
    'contact_phone',
    'enterprise_name',
    'classification',
    'lead_temperature',
    'assigned_broker_id',
    'created_at',
    'last_message_at',
    'no_first_response',
    'is_novo_sem_projeto',
    'is_inactive_12_24h',
    'attention_reason',
  ] as const;
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.conversation_id),
        csvEscape(r.customer_name),
        csvEscape(r.contact_phone),
        csvEscape(r.enterprise_name),
        csvEscape(r.classification),
        csvEscape(r.lead_temperature),
        csvEscape(r.assigned_broker_id),
        csvEscape(r.created_at),
        csvEscape(r.last_message_at),
        csvEscape(r.no_first_response),
        csvEscape(r.is_novo_sem_projeto),
        csvEscape(r.is_inactive_12_24h),
        csvEscape(r.attention_reason),
      ].join(',')
    );
  }
  return lines.join('\r\n');
}

router.get('/overview', async (req, res) => {
  try {
    const raw = typeof req.query.period === 'string' ? req.query.period : '7d';
    const period: DashboardPeriod = PERIODS.has(raw as DashboardPeriod) ? (raw as DashboardPeriod) : '7d';
    let enterpriseId: number | null = null;
    if (req.query.enterpriseId != null && String(req.query.enterpriseId).trim() !== '') {
      const n = parseInt(String(req.query.enterpriseId), 10);
      if (!Number.isNaN(n)) enterpriseId = n;
    }
    const overview = await getDashboardOverview(period, enterpriseId);
    res.json(overview);
  } catch (e) {
    console.error('[Dashboard] GET /overview:', e);
    res.status(500).json({ error: 'Erro ao carregar dashboard.' });
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const raw = typeof req.query.period === 'string' ? req.query.period : '7d';
    const period: DashboardPeriod = PERIODS.has(raw as DashboardPeriod) ? (raw as DashboardPeriod) : '7d';
    let enterpriseId: number | null = null;
    if (req.query.enterpriseId != null && String(req.query.enterpriseId).trim() !== '') {
      const n = parseInt(String(req.query.enterpriseId), 10);
      if (!Number.isNaN(n)) enterpriseId = n;
    }
    const rows = await getDashboardCsvRows(period, enterpriseId);
    const body = `\uFEFF${buildDashboardCsv(rows)}`;
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard-${dateStr}.csv"`);
    res.send(body);
  } catch (e) {
    console.error('[Dashboard] GET /export.csv:', e);
    res.status(500).json({ error: 'Erro ao exportar CSV.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NOVO ENDPOINT: Exportar CSV no formato compatível com Django
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Formata telefone brasileiro: remove +55, espaços, parênteses, traços.
 * Entrada: "+5511999887766" ou "55 11 99988-7766"
 * Saída: "11999887766"
 */
function formatPhoneForDjango(phone: string | null): string {
  if (!phone) return '';
  let clean = phone.replace(/\D/g, ''); // Remove tudo que não é dígito
  // Remove código do país (55) se presente
  if (clean.startsWith('55') && clean.length > 11) {
    clean = clean.slice(2);
  }
  return clean;
}

/**
 * Formata data ISO para DD/MM/YYYY HH:MM (fuso São Paulo).
 */
function formatDateForDjango(isoDate: Date | null): string {
  if (!isoDate) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(isoDate);
}

/**
 * Gera email fake para contornar bug do Django que exige email.
 * Formato: {conversation_id}@netiv.lead
 */
function generateFakeEmail(conversationId: number): string {
  return `${conversationId}@netiv.lead`;
}

/**
 * Constrói CSV no formato Django:
 * nome;email;telefone;campanha;origem;descricao_1;descricao_2;descricao_3
 */
function buildDjangoCsv(rows: DashboardCsvRow[]): string {
  const headers = ['nome', 'email', 'telefone', 'campanha', 'origem', 'descricao_1', 'descricao_2', 'descricao_3'];
  const lines = [headers.join(';')];

  for (const r of rows) {
    // Monta campanha: "Empreendimento - Classificação" ou só classificação se sem empreendimento
    const campanha = r.enterprise_name
      ? `${r.enterprise_name} - ${r.classification}`
      : r.classification;

    const row = [
      csvEscape(r.customer_name || 'Sem nome'),           // nome
      csvEscape(generateFakeEmail(r.conversation_id)),    // email (fake)
      csvEscape(formatPhoneForDjango(r.contact_phone)),   // telefone
      csvEscape(campanha),                                 // campanha
      csvEscape('Netiv IA'),                               // origem
      csvEscape(r.classification),                         // descricao_1
      csvEscape(r.lead_temperature || ''),                 // descricao_2
      csvEscape(formatDateForDjango(r.created_at)),        // descricao_3
    ];
    lines.push(row.join(';'));
  }

  return lines.join('\r\n');
}

router.get('/export-django.csv', async (req, res) => {
  try {
    const raw = typeof req.query.period === 'string' ? req.query.period : '7d';
    const period: DashboardPeriod = PERIODS.has(raw as DashboardPeriod) ? (raw as DashboardPeriod) : '7d';
    let enterpriseId: number | null = null;
    if (req.query.enterpriseId != null && String(req.query.enterpriseId).trim() !== '') {
      const n = parseInt(String(req.query.enterpriseId), 10);
      if (!Number.isNaN(n)) enterpriseId = n;
    }
    const rows = await getDashboardCsvRows(period, enterpriseId);
    const body = `\uFEFF${buildDjangoCsv(rows)}`; // BOM para Excel reconhecer UTF-8
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-django-${dateStr}.csv"`);
    res.send(body);
  } catch (e) {
    console.error('[Dashboard] GET /export-django.csv:', e);
    res.status(500).json({ error: 'Erro ao exportar CSV para Django.' });
  }
});

/** Filtro local da seção "Itens que exigem atenção" (não altera o overview). */
router.get('/attention-items', async (req, res) => {
  try {
    let enterpriseId: number | null = null;
    if (req.query.enterpriseId != null && String(req.query.enterpriseId).trim() !== '') {
      const n = parseInt(String(req.query.enterpriseId), 10);
      if (!Number.isNaN(n)) enterpriseId = n;
    }
    const attentionType = parseDashboardAttentionType(
      typeof req.query.attentionType === 'string' ? req.query.attentionType : undefined
    );
    const payload = await getDashboardAttentionItems(enterpriseId, attentionType);
    res.json(payload);
  } catch (e) {
    console.error('[Dashboard] GET /attention-items:', e);
    res.status(500).json({ error: 'Erro ao carregar itens de atenção.' });
  }
});

export default router;
