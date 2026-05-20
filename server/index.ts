import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './auth.js';
import apiRouter from './routes.js';
import anomalyRouter from './anomaly-routes.js';
import driposRouter from './dripos-routes.js';
import applicantsRouter from './applicants-routes.js';
import bakeHausRouter from './bake-haus-routes.js';
import patronsRouter from './patrons-routes.js';
import holidayRouter from './holiday-routes.js';
import { seedHolidaysForYear } from './holidays.js';
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
app.use('/api', applicantsRouter);
app.use('/api', bakeHausRouter);
app.use('/api', patronsRouter);
app.use('/api', holidayRouter);

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

  // Holiday calendar — seed Germania-observed holidays for a 4-year
  // window (prev-2 through next year). Past years are essential so the
  // detail-modal historical-sales lookup has something to match on;
  // future year keeps the page populated when managers preview the
  // upcoming season. Idempotent via the unique (date, name) index.
  try {
    const yr = new Date().getFullYear();
    for (const y of [yr - 2, yr - 1, yr, yr + 1]) {
      const { inserted, skipped } = seedHolidaysForYear(y);
      if (inserted > 0) console.log(`[HolidaySeed] ${y}: inserted ${inserted}, skipped ${skipped}`);
    }
  } catch (err) {
    console.warn('[HolidaySeed] failed:', err instanceof Error ? err.message : err);
  }

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

  // Pre-warm the Hours Watch cache so the cold 52-wk pull happens out of
  // band of any user request. Past weeks cache forever, so this is mostly
  // a one-time hit after a fresh deploy; subsequent boots short-circuit
  // every cached cell instantly. Fires 30s after boot to let the Dripos
  // token + daily-sync settle first.
  setTimeout(async () => {
    try {
      const { prewarmEmployeeHours } = await import('./dripos.js');
      prewarmEmployeeHours();
    } catch (err) {
      console.warn('[boot] hours prewarm import failed:', err);
    }
  }, 30_000);

  // Patron sync — pulls ~50k patrons from /patrons/dumb/v2 on boot,
  // then every 6 hours. Boot delay matches the hours prewarm so we're
  // not slamming Dripos with parallel cold pulls.
  const patronSyncOnce = async () => {
    try {
      const { prewarmPatronsSync } = await import('./patrons.js');
      await prewarmPatronsSync();
    } catch (err) {
      console.warn('[patrons-sync] import or run failed:', err);
    }
  };
  setTimeout(patronSyncOnce, 60_000);
  setInterval(patronSyncOnce, 6 * 60 * 60 * 1000);

  // Bake Haus auto-lock — fires Monday 23:59 America/Chicago to freeze
  // the week's Mon/Wed/Fri delivery quantities. Chef Maggie can still
  // press the manual "Lock this week" button earlier in the day; this
  // is the fallback so no one has to remember. Runs every minute so a
  // server restart during the lock window still catches up.
  const autoLockTick = async () => {
    try {
      const { mondayOfWeek, isWeekLocked, lockWeek } = await import('./bake-haus.js');
      const now = new Date();
      // Format current time in America/Chicago to a Date that JS can
      // compare on year/month/day/hour/minute. Intl is the cleanest
      // way to do tz arithmetic without pulling in a dep.
      const tz = process.env.BAKE_HAUS_AUTO_LOCK_TZ || 'America/Chicago';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
      const weekday = get('weekday'); // 'Mon', 'Tue', etc.
      const hour = parseInt(get('hour'), 10);
      const minute = parseInt(get('minute'), 10);
      const targetHour = Number(process.env.BAKE_HAUS_AUTO_LOCK_HOUR ?? 23);
      const targetMinute = Number(process.env.BAKE_HAUS_AUTO_LOCK_MINUTE ?? 59);
      // Fire only on Mondays in the same minute as the configured
      // target time (drift-tolerant: a missed minute will be caught
      // by the next Mon-23:59 because the lock is idempotent and the
      // isWeekLocked check skips re-runs in the same window).
      if (weekday !== 'Mon') return;
      if (hour !== targetHour || minute !== targetMinute) return;
      const week = mondayOfWeek();
      if (isWeekLocked(week)) return;
      console.log(`[BakeHausAutoLock] firing for week ${week}`);
      const result = await lockWeek(week, 'auto-lock (Mon 23:59 CT)', 'auto', null);
      console.log(`[BakeHausAutoLock] locked ${result.rowsSnapshotted} rows (mode=${result.mode})`);
    } catch (err) {
      console.warn('[BakeHausAutoLock] tick failed:', err instanceof Error ? err.message : err);
    }
  };
  setInterval(autoLockTick, 60_000);
});
