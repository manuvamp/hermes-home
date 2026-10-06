/**
 * Home Assistant — minimal local REST adapter (spec §16).
 *
 * Talks directly to Home Assistant's REST API (HASS_URL / HASS_TOKEN).
 * A thin, dependency-free subset of the `ha_*` toolset:
 *   listEntities / getState / callService
 *
 * Home Assistant is never exposed to the internet; the MCP server is
 * the only public component (spec §38).
 */

import { config } from '../config.js';

const HASS_URL = config.homeAssistant.url;
const HASS_TOKEN = config.homeAssistant.token;
const TIMEOUT_MS = 5_000;

export type HassEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};

export class HassError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HassError';
  }
}

function configured(): boolean {
  return Boolean(HASS_TOKEN);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!configured()) {
    throw new HassError(
      'Home Assistant not configured — set HASS_URL and HASS_TOKEN.',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HASS_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${HASS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HassError(
        `HA ${method} ${path} failed: HTTP ${res.status} — ${text.slice(0, 200)}`,
        res.status,
      );
    }
    return (text ? (JSON.parse(text) as T) : ({} as T));
  } finally {
    clearTimeout(timer);
  }
}

export async function homeAssistantHealth(): Promise<{
  ok: boolean;
  error?: string;
  detail?: string;
}> {
  if (!configured()) return { ok: false, error: 'HASS_TOKEN not set' };
  try {
    await call<unknown>('GET', '/api/');
    return { ok: true, detail: HASS_URL };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listEntities(domain?: string): Promise<HassEntity[]> {
  const states = await call<HassEntity[]>('GET', '/api/states');
  return domain ? states.filter((s) => s.entity_id.startsWith(`${domain}.`)) : states;
}

export async function getState(entityId: string): Promise<HassEntity> {
  return call<HassEntity>('GET', `/api/states/${encodeURIComponent(entityId)}`);
}

export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  return call<unknown>(
    'POST',
    `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
    data,
  );
}

/**
 * Fuzzy-resolve a user phrase like "office lights" to entity ids.
 * Matches on entity_id and friendly_name; prefers exact-ish matches.
 */
export async function resolveTarget(target: string): Promise<HassEntity[]> {
  const wanted = target.toLowerCase().replace(/\s+/g, ' ');
  const states = await listEntities();
  const score = (e: HassEntity): number => {
    const name = String(e.attributes?.friendly_name ?? '').toLowerCase();
    const id = e.entity_id.toLowerCase();
    if (name === wanted || id === wanted) return 100;
    if (name.includes(wanted) || id.includes(wanted.replace(' ', '_'))) return 50;
    const tokens = wanted.split(' ');
    return tokens.filter((t) => name.includes(t) || id.includes(t)).length;
  };
  return states
    .map((e) => ({ e, s: score(e) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ e }) => e);
}
