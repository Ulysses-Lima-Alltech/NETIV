import { Router } from 'express';
import authRouter from './auth.js';
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
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES_ORG_ADMIN, ROLES_SETTINGS_ADMIN } from '../constants/roles.js';

const router = Router();

router.use('/auth', authRouter);
// SSO: chamado pelo Django, protegido pelo JWT assinado (não precisa de auth)
router.use('/auth/sso', ssoRouter);

// API service endpoints for Django (protected by JWT, not session auth)
router.use('/api/service', apiDjangoRouter);

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

export default router;
