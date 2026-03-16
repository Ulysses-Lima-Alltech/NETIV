import { Router } from 'express';
import { getOpenAIConfigPublic, updateOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { openAISettingUpdateSchema } from '../validators/ai.js';

const router = Router();

function isDatabaseError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('SQLITE_') ||
    msg.includes('no such column') ||
    msg.includes('no such table') ||
    msg.includes('database') ||
    msg.includes('schema')
  );
}

function getSafeErrorMessage(e: unknown, generic: string): string {
  if (isDatabaseError(e)) {
    return 'Configuração do banco desatualizada. Reinicie o servidor para aplicar atualizações e tente novamente.';
  }
  return generic;
}

router.get('/ai', (req, res) => {
  try {
    const config = getOpenAIConfigPublic();
    if (!config) {
      return res.status(404).json({ error: 'Configuração de IA não encontrada.' });
    }
    res.json(config);
  } catch (e) {
    console.error('[Settings] GET ai:', e);
    const message = getSafeErrorMessage(e, 'Erro ao obter configuração de IA.');
    res.status(500).json({ error: message });
  }
});

router.put('/ai', (req, res) => {
  try {
    const parsed = openAISettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const update = parsed.data;
    if (update.openaiBaseUrl === '') (update as { openaiBaseUrl?: null }).openaiBaseUrl = null;
    updateOpenAIConfig(update);
    const publicConfig = getOpenAIConfigPublic();
    if (!publicConfig) return res.status(500).json({ error: 'Erro ao obter configuração após salvar.' });
    res.json(publicConfig);
  } catch (e) {
    console.error('[Settings] PUT ai:', e);
    const message = getSafeErrorMessage(e, 'Erro ao salvar configuração de IA.');
    res.status(500).json({ error: message });
  }
});

export default router;
