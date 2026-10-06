/**
 * Tool registry — one source of truth for the tool catalogue.
 *
 * MVP track: handlers run locally in this server.
 * Registry-remote track (future): `remote=true` tools tunnel to Hermes.
 *
 * We deliberately expose only a small, hand-picked set of tools to
 * Alexa+ (spec §10) — never the whole Hermes catalog.
 */
import type { ToolDefinition } from '@hermes-home/shared';
import type { RequestContext } from '../state/context.js';
import { hermesTools } from './hermes.js';
import { homeTools } from './home.js';
import { memoryTools } from './memory.js';
import { calendarTools } from './calendar.js';
import { githubTools } from './github.js';
import { messagingTools } from './messaging.js';

export type ToolHandler = (
  input: unknown,
  ctx: RequestContext,
) => Promise<unknown>;

export type RegisteredTool = ToolDefinition & {
  handler: ToolHandler;
  /** reserved for the 'Hermes as registry-remote MCP server' track */
  remote?: boolean;
};

class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: RegisteredTool[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  listInfo(): Array<Omit<RegisteredTool, 'handler'>> {
    return this.list().map(({ handler: _handler, ...info }) => info);
  }
}

export const toolRegistry = new ToolRegistry();
toolRegistry.registerAll([
  ...hermesTools,
  ...homeTools,
  ...memoryTools,
  ...calendarTools,
  ...githubTools,
  ...messagingTools,
]);
