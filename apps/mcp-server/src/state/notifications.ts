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

export async function notifyRunComplete(run: TrackedRun): Promise<void> {
  const summary =
    run.status === 'completed'
      ? `Hermes finished: "${run.description}". Ask Alexa what it found.`
      : `Hermes task "${run.description}" ended with status ${run.status}${
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
