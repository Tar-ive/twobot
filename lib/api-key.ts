import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// API key format:  tb_<32 random bytes base64url>
// Stored: prefix (first 11 chars including "tb_"), salt:hash via scrypt.
//
// Why scrypt: built into Node, no native deps, fine for our scale.
// Why prefix: we look up candidate keys by prefix, then constant-time compare.

const KEY_PREFIX = "tb_";
const KEY_BYTES = 24; // ~32 chars base64url
const PREFIX_LEN = KEY_PREFIX.length + 8;

export function generateApiKey(): { key: string; prefix: string } {
  const raw = randomBytes(KEY_BYTES).toString("base64url");
  const key = KEY_PREFIX + raw;
  return { key, prefix: key.slice(0, PREFIX_LEN) };
}

export function hashApiKey(key: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(key, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyApiKey(key: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(key, salt, 32);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function getPrefix(key: string): string {
  return key.slice(0, PREFIX_LEN);
}
