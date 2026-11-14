/**
 * Device tokens for POST /api/ingest/readings (specs/05-data-platform.md §8).
 * token = "<deviceId>.<HMAC-SHA256(ARGUS_DEVICE_SECRET, deviceId)>" — nothing secret is stored in the DB,
 * and rotating ARGUS_DEVICE_SECRET revokes every token at once.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(secret: string, deviceId: string): string {
  return createHmac('sha256', secret).update(`argus-device:${deviceId}`).digest('base64url');
}

export function deviceToken(secret: string, deviceId: string): string {
  return `${deviceId}.${sign(secret, deviceId)}`;
}

/** Returns the device id when the token is valid. */
export function verifyDeviceToken(secret: string | undefined, token: string | undefined): string | null {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const deviceId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, deviceId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? deviceId : null;
}
