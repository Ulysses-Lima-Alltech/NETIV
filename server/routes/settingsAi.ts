import { Router } from 'express';
import { getOpenAIConfig, getOpenAIConfigPublic, updateOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { runAnaOpenAIDiagnostic } from '../services/anaOpenAIDiagnosticService.js';
import {
  getGlobalAiSettingsForFrontend,
  getSafeEnterpriseAiSettingsForFrontend,
  testEnterpriseAiConnection,
  updateGlobalAiSettings,
  upsertEnterpriseAiSettings,
} from '../services/enterpriseAiSettingsService.js';
import { listOpenAiCostSnapshots, syncOpenAiCosts } from '../services/openaiCostSyncService.js';
import { OPENAI_ALLOWED_MODELS } from '../catalogs/aiModels.js';
import {
  enterpriseAiSettingUpdateSchema,
  globalAiSettingUpdateSchema,
  openAISettingUpdateSchema,
} from '../validators/ai.js';

const router = Router();

function parseEnterpriseId(raw: string): number | null {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

router.get('/ai', async (_req, res) => {
  try {
    const config = await getOpenAIConfigPublic();
    if (!config) return res.status(404).json({ error: 'Configuração de IA não encontrada.' });
    res.json(config);
  } catch (e) {
    console.error('[Settings] GET ai:', e);
    res.status(500).json({ error: 'Erro ao obter configuração de IA.' });
  }
});

router.put('/ai', async (req, res) => {
  try {
    const parsed = openAISettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const update = parsed.data;
    if (update.openaiBaseUrl === '') (update as { openaiBaseUrl?: null }).openaiBaseUrl = null;
    await updateOpenAIConfig(update);
    const publicConfig = await getOpenAIConfigPublic();
    if (!publicConfig) return res.status(500).json({ error: 'Erro após salvar.' });
    res.json(publicConfig);
  } catch (e) {
    if ((e as { code?: string })?.code === 'INVALID_OPENAI_MODEL') {
      return res.status(400).json({ error: e instanceof Error ? e.message : 'Modelo invalido.' });
    }
    console.error('[Settings] PUT ai:', e);
    res.status(500).json({ error: 'Erro ao salvar configuração de IA.' });
  }
});

router.post('/ai/test', async (_req, res) => {
  try {
    const cfg = await getOpenAIConfig();
    if (!cfg?.openaiApiKey?.trim()) {
      return res.status(400).json({ success: false, error: 'API Key não configurada.' });
    }

    const baseUrl = (cfg.openaiBaseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = cfg.modelColdLead || cfg.modelHotLead || 'gpt-4.1';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const apiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = (await apiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: string };
    };

    if (!apiRes.ok) {
      const errMsg = data.error?.message ?? `HTTP ${apiRes.status}`;
      return res.status(400).json({ success: false, error: errMsg, model, baseUrl });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    res.json({ success: true, model, baseUrl, reply });
  } catch (e) {
    console.error('[Settings] POST ai/test:', e);
    const msg = e instanceof Error ? e.message : 'Erro ao testar.';
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/ai/diagnostics/ana/openai', async (_req, res) => {
  try {
    const result = await runAnaOpenAIDiagnostic();
    return res.json(result);
  } catch (e) {
    console.error('[Settings] POST ai/diagnostics/ana/openai:', e);
    const msg = e instanceof Error ? e.message : 'Erro ao diagnosticar provider da Ana.';
    return res.status(500).json({
      ok: false,
      provider: 'unknown',
      model: null,
      status: null,
      classifiedError: 'UNKNOWN_RUNTIME_ERROR',
      sanitizedMessage: msg,
      canGenerate: false,
      recommendation: 'Revise o servidor e tente novamente.',
    });
  }
});

router.get('/api/global', async (_req, res) => {
  try {
    const data = await getGlobalAiSettingsForFrontend();
    return res.json(data);
  } catch (error) {
    console.error('[Settings] GET api/global:', error);
    return res.status(500).json({ error: 'Erro ao carregar configuracao global de API.' });
  }
});

router.put('/api/global', async (req, res) => {
  try {
    const parsed = globalAiSettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue: { message: string }) => issue.message).join('; ') || 'Dados invalidos.';
      return res.status(400).json({ error: msg });
    }

    await updateGlobalAiSettings(parsed.data);
    const data = await getGlobalAiSettingsForFrontend();
    return res.json(data);
  } catch (error) {
    if ((error as { code?: string })?.code === 'INVALID_OPENAI_MODEL') {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Modelo invalido.' });
    }
    console.error('[Settings] PUT api/global:', error);
    return res.status(500).json({ error: 'Erro ao salvar configuracao global de API.' });
  }
});

router.get('/api/enterprises', async (_req, res) => {
  try {
    const items = await getSafeEnterpriseAiSettingsForFrontend();
    return res.json({ enterprises: items, available_models: OPENAI_ALLOWED_MODELS });
  } catch (error) {
    console.error('[Settings] GET api/enterprises:', error);
    return res.status(500).json({ error: 'Erro ao carregar configuracao por empreendimento.' });
  }
});

router.put('/api/enterprises/:enterpriseId', async (req, res) => {
  try {
    const enterpriseId = parseEnterpriseId(req.params.enterpriseId);
    if (enterpriseId == null) {
      return res.status(400).json({ error: 'enterpriseId invalido.' });
    }

    const parsed = enterpriseAiSettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue: { message: string }) => issue.message).join('; ') || 'Dados invalidos.';
      return res.status(400).json({ error: msg });
    }

    await upsertEnterpriseAiSettings(enterpriseId, parsed.data);
    const items = await getSafeEnterpriseAiSettingsForFrontend();
    const updated = items.find((item) => item.enterprise_id === enterpriseId) ?? null;
    if (!updated) {
      return res.status(404).json({ error: 'Empreendimento nao encontrado.' });
    }
    return res.json(updated);
  } catch (error) {
    if ((error as { code?: string })?.code === 'INVALID_OPENAI_MODEL') {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Modelo invalido.' });
    }
    console.error('[Settings] PUT api/enterprises/:enterpriseId:', error);
    return res.status(500).json({ error: 'Erro ao salvar configuracao do empreendimento.' });
  }
});

