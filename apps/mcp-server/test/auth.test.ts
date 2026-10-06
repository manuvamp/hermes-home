/**
 * End-to-end JWT verification:
 *   - real RSA keypair from node:crypto
 *   - real RS256-signed JWT
 *   - JWKS served over HTTP with the SAME public key Node's createVerify
 *     has already proven it accepts
 *   - verifyBearerToken accepts only correct, fresh, correctly-audienced tokens
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  createSign,
  createVerify,
  createPublicKey,
  constants,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';

let jwksServer: Server;

// Generate a Node-native keypair and its JWK through Node itself —
// no WebCrypto, no format guessing.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicJwk = pair.publicKey.export({ format: 'jwk' }) as {
  kty: string;
  n: string;
  e: string;
};

const KID = 'test-key-1';
const ISSUER = 'https://issuer.test';
const AUDIENCE = 'hermes-home';

// Self-check before anything else: prove the sign/verify pair works at all,
// using the same JWK shape the JWKS endpoint will serve.
const selfCheckData = 'hello';
const selfSig = createSign('RSA-SHA256')
  .update(selfCheckData)
  .sign({ key: privateKey, padding: constants.RSA_PKCS1_PADDING });
const selfKeyObj = createPublicKey({ key: publicJwk as never, format: 'jwk' });
if (!createVerify('RSA-SHA256').update(selfCheckData).verify(selfKeyObj, selfSig)) {
  throw new Error('JWT self-check failed: Node JWK verify path broken');
}

before(async () => {
  jwksServer = createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          keys: [{ kty: 'RSA', kid: KID, use: 'sig', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }],
        }),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
  const { port } = jwksServer.address() as { port: number };
  process.env.AUTH_JWKS_URI = `http://127.0.0.1:${port}/jwks`;
  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_AUDIENCE = AUDIENCE;
});

after(() => jwksServer.close());

const b64url = (s: string) => Buffer.from(s).toString('base64url');

function signJwt(claims: Record<string, unknown>, kid = KID): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = createSign('RSA-SHA256')
    .update(data)
    .sign({ key: privateKey, padding: constants.RSA_PKCS1_PADDING });
  return `${data}.${sig.toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);

test('accepts a correctly-signed RS256 JWT with right iss/aud/exp', async () => {
  const { verifyBearerToken } = await import('../src/auth/jwks.js');
  const token = signJwt({ sub: 'alice', iss: ISSUER, aud: AUDIENCE, exp: now() + 300 });
  const res = await verifyBearerToken(token);
  assert.ok('claims' in res, JSON.stringify(res));
  assert.equal(res.claims.sub, 'alice');
});

test('rejects a tampered payload', async () => {
  const { verifyBearerToken } = await import('../src/auth/jwks.js');
  const token = signJwt({ sub: 'alice', iss: ISSUER, aud: AUDIENCE, exp: now() + 300 });
  const parts = token.split('.');
  parts[1] = b64url(JSON.stringify({ sub: 'mallory', iss: ISSUER, aud: AUDIENCE, exp: now() + 300 }));
  const res = await verifyBearerToken(parts.join('.'));
  assert.ok('error' in res);
  assert.match(res.error, /signature/);
});

test('rejects an expired token', async () => {
  const { verifyBearerToken } = await import('../src/auth/jwks.js');
  const token = signJwt({ sub: 'alice', iss: ISSUER, aud: AUDIENCE, exp: now() - 60 });
  const res = await verifyBearerToken(token);
  assert.ok('error' in res);
  assert.match(res.error, /expired/);
});

test('rejects a wrong audience', async () => {
  const { verifyBearerToken } = await import('../src/auth/jwks.js');
  const token = signJwt({ sub: 'alice', iss: ISSUER, aud: 'someone-else', exp: now() + 300 });
  const res = await verifyBearerToken(token);
  assert.ok('error' in res);
  assert.match(res.error, /audience/);
});

test('rejects an unknown kid', async () => {
  const { verifyBearerToken } = await import('../src/auth/jwks.js');
  const token = signJwt({ sub: 'alice', iss: ISSUER, aud: AUDIENCE, exp: now() + 300 }, 'nope');
  const res = await verifyBearerToken(token);
  assert.ok('error' in res);
});
