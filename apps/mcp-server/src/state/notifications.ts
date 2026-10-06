/**
 * Task-completion notifications (spec §19).
 *
 * When a tracked Hermes run finishes, push a heads-up to every configured
 * channel (Hermes itself first, then direct Telegram/Discord/Slack).
 * Channels that aren't configured or fail are non-fatal — logged only.
 */
import { hermesNotify } from '../hermes/client.js';
import {
  configuredChannels,
  sendMessage,
} from './messaging.js';
import type { TrackedRun } from './runs.js';

/** Short, voice-friendly label: first sentence/clause of the request, capped. */
function shortLabel(description: string): string {
  const first = description.split(/[.\n]/)[0]?.replace(/^Voice request:\s*/i, '').replace(/["“”]/g, '').trim() ?? '';
  return first.length > 70 ? `${first.slice(0, 67)}…` : first || 'your task';
}

export async function notifyRunComplete(run: TrackedRun): Promise<void> {
  const label = shortLabel(run.description);
  const summary =
    run.status === 'completed'
      ? `Hermes finished: ${label}.`
      : `Hermes task "${label}" ended with status ${run.status}${
          run.error ? `: ${run.error}` : ''
        }.`;

  // Primary: Hermes' own notify surface when its config has channels.
  try {
    await hermesNotify(summary);
  } catch {
    // already logged inside hermesNotify
  }

  // Fallback / redundancy: hermes gateway (uses the same credentials the
  // user's Discord/Telegram sessions use) or direct webhooks if SSH isn't set.
  if (configuredChannels().length > 0) {
    const results = await sendMessage(summary).catch(() => null);
    if (results && Object.values(results).every((r) => r === 'failed')) {
      console.warn('all direct notification channels failed for run', run.runId);
    }
  }
}
