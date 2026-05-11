import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { Router, Request, Response, NextFunction } from 'express';
import db from './db.js';

const router = Router();

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

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

router.get('/google', (_req: Request, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
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
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

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

router.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;
