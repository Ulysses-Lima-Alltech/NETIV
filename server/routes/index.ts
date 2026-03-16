import { Router } from 'express';
import settingsRouter from './settings.js';
import settingsAiRouter from './settingsAi.js';
import whatsappRouter from './whatsapp.js';
import webhookRouter from './webhook.js';
import leadRouter from './lead.js';
import projectsRouter from './projects.js';
import openaiTestRouter from './openaiTest.js';
import aiChatRouter from './aiChat.js';

const router = Router();

router.use('/settings/integrations', settingsRouter);
router.use('/settings', settingsAiRouter);
router.use('/whatsapp', whatsappRouter);
router.use('/webhook/whatsapp', webhookRouter);
router.use('/webhooks/whatsapp', webhookRouter);
router.use('/lead', leadRouter);
router.use('/projects', projectsRouter);
router.use('/openai', openaiTestRouter);
router.use('/ai', aiChatRouter);

export default router;
