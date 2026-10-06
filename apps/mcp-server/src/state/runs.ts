/**
 * Run registry — maps Hermes run ids to the owning userId.
 *
 * hermes_task_status / hermes_task_result must never leak one user's run
 * to another user (spec §39), so every status/result lookup verifies the
 * caller owns the run id.
 *
 * In-memory for the hackathon; swap `runs` Map for Redis/Postgres to
 * survive restarts (the interface is deliberately tiny).
 */
import type { RunStatus } from '@hermes-home/shared';
import { hermesGetRun, hermesStartRun, type HermesRun } from '../hermes/client.js';

export type TrackedRun = {
  runId: string;
  userId: string;
  description: string;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  notifiedPush?: boolean;
  result?: string;
  error?: string;
};

const runs = new Map<string, TrackedRun>();

/** Lazily starts the background status-pump once Hermes is verified reachable. */
let pumpStarted = false;
export function ensureRunPump(): void {
  if (pumpStarted) return;
  pumpStarted = true;
  const interval = setInterval(() => void pump(), 2_500);
  interval.unref?.();
}

export async function startRun(
  userId: string,
  description: string,
  context?: string,
): Promise<TrackedRun> {
  const runId = await hermesStartRun(description, context);
  const tracked: TrackedRun = {
    runId,
    userId,
    description,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  runs.set(runId, tracked);
  ensureRunPump();
  return tracked;
}

/**
 * Read a run for a user. Returns:
 *  - the run on success (status refreshed from Hermes)
 *  - null if the run id doesn't belong to this user / doesn't exist
 */
export async function getRunForUser(
  userId: string,
  runId: string,
): Promise<TrackedRun | null> {
  const tracked = runs.get(runId);
  if (!tracked || tracked.userId !== userId) return null;
  if (tracked.status === 'queued' || tracked.status === 'running') {
    await refreshRun(tracked).catch(() => undefined);
  }
  return tracked;
}

export async function refreshRun(tracked: TrackedRun): Promise<TrackedRun> {
  let hermes: HermesRun;
  try {
    hermes = await hermesGetRun(tracked.runId);
  } catch (err) {
    // A transient gateway hiccup must not destroy a tracked run.
    tracked.error = err instanceof Error ? err.message : String(err);
    return tracked;
  }
  tracked.status = hermes.status;
  if (hermes.output) tracked.result = hermes.output;
  if (hermes.error) tracked.error = hermes.error;
  if (
    (hermes.status === 'completed' ||
      hermes.status === 'failed' ||
      hermes.status === 'cancelled') &&
    !tracked.completedAt
  ) {
    tracked.completedAt = new Date().toISOString();
    void notifyRunFinished(tracked);
  }
  return tracked;
}

/** Check status/result visibility without throwing — used by tests. */
export function listRunsForUser(userId: string): TrackedRun[] {
  return [...runs.values()].filter((r) => r.userId === userId);
}

async function pump(): Promise<void> {
  const actives = [...runs.values()].filter(
    (r) => r.status === 'queued' || r.status === 'running',
  );
  for (const r of actives) {
    await refreshRun(r).catch(() => undefined);
  }
}

/** Dynamically imported to avoid a cycle: notifications must not import runs. */
async function notifyRunFinished(run: TrackedRun): Promise<void> {
  if (run.notifiedPush) return;
  run.notifiedPush = true;
  const { notifyRunComplete } = await import('./notifications.js');
  await notifyRunComplete(run);
}

/** Test hook: reset state. */
export function __resetRuns(): void {
  runs.clear();
}
