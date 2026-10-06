/**
 * Hermes API client — the "real Hermes agent" backend track.
 *
 * Talks to the Hermes HTTP gateway (default http://127.0.0.1:8642):
 *   POST /v1/chat/completions   — quick asks (bounded, short timeout)
 *   POST /v1/runs               — long async tasks, returns a run id
 *   GET  /v1/runs/{id}          — run status / result
 *   GET  /health                — liveness
 *
 * The gateway is NEVER exposed publicly; the MCP server is (spec §38).
 */
import type { RunStatus } from '@hermes-home/shared';
import { config } from '../config.js';

const BASE_URL = config.hermes.apiUrl;
const API_KEY = config.hermes.apiKey;

/** Quick asks must stay well under Alexa+'s ~500 ms guidance for the MCP
 *  hop itself; we allow Hermes a bit longer but bounded so a hung model can
 *  never hang the tool call. */
const ASK_TIMEOUT_MS = config.hermes.askTimeoutMs;
const DEFAULT_TIMEOUT_MS = 10_000;

export type HermesHealth = { ok: boolean; detail?: string };

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export type StartRunResponse = {
  id?: string;
  runId?: string;
  run_id?: string;
  status?: string;
};

export type HermesRun = {
  id: string;
  status: RunStatus;
  output?: string;
  error?: string;
  createdAt?: string;
  completedAt?: string;
  raw: Record<string, unknown>;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (API_KEY) h.authorization = `Bearer ${API_KEY}`;
  return h;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HermesApiError(
        `Hermes ${method} ${path} failed: HTTP ${res.status} — ${text.slice(0, 300)}`,
        res.status,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some dev gateways return plain text for chat completions.
      return { choices: [{ message: { content: text } }] } as unknown as T;
    }
  } finally {
    clearTimeout(timer);
  }
}

export class HermesApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HermesApiError';
  }
}

export async function hermesHealth(): Promise<HermesHealth> {
  try {
    await request<unknown>('GET', '/health', undefined, 5_000);
    return { ok: true, detail: BASE_URL };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Hard startup gate — refuses to run the Alexa+ bridge demo against a stub. */
export async function assertHermesReady(): Promise<void> {
  if (!config.hermes.required) return;
  const health = await hermesHealth();
  if (!health.ok) {
    throw new Error(
      [
        `Hermes gateway not reachable at ${BASE_URL} (/health failed: ${health.detail}).`,
        'Hermes Home requires a REAL Hermes runtime — start it first:',
        '  hermes gateway   # (API_SERVER_ENABLED=true, API_SERVER_KEY set)',
        'or point HERMES_API_URL at your cloud/VM Hermes.',
        'Set HERMES_REQUIRED=false only for unit tests.',
      ].join('\n'),
    );
  }
}

/** Quick synchronous answer from the Hermes agent. */
export async function hermesAsk(prompt: string, context?: string): Promise<string> {
  const message = context ? `${prompt}\n\nContext:\n${context}` : prompt;
  const res = await request<CompletionResponse>(
    'POST',
    '/v1/chat/completions',
    {
      model: process.env.HERMES_MODEL ?? 'default',
      messages: [{ role: 'user', content: message }],
    },
    ASK_TIMEOUT_MS,
  );
  if (res.error) throw new HermesApiError(res.error.message ?? 'Hermes error');
  const answer = res.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new HermesApiError('Hermes returned an empty completion');
  return answer;
}

/** Start a long async run; returns the run id immediately (spec §12). */
export async function hermesStartRun(
  prompt: string,
  context?: string,
): Promise<string> {
  const message = context ? `${prompt}\n\nContext:\n${context}` : prompt;
  const res = await request<StartRunResponse>(
    'POST',
    '/v1/runs',
    { input: message },
    DEFAULT_TIMEOUT_MS,
  );
  const id = res.id ?? res.runId ?? res.run_id;
  if (!id) throw new HermesApiError('Hermes /v1/runs returned no run id');
  return id;
}

/** Get one run, normalised. Hermes' own status values are authoritative. */
export async function hermesGetRun(id: string): Promise<HermesRun> {
  const raw = await request<Record<string, unknown>>(
    'GET',
    `/v1/runs/${encodeURIComponent(id)}`,
  );
  return normaliseRun(id, raw);
}

function normaliseRun(id: string, raw: Record<string, unknown>): HermesRun {
  const realId =
    (raw.run_id as string | undefined) ?? (raw.id as string | undefined) ?? id;
  const status = String(raw.status ?? raw.state ?? 'running') as RunStatus;
  const rawOutput = raw.output;
  const output =
    (typeof rawOutput === 'string' ? rawOutput : undefined) ??
    (raw.result as string | undefined) ??
    ((raw.final_output as { content?: string } | undefined)?.content ??
      undefined) ??
    (raw.message as string | undefined);
  return {
    id: realId,
    status,
    output,
    error: raw.error as string | undefined,
    createdAt: raw.created_at as string | undefined,
    completedAt: raw.completed_at as string | undefined,
    raw,
  };
}

/** Push to a configured messaging target via Hermes' notification surface. */
export async function hermesNotify(push: string): Promise<void> {
  // Hermes exposes a notification/send surface; exact path may differ
  // per version — if it's absent this degrades gracefully and the
  // notification worker logs it.
  await request<unknown>('POST', '/v1/notify', { message: push }).catch(
    (err) => {
      console.warn('hermes notify failed (non-fatal):', err);
    },
  );
}
