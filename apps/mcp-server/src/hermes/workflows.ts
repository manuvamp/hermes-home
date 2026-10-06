/**
 * STRUCTURAL STUB — workflow templates for the future registry-remote
 * and Alexa+ Conversations surfaces.
 *
 * The demo's hero interaction ("Hermes, handle this" — spec §33) is a
 * workflow at heart. This file captures the template shapes now so the
 * product work later is filling in behavior, not re-inventing plumbing.
 */
import { z } from 'zod';

export const WorkflowTemplate = z.object({
  id: z.string(),
  title: z.string(),
  trigger: z.enum(['voice', 'schedule', 'event']),
  /** Natural-language brief handed to Hermes as a long run. */
  brief: z.string(),
  /** Tools the workflow is *expected* to rely on (informational). */
  expectedTools: z.array(z.string()).default([]),
  /** Safety posture — whether any auto-action is allowed. */
  requiresConfirmationForActions: z.boolean().default(true),
});
export type WorkflowTemplate = z.infer<typeof WorkflowTemplate>;

/** Example set to be expanded post-hackathon. */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'meeting-prep',
    title: 'Prepare for tomorrow’s meeting',
    trigger: 'voice',
    brief:
      'Find what was discussed last time with this person, check the latest project status, and remind me of anything I promised.',
    expectedTools: ['hermes_start_task', 'hermes_memory_search'],
    requiresConfirmationForActions: true,
  },
  {
    id: 'wind-down',
    title: 'I’m going to bed',
    trigger: 'voice',
    brief:
      'Turn off office and living-room lights, set the bedroom temperature, check tomorrow’s calendar, and tell me the one thing needing attention tomorrow.',
    expectedTools: ['home_control', 'hermes_ask'],
    requiresConfirmationForActions: true,
  },
];
