/**
 * Messaging tool (spec §19, §43) — sends via Hermes' own gateway on the VM
 * using `hermes send` (spec's recommended pattern). The messages come from
 * Hermes' own bot identity — the same one your Discord/Telegram chats use.
 *
 * If SSH isn't configured, direct webhooks/bot tokens are the fallback.
 */
import { z } from 'zod';
import type { RegisteredTool } from './registry.js';
import { configuredChannels, sendMessage } from '../state/messaging.js';

const Input = z.object({
  message: z.string().min(1).describe('The text to send.'),
  to: z
    .string()
    .optional()
    .describe(
      'Delivery target — e.g. "discord:<your_discord_username>" (a DM), "discord:#ops" (a channel), "telegram". Omit for the user’s home DM (currently discord:<your_discord_username>).',
    ),
});

export const messagingTools: RegisteredTool[] = [
  {
    name: 'send_message',
    title: 'Send a message',
    description:
      "Push a notification through Hermes' own messaging gateway — Discord/Telegram/etc. — using Hermes' own bot identity. Use for 'ping me on Telegram', 'DM me when it's done', 'send X to manu'.",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        to: {
          type: 'string',
          description:
            'Delivery target, e.g. "discord:<your_discord_username>" or "discord:#ops". Omit to DM the user.',
        },
      },
      required: ['message'],
    },
    handler: async (input) => {
      const { message, to } = Input.parse(input);
      const channels = configuredChannels();
      if (channels.length === 0) {
        return {
          success: false,
          error:
            'No messaging channel configured — set HERMES_SEND_SSH_HOST for the hermes gateway path, or configure a webhook (TELEGRAM_*/DISCORD_*/SLACK_*).',
        };
      }
      try {
        const results = await sendMessage(message, to);
        const ok = Object.values(results).some((r) => r === 'sent');
        return {
          success: ok,
          sentTo: to ?? '(your DM)',
          channel: channels[0],
          results,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },
];
