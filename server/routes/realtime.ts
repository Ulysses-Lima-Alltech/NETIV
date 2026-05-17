import { Router } from 'express';
import { getSocketPath, isRealtimeEnabled } from '../realtime/socketServer.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    enabled: isRealtimeEnabled(),
    socketPath: getSocketPath(),
  });
});

export default router;
