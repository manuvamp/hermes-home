/**
 * Hermes Home — MCP server entry point.
 *
 * Routes summary:
 *   GET  /health                                  — infra health (no auth)
 *   GET  /ready                                   — readiness incl. Hermes reachability
 *   POST /mcp                                     — Alexa+ Streamable HTTP MCP endpoint
 *   GET  /sse / POST /messages                    — Backwards-compat SSE
 *   GET  /.well-known/oauth-protected-resource    — OAuth discovery (spec §9)
 *   GET  /.well-known/oauth-authorization-server  — OAuth discovery
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { buildMcpServer } from './mcp/mcpServer.js';
import { StreamableHTTPServerTransport } from './mcp/transport.js';
import { toolRegistry } from './tools/registry.js';
import { requestContext } from './state/context.js';
import { assertHermesReady, hermesHealth } from './hermes/client.js';
import { homeAssistantHealth } from './state/homeassistant.js';
import { calendarConfigured } from './state/calendar.js';
import { githubConfigured } from './state/github.js';
import { configuredChannels } from './state/messaging.js';
import { registerLocalAuth, authPreHandler } from './auth/index.js';

const PORT = config.port;
const AUTH_MODE = config.auth.mode;

async function main(): Promise<void> {
  // Fail fast if the Hermes substrate isn't reachable — this is the
  // "real Hermes, not a stub" guardrail from the spec.
  await assertHermesReady();

  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => randomUUID(),
  });

  registerLocalAuth(AUTH_MODE, app);

  // One factory per session — see mcp/transport.ts for why.
  const transport = new StreamableHTTPServerTransport({ mcpFactory: buildMcpServer });

  // ---- infra ----------------------------------------------------------
  app.get('/health', async () => ({ ok: true, service: 'hermes-home-mcp' }));

  app.get('/ready', async (req, reply) => {
    const [hermes, ha] = await Promise.allSettled([
      hermesHealth(),
      homeAssistantHealth(),
    ]);
    const ready = hermes.status === 'fulfilled';
    if (!ready) reply.code(503);
    return {
      ready,
      hermes:
        hermes.status === 'fulfilled'
          ? hermes.value
          : { ok: false, error: String(hermes.reason) },
      integrations: {
        homeAssistant:
          ha.status === 'fulfilled' ? ha.value : { ok: false, error: String(ha.reason) },
        calendar: { ok: calendarConfigured() },
        github: { ok: githubConfigured() },
        messaging: { ok: configuredChannels().length > 0, channels: configuredChannels() },
      },
    };
  });

  // ---- introspection --------------------------------------------------
  app.get('/tools', async () => toolRegistry.listInfo());
  app.get('/version', async () => ({
    name: 'hermes-home-mcp',
    version: '0.1.0',
    modes: ['bridge', 'hermes'],
  }));

  // ---- MCP ------------------------------------------------------------
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    preHandler: authPreHandler,
    handler: async (req, reply) => {
      const ctx = requestContext(req);
      req.log.info(
        { reqId: ctx.requestId, userId: ctx.userId, mode: ctx.mode },
        'mcp request',
      );
      return transport.handle(req, reply);
    },
  });

  // Backwards-compat SSE endpoints for older MCP clients (spec §8 note).
  app.get('/sse', async (_req, reply) => {
    reply.code(410).send({
      error:
        'SSE transport is deprecated; Alexa+ requires Streamable HTTP. Use POST /mcp.',
    });
  });
  app.post('/messages', async (_req, reply) => {
    reply.code(410).send({ error: 'Use POST /mcp (Streamable HTTP transport).' });
  });

  // ---- auth discovery — configured per AUTH_MODE ------------------------
  registerWellKnown(app);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await transport.close().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info({ port: PORT, auth: AUTH_MODE }, 'Hermes Home MCP server up');
}

function registerWellKnown(app: ReturnType<typeof Fastify>): void {
  const issuer =
    config.auth.issuer || config.publicBaseUrl || `http://127.0.0.1:${PORT}`;

  app.get('/.well-known/oauth-protected-resource', async () => ({
    resource: config.publicBaseUrl || `http://127.0.0.1:${PORT}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/your-org/hermes-home',
  }));

  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer,
    token_endpoint: `${issuer}/token`,
    authorization_endpoint: `${issuer}/authorize`,
    jwks_uri: config.auth.jwksUri || `${issuer}/.well-known/jwks.json`,
    scopes_supported: ['hermes'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }));
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
