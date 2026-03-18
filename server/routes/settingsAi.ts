import { Router } from 'express';
import { getOpenAIConfigPublic, updateOpenAIConfig } from '../repositories/openaiConfigRepository.js';
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

export default router;
