import { Router } from 'express';
import authRouter from './auth.js';
import mobileAuthRouter from './mobileAuth.js';
import mobileHomeRouter from './mobileHome.js';
import mobileConversationsRouter from './mobileConversations.js';
import mobileVisitsRouter from './mobileVisits.js';
import mobileTeamRouter from './mobileTeam.js';
import mobileEnterprisesRouter from './mobileEnterprises.js';
import mobilePushTokenRouter from './mobilePushToken.js';
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
import dashboardRouter from './dashboard.js';
import contactsRouter from './contacts.js';
import apiDjangoRouter from './apiDjango.js';
import whatsappBatchRouter from './whatsappBatch.js';
import knowledgeRouter from './knowledge.js';
import realtimeRouter from './realtime.js';
import { requireAuth, requirePasswordChangeComplete, requireRole } from '../middleware/auth.js';
import { ROLES_ORG_ADMIN, ROLES_SETTINGS_ADMIN } from '../constants/roles.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/mobile/auth', mobileAuthRouter);
router.use('/mobile/home', mobileHomeRouter);
router.use('/mobile/conversations', mobileConversationsRouter);
router.use('/mobile/visits', mobileVisitsRouter);
router.use('/mobile/team', mobileTeamRouter);
router.use('/mobile/enterprises', mobileEnterprisesRouter);
router.use('/mobile/push-token', mobilePushTokenRouter);
// SSO: chamado pelo Django, protegido pelo JWT assinado (não precisa de auth)
router.use('/auth/sso', ssoRouter);

// API service endpoints for Django (protected by JWT, not session auth)
router.use('/api/service', apiDjangoRouter);

router.use('/realtime', realtimeRouter);

router.use(requireAuth);
router.use(requirePasswordChangeComplete);

router.use('/users', requireRole(...ROLES_ORG_ADMIN), usersRouter);
router.use('/settings/integrations', requireRole(...ROLES_SETTINGS_ADMIN), settingsRouter);
router.use('/settings', requireRole(...ROLES_SETTINGS_ADMIN), settingsAiRouter);
router.use('/whatsapp', whatsappRouter);
router.use('/dashboard', dashboardRouter);
router.use('/webhook/whatsapp', requireRole(...ROLES_SETTINGS_ADMIN), webhookRouter);
router.use('/webhooks/whatsapp', requireRole(...ROLES_SETTINGS_ADMIN), webhookRouter);
router.use('/lead', requireRole(...ROLES_SETTINGS_ADMIN), leadRouter);
router.use('/projects', projectsRouter);
router.use('/corretores', corretoresRouter);
router.use('/appointments', appointmentsRouter);
router.use('/contacts', contactsRouter);
router.use('/whatsapp-batch', requireRole(...ROLES_SETTINGS_ADMIN), whatsappBatchRouter);
router.use('/knowledge', requireRole(...ROLES_SETTINGS_ADMIN), knowledgeRouter);

export default router;
