import type { Env } from './env';

/** Long enough to cover a game session without the GM re-entering the password mid-table. */
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

interface TokenPayload {
  exp: number; // unix seconds
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Issues `<payload>.<signature>`, both base64url, over a small JSON payload carrying only an expiry. */
export async function issueSessionToken(env: Env): Promise<string> {
  const payload: TokenPayload = { exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await hmacKey(env.SESSION_SECRET);
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** True only for a token whose signature verifies against SESSION_SECRET and hasn't expired. */
export async function verifySessionToken(token: string, env: Env): Promise<boolean> {
  const [payloadPart, signaturePart] = token.split('.');
  if (payloadPart === undefined || signaturePart === undefined) return false;

  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadPart);
    signatureBytes = base64UrlDecode(signaturePart);
  } catch {
    return false;
  }

  const key = await hmacKey(env.SESSION_SECRET);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes);
  if (!valid) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as TokenPayload;
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * Constant-time password check: HMAC both sides with SESSION_SECRET, then
 * XOR-compare the digests, rather than a naive `===` on the raw password
 * (which leaks timing information proportional to the matching prefix).
 */
export async function checkPassword(candidate: string, env: Env): Promise<boolean> {
  if (candidate.length === 0) return false;
  const key = await hmacKey(env.SESSION_SECRET);
  const [candidateDigest, actualDigest] = await Promise.all([
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(candidate)),
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(env.GM_PASSWORD)),
  ]);
  const a = new Uint8Array(candidateDigest);
  const b = new Uint8Array(actualDigest);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
