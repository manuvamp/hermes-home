/**
 * Memory tools (spec §§15, 24).
 *
 * hermes_memory_search — query the user's stored memories (user-scoped).
 * hermes_remember      — explicitly store something for later.
 *
 * Results always carry `source: 'memory'` so Alexa never presents a
 * stored memory as a fresh inference (spec §24).
 */
import { MemorySearchInput } from '@hermes-home/shared';
import { z } from 'zod';
import type { RegisteredTool } from './registry.js';
import { remember, searchMemories } from '../state/memory.js';

const RememberInput = z.object({
  content: z.string().min(1).describe('Exactly what to remember.'),
});

export const memoryTools: RegisteredTool[] = [
  {
    name: 'hermes_memory_search',
    title: 'Search memory',
    description:
      'Search the user’s personal memory for things they have said, decided, or asked Hermes to remember. Use before answering "what did I decide about X" style questions — never invent a memory.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: {
          type: 'number',
          description: 'Max memories to return (default 5).',
        },
      },
      required: ['query'],
    },
    handler: async (input, ctx) => {
      const { query, limit } = MemorySearchInput.parse(input);
      const memories = await searchMemories(ctx.userId, query, limit ?? 5);
      return {
        success: true,
        source: 'memory',
        query,
        found: memories.length,
        memories: memories.map((m) => ({
          content: m.content,
          recordedAt: m.createdAt,
          source: m.source ?? 'user',
        })),
      };
    },
  },
  {
    name: 'hermes_remember',
    title: 'Remember this',
    description:
      'Store something the user explicitly asked to remember, verbatim. Use when the user says "remember that…". It will later surface via hermes_memory_search.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Exactly what to remember.' },
      },
      required: ['content'],
    },
    handler: async (input, ctx) => {
      const { content } = RememberInput.parse(input);
      const entry = await remember(ctx.userId, content, 'user');
      return {
        success: true,
        source: 'memory',
        remembered: entry.content,
        recordedAt: entry.createdAt,
      };
    },
  },
];
