import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import webhookMetaRouter from './routes/webhookMeta.js';
import { getDb } from './db/index.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use('/webhook', webhookMetaRouter);
app.use('/api', apiRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

getDb();

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
