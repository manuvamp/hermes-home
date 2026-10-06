/**
 * MCP server factory.
 *
 * The SDK's `McpServer` wraps a `Protocol` that permits exactly ONE transport
 * per instance. Because Streamable HTTP spawns one transport per session,
 * transport.ts calls this factory once per session rather than sharing a
 * single `McpServer` (which throws "Already connected to a transport").
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolRegistry } from '../tools/registry.js';
import { requestContext } from '../state/context.js';

export const SERVER_INFO = { name: 'hermes-home', version: '0.1.0' } as const;

/**
 * Build the MCP server with every registered tool. Handlers wrap tool
 * execution with per-call context (request/user) and never throw to
 * the protocol layer — errors come back as `isError` content so Alexa+
 * can speak them naturally.
 */
export function buildMcpServer(): McpServer {
  const mcp = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  for (const tool of toolRegistry.list()) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // The SDK accepts a JSON Schema shape via inputSchema with zod,
        // but we hold plain JSON Schemas — registerRaw-style:
        inputSchema: jsonSchemaToZodRawShape(tool.inputSchema),
      },
      async (args, extra) => {
        const start = Date.now();
        try {
          const req = (extra as { requestInfo?: { headers?: Record<string, string | string[] | undefined> } })
            ?.requestInfo;
          const ctx = requestContextFromHeaders(req?.headers ?? {});
          const result = await tool.handler(args, ctx);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: toStructured(result),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: message }),
              },
            ],
          };
        } finally {
          logToolTiming(tool.name, Date.now() - start);
        }
      },
    );
  }

  return mcp;
}

function requestContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): ReturnType<typeof requestContext> {
  const userHeader = headers['x-user-id'];
  return {
    requestId: String(headers['mcp-request-id'] ?? `mcp-${Date.now()}`),
    userId:
      typeof userHeader === 'string' && userHeader.trim() !== ''
        ? userHeader.trim()
        : 'local-user',
    mode: 'bridge',
    startedAt: Date.now(),
  };
}

function toStructured(result: unknown): Record<string, unknown> | undefined {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return undefined;
}

let lastLog = 0;
function logToolTiming(name: string, ms: number): void {
  // Structured but throttled: Alexa+/Inspector dev traffic is chatty.
  const now = Date.now();
  if (now - lastLog < 100) return;
  lastLog = now;
  console.log(JSON.stringify({ metric: 'tool_duration_ms', tool: name, ms }));
}

/**
 * The SDK's registerTool wants zod RawShape for inputSchema. We store
 * portable JSON Schemas in the registry (they're what we document for
 * Hermes registration too), so convert the common subset here.
 */
import { z } from 'zod';
function jsonSchemaToZodRawShape(schema: Record<string, unknown>) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case 'string':
        field =
          Array.isArray(prop.enum) && prop.enum.length > 0
            ? z.enum(prop.enum as [string, ...string[]])
            : z.string();
        break;
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      default:
        field = z.unknown();
    }
    if (typeof prop.description === 'string') {
      field = field.describe(prop.description);
    }
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}
