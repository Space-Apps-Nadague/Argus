/**
 * ARGUS — Family email from the Photobooth (specs/05-data-platform.md §6 "Family email")
 *
 * A photo sent home is emailed to the family members' addresses after the live one-way light
 * time (e.g. ~11 min from Mars), so it arrives on Earth when a real downlink would.
 *
 * Transport:
 *  - SMTP from .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM): real delivery.
 *    Works with any mail account, e.g. a team Gmail with an app password, Brevo or Outlook.
 *  - MAIL_TEST=ethereal (opt-in, for demos): an Ethereal test mailbox (https://ethereal.email).
 *    Nothing reaches the family, but every email gets a link showing exactly what they would get.
 *  - Neither: nothing is sent and the photo shows "Email is not set up on the ARGUS server yet".
 *
 * The queue lives in memory: a server restart drops emails still waiting for their light time.
 */

import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';

export interface FamilyRecipient {
  name: string;
  email: string;
}

export interface FamilyEmailJob {
  id: string;
  /** Who queued it (user id), so only they can read its status. */
  owner: string;
  crewId: string;
  callsign: string;
  place: string;
  to: FamilyRecipient[];
  message: string;
  /** JPEG bytes, base64 (no data: prefix). */
  imageBase64: string;
  sendAt: number;
}

export interface FamilyEmailStatus {
  id: string;
  status: 'scheduled' | 'sent' | 'failed';
  sendAtIso: string;
  /** smtp: real delivery. test: Ethereal preview only. */
  mode?: 'smtp' | 'test';
  previewUrl?: string;
  error?: string;
}

export interface MailTransport {
  mode: 'smtp' | 'test';
  from: string;
  send(mail: SendMailOptions): Promise<{ previewUrl?: string }>;
}

/** No SMTP settings and no MAIL_TEST: the server has nowhere to send email. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('Email is not set up on the ARGUS server yet (SMTP settings in .env).');
    this.name = 'MailNotConfiguredError';
  }
}

let transport: Promise<MailTransport> | null = null;

/** SMTP when configured; an Ethereal test account only when MAIL_TEST=ethereal (cached). */
export function getTransport(env: NodeJS.ProcessEnv = process.env): Promise<MailTransport> {
  if (!transport) {
    transport = (async (): Promise<MailTransport> => {
      if (env.SMTP_HOST) {
        const port = Number(env.SMTP_PORT ?? 587);
        const t = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port,
          secure: port === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
        });
        return {
          mode: 'smtp',
          from: env.MAIL_FROM ?? env.SMTP_USER ?? 'ARGUS <no-reply@argus.local>',
          send: async (m) => {
            await t.sendMail(m);
            return {};
          },
        };
      }
      if (env.MAIL_TEST !== 'ethereal') throw new MailNotConfiguredError();
      const account = await nodemailer.createTestAccount();
      const t = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
      return {
        mode: 'test',
        from: `ARGUS Family Mail <${account.user}>`,
        send: async (m) => {
          const info = await t.sendMail(m);
          return { previewUrl: nodemailer.getTestMessageUrl(info) || undefined };
        },
      };
    })();
    transport.catch(() => {
      transport = null;
    });
  }
  return transport;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The email the family receives: the photo inline, the message and where it came from. */
export function buildFamilyEmail(job: FamilyEmailJob, from: string): SendMailOptions {
  const names = job.to.map((r) => r.name).join(' & ');
  const subject = `A photo from ${job.callsign} in ${job.place}`;
  const msg = job.message.trim();
  const text = [
    `Hi ${names},`,
    '',
    `${job.callsign} sent you a photo from ${job.place}.`,
    msg ? `"${msg}"` : '',
    '',
    'Sent with ARGUS Family Mail. It travelled at the speed of light to reach you.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e6f7ff">
<div style="max-width:640px;margin:0 auto;padding:24px">
  <p style="font-size:13px;letter-spacing:2px;color:#4dd0ff;margin:0 0 8px">ARGUS FAMILY MAIL</p>
  <h1 style="font-size:22px;margin:0 0 16px;color:#ffffff">Hi ${escapeHtml(names)},</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(job.callsign)} sent you a photo from <strong>${escapeHtml(job.place)}</strong>.</p>
  ${msg ? `<p style="font-size:17px;font-style:italic;margin:0 0 16px;color:#ffffff">&ldquo;${escapeHtml(msg)}&rdquo;</p>` : ''}
  <img src="cid:argus-photo" alt="Photo from ${escapeHtml(job.callsign)}" style="width:100%;border-radius:12px;display:block" />
  <p style="font-size:12px;color:#8aa0b8;margin:16px 0 0">It travelled at the speed of light to reach you.</p>
</div></body></html>`;
  return {
    from,
    to: job.to.map((r) => ({ name: r.name, address: r.email })),
    subject,
    text,
    html,
    attachments: [{ filename: `argus-${job.callsign.toLowerCase()}.jpg`, content: Buffer.from(job.imageBase64, 'base64'), cid: 'argus-photo', contentType: 'image/jpeg' }],
  };
}

type Timer = (fn: () => void, ms: number) => unknown;

/** Holds each email until its light time has passed, then sends it. */
export class FamilyMailQueue {
  private jobs = new Map<string, { owner: string; status: FamilyEmailStatus; createdAt: number }>();

  constructor(
    private readonly transportFn: () => Promise<MailTransport> = () => getTransport(),
    private readonly now: () => number = () => Date.now(),
    private readonly timer: Timer = (fn, ms) => setTimeout(fn, ms)
  ) {}

  schedule(job: FamilyEmailJob): FamilyEmailStatus {
    this.prune();
    const status: FamilyEmailStatus = { id: job.id, status: 'scheduled', sendAtIso: new Date(job.sendAt).toISOString() };
    this.jobs.set(job.id, { owner: job.owner, status, createdAt: this.now() });
    this.timer(() => void this.run(job), Math.max(0, job.sendAt - this.now()));
    return { ...status };
  }

  /** Status for the user who queued it; undefined for anyone else. */
  get(id: string, owner: string): FamilyEmailStatus | undefined {
    const entry = this.jobs.get(id);
    return entry && entry.owner === owner ? { ...entry.status } : undefined;
  }

  async run(job: FamilyEmailJob): Promise<void> {
    const entry = this.jobs.get(job.id);
    if (!entry) return;
    try {
      const t = await this.transportFn();
      const { previewUrl } = await t.send(buildFamilyEmail(job, t.from));
      entry.status = { ...entry.status, status: 'sent', mode: t.mode, previewUrl };
    } catch (err) {
      console.error('[ARGUS family mail] send failed', err instanceof Error ? err.message : err);
      const error = err instanceof MailNotConfiguredError ? err.message : 'The email could not be sent. Check the SMTP settings.';
      entry.status = { ...entry.status, status: 'failed', error };
    }
  }

  /** Forget jobs older than a day. */
  private prune() {
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    for (const [id, e] of this.jobs) if (e.createdAt < cutoff) this.jobs.delete(id);
  }
}

export const familyMailQueue = new FamilyMailQueue();
