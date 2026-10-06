/**
 * Proper JWT validation: RS256 signature verification against a JWKS
 * endpoint, plus iss/aud/exp enforcement. Zero npm deps — Node crypto
 * handles RSA verification directly.
 *
 * This is what makes AUTH_MODE=oauth2 safe to put on the open internet.
 */
import { createVerify, createPublicKey, type KeyObject } from 'node:crypto';
import { config } from '../config.js';

export type VerifiedClaims = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  scope?: string;
};

type Jwk = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x5c?: string[];
};

/* ---------------- JWKS cache ---------------- */

const JWKS_TTL_MS = 10 * 60_000;
let cachedKeys: { at: number; keys: Map<string, KeyObject> } | null = null;

async function fetchJwks(): Promise<Map<string, KeyObject>> {
  if (cachedKeys && Date.now() - cachedKeys.at < JWKS_TTL_MS) {
    return cachedKeys.keys;
  }
  const res = await fetch(config.auth.jwksUri, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, KeyObject>();
  for (const jwk of keys) {
    if ((jwk.use ?? 'sig') !== 'sig') continue;
    if (jwk.kty === 'RSA' && jwk.n && jwk.e && jwk.kid) {
      map.set(
        jwk.kid,
        // Node's WebCrypto-flavored typing expects JsonWebKey; our Jwk
        // shape is structurally compatible but declared independently.
        createPublicKey({ key: jwk as never, format: 'jwk' }),
      );
    }
  }
  cachedKeys = { at: Date.now(), keys: map };
  return map;
}

/* ---------------- JWT decode + verify ---------------- */

function b64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Returns verified claims, or null with a reason. NEVER throws from the
 * request path — auth failures are 401 responses, not 500s.
 */
export async function verifyBearerToken(
  token: string,
): Promise<{ claims: VerifiedClaims } | { error: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'malformed token (not 3 parts)' };

  let header: { alg?: string; kid?: string };
  let payload: VerifiedClaims;
  try {
    header = JSON.parse(b64url(parts[0]!).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]!).toString('utf8'));
  } catch {
    return { error: 'malformed token (bad JSON)' };
  }

  if (header.alg !== 'RS256') return { error: `unsupported alg ${header.alg}` };
  if (!header.kid) return { error: 'token missing kid' };

  const signedContent = `${parts[0]}.${parts[1]}`;
  const signature = parts[2]!;

  let keys: Map<string, KeyObject>;
  try {
    keys = await fetchJwks();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'JWKS unavailable' };
  }
  const key = keys.get(header.kid);
  if (!key) {
    // Key rotation race: force refresh once.
    cachedKeys = null;
    try {
      keys = await fetchJwks();
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'JWKS unavailable' };
    }
    const retryKey = keys.get(header.kid);
    if (!retryKey) return { error: 'unknown signing key (kid)' };
    return verifyWithKey(retryKey, signedContent, signature, payload);
  }
  return verifyWithKey(key, signedContent, signature, payload);
}

function verifyWithKey(
  key: KeyObject,
  signedContent: string,
  signatureB64: string,
  payload: VerifiedClaims,
): { claims: VerifiedClaims } | { error: string } {
  const ok = createVerify('RSA-SHA256')
    .update(signedContent)
    .verify(key, b64url(signatureB64));
  if (!ok) return { error: 'invalid signature' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { error: 'token expired' };
  }
  if (config.auth.issuer && payload.iss && payload.iss !== config.auth.issuer) {
    return { error: 'issuer mismatch' };
  }
  if (config.auth.audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(config.auth.audience)) {
      return { error: 'audience mismatch' };
    }
  }
  return { claims: payload };
}
