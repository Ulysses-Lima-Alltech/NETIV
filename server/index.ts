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
import { processDueDeferredHandoffs } from './repositories/conversationRepository.js';
import { processAnaReengagementScan } from './services/anaReengagementService.js';
import { syncAllConversationOwnersFromContacts } from './repositories/contactsRepository.js';
import { runDjangoSyncWorker } from './services/djangoSyncWorker.js';
import { processDueScheduledBatchSends } from './services/whatsappBatchTemplateService.js';
import { initSocketServer, setRealtimeEnabled } from './realtime/socketServer.js';
import { processAnaRetryJobsTick } from './services/anaRetryWorkerService.js';
import { processAnaVisitFollowupTick } from './services/anaVisitFollowupService.js';
import {
  AUTO_WALLET_MIN_INTERVAL_MS,
  DEFAULT_AUTO_WALLET_BATCH_LIMIT,
  DEFAULT_AUTO_WALLET_INACTIVE_DAYS,
  processInactiveConversationsToWalletOnce,
} from './services/inactiveConversationWalletService.js';

const app = express();
const httpServer = createServer(app);
const realtimeEnabled = String(process.env.REALTIME_ENABLED ?? '').trim().toLowerCase() === 'true';
const anaReengagementScanIntervalMs = (() => {
  const raw = Number.parseInt(String(process.env.ANA_REENGAGEMENT_SCAN_INTERVAL_MS ?? ''), 10);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 60_000;
})();
const autoWalletInactiveEnabled = process.env.AUTO_WALLET_INACTIVE_ENABLED === 'true';
setRealtimeEnabled(realtimeEnabled);
const browserOrigins = String(process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || browserOrigins.includes(origin) || (config.nodeEnv !== 'production' && browserOrigins.length === 0)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin não autorizada.'));
  },
}));
app.use(express.json({
  limit: '10mb',
  verify(req, _res, buffer) {
    (req as express.Request).rawBody = Buffer.from(buffer);
  },
}));
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

initPostgres({ applyMigrations: config.nodeEnv !== 'production' })
  .then(async () => {
    try {
      const synced = await syncAllConversationOwnersFromContacts();
      if (synced > 0) {
        console.log(`[startup] Legacy contact owner sync ignored: ${synced} conversa(oes).`);
      }
    } catch (e) {
      console.warn('[startup] Legacy contact owner sync check failed:', e instanceof Error ? e.message : e);
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
    if (autoWalletInactiveEnabled) {
      const inactiveWalletIntervalMs = Math.max(
        AUTO_WALLET_MIN_INTERVAL_MS,
        parseInt(String(process.env.AUTO_WALLET_INACTIVE_INTERVAL_MS ?? ''), 10) || AUTO_WALLET_MIN_INTERVAL_MS
      );
      const inactiveWalletBatchLimit =
        parseInt(String(process.env.AUTO_WALLET_INACTIVE_BATCH_LIMIT ?? ''), 10) || DEFAULT_AUTO_WALLET_BATCH_LIMIT;
      const inactiveWalletDays =
        parseInt(String(process.env.AUTO_WALLET_INACTIVE_DAYS ?? ''), 10) || DEFAULT_AUTO_WALLET_INACTIVE_DAYS;
      console.log('[AUTO_WALLET_INACTIVE] enabled', {
        inactiveDays: inactiveWalletDays,
        batchLimit: inactiveWalletBatchLimit,
        intervalMs: inactiveWalletIntervalMs,
      });
      const runInactiveWalletJob = () => {
        void processInactiveConversationsToWalletOnce({
          inactiveDays: inactiveWalletDays,
          batchLimit: inactiveWalletBatchLimit,
        }).catch((err) => console.error('[auto wallet inactive]', err));
      };
      setTimeout(runInactiveWalletJob, 60_000);
      setInterval(runInactiveWalletJob, inactiveWalletIntervalMs);
    } else {
      console.log('[AUTO_WALLET_INACTIVE] disabled', {
        AUTO_WALLET_INACTIVE_ENABLED: process.env.AUTO_WALLET_INACTIVE_ENABLED ?? '(unset)',
      });
    }
    setInterval(() => {
      void processDueDeferredHandoffs().catch((err) => console.error('[handoff defer]', err));
    }, 60 * 60 * 1000);
    setInterval(() => {
      void processAnaReengagementScan().catch((err) => console.error('[ana reengage]', err));
    }, anaReengagementScanIntervalMs);
    setInterval(() => {
      void processDueScheduledBatchSends().catch((err) => console.error('[whatsapp batch scheduled worker]', err));
    }, 30_000);
    setInterval(() => {
      void runDjangoSyncWorker().catch((err) => console.error('[django sync]', err));
    }, 10_000);
    setInterval(() => {
      void processAnaRetryJobsTick().catch((err) => console.error('[ana retry worker]', err));
    }, 5_000);
    setInterval(() => {
      void processAnaVisitFollowupTick().catch((err) => console.error('[ana visit followup worker]', err));
    }, 15_000);
  })
  .catch((e) => {
    console.error('[startup]', e);
    process.exit(1);
  });




