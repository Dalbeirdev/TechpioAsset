/**
 * Branded HTML email layout (v2.18). One renderer for every outgoing
 * notification: PioAssets wordmark header, optional status badge, intro copy,
 * a key-value card, CTA button, footer. Table-based with inline styles so it
 * renders in Outlook and Gmail alike; plain-text remains the sibling body on
 * every message, composed by the caller.
 */

export interface EmailBadge {
  label: string;
  /** informational | success | warning | critical */
  tone: 'info' | 'success' | 'warning' | 'critical';
}

export interface BrandedEmailInput {
  heading: string;
  /** Short sentences; rendered as paragraphs. */
  paragraphs: string[];
  badge?: EmailBadge;
  /** Key-value rows rendered as an information card. */
  rows?: [string, string][];
  cta?: { label: string; url: string };
  companyName: string;
  /** Absolute product URL for the footer link. */
  productUrl: string;
  footerNote?: string;
  /**
   * The header logo, when the sender is also attaching it as an inline part
   * with this cid. Omitted, the header falls back to a styled text wordmark.
   */
  logo?: EmailLogo;
}

export interface EmailLogo {
  cid: string;
  width: number;
  height: number;
}

const TONES: Record<EmailBadge['tone'], { bg: string; fg: string }> = {
  info: { bg: '#dbeafe', fg: '#1d4ed8' },
  success: { bg: '#dcfce7', fg: '#15803d' },
  warning: { bg: '#fef3c7', fg: '#b45309' },
  critical: { bg: '#fee2e2', fg: '#b91c1c' },
};

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The wordmark, on the white header band the artwork is drawn for.
 *
 * The image is addressed by Content-ID, not by URL. Outlook and Gmail refuse to
 * fetch a remote image from a sender the reader has not trusted, so a linked
 * logo arrives as a broken box; a part carried inside the message is not a
 * fetch, so it renders. The caller supplies the cid and attaches the matching
 * part - when it does not, the styled text is the header, which is also what a
 * reader sees if their client blocks inline images too.
 */
function brandHeader(productUrl: string, logo?: EmailLogo): string {
  const base = /^https?:\/\//i.test(productUrl) ? productUrl.replace(/\/+$/, '') : null;
  const inner = logo
    ? `<img src="cid:${esc(logo.cid)}" alt="PioAssets" width="${logo.width}" height="${logo.height}" style="display:block;border:0;outline:none;width:${logo.width}px;height:${logo.height}px;font-size:20px;font-weight:800;color:#001858;letter-spacing:-.01em;text-decoration:none;"/>`
    : '<span style="font-size:20px;font-weight:800;color:#001858;letter-spacing:-.01em;">Pio<span style="color:#0038a8;">Assets</span></span>';
  return base ? `<a href="${esc(base)}" style="text-decoration:none;">${inner}</a>` : inner;
}

/**
 * The footer's product link. A misconfigured WEB_URL used to render an anchor
 * with an empty href - a link that looks clickable and goes nowhere - so the
 * name is plain text unless there is somewhere real to send the reader.
 */
function productLink(productUrl: string): string {
  const name = '<strong style="font-weight:600;">PioAssets</strong>';
  return /^https?:\/\//i.test(productUrl)
    ? `<a href="${esc(productUrl.replace(/\/+$/, ''))}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">PioAssets</a>`
    : name;
}

export function renderBrandedEmail(input: BrandedEmailInput): string {
  const badge = input.badge
    ? `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${TONES[input.badge.tone].bg};color:${TONES[input.badge.tone].fg};font-size:12px;font-weight:700;letter-spacing:.02em;">${esc(input.badge.label)}</span>`
    : '';

  const rows = input.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden;">
        ${input.rows
          .map(
            ([k, v], i) => `<tr style="background:${i % 2 ? '#f8fafc' : '#ffffff'};">
          <td style="padding:10px 16px;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top;">${esc(k)}</td>
          <td style="padding:10px 16px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(v)}</td>
        </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:999px;background:#1d4ed8;">
        <a href="${esc(input.cta.url)}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:999px;">${esc(input.cta.label)}</a>
      </td></tr></table>`
    : '';

  const paragraphs = input.paragraphs
    .map((par) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#334155;">${esc(par)}</p>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#ffffff;padding:20px 28px 16px;border-bottom:1px solid #e2e8f0;">
          ${brandHeader(input.productUrl, input.logo)}
        </td></tr>
        <tr><td style="padding:28px;">
          ${badge ? `${badge}<div style="height:12px;"></div>` : ''}
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;color:#0f172a;letter-spacing:-.01em;">${esc(input.heading)}</h1>
          ${paragraphs}
          ${rows}
          ${cta}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
            ${esc(input.footerNote ?? 'You are receiving this because of your role in PioAssets. Manage your notification preferences in the app.')}<br/>
            ${productLink(input.productUrl)} · ${esc(input.companyName)} · IT Asset Management
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** {{namespace.key}} interpolation; unknown variables render as an em dash. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '—');
}
