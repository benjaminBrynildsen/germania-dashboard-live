import nodemailer from 'nodemailer';
import db from './db.js';

// Outbound email for dashboard notifications, starting with Bake Haus order
// submissions. Gmail Workspace SMTP with a pooled transport — pooling matters:
// per-message logins trip Gmail's 454-4.7.0 lockout (learned the hard way on
// the Theodore/Wilhelm blasts).
//
// Config is all env (set in Render), and everything degrades to a console
// log when unconfigured so the feature is inert until credentials exist:
//   GMAIL_USER              sender account (Workspace address)
//   GMAIL_APP_PASSWORD      app password for that account
//   BAKE_HAUS_ORDER_EMAILS  comma-separated recipients for order submissions

let transporter: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 2,
      auth: { user, pass },
    });
  }
  return transporter;
}

function orderRecipients(): string[] {
  return (process.env.BAKE_HAUS_ORDER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Notify the bakery when a store submits (or re-submits) its weekly order.
 * Fire-and-forget: callers must not await this on the request path — a slow
 * or failing SMTP hop should never block the Save button.
 */
export async function sendBakeHausOrderEmail(opts: {
  week: string;          // Monday YYYY-MM-DD
  store: string;         // G1..G4 label
  savedBy: string | null;
  isUpdate: boolean;     // re-save of an already-submitted (week, store)
}): Promise<void> {
  const recipients = orderRecipients();
  const transport = getTransport();
  if (!transport || recipients.length === 0) {
    console.log(`[bake-haus-email] skipped (not configured): ${opts.store} week ${opts.week}`);
    return;
  }

  const rows = db.prepare(`
    SELECT item_name, weekly_qty, notes FROM bake_haus_orders
    WHERE week_start_iso = ? AND store_label = ? AND weekly_qty > 0
    ORDER BY item_name
  `).all(opts.week, opts.store) as Array<{ item_name: string; weekly_qty: number; notes: string | null }>;

  const weekLabel = new Date(`${opts.week}T12:00:00`)
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
  const verb = opts.isUpdate ? 'updated' : 'submitted';
  const subject = `Bake Haus order ${verb} — ${opts.store}, week of ${weekLabel}`;

  const itemRows = rows.length
    ? rows.map((r) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${esc(r.item_name)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${r.weekly_qty}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#666;">${esc(r.notes ?? '')}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;color:#999;">No items with quantities.</td></tr>';

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;">
      <h2 style="margin:0 0 4px;">${esc(opts.store)} ${verb} their Bake Haus order</h2>
      <p style="margin:0 0 16px;color:#555;">
        Week of ${esc(weekLabel)}${opts.savedBy ? ` · saved by ${esc(opts.savedBy)}` : ''}
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase;">
            <th style="padding:6px 12px;">Item</th>
            <th style="padding:6px 12px;text-align:right;">Weekly qty</th>
            <th style="padding:6px 12px;">Notes</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#999;">
        Sent automatically by the Germania dashboard when a store hits Save on the Bake Haus tab.
      </p>
    </div>`;

  await transport.sendMail({
    from: `Germania Dashboard <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html,
  });
  console.log(`[bake-haus-email] sent: ${subject} -> ${recipients.join(', ')}`);
}
