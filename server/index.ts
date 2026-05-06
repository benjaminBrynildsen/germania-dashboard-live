import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './auth.js';
import apiRouter from './routes.js';
import anomalyRouter from './anomaly-routes.js';
import driposRouter from './dripos-routes.js';
import { startReviewSync } from './places.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 1930;

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api', apiRouter);
app.use('/api', anomalyRouter);
app.use('/api', driposRouter);

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Germania Dashboard API running on http://localhost:${PORT}`);
  startReviewSync();

  // Daily Dripos sales sync — runs once on boot (after a short delay so the
  // network/DB has fully settled) and then every 6h. Keeps `sales_daily`
  // (used by the SalesAnomaly tab) and the weekly-metrics cache (used by
  // /api/locations) fresh without anyone clicking anything.
  const driposSyncOnce = async () => {
    try {
      const { syncDailySales, NoToken, AuthExpired } = await import('./dripos.js');
      const summary = await syncDailySales(30);
      console.log(`[DriposSync] synced ${summary.rowsWritten} rows for ${summary.startDate}..${summary.endDate}, errors=${summary.errors.length}`);
    } catch (err: unknown) {
      const isAuthIssue =
        err instanceof Error &&
        (err.name === 'NoToken' || err.name === 'AuthExpired');
      if (isAuthIssue) {
        console.log('[DriposSync] no valid token — skipping (user can log in via Weekly Sales tab)');
      } else {
        console.error('[DriposSync] failed:', err);
      }
    }
  };
  setTimeout(driposSyncOnce, 10_000);
  setInterval(driposSyncOnce, 6 * 60 * 60 * 1000);
});
