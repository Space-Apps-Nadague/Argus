import { describe, expect, it } from 'vitest';
import { deliveryStatus, formatCountdown, isEmail, loadContacts, loadPostcards, MAX_POSTCARDS, newPostcard, saveContacts, savePostcard, updatePostcard, type KeyValueStore } from '../familyMail';

const memory = (limit = Infinity): KeyValueStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      data[k] = v;
    },
  };
};

const card = (i: number, image = 'data:image/jpeg;base64,xx') =>
  newPostcard({ crewId: 'c1', to: ['Mom'], message: ` hi ${i} `, image, delaySeconds: 600, now: new Date(Date.UTC(2026, 10, 15, 10, i)), id: `p${i}` });

describe('family mail', () => {
  it('arrives after the one-way light time', () => {
    const c = card(0);
    expect(c.message).toBe('hi 0');
    expect(deliveryStatus(c, new Date(Date.UTC(2026, 10, 15, 10, 5)))).toEqual({ delivered: false, secondsLeft: 300 });
    expect(deliveryStatus(c, new Date(Date.UTC(2026, 10, 15, 10, 10))).delivered).toBe(true);
    expect(newPostcard({ crewId: 'c', to: [], message: '', image: 'x', delaySeconds: 0 }).delaySeconds).toBe(0);
  });

  it('keeps contacts per astronaut', () => {
    const s = memory();
    saveContacts('c1', [{ id: '1', name: 'Mom', relation: 'mother' }], s);
    saveContacts('c2', [{ id: '2', name: 'Dan', relation: 'son' }], s);
    expect(loadContacts('c1', s).map((c) => c.name)).toEqual(['Mom']);
    expect(loadContacts('c3', s)).toEqual([]);
  });

  it('keeps the newest postcards and drops the oldest when storage is full', () => {
    const s = memory();
    for (let i = 0; i < MAX_POSTCARDS + 3; i++) savePostcard(card(i), s);
    const list = loadPostcards('c1', s);
    expect(list).toHaveLength(MAX_POSTCARDS);
    expect(list[0].id).toBe(`p${MAX_POSTCARDS + 2}`);
    const tight = memory(1200);
    for (let i = 0; i < 6; i++) savePostcard(card(i, 'data:image/jpeg;base64,' + 'A'.repeat(300)), tight);
    expect(loadPostcards('c1', tight).length).toBeGreaterThan(0);
    expect(loadPostcards('c1', tight)[0].id).toBe('p5');
  });

  it('updates the email status of a stored postcard', () => {
    const s = memory();
    savePostcard(card(1), s);
    updatePostcard('c1', 'p1', { email: { status: 'sent', recipients: ['mom@example.com'], mode: 'smtp' } }, s);
    expect(loadPostcards('c1', s)[0].email?.status).toBe('sent');
  });

  it('checks email addresses', () => {
    expect(isEmail('mom@example.com')).toBe(true);
    expect(isEmail('mom@example')).toBe(false);
    expect(isEmail('not an email')).toBe(false);
  });

  it('formats the time left', () => {
    expect(formatCountdown(42)).toBe('42s');
    expect(formatCountdown(658)).toBe('10m 58s');
  });
});
