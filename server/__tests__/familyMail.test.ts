import { describe, expect, it } from 'vitest';
import { buildFamilyEmail, FamilyMailQueue, getTransport, MailNotConfiguredError, type FamilyEmailJob, type MailTransport } from '../family/mailer';

const job = (over: Partial<FamilyEmailJob> = {}): FamilyEmailJob => ({
  id: 'pc-1',
  owner: 'u1',
  crewId: 'c1',
  callsign: 'VEGA',
  place: 'Mars',
  to: [{ name: 'Mom', email: 'mom@example.com' }],
  message: 'Miss you <3',
  imageBase64: Buffer.from('jpeg').toString('base64'),
  sendAt: 1_000 + 600_000,
  ...over,
});

describe('family email', () => {
  it('builds an email with the photo inline and the message escaped', () => {
    const m = buildFamilyEmail(job(), 'ARGUS <a@b.c>');
    expect(m.subject).toBe('A photo from VEGA in Mars');
    expect(m.to).toEqual([{ name: 'Mom', address: 'mom@example.com' }]);
    expect(String(m.html)).toContain('cid:argus-photo');
    expect(String(m.html)).toContain('Miss you &lt;3');
    expect(String(m.html)).not.toContain('<3');
    expect(m.attachments?.[0]).toMatchObject({ cid: 'argus-photo', contentType: 'image/jpeg' });
  });

  it('waits for the light time, then sends; only the sender can read the status', async () => {
    let now = 1_000;
    const timers: { fn: () => void; ms: number }[] = [];
    const sent: unknown[] = [];
    const transport: MailTransport = { mode: 'test', from: 'x', send: async (m) => (sent.push(m), { previewUrl: 'https://ethereal.email/message/abc' }) };
    const q = new FamilyMailQueue(async () => transport, () => now, (fn, ms) => timers.push({ fn, ms }));

    const s = q.schedule(job());
    expect(s.status).toBe('scheduled');
    expect(timers[0].ms).toBe(600_000);
    expect(sent).toHaveLength(0);
    expect(q.get('pc-1', 'someone-else')).toBeUndefined();

    now += 600_000;
    await q.run(job());
    expect(sent).toHaveLength(1);
    expect(q.get('pc-1', 'u1')).toMatchObject({ status: 'sent', mode: 'test', previewUrl: 'https://ethereal.email/message/abc' });
  });

  it('reports a failed send without exposing the error details', async () => {
    const q = new FamilyMailQueue(async () => ({ mode: 'smtp', from: 'x', send: async () => Promise.reject(new Error('535 auth failed for secret@x')) }), () => 0, () => 0);
    q.schedule(job({ sendAt: 0 }));
    await q.run(job({ sendAt: 0 }));
    const st = q.get('pc-1', 'u1')!;
    expect(st.status).toBe('failed');
    expect(st.error).not.toContain('secret');
  });

  it('does not send anywhere when no mail server is set up', async () => {
    await expect(getTransport({} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(MailNotConfiguredError);
    const q = new FamilyMailQueue(() => getTransport({} as NodeJS.ProcessEnv), () => 0, () => 0);
    q.schedule(job({ sendAt: 0 }));
    await q.run(job({ sendAt: 0 }));
    expect(q.get('pc-1', 'u1')).toMatchObject({ status: 'failed', error: expect.stringContaining('not set up') });
  });
});
