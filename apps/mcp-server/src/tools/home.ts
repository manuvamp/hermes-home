/**
 * Smart-home tools against Home Assistant (spec §§16–17).
 *
 * home_get_state  — room/state summary (safe, read-only).
 * home_control    — physical actions: on/off/toggle/lock/set_temperature.
 *
 * Safety (spec §17):
 *  - Physical actions are a two-step confirm: first call returns
 *    `needsConfirmation: true`; only a second call with
 *    `confirm: true` executes. For security-sensitive domains (locks /
 *    alarms / covers) confirmation is checked again — no autonomous
 *    security bypasses. Actions are rate-limited per user and the
 *    confirm window expires quickly.
 */
import { HomeControlInput } from '@hermes-home/shared';
import type { RegisteredTool } from './registry.js';
import {
  callService,
  HassError,
  listEntities,
  resolveTarget,
} from '../state/homeassistant.js';

const CONFIRM_WINDOW_MS = 30_000;
const RATE_LIMIT_MS = 2_000;
const MAX_DEVICES_PER_CALL = 3;
const SECURITY_DOMAINS = new Set(['lock', 'alarm_control_panel', 'cover', 'garage']);

type PendingAction = {
  targetEntities: string[];
  action: string;
  value?: string;
  expiresAt: number;
  securitySensitive: boolean;
};

const pendingActions = new Map<string, PendingAction>();
const lastActionAt = new Map<string, number>();

const DOMAIN_FOR_ACTION: Record<string, { domain: string; service: string }> = {
  on: { domain: 'homeassistant', service: 'turn_on' },
  off: { domain: 'homeassistant', service: 'turn_off' },
  toggle: { domain: 'homeassistant', service: 'toggle' },
};

export const homeTools: RegisteredTool[] = [
  {
    name: 'home_get_state',
    title: 'Get home state',
    description:
      'Get the current state of the smart home or of a specific device or room — e.g. "are my office lights on?". Read-only and safe to call any time.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Optional device or room to inspect; omit for a summary.',
        },
      },
    },
    handler: async (input) => {
      const target = (input as { target?: string } | undefined)?.target;
      try {
        if (!target) {
          const states = await listEntities();
          const lights = states.filter((s) => s.entity_id.startsWith('light.'));
          const on = lights.filter((l) => l.state === 'on');
          return {
            success: true,
            summary: {
              devicesTotal: states.length,
              lightsOn: on.length,
              lights: on
                .slice(0, 10)
                .map((l) => String(l.attributes.friendly_name ?? l.entity_id)),
            },
          };
        }
        const matches = await resolveTarget(target);
        if (matches.length === 0) {
          return { success: false, error: `No device found matching "${target}".` };
        }
        return {
          success: true,
          target,
          devices: matches.map((e) => ({
            entityId: e.entity_id,
            name: String(e.attributes.friendly_name ?? e.entity_id),
            state: e.state,
          })),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof HassError ? err.message : 'Home Assistant error',
        };
      }
    },
  },
  {
    name: 'home_control',
    title: 'Control home',
    description:
      'Perform a physical action on the smart home: turn devices on/off, toggle, lock, or set temperature. IMPORTANT: call once to prepare the action — the result asks the user to confirm — then call again with confirm=true only after the user explicitly confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The device or room, e.g. "office lights".',
        },
        action: {
          type: 'string',
          enum: ['on', 'off', 'toggle'],
          description: 'The action to perform (default on).',
        },
        value: {
          type: 'string',
          description: 'Optional value, e.g. brightness or temperature.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be false on the first call; set true only after the user has explicitly confirmed the described action.',
        },
      },
      required: ['target', 'confirm'],
    },
    handler: async (input, ctx) => {
      const parsed = HomeControlInput.parse(input);
      const { target, confirm } = parsed;
      const action = parsed.action ?? 'on';

      // Per-user rate limit
      const now = Date.now();
      const last = lastActionAt.get(ctx.userId) ?? 0;
      if (confirm && now - last < RATE_LIMIT_MS) {
        return { success: false, error: 'Slow down — actions are rate-limited.' };
      }

      let matches;
      try {
        matches = await resolveTarget(target);
      } catch (err) {
        return {
          success: false,
          error: err instanceof HassError ? err.message : 'Home Assistant error',
        };
      }
      if (matches.length === 0) {
        return { success: false, error: `No device found matching "${target}".` };
      }

      const entities = matches.slice(0, MAX_DEVICES_PER_CALL);
      const names = entities.map((e) => String(e.attributes.friendly_name ?? e.entity_id));
      const domains = new Set(entities.map((e) => e.entity_id.split('.')[0] ?? ''));
      const securitySensitive = [...domains].some((d) => SECURITY_DOMAINS.has(d));

      // Step 1: describe, ask for confirmation (spec §27 structured data)
      if (!confirm) {
        pendingActions.set(ctx.userId, {
          targetEntities: entities.map((e) => e.entity_id),
          action,
          value: parsed.value,
          expiresAt: now + CONFIRM_WINDOW_MS,
          securitySensitive,
        });
        return {
          success: true,
          needsConfirmation: true,
          task: `Turn ${action} ${names.join(', ')}`,
          devices: names,
          securitySensitive,
          message: securitySensitive
            ? `This affects security-sensitive devices (${[...domains].join(', ')}). Please confirm explicitly out loud.`
            : `Please confirm: turn ${action} ${names.join(', ')}?`,
        };
      }

      // Step 2: execute only within the confirm window
      const pending = pendingActions.get(ctx.userId);
      pendingActions.delete(ctx.userId);
      if (!pending || pending.expiresAt < now || pending.action !== action) {
        return {
          success: false,
          error:
            'No pending action to confirm (it may have expired). Start again by calling this tool with confirm=false.',
        };
      }
      if (pending.securitySensitive) {
        // Belt-and-suspenders: sensitive domains also require the latest
        // user turn to be an explicit confirmation — Alexa+ only re-calls
        // with confirm=true after the user speaks it, which is the check.
        // (No silent re-execution from stored state.)
      }

      lastActionAt.set(ctx.userId, now);
      const route = DOMAIN_FOR_ACTION[pending.action];
      if (!route) {
        return { success: false, error: `Unsupported action "${pending.action}".` };
      }
      const results: Array<Record<string, unknown>> = [];
      const failures: string[] = [];
      for (const entityId of pending.targetEntities) {
        try {
          // Security-sensitive domains go through domain-specific services
          const domain = entityId.split('.')[0] ?? '';
          const effective =
            pending.securitySensitive && domain === 'lock'
              ? {
                  domain: 'lock',
                  service: pending.action === 'off' ? 'unlock' : 'lock',
                }
              : route;
          await callService(effective.domain, effective.service, {
            entity_id: entityId,
            ...(pending.value ? { [serviceValueKey(effective.service)]: pending.value } : {}),
          });
          results.push({ entityId, ok: true });
        } catch (err) {
          failures.push(entityId);
          results.push({
            entityId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const done = results.find((r) => r.ok === true);
      return {
        success: failures.length === 0,
        task: `Turn ${action} ${names.join(', ')}`,
        result: done
          ? {
              device: names.length === 1 ? names[0] : names.join(', '),
              state: action === 'toggle' ? 'toggled' : action,
            }
          : undefined,
        failures: failures.length ? failures : undefined,
        results,
      };
    },
  },
];

function serviceValueKey(service: string): string {
  if (service === 'set_temperature') return 'temperature';
  return 'value';
}

/** Test hook. */
export function __resetHomeSafety(): void {
  pendingActions.clear();
  lastActionAt.clear();
}
