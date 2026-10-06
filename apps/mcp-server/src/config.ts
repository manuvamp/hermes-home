/**
 * Centralised runtime configuration.
 *
 * Loads `.env` (if present) without a dependency, then exposes typed,
 * defaulted accessors. Every other module reads from here — never from
 * `process.env` sprinkled through the codebase.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locate the repo .env by walking UP from this file (not from cwd),
 * so `npm run dev:mcp` works whether invoked from the repo root
 * or from apps/mcp-server.
 */
function findEnvFile(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url)); // dist/ when built, src/ with tsx
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const envFile = findEnvFile();
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue; // real env wins
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

function str(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  port: num('PORT', 3000),
  logLevel: str('LOG_LEVEL', 'info'),
  publicBaseUrl: str('PUBLIC_BASE_URL'),

  auth: {
    mode: str('AUTH_MODE', 'local') as 'local' | 'oauth2',
    localToken: str('AUTH_LOCAL_TOKEN'),
    issuer: str('AUTH_ISSUER'),
    audience: str('AUTH_AUDIENCE'),
    jwksUri: str('AUTH_JWKS_URI'),
  },

  hermes: {
    apiUrl: str('HERMES_API_URL', 'http://127.0.0.1:8642').replace(/\/+$/, ''),
    apiKey: str('HERMES_API_KEY'),
    model: str('HERMES_MODEL', 'default'),
    askTimeoutMs: num('HERMES_ASK_TIMEOUT_MS', 20_000),
    required: str('HERMES_REQUIRED', 'true') !== 'false',
    /** SSH delivery for `hermes send` (outbound messaging via the VM gateway) */
    sendSshHost: str('HERMES_SEND_SSH_HOST'),
    sendSshUser: str('HERMES_SEND_SSH_USER', 'cocat'),
    sendSshKey: str('HERMES_SEND_SSH_KEY', String(process.env.USERPROFILE ?? '~') + '/.ssh/id_ed25519'),
    sendSudoUser: str('HERMES_SEND_SUDO_USER', 'openclaw'),
    sendTarget: str('HERMES_SEND_TARGET', 'discord'),
  },

  homeAssistant: {
    url: str('HASS_URL', 'http://homeassistant.local:8123').replace(/\/+$/, ''),
    token: str('HASS_TOKEN'),
  },

  calendar: {
    /** Direct .ics subscription URL (iCloud/Google “secret address”) */
    icsUrl: str('CALENDAR_ICS_URL'),
    /** CalDAV endpoint — do PROPFIND discovery + REPORT */
    caldavUrl: str('CALDAV_URL'),
    username: str('CALDAV_USERNAME'),
    password: str('CALDAV_PASSWORD'),
  },

  github: {
    token: str('GITHUB_TOKEN'),
    user: str('GITHUB_USER'),
  },

  messaging: {
    telegramBotToken: str('TELEGRAM_BOT_TOKEN'),
    telegramChatId: str('TELEGRAM_CHAT_ID'),
    discordWebhookUrl: str('DISCORD_WEBHOOK_URL'),
    slackWebhookUrl: str('SLACK_WEBHOOK_URL'),
  },

  mcpSessionTtlMs: num('MCP_SESSION_TTL_MS', 30 * 60_000),
  memoryPath: str('HERMES_HOME_MEMORY_PATH', './data/memory.json'),
} as const;

export type Config = typeof config;
