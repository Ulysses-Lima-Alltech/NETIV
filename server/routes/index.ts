import { Router } from 'express';
import authRouter from './auth.js';
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
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use('/auth', authRouter);

router.use(requireAuth);

router.use('/users', requireRole('ADMIN'), usersRouter);
router.use('/settings/integrations', requireRole('ADMIN'), settingsRouter);
router.use('/settings', requireRole('ADMIN'), settingsAiRouter);
router.use('/whatsapp', whatsappRouter);
router.use('/webhook/whatsapp', webhookRouter);
router.use('/webhooks/whatsapp', webhookRouter);
router.use('/lead', leadRouter);
router.use('/projects', requireRole('ADMIN'), projectsRouter);
router.use('/corretores', requireRole('ADMIN'), corretoresRouter);
router.use('/appointments', appointmentsRouter);
router.use('/openai', openaiTestRouter);
router.use('/ai', aiChatRouter);

export default router;
