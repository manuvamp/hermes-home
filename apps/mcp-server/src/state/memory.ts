/**
 * Persistent memory store (spec §24).
 *
 * One JSON file, keyed by userId, so search results NEVER cross users
 * (spec §39). Entries carry an explicit `source: 'user'` so Alexa+ can
 * distinguish stored memories from fresh inference (spec §24:
 * "Make it obvious which information came from stored memory").
 *
 * Swapping this for Hermes' native memory or a real DB later only
 * requires changing the three exported functions.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Memory } from '@hermes-home/shared';

import { config } from '../config.js';

const MEMORY_PATH = config.memoryPath;

type MemoryFile = Record<string, Memory[]>;

async function loadAll(): Promise<MemoryFile> {
  try {
    const raw = await readFile(MEMORY_PATH, 'utf8');
    return JSON.parse(raw) as MemoryFile;
  } catch {
    return {};
  }
}

async function saveAll(data: MemoryFile): Promise<void> {
  await mkdir(dirname(MEMORY_PATH), { recursive: true });
  await writeFile(MEMORY_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export async function remember(
  userId: string,
  content: string,
  source = 'user',
): Promise<Memory> {
  const all = await loadAll();
  const entry: Memory = {
    id: randomUUID(),
    content,
    source,
    createdAt: new Date().toISOString(),
  };
  all[userId] = [...(all[userId] ?? []), entry];
  await saveAll(all);
  return entry;
}

/** Naive relevance: case-insensitive term overlap. Deliberately simple —
 *  the point for the demo is honest recall, not ML. */
export async function searchMemories(
  userId: string,
  query: string,
  limit = 5,
): Promise<Memory[]> {
  const all = await loadAll();
  const mine = all[userId] ?? [];
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3);
  const scored = mine
    .map((m) => {
      const hay = m.content.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      return { m, score: hits };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ m, score }) => ({
    ...m,
    relevance: score,
  }));
}

export async function allMemories(userId: string, limit = 50): Promise<Memory[]> {
  const all = await loadAll();
  return (all[userId] ?? []).slice(-limit);
}
