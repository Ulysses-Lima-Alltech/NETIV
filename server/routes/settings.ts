import { Router } from 'express';
import { getWhatsAppConfigPublic, updateWhatsAppConfig, validateConfigForEnabled } from '../repositories/whatsappConfigRepository.js';
import { testConnection } from '../services/whatsappMetaService.js';
import { whatsappSettingUpdateSchema } from '../validators/settings.js';

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

function getSafeErrorMessage(e: unknown, genericMessage: string): string {
  if (isDatabaseError(e)) {
    return 'Configuração do banco desatualizada. Reinicie o servidor para aplicar atualizações e tente novamente.';
  }
  return genericMessage;
}

router.get('/whatsapp', (req, res) => {
  try {
    const config = getWhatsAppConfigPublic();
    if (!config) {
      return res.status(404).json({ error: 'Configuração WhatsApp não encontrada.' });
    }
    res.json(config);
  } catch (e) {
    console.error('[Settings] GET whatsapp:', e);
    const message = getSafeErrorMessage(e, 'Erro ao obter configuração.');
    res.status(500).json({ error: message });
  }
});

router.put('/whatsapp', (req, res) => {
  try {
    const parsed = whatsappSettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const update = parsed.data;
    const merged = updateWhatsAppConfig(update);
    const validationError = validateConfigForEnabled(merged);
    if (validationError) {
      updateWhatsAppConfig({ enabled: false });
      return res.status(400).json({ error: validationError });
    }
    const publicConfig = getWhatsAppConfigPublic();
    if (!publicConfig) return res.status(500).json({ error: 'Erro ao obter configuração após salvar.' });
    res.json(publicConfig);
  } catch (e) {
    console.error('[Settings] PUT whatsapp:', e);
    const message = getSafeErrorMessage(e, 'Erro ao salvar configuração.');
    res.status(500).json({ error: message });
  }
});

router.post('/whatsapp/test', async (req, res) => {
  try {
    const result = await testConnection();
    if (result.success) {
      return res.json({ success: true, message: 'Conexão com a Meta validada com sucesso.' });
    }
    const errorMessage = result.detail ? `${result.error} ${result.detail}` : result.error;
    res.status(400).json({ success: false, error: errorMessage });
  } catch (e) {
    console.error('[Settings] POST whatsapp/test:', e);
    const message = getSafeErrorMessage(e, 'Erro ao testar conexão.');
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
