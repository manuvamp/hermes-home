/**
 * Auth plug-in point (spec §9).
 *
 * Modes:
 *   local  — default. Trusts loopback; the transport's DNS-rebind guard is
 *            the hard boundary here. A static bearer token can be required
 *            with AUTH_LOCAL_TOKEN for slightly-less-open local testing.
 *   oauth2 — production Alexa+ account-linking. Real RS256 JWT verification
 *            against AUTH_JWKS_URI (oauth2-proxy / Keycloak / Cognito), with
 *            issuer/audience/expiry enforced. See docs/oauth-reference/README.md.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyBearerToken } from './jwks.js';

export function registerLocalAuth(mode: string, _app: FastifyInstance): void {
  if (mode !== 'local' && mode !== 'oauth2') {
    throw new Error(`unknown AUTH_MODE "${mode}" (expected 'local' | 'oauth2')`);
  }
  if (mode === 'oauth2' && !config.auth.jwksUri) {
    // Fail loudly at boot — never run an internet-facing listener that
    // cannot verify tokens.
    throw new Error(
      'AUTH_MODE=oauth2 requires AUTH_JWKS_URI (and ideally AUTH_ISSUER + AUTH_AUDIENCE). ' +
        'See docs/oauth-reference/README.md.',
    );
  }
}

/** Fastify preHandler for the /mcp route. */
export async function authPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const mode = config.auth.mode;

  if (mode === 'local') {
    const required = config.auth.localToken;
    if (required && req.headers.authorization !== `Bearer ${required}`) {
      reply.code(401).send({
        error: 'Unauthorized: Bearer token required for this local instance.',
      });
      return;
    }
    return;
  }

  // oauth2 mode — verify Authorization: Bearer <RS256 JWT>.
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    reply
      .code(401)
      .header(
        'WWW-Authenticate',
        `Bearer realm="hermes-home", resource_metadata="${
          config.publicBaseUrl ?? ''
        }/.well-known/oauth-protected-resource"`,
      )
      .send({ error: 'Unauthorized' });
    return;
  }

  const result = await verifyBearerToken(token);
  if ('error' in result) {
    reply.code(401).send({ error: `Unauthorized: ${result.error}` });
    return;
  }
  (req as FastifyRequest & { user?: { sub?: string } }).user = {
    sub: typeof result.claims.sub === 'string' ? result.claims.sub : undefined,
  };
}
