import 'dotenv/config';
import './express-augmentation.js';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import webhookMetaRouter from './routes/webhookMeta.js';
import { initPostgres } from './db/pg.js';
import { getWhatsAppConfig } from './repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from './repositories/openaiConfigRepository.js';
import { bootstrapFirstAdmin } from './bootstrap/adminBootstrap.js';
import { processDueDeferredHandoffs } from './repositories/conversationRepository.js';
import { processAnaReengagementScan } from './services/anaReengagementService.js';
import { syncAllConversationOwnersFromContacts } from './repositories/contactsRepository.js';
import { runDjangoSyncWorker } from './services/djangoSyncWorker.js';
import { processDueScheduledBatchSends } from './services/whatsappBatchTemplateService.js';
import { initSocketServer, setRealtimeEnabled } from './realtime/socketServer.js';

const app = express();
const httpServer = createServer(app);
const realtimeEnabled = String(process.env.REALTIME_ENABLED ?? '').trim().toLowerCase() === 'true';
setRealtimeEnabled(realtimeEnabled);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/webhook', webhookMetaRouter);
app.use('/api', apiRouter);

/** Health checks ALB/ECS: corpo fixo, sem dependência de banco ou auth */
app.get('/', (_req, res) => {
  res.type('text/plain').status(200).send('ok');
});
app.get('/health', (_req, res) => {
  const providerRaw = String(process.env.BACKEND_PROVIDER ?? '').trim().toLowerCase();
  const provider = providerRaw === 'aws' ? 'aws' : providerRaw === 'render' ? 'render' : 'unknown';
  const environment = String(process.env.APP_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown').trim() || 'unknown';
  const version = String(process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.0.0').trim() || '0.0.0';
  const commit = String(process.env.APP_COMMIT ?? process.env.COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? 'unknown').trim() || 'unknown';

  res.status(200).json({
    status: 'ok',
    provider,
    environment,
    version,
    commit,
  });
});

initPostgres()
  .then(async () => {
    try {
      await bootstrapFirstAdmin();
    } catch (e) {
      console.error('[startup] Falha no bootstrap do admin:', e instanceof Error ? e.stack ?? e.message : e);
    }

    try {
      const synced = await syncAllConversationOwnersFromContacts();
      if (synced > 0) {
        console.log(`[startup] Sync contacts.owner_user_id → conversations.assigned_broker_id: ${synced} conversa(ões).`);
      }
    } catch (e) {
      console.warn('[startup] Sync assigned_broker desde contacts:', e instanceof Error ? e.message : e);
    }

    try {
      const wa = await getWhatsAppConfig();
      const ai = await getOpenAIConfig();
      console.log('[startup] Config do banco:',
        `WhatsApp=${wa?.enabled ? 'ATIVO' : 'inativo'}`,
        `(token=${wa?.metaAccessToken ? 'sim' : 'não'},`,
        `phoneId=${wa?.whatsappPhoneNumberId ? 'sim' : 'não'})`,
        `| IA=${ai?.aiEnabled ? 'ATIVO' : 'inativo'}`,
        `(key=${ai?.openaiApiKey ? 'sim' : 'não'})`
      );
    } catch (e) {
      console.warn('[startup] Não foi possível ler config do banco:', e instanceof Error ? e.message : e);
    }
    if (realtimeEnabled) {
      console.log('[Realtime] enabled');
      initSocketServer(httpServer);
      console.log('[Realtime] socket server initialized');
    } else {
      console.log('[Realtime] disabled');
    }
    httpServer.listen(config.port, () => {
      console.log(`Server http://localhost:${config.port}`);
    });
    setInterval(() => {
      void processDueDeferredHandoffs().catch((err) => console.error('[handoff defer]', err));
    }, 15_000);
    setInterval(() => {
      void processAnaReengagementScan().catch((err) => console.error('[ana reengage]', err));
    }, 300_000);
    setInterval(() => {
      void processDueScheduledBatchSends().catch((err) => console.error('[whatsapp batch scheduled worker]', err));
    }, 30_000);
    setInterval(() => {
      void runDjangoSyncWorker().catch((err) => console.error('[django sync]', err));
    }, 10_000);
  })
  .catch((e) => {
    console.error('[startup]', e);
    process.exit(1);
  });
