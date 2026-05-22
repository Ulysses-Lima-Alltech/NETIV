import { Router } from 'express';
import authRouter from './auth.js';
import mobileAuthRouter from './mobileAuth.js';
import mobileHomeRouter from './mobileHome.js';
import ssoRouter from './sso.js';
import usersRouter from './users.js';
import settingsRouter from './settings.js';
import settingsAiRouter from './settingsAi.js';
import whatsappRouter from './whatsapp.js';
import webhookRouter from './webhook.js';
import leadRouter from './lead.js';
import projectsRouter from './projects.js';
import corretoresRouter from './corretores.js';
import appointmentsRouter from './appointments.js';
import openaiTestRouter from './openaiTest.js';
import aiChatRouter from './aiChat.js';
import dashboardRouter from './dashboard.js';
import contactsRouter from './contacts.js';
import apiDjangoRouter from './apiDjango.js';
import whatsappBatchRouter from './whatsappBatch.js';
import reengagementRouter from './reengagement.js';
import knowledgeRouter from './knowledge.js';
import realtimeRouter from './realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES_ORG_ADMIN, ROLES_SETTINGS_ADMIN } from '../constants/roles.js';
import { listBatchTemplatesFromMetaOrFallback } from '../services/whatsappTemplateCatalogSyncService.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/mobile/auth', mobileAuthRouter);
router.use('/mobile/home', mobileHomeRouter);
// SSO: chamado pelo Django, protegido pelo JWT assinado (não precisa de auth)
router.use('/auth/sso', ssoRouter);

// API service endpoints for Django (protected by JWT, not session auth)
router.use('/api/service', apiDjangoRouter);

/**
 * Compatibilidade explícita para a URL pública usada pelo frontend:
 * GET /api/whatsapp-batch/templates
 */
router.get('/whatsapp-batch/templates', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh ?? '') === '1';
    const { templates, fallbackUsed } = await listBatchTemplatesFromMetaOrFallback({ forceRefresh });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
      templates,
      warning: fallbackUsed ? 'Não foi possível sincronizar com a Meta. Exibindo catálogo local.' : null,
      source: fallbackUsed ? 'local_fallback' : 'meta_sync',
    });
  } catch (error) {
    console.error('[WHATSAPP_BATCH_TEMPLATES_COMPAT_ERROR]', error);
    res.status(500).json({ error: 'Erro ao listar templates do WhatsApp.' });
  }
});
router.use('/realtime', realtimeRouter);

router.use(requireAuth);

router.use('/users', requireRole(...ROLES_ORG_ADMIN), usersRouter);
router.use('/settings/integrations', requireRole(...ROLES_SETTINGS_ADMIN), settingsRouter);
router.use('/settings', requireRole(...ROLES_SETTINGS_ADMIN), settingsAiRouter);
router.use('/whatsapp', whatsappRouter);
router.use('/dashboard', dashboardRouter);
router.use('/webhook/whatsapp', webhookRouter);
router.use('/webhooks/whatsapp', webhookRouter);
router.use('/lead', leadRouter);
router.use('/projects', requireRole(...ROLES_ORG_ADMIN), projectsRouter);
router.use('/corretores', requireRole(...ROLES_ORG_ADMIN), corretoresRouter);
router.use('/appointments', appointmentsRouter);
router.use('/openai', openaiTestRouter);
router.use('/ai', aiChatRouter);
router.use('/contacts', requireRole(...ROLES_SETTINGS_ADMIN), contactsRouter);
router.use('/whatsapp-batch', requireRole(...ROLES_SETTINGS_ADMIN), whatsappBatchRouter);
router.use('/reengagement', requireRole(...ROLES_ORG_ADMIN), reengagementRouter);
router.use('/knowledge', requireRole(...ROLES_SETTINGS_ADMIN), knowledgeRouter);

export default router;
