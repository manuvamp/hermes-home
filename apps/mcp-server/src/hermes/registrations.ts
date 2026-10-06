/**
 * STRUCTURAL STUB — "Hermes as registry-remote MCP server" track.
 *
 * MVP path runs tool handlers locally against the Hermes HTTP API.
 * This stub preserves the second architecture from the spec:
 * every Hermes Home tool can *also* be registered with Hermes itself
 * (as an MCP server Hermes connects to), so the whole tool surface is
 * thrash-free whichever side drives.
 *
 * Writes a `tool-config.json` Hermes can pick up via HERMES_MCP_CONFIG.
 * Intentionally NOT wired into server.ts yet.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { toolRegistry } from '../tools/registry.js';

export type HermesToolConfig = {
  mcpServers: Record<
    string,
    {
      url: string;
      transport: 'streamable-http';
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
    }
  >;
};

export function buildToolConfig(publicBaseUrl: string): HermesToolConfig {
  return {
    mcpServers: {
      'hermes-home': {
        url: `${publicBaseUrl.replace(/\/+$/, '')}/mcp`,
        transport: 'streamable-http',
        tools: toolRegistry.listInfo().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    },
  };
}

export async function writeToolConfig(
  publicBaseUrl: string,
  path = './tool-config.json',
): Promise<string> {
  const config = buildToolConfig(publicBaseUrl);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf8');
  return path;
}
