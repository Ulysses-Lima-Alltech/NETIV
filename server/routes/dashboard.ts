import { Router } from 'express';
import {
  getDashboardOverview,
  getDashboardCsvRows,
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
    const attentionType = parseDashboardAttentionType(
      typeof req.query.attentionType === 'string' ? req.query.attentionType : undefined
    );
    const overview = await getDashboardOverview(period, enterpriseId, attentionType);
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
    const attentionType = parseDashboardAttentionType(
      typeof req.query.attentionType === 'string' ? req.query.attentionType : undefined
    );
    const rows = await getDashboardCsvRows(period, enterpriseId, attentionType);
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

export default router;
