import { Router } from 'express';
import { getWhatsAppConfigPublic, updateWhatsAppConfig, validateConfigForEnabled } from '../repositories/whatsappConfigRepository.js';
import { testConnection } from '../services/whatsappMetaService.js';
import { whatsappSettingUpdateSchema } from '../validators/settings.js';

const router = Router();

router.get('/whatsapp', async (_req, res) => {
  try {
    const config = await getWhatsAppConfigPublic();
    if (!config) return res.status(404).json({ error: 'Configuração não encontrada.' });
    res.json(config);
  } catch (e) {
    console.error('[Settings] GET whatsapp:', e);
    res.status(500).json({ error: 'Erro ao obter configuração.' });
  }
});

router.put('/whatsapp', async (req, res) => {
  try {
    const parsed = whatsappSettingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const update = parsed.data;
    let merged = await updateWhatsAppConfig(update);
    const validationError = validateConfigForEnabled(merged);
    if (validationError) {
      merged = await updateWhatsAppConfig({ enabled: false });
      return res.status(400).json({ error: validationError });
    }
    const publicConfig = await getWhatsAppConfigPublic();
    if (!publicConfig) return res.status(500).json({ error: 'Erro após salvar.' });
    res.json(publicConfig);
  } catch (e) {
    console.error('[Settings] PUT whatsapp:', e);
    res.status(500).json({ error: 'Erro ao salvar.' });
  }
});

router.post('/whatsapp/test', async (_req, res) => {
  try {
    const result = await testConnection();
    if (result.success) {
      return res.json({ success: true, message: 'Conexão validada.' });
    }
    const errorMessage = result.detail ? `${result.error} ${result.detail}` : result.error;
    res.status(400).json({ success: false, error: errorMessage });
  } catch (e) {
    console.error('[Settings] POST whatsapp/test:', e);
    res.status(500).json({ success: false, error: 'Erro ao testar.' });
  }
});

export default router;
