/**
 * Hermes Home — zod schemas for every MCP tool's input.
 *
 * Kept in one place so Hermes-registered tools and the local MCP
 * implementations share identical validation. Alex+ reads these
 * (converted to JSON Schema) during tool discovery.
 */
import { z } from 'zod';

export const HermesAskInput = z.object({
  prompt: z.string().describe('The question to ask the Hermes personal agent.'),
  context: z
    .string()
    .optional()
    .describe('Optional extra context to help Hermes answer.'),
});
export type HermesAskInput = z.infer<typeof HermesAskInput>;

export const HermesStartTaskInput = z.object({
  prompt: z.string().describe('A description of the longer task for Hermes.'),
  context: z
    .string()
    .optional()
    .describe('Optional extra context for the task.'),
});
export type HermesStartTaskInput = z.infer<typeof HermesStartTaskInput>;

export const RunIdInput = z.object({
  runId: z.string().describe('The Hermes run identifier previously returned.'),
});
export type RunIdInput = z.infer<typeof RunIdInput>;

export const MemorySearchInput = z.object({
  query: z.string().describe('What to search the user’s memory for.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of memories to return (default 5).'),
});
export type MemorySearchInput = z.infer<typeof MemorySearchInput>;

export const HomeControlInput = z.object({
  target: z
    .string()
    .describe(
      'What to control — a device or room, e.g. "office lights" or "bedroom fan".',
    ),
  action: z
    .enum(['on', 'off', 'toggle'])
    .optional()
    .describe('The action to perform (default: on).'),
  value: z
    .string()
    .optional()
    .describe('Optional value for the action, e.g. brightness or temperature.'),
  confirm: z
    .boolean()
    .describe(
      'Explicit user confirmation. MUST be false first time for physical actions so the user can confirm.',
    ),
});
export type HomeControlInput = z.infer<typeof HomeControlInput>;
