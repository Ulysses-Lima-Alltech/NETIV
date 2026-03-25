import 'dotenv/config';
import './express-augmentation.js';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import webhookMetaRouter from './routes/webhookMeta.js';
import { initPostgres } from './db/pg.js';
import { getWhatsAppConfig } from './repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from './repositories/openaiConfigRepository.js';
import { bootstrapFirstAdmin } from './bootstrap/adminBootstrap.js';
import { processDueDeferredHandoffs } from './repositories/conversationRepository.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use('/webhook', webhookMetaRouter);
app.use('/api', apiRouter);

app.get('/health', async (_req, res) => {
  try {
    const wa = await getWhatsAppConfig();
    const ai = await getOpenAIConfig();
    res.json({
      status: 'ok',
      whatsapp: { enabled: !!wa?.enabled, hasToken: !!wa?.metaAccessToken?.trim() },
      ai: { enabled: !!ai?.aiEnabled, hasKey: !!ai?.openaiApiKey?.trim() },
    });
  } catch {
    res.json({ status: 'ok' });
  }
});

initPostgres()
  .then(async () => {
    try {
      await bootstrapFirstAdmin();
    } catch (e) {
      console.error('[startup] Falha no bootstrap do admin:', e instanceof Error ? e.stack ?? e.message : e);
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
    app.listen(config.port, () => {
      console.log(`Server http://localhost:${config.port}`);
    });
    setInterval(() => {
      void processDueDeferredHandoffs().catch((err) => console.error('[handoff defer]', err));
    }, 15_000);
  })
  .catch((e) => {
    console.error('[startup]', e);
    process.exit(1);
  });