router.post('/api/enterprises/:enterpriseId/test', async (req, res) => {
  try {
    const enterpriseId = parseEnterpriseId(req.params.enterpriseId);
    if (enterpriseId == null) {
      return res.status(400).json({ error: 'enterpriseId invalido.' });
    }

    const result = await testEnterpriseAiConnection(enterpriseId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('[Settings] POST api/enterprises/:enterpriseId/test:', error);
    const msg = error instanceof Error ? error.message : 'Erro ao testar configuracao do empreendimento.';
    return res.status(500).json({ error: msg });
  }
});

router.post('/api/costs/sync', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const startTime = body.startTime ? new Date(String(body.startTime)) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endTime = body.endTime ? new Date(String(body.endTime)) : new Date();
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      return res.status(400).json({ error: 'Periodo invalido para sincronizacao de custos.' });
    }
    const result = await syncOpenAiCosts({
      startTime,
      endTime,
      groupBy: ['api_key_id', 'project_id', 'line_item'],
      bucketWidth: '1d',
    });
    return res.json({
      ...result,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });
  } catch (error) {
    console.error('[Settings] POST api/costs/sync:', error);
    const msg = error instanceof Error ? error.message : 'Erro ao sincronizar custos OpenAI.';
    return res.status(500).json({ error: msg });
  }
});

router.get('/api/costs/snapshots', async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const startTime = q.startTime ? new Date(String(q.startTime)) : null;
    const endTime = q.endTime ? new Date(String(q.endTime)) : null;
    const enterpriseId = q.enterpriseId ? Number.parseInt(String(q.enterpriseId), 10) : null;
    const limit = q.limit ? Number.parseInt(String(q.limit), 10) : 200;
    if ((startTime && Number.isNaN(startTime.getTime())) || (endTime && Number.isNaN(endTime.getTime()))) {
      return res.status(400).json({ error: 'Parametros startTime/endTime invalidos.' });
    }
    if (enterpriseId != null && (!Number.isFinite(enterpriseId) || enterpriseId <= 0)) {
      return res.status(400).json({ error: 'enterpriseId invalido.' });
    }
    const snapshots = await listOpenAiCostSnapshots({
      startTime,
      endTime,
      enterpriseId,
      limit,
    });
    return res.json({ snapshots });
  } catch (error) {
    console.error('[Settings] GET api/costs/snapshots:', error);
    const msg = error instanceof Error ? error.message : 'Erro ao listar snapshots de custo OpenAI.';
    return res.status(500).json({ error: msg });
  }
});

export default router;

