import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import db from './db.js';

const SHEET_ID =
  process.env.APPLICANTS_SHEET_ID ||
  '1_ieWmlz-QN_yl2FxleeM_k9W6txGk7QwMpupQvpt8Lk';
// `gid` is the tab id in the URL; `range` is the A1 reference Sheets API wants.
// We fetch the whole sheet ("Sheet1" by default) and rely on the first row as
// headers. Caller can override via APPLICANTS_SHEET_RANGE.
const SHEET_RANGE = process.env.APPLICANTS_SHEET_RANGE || 'A:ZZ';

function getAuthClient(userId: number): OAuth2Client {
  const user = db
    .prepare('SELECT google_access_token, google_refresh_token FROM users WHERE id = ?')
    .get(userId) as { google_access_token?: string; google_refresh_token?: string };
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2Client.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare('UPDATE users SET google_access_token = ? WHERE id = ?').run(
        tokens.access_token,
        userId,
      );
    }
  });
  return oauth2Client;
}

export interface Applicant {
  /** Stable id derived from the row (timestamp + email if both exist). */
  id: string;
  /** Original row index in the sheet (1-based, after the header). */
  row: number;
  /** First non-empty value among Timestamp-like headers, ISO if parseable. */
  submittedAt: string | null;
  /** Best-guess name field. */
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Drive file id parsed from a "resume" question's response, if present. */
  resumeFileId: string | null;
  /** Original Drive URL (so we can fall back to opening in Drive). */
  resumeUrl: string | null;
  /** All columns from the sheet — keys are the header strings as-is. */
  fields: Record<string, string>;
}

interface ApplicantsResponse {
  sheetId: string;
  sheetTitle: string | null;
  headers: string[];
  applicants: Applicant[];
}

const DRIVE_FILE_RE = /https?:\/\/(?:drive\.google\.com|docs\.google\.com)\/[^\s,]+/i;
const DRIVE_FILE_ID_RE = /\/d\/([a-zA-Z0-9_-]{20,})|[?&]id=([a-zA-Z0-9_-]{20,})/;

function parseDriveFileId(s: string): string | null {
  const m = s.match(DRIVE_FILE_ID_RE);
  return m ? m[1] ?? m[2] ?? null : null;
}

function pickHeader(headers: string[], patterns: RegExp[]): number {
  for (const pat of patterns) {
    const i = headers.findIndex((h) => pat.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export async function fetchApplicants(userId: number): Promise<ApplicantsResponse> {
  const auth = getAuthClient(userId);
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    includeGridData: false,
  });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title ?? null;
  const targetRange = sheetTitle ? `${sheetTitle}!${SHEET_RANGE}` : SHEET_RANGE;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: targetRange,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 1) {
    return { sheetId: SHEET_ID, sheetTitle, headers: [], applicants: [] };
  }

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const tsIdx = pickHeader(headers, [/^timestamp$/i, /submit/i, /date/i]);
  const nameIdx = pickHeader(headers, [/^name$/i, /full name/i, /first.*last/i, /your name/i]);
  const emailIdx = pickHeader(headers, [/email/i]);
  const phoneIdx = pickHeader(headers, [/phone/i, /mobile/i, /cell/i]);
  const resumeIdx = pickHeader(headers, [/resume/i, /cv/i, /upload/i]);

  const applicants: Applicant[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !String(c ?? '').trim())) continue;

    const fields: Record<string, string> = {};
    headers.forEach((h, i) => {
      fields[h] = String(row[i] ?? '').trim();
    });

    const resumeRaw = resumeIdx >= 0 ? String(row[resumeIdx] ?? '') : '';
    const resumeUrlMatch = resumeRaw.match(DRIVE_FILE_RE);
    const resumeUrl = resumeUrlMatch ? resumeUrlMatch[0] : null;
    const resumeFileId = resumeUrl ? parseDriveFileId(resumeUrl) : null;

    const ts = tsIdx >= 0 ? String(row[tsIdx] ?? '').trim() : '';
    const submittedAt = ts || null;
    const name = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() || null : null;
    const email = emailIdx >= 0 ? String(row[emailIdx] ?? '').trim() || null : null;
    const phone = phoneIdx >= 0 ? String(row[phoneIdx] ?? '').trim() || null : null;

    applicants.push({
      id: `${r}-${email ?? 'no-email'}`,
      row: r,
      submittedAt,
      name,
      email,
      phone,
      resumeFileId,
      resumeUrl,
      fields,
    });
  }

  // Newest first by row order (Google Forms appends).
  applicants.reverse();
  return { sheetId: SHEET_ID, sheetTitle, headers, applicants };
}

/**
 * Stream a resume file's content from Drive back through the dashboard.
 * Drive's webContentLink requires a Google session; piping it through here
 * means the user only needs to be authenticated to OUR app to view it.
 */
export async function streamResume(
  userId: number,
  fileId: string,
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; name: string }> {
  const auth = getAuthClient(userId);
  const drive = google.drive({ version: 'v3', auth });

  const meta = await drive.files.get({
    fileId,
    fields: 'name,mimeType',
  });
  const mimeType = meta.data.mimeType ?? 'application/octet-stream';
  const name = meta.data.name ?? 'resume';

  // Google Docs need to be exported; raw files can be downloaded directly.
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    const exportMime =
      mimeType === 'application/vnd.google-apps.document'
        ? 'application/pdf'
        : 'application/pdf';
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'stream' },
    );
    return { stream: res.data as NodeJS.ReadableStream, mimeType: exportMime, name: `${name}.pdf` };
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );
  return { stream: res.data as NodeJS.ReadableStream, mimeType, name };
}
