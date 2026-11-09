import { Router } from 'express';
import {
  unclassifiedLeadFollowupPreviewSchema,
  unclassifiedLeadFollowupSendSchema,
  unclassifiedLeadSettingsSchema,
} from '../validators/anaUnclassifiedLeadSettings.js';
import {
  getUnclassifiedLeadSettings,
  saveUnclassifiedLeadSettings,
} from '../repositories/anaUnclassifiedLeadSettingsRepository.js';
import {
  getUnclassifiedLeadFollowupTemplates,
  previewUnclassifiedLeadFollowup,
  sendUnclassifiedLeadFollowup,
} from '../services/anaUnclassifiedLeadFollowupService.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.get('/unclassified-leads', async (_req, res) => {
  try {
    return res.json(await getUnclassifiedLeadSettings());
  } catch (error) {
    console.error('[Settings] GET unclassified leads:', error);
    return res.status(500).json({ error: 'Erro ao carregar a mensagem geral.' });
  }
});

router.put('/unclassified-leads', async (req, res) => {
  const parsed = unclassifiedLeadSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Informe um texto de até 2000 caracteres ou null.' });
  }

  try {
    return res.json(await saveUnclassifiedLeadSettings(
      parsed.data.initialMessage,
      parsed.data.followUpMessage
    ));
  } catch (error) {
    console.error('[Settings] PUT unclassified leads:', error);
    return res.status(500).json({ error: 'Erro ao salvar a mensagem geral.' });
  }
});

router.get('/unclassified-leads/follow-up/templates', async (_req, res) => {
  try {
    return res.json({ templates: await getUnclassifiedLeadFollowupTemplates() });
  } catch (error) {
    console.error('[Settings] GET unclassified lead follow-up templates:', error);
    return res.status(502).json({ error: 'Não foi possível confirmar os templates aprovados da Meta.' });
  }
});

router.post('/unclassified-leads/follow-up/preview', async (req, res) => {
  const parsed = unclassifiedLeadFollowupPreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Selecione um template de Marketing aprovado.' });
  }

  try {
    return res.json(await previewUnclassifiedLeadFollowup(parsed.data.templateKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao montar a prévia.';
    return res.status(400).json({ error: message });
  }
});

router.post('/unclassified-leads/follow-up/send', async (req, res) => {
  const parsed = unclassifiedLeadFollowupSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Confirmação de envio inválida.' });
  }

  try {
    const result = await sendUnclassifiedLeadFollowup({
      ...parsed.data,
      createdBy: (req as AuthenticatedRequest).user?.id ?? null,
    });
    return res.json(result);
  } catch (error) {
    console.error('[Settings] POST unclassified lead follow-up:', error);
    const message = error instanceof Error ? error.message : 'Erro ao enviar o follow-up.';
    return res.status(409).json({ error: message });
  }
});

export default router;
