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
const TIMESTAMP_VALUE_RE =
  /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}/; // Sheets' default Timestamp format

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

/**
 * Pick a column whose VALUES look like a given type — used as a fallback when
 * header regex matching is too narrow / too greedy. Samples up to 5 rows.
 */
function pickByValue(
  rows: string[][],
  predicate: (v: string) => boolean,
): number {
  if (rows.length === 0) return -1;
  const sample = rows.slice(0, 5);
  const width = Math.max(...sample.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    const hits = sample.filter((r) => {
      const v = String(r[c] ?? '').trim();
      return v && predicate(v);
    }).length;
    if (hits >= Math.min(2, sample.length)) return c;
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
  const valueRows = rows.slice(1) as string[][];

  // Timestamp — narrow header match (only the literal Google Forms default)
  // with a value-based fallback so we don't accidentally grab the resume
  // column when its header has the word "submit" in it.
  let tsIdx = pickHeader(headers, [/^timestamp$/i]);
  if (tsIdx < 0) {
    tsIdx = pickByValue(valueRows, (v) => TIMESTAMP_VALUE_RE.test(v));
  }

  // Name — try a single full-name column first, fall back to combining
  // separate First Name + Last Name columns (Google Forms default).
  const fullNameIdx = pickHeader(headers, [
    /^name$/i, /^full name$/i, /^your (full )?name$/i,
  ]);
  const firstNameIdx = pickHeader(headers, [/^first[\s_-]?name$/i, /\bfirst name\b/i]);
  const lastNameIdx = pickHeader(headers, [/^last[\s_-]?name$/i, /\blast name\b/i]);

  const emailIdx = pickHeader(headers, [/e-?mail/i]);
  const phoneIdx = pickHeader(headers, [/phone/i, /mobile/i, /cell/i]);

  // Resume — header match preferred, otherwise pick the column whose values
  // are Drive URLs (Google Forms file-upload questions always store them).
  let resumeIdx = pickHeader(headers, [/resume/i, /\bcv\b/i]);
  if (resumeIdx < 0) {
    resumeIdx = pickByValue(valueRows, (v) => DRIVE_FILE_RE.test(v));
  }

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
    // Guard against a non-timestamp value sneaking through (e.g. a URL).
    const submittedAt = ts && !/^https?:\/\//i.test(ts) ? ts : null;

    let name: string | null = null;
    if (fullNameIdx >= 0) {
      name = String(row[fullNameIdx] ?? '').trim() || null;
    } else {
      const first = firstNameIdx >= 0 ? String(row[firstNameIdx] ?? '').trim() : '';
      const last = lastNameIdx >= 0 ? String(row[lastNameIdx] ?? '').trim() : '';
      const combined = `${first} ${last}`.trim();
      name = combined || null;
    }

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
