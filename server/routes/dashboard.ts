import { Router } from 'express';
import { getDashboardOverview, type DashboardPeriod } from '../repositories/dashboardRepository.js';

const router = Router();

const PERIODS = new Set<DashboardPeriod>(['today', '7d', '30d']);

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

export default router;
