/**
 * ARGUS — Family mail: photos from the Photobooth sent home (specs/02-ui-dashboard.md §2.7)
 * Postcards go into an Earth downlink queue and arrive after the live one-way light time
 * (e.g. 11 minutes from Mars, instantly on Earth). With the ARGUS server, family members with an
 * email address also receive the photo by email at that moment (server/family/mailer.ts).
 * Contacts and postcards are kept per astronaut on this device.
 */

export interface FamilyContact {
  id: string;
  name: string;
  relation: string;
  /** Where the photos are emailed (optional). */
  email?: string;
}

/** Email delivery of a postcard (server mode). */
export interface PostcardEmail {
  /** simulated: demo without the ARGUS server — nothing is sent, the delivery is shown on screen. */
  status: 'scheduled' | 'sent' | 'failed' | 'no_server' | 'simulated';
  recipients: string[];
  /** smtp: really delivered. test: Ethereal test mailbox, see previewUrl. */
  mode?: 'smtp' | 'test';
  previewUrl?: string;
  error?: string;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export interface FamilyPostcard {
  id: string;
  crewId: string;
  /** Contact names at the time of sending. */
  to: string[];
  message: string;
  /** JPEG data URL (downscaled). */
  image: string;
  sentAtIso: string;
  arrivesAtIso: string;
  delaySeconds: number;
  email?: PostcardEmail;
}

export const CONTACTS_KEY = 'argus_family_contacts_v1';
export const MAIL_KEY = 'argus_family_mail_v1';
/** Postcards kept per astronaut; the oldest are dropped first. */
export const MAX_POSTCARDS = 12;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const safeStore = (): KeyValueStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

function readMap<T>(key: string, store: KeyValueStore | null): Record<string, T[]> {
  try {
    const raw = store?.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, T[]>) : {};
  } catch {
    return {};
  }
}

export function loadContacts(crewId: string, store: KeyValueStore | null = safeStore()): FamilyContact[] {
  const list = readMap<FamilyContact>(CONTACTS_KEY, store)[crewId];
  return Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string') : [];
}

export function saveContacts(crewId: string, contacts: FamilyContact[], store: KeyValueStore | null = safeStore()): void {
  const map = readMap<FamilyContact>(CONTACTS_KEY, store);
  map[crewId] = contacts;
  try {
    store?.setItem(CONTACTS_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadPostcards(crewId: string, store: KeyValueStore | null = safeStore()): FamilyPostcard[] {
  const list = readMap<FamilyPostcard>(MAIL_KEY, store)[crewId];
  return Array.isArray(list) ? list.filter((p) => p && typeof p.image === 'string') : [];
}

/** Adds a postcard (newest first), keeps at most MAX_POSTCARDS and drops more if storage is full. */
export function savePostcard(card: FamilyPostcard, store: KeyValueStore | null = safeStore()): FamilyPostcard[] {
  const map = readMap<FamilyPostcard>(MAIL_KEY, store);
  let list = [card, ...(map[card.crewId] ?? [])].slice(0, MAX_POSTCARDS);
  while (list.length) {
    map[card.crewId] = list;
    try {
      store?.setItem(MAIL_KEY, JSON.stringify(map));
      return list;
    } catch {
      list = list.slice(0, -1); // quota exceeded: drop the oldest and retry
    }
  }
  return [];
}

/** Updates one stored postcard (e.g. its email status) and returns the new list. */
export function updatePostcard(
  crewId: string,
  id: string,
  patch: Partial<FamilyPostcard>,
  store: KeyValueStore | null = safeStore()
): FamilyPostcard[] {
  const map = readMap<FamilyPostcard>(MAIL_KEY, store);
  const list = (map[crewId] ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p));
  map[crewId] = list;
  try {
    store?.setItem(MAIL_KEY, JSON.stringify(map));
  } catch {
    /* storage full: keep the in-memory list */
  }
  return list;
}

export function newPostcard(params: {
  crewId: string;
  to: string[];
  message: string;
  image: string;
  delaySeconds: number;
  now?: Date;
  id?: string;
}): FamilyPostcard {
  const now = params.now ?? new Date();
  return {
    id: params.id ?? `pc-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    crewId: params.crewId,
    to: params.to,
    message: params.message.trim().slice(0, 200),
    image: params.image,
    sentAtIso: now.toISOString(),
    arrivesAtIso: new Date(now.getTime() + Math.max(0, params.delaySeconds) * 1000).toISOString(),
    delaySeconds: Math.max(0, params.delaySeconds),
  };
}

export function deliveryStatus(card: FamilyPostcard, now: Date = new Date()): { delivered: boolean; secondsLeft: number } {
  const left = (new Date(card.arrivesAtIso).getTime() - now.getTime()) / 1000;
  return { delivered: left <= 0, secondsLeft: Math.max(0, Math.ceil(left)) };
}

export function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
