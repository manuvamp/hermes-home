/**
 * Outbound messaging notifications (spec §§19, 43).
 *
 * Preferred path: `hermes send` over SSH to the VM (uses the gateway's own
 * Discord/Telegram credentials). Fallback: direct webhooks/bot tokens when
 * SSH isn't configured.
 */
import { config } from '../config.js';
import { hermesSend, hermesSendConfigured } from './hermesSend.js';

export type MessageChannel = 'telegram' | 'discord' | 'slack' | 'hermes';

/**
 * Preferred channel: 'hermes'. Deliveries go through Hermes' OWN messaging
 * gateway on the VM via `hermes send` (spec §19) — the same bot identity your
 * Discord/telegram chat sessions use. No webhooks, no extra bot.
 *
 * Webhooks/bot tokens below are the fallback when SSH to the VM isn't set up.
 */
export function configuredChannels(): MessageChannel[] {
  const out: MessageChannel[] = [];
  if (hermesSendConfigured()) return ['hermes'];
  if (config.messaging.telegramBotToken && config.messaging.telegramChatId) {
    out.push('telegram');
  }
  if (config.messaging.discordWebhookUrl) out.push('discord');
  if (config.messaging.slackWebhookUrl) out.push('slack');
  return out;
}

/** Public surface for the tool layer. `target` overrides the delivery
 *  address for the hermes path (e.g. "discord:<your_discord_username>", "discord:#ops",
 *  "telegram"). */
export async function sendMessage(
  text: string,
  target?: string,
): Promise<Record<string, 'sent' | 'failed'>> {
  if (hermesSendConfigured()) {
    await hermesSend(text, target ?? config.hermes.sendTarget);
    return { hermes: 'sent' };
  }

  const targets: MessageChannel[] = configuredChannels();
  if (targets.length === 0) {
    throw new Error(
      'No messaging channel configured — either set HERMES_SEND_SSH_HOST/USER for hermes send, or configure a TELEGRAM_*/DISCORD_*/SLACK_* webhook.',
    );
  }
  const results: Record<string, 'sent' | 'failed'> = {};
  for (const ch of targets) {
    try {
      if (ch === 'telegram') await sendTelegram(text);
      else if (ch === 'discord') await sendDiscord(text);
      else if (ch === 'slack') await sendSlack(text);
      results[ch] = 'sent';
    } catch {
      results[ch] = 'failed';
    }
  }
  return results;
}

const TIMEOUT_MS = 5_000;

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.messaging.telegramBotToken}/sendMessage`;
  await postJson(url, {
    chat_id: config.messaging.telegramChatId,
    text,
    disable_web_page_preview: true,
  });
}

async function sendDiscord(text: string): Promise<void> {
  await postJson(config.messaging.discordWebhookUrl, { content: text });
}

async function sendSlack(text: string): Promise<void> {
  await postJson(config.messaging.slackWebhookUrl, { text });
}
