/**
 * Streamable HTTP MCP transport wiring (spec §8).
 *
 * Security default: bound to localhost / private origins ONLY unless
 * you explicitly opt into public framework-level access through
 * AUTH_MODE=oauth2 *and* deploy outside this local trust boundary.
 * This is the deliberate DNS-rebinding protection for local dev —
 * a malicious web page must not be able to POST JSON-RPC at your
 * laptop's unauthenticated MCP port.
 *
 * Session model: stateful — each `initialize` creates a server-side
 * transport keyed by `mcp-session-id`; subsequent POSTs/GETs/DELETEs
 * present the session id. Sessions expire after inactivity.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport as SdkStreamableTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const SESSION_TTL_MS = config.mcpSessionTtlMs;
const MAX_SESSIONS = 100;

/** A request from a browser we should not trust: has an Origin that
 *  isn't localhost/private. In local dev mode we reject it. */
const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl / inspector / non-browser clients
  try {
    const url = new URL(origin);
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0]?.toLowerCase() ?? '';
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
}

type Session = {
  transport: SdkStreamableTransport;
  createdAt: number;
  touchedAt: number;
};

export class StreamableHTTPServerTransport {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly opts: { mcpFactory: () => McpServer }) {
    const sweeper = setInterval(() => this.sweep(), 60_000);
    sweeper.unref?.();
  }

  async handle(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    // --- DNS rebind guard -------------------------------------------
    // Local dev mode: only accept requests addressed to a local host
    // header, without a foreign browser Origin. In production you set
    // PUBLIC_BASE_URL + AUTH_MODE=oauth2 and this check is relaxed to
    // HOST-only matching against PUBLIC_BASE_URL's host.
    const hostOk = this.hostAllowed(req.headers.host);
    const originOk = this.originAllowed(req.headers.origin);
    if (!hostOk || !originOk) {
      req.log.warn(
        { host: req.headers.host, origin: req.headers.origin },
        'refused request (DNS-rebind guard)',
      );
      return reply.code(403).send({
        error:
          'Refused: untrusted host/origin. This MCP server only accepts local connections unless AUTH_MODE=oauth2 with a configured PUBLIC_BASE_URL.',
      });
    }

    const sessionId = req.headers['mcp-session-id'];
    const body = req.body as Record<string, unknown> | undefined;

    try {
      if (typeof sessionId === 'string' && this.sessions.has(sessionId)) {
        const session = this.touch(sessionId);
        return await session.transport.handleRequest(
          req.raw,
          reply.raw,
          body,
        );
      }

      // New session — must be an initialize request
      if (req.method === 'POST' && isInitializeRequest(body)) {
        // Each connection needs its OWN McpServer+Protocol: the SDK only
        // permits one transport per Protocol instance, so re-connecting the
        // shared server throws "Already connected to a transport".
        const mcp = this.opts.mcpFactory();
        const transport = new SdkStreamableTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            this.sessions.set(id, {
              transport,
              createdAt: Date.now(),
              touchedAt: Date.now(),
            });
            this.enforceCapacity();
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) this.sessions.delete(id);
        };
        await mcp.connect(transport);
        return await transport.handleRequest(req.raw, reply.raw, body);
      }

      return reply.code(400).send({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Bad request: no valid session. Send an initialize request first.',
        },
        id: null,
      });
    } catch (err) {
      req.log.error({ err }, 'mcp transport error');
      if (!reply.sent) {
        return reply
          .code(500)
          .send({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  }

  async close(): Promise<void> {
    for (const { transport } of this.sessions.values()) {
      await transport.close().catch(() => undefined);
    }
    this.sessions.clear();
  }

  private touch(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error('session vanished');
    s.touchedAt = Date.now();
    return s;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.touchedAt > SESSION_TTL_MS) {
        void s.transport.close().catch(() => undefined);
        this.sessions.delete(id);
      }
    }
  }

  private enforceCapacity(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const oldest = [...this.sessions.entries()].sort(
      (a, b) => a[1].touchedAt - b[1].touchedAt,
    )[0];
    if (oldest) {
      void oldest[1].transport.close().catch(() => undefined);
      this.sessions.delete(oldest[0]);
    }
  }

  private hostAllowed(host: string | undefined): boolean {
    if (config.auth.mode === 'oauth2' && config.publicBaseUrl) {
      try {
        const publicHost = new URL(config.publicBaseUrl).host;
        return host === publicHost || isLocalHostHeader(host);
      } catch {
        return false;
      }
    }
    return isLocalHostHeader(host);
  }

  private originAllowed(origin: string | undefined): boolean {
    if (config.auth.mode === 'oauth2' && config.publicBaseUrl) {
      // In production the only clients should be Alexa+ backend calls
      // (no Origin header) or your own dashboard.
      if (!origin) return true;
      try {
        return new URL(origin).host === new URL(config.publicBaseUrl).host;
      } catch {
        return false;
      }
    }
    return isLocalOrigin(origin);
  }
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { method?: unknown };
  return b.method === 'initialize';
}
