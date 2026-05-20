import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { Router, Request, Response, NextFunction } from 'express';
import db from './db.js';

const router = Router();

/**
 * Build an OAuth2 client whose redirect_uri matches the host the user is
 * actually on. Without this, a sign-in started at
 *   https://dashboard.germaniabrewhaus.com/...
 * would bounce back to
 *   https://germania-dashboard.onrender.com/...
 * (whatever GOOGLE_REDIRECT_URI was hardcoded to) — and the post-callback
 * res.redirect('/') would land the user on the wrong host.
 *
 * The env var GOOGLE_REDIRECT_URI is still honored as a fallback for local
 * dev where x-forwarded-host isn't set.
 */
function buildOAuthClient(req: Request): OAuth2Client {
  const fwdProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const fwdHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const proto = fwdProto || req.protocol || 'https';
  const host = fwdHost || req.get('host');
  const redirectUri = host
    ? `${proto}://${host}/api/auth/google/callback`
    : process.env.GOOGLE_REDIRECT_URI;
  console.log('[oauth]', req.path, 'redirect_uri =', redirectUri, {
    host: req.get('host'),
    xfHost: req.headers['x-forwarded-host'],
    xfProto: req.headers['x-forwarded-proto'],
  });
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/drive.file',
  // Read the applicants response sheet (and any future sheets). Narrow
  // alternative to drive.readonly — only Sheets, read-only.
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  // Read the resume uploads attached to Google Form responses. drive.file
  // (above) only grants access to files THIS APP created; form uploads
  // live in the form owner's Drive, so we need a broader read scope to
  // stream them back through /api/applicants/resume/:fileId.
  'https://www.googleapis.com/auth/drive.readonly',
];

export interface AuthRequest extends Request {
  user?: { id: number; email: string; name: string; role: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

router.get('/google', (req: Request, res: Response) => {
  const client = buildOAuthClient(req);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    hd: process.env.ALLOWED_DOMAIN,
  });
  res.redirect(url);
});

router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const client = buildOAuthClient(req);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2Client = client; // keep var name below working

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;

    const allowedDomain = process.env.ALLOWED_DOMAIN || 'germaniabrewhaus.com';
    const emailDomain = (payload.email || '').split('@')[1]?.toLowerCase();
    if (payload.hd !== allowedDomain && emailDomain !== allowedDomain) {
      res.redirect(`/login?denied=${encodeURIComponent(payload.email || 'unknown')}`);
      return;
    }

    const stmt = db.prepare(`
      INSERT INTO users (email, name, picture, google_access_token, google_refresh_token)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        picture = excluded.picture,
        google_access_token = excluded.google_access_token,
        google_refresh_token = COALESCE(excluded.google_refresh_token, users.google_refresh_token)
    `);
    stmt.run(payload.email, payload.name, payload.picture, tokens.access_token, tokens.refresh_token);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(payload.email) as any;

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).send('Authentication failed');
  }
});

// Dev login — bypasses Google OAuth. Disabled in production so the
// dashboard.dripos data + admin role can't be claimed by anyone hitting the
// public URL.
router.post('/dev-login', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const { name, email } = req.body;
  const devEmail = email || 'dev@germaniabrewhaus.com';
  const devName = name || 'Dev User';

  const stmt = db.prepare(`
    INSERT INTO users (email, name, role)
    VALUES (?, ?, 'admin')
    ON CONFLICT(email) DO UPDATE SET name = excluded.name
  `);
  stmt.run(devEmail, devName);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(devEmail) as any;

  const jwtToken = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  res.cookie('token', jwtToken, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  // Lazy-import the bake-haus allowlist helper so /me stays cheap and
  // a failing import (older deploy) doesn't take auth offline.
  let canUnlockBakeHaus = false;
  try {
    const mod = await import('./bake-haus.js');
    canUnlockBakeHaus = mod.isUserAllowedToUnlock(req.user?.email ?? null);
  } catch { /* non-fatal — falls back to false */ }
  res.json({
    user: req.user,
    permissions: {
      canUnlockBakeHaus,
    },
  });
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;
