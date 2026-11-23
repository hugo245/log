'use strict';
// Outgoing email. Uses whichever is configured, in this order:
//   RESEND_API_KEY                      -> Resend HTTP API (no extra packages)
//   POSTMARK_SERVER_TOKEN               -> Postmark HTTP API (no extra packages)
//   SMTP_HOST (+ SMTP_PORT/USER/PASS)   -> any SMTP server (needs the nodemailer package)
// EMAIL_FROM is the sender, e.g. "Acme Panel <panel@acme.gg>". Without a provider, email is
// simply off and everything else (in-app notifications) keeps working.

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { }

let smtpTransport = null;

function provider() {
    if (process.env.RESEND_API_KEY) return 'resend';
    if (process.env.POSTMARK_SERVER_TOKEN) return 'postmark';
    if (process.env.SMTP_HOST && nodemailer) return 'smtp';
    return null;
}

function configured() { return !!(provider() && process.env.EMAIL_FROM); }

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A plain, readable email: heading, text, optional button. No tracking, no images.
function layout({ studioName, title, text, link, linkLabel, accent }) {
    const color = /^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : '#111216';
    const paragraphs = String(text || '').split(/\n+/).map(p => `<p style="margin:0 0 12px;line-height:1.55;color:#3c3f46;">${escapeHtml(p)}</p>`).join('');
    return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Inter,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e7e7ea;border-radius:14px;">
<tr><td style="padding:28px 28px 8px;font-size:13px;font-weight:600;color:#8a8d96;">${escapeHtml(studioName)}</td></tr>
<tr><td style="padding:0 28px 8px;"><h1 style="margin:0 0 14px;font-size:19px;color:#111216;">${escapeHtml(title)}</h1>${paragraphs}</td></tr>
${link ? `<tr><td style="padding:4px 28px 28px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px;">${escapeHtml(linkLabel || 'Open')}</a></td></tr>` : '<tr><td style="padding:0 0 16px;"></td></tr>'}
</table>
<p style="font-size:12px;color:#8a8d96;margin:16px 0 0;">You can turn these emails off in My payments.</p>
</td></tr></table></body></html>`;
}

async function send({ to, subject, text, html }) {
    const p = provider();
    const from = process.env.EMAIL_FROM;
    if (!p || !from || !to) return { sent: false, reason: 'not_configured' };
    try {
        if (p === 'resend') {
            const r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, to: [to], subject, text, html })
            });
            if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
            return { sent: true };
        }
        if (p === 'postmark') {
            const r = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST',
                headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: 'outbound' })
            });
            if (!r.ok) return { sent: false, reason: `postmark_${r.status}` };
            return { sent: true };
        }
        if (!smtpTransport) {
            smtpTransport = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: Number(process.env.SMTP_PORT) === 465,
                auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
            });
        }
        await smtpTransport.sendMail({ from, to, subject, text, html });
        return { sent: true };
    } catch (e) {
        return { sent: false, reason: 'error', message: e.message };
    }
}

module.exports = { configured, provider, send, layout, escapeHtml };
