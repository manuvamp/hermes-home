/**
 * Hermes bridge tools (spec §§11–14).
 *
 * hermes_ask          — quick synchronous answer (bounded).
 * hermes_start_task   — start a long async Hermes run; return id fast.
 * hermes_task_status  — poll one run's status (owner-checked).
 * hermes_task_result  — fetch a completed run's output (owner-checked).
 */
import {
  HermesAskInput,
  HermesStartTaskInput,
  RunIdInput,
} from '@hermes-home/shared';
import type { RegisteredTool } from './registry.js';
import { hermesAsk } from '../hermes/client.js';
import { getRunForUser, startRun } from '../state/runs.js';

const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const hermesTools: RegisteredTool[] = [
  {
    name: 'hermes_ask',
    title: 'Ask Hermes',
    description:
      'Ask the Hermes personal agent a quick question. Use for short factual or memory-flavoured questions. For long research or multi-step work, use hermes_start_task instead.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The question to ask.' },
        context: {
          type: 'string',
          description: 'Optional extra context to help answer.',
        },
      },
      required: ['prompt'],
    },
    handler: async (input) => {
      const { prompt, context } = HermesAskInput.parse(input);
      const answer = await hermesAsk(prompt, context);
      return { success: true, answer, source: 'hermes' };
    },
  },
  {
    name: 'hermes_start_task',
    title: 'Start Hermes task',
    description:
      'Start a long-running Hermes agent task in the background — research, summarising email, planning, multi-step work. Returns immediately with a runId; follow up with hermes_task_status / hermes_task_result.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What Hermes should work on.' },
        context: { type: 'string', description: 'Optional extra context.' },
      },
      required: ['prompt'],
    },
    handler: async (input, ctx) => {
      const { prompt, context } = HermesStartTaskInput.parse(input);
      const run = await startRun(ctx.userId, prompt, context);
      return {
        success: true,
        runId: run.runId,
        status: 'started',
        message: 'Hermes has started working on that.',
      };
    },
  },
  {
    name: 'hermes_task_status',
    title: 'Hermes task status',
    description:
      'Check whether a Hermes background task is queued, running, completed, failed, or cancelled.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string', description: 'The run to check.' } },
      required: ['runId'],
    },
    handler: async (input, ctx) => {
      const { runId } = RunIdInput.parse(input);
      if (!RUN_ID_PATTERN.test(runId)) {
        return { success: false, error: 'Invalid run id.' };
      }
      const run = await getRunForUser(ctx.userId, runId);
      if (!run) {
        return {
          success: false,
          error: 'Unknown or inaccessible runId.',
        };
      }
      return {
        success: true,
        runId: run.runId,
        status: run.status,
        progress:
          run.status === 'running'
            ? 'Hermes is still working.'
            : run.status === 'completed'
              ? 'Ready — ask for the result.'
              : run.error,
      };
    },
  },
  {
    name: 'hermes_task_result',
    title: 'Hermes task result',
    description:
      'Get the result of a completed Hermes task. If it is still running, you get its current status instead.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string', description: 'The run to fetch.' } },
      required: ['runId'],
    },
    handler: async (input, ctx) => {
      const { runId } = RunIdInput.parse(input);
      if (!RUN_ID_PATTERN.test(runId)) {
        return { success: false, error: 'Invalid run id.' };
      }
      const run = await getRunForUser(ctx.userId, runId);
      if (!run) {
        return { success: false, error: 'Unknown or inaccessible runId.' };
      }
      if (run.status !== 'completed' && run.status !== 'failed') {
        return {
          success: false,
          runId: run.runId,
          status: run.status,
          message: 'Hermes is still working.',
        };
      }
      return {
        success: run.status === 'completed',
        runId: run.runId,
        status: run.status,
        result: run.result,
        error: run.error,
      };
    },
  },
];
