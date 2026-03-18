import { Router } from 'express';
import { getOpenAIConfig, getOpenAIConfigPublic, updateOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { openAISettingUpdateSchema } from '../validators/ai.js';

const router = Router();

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
    const model = cfg.modelColdLead || cfg.modelHotLead || 'gpt-4o-mini';

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

export default router;
