/**
 * Calendar tools (spec §43).
 *
 * calendar_today    — what's on the calendar today
 * calendar_tomorrow — what's on tomorrow
 * calendar_events   — events in an explicit date range
 *
 * Output is aggressively small, voice-friendly, and never dumps raw iCal.
 */
import { z } from 'zod';
import type { RegisteredTool } from './registry.js';
import {
  calendarConfigured,
  eventsForDay,
  listEvents,
} from '../state/calendar.js';

const RangeInput = z.object({
  from: z.string().describe('Start date (ISO, e.g. 2026-10-03).'),
  to: z.string().describe('End date exclusive (ISO).'),
});

function fmt(e: {
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}) {
  const start = new Date(e.start);
  return {
    title: e.summary,
    time: e.allDay
      ? 'all day'
      : start.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        }),
    location: e.location,
  };
}

function unavailable(): Record<string, unknown> {
  return {
    success: false,
    error:
      'Calendar not configured yet — set CALENDAR_ICS_URL (or CALDAV_*) in .env and restart.',
  };
}

export const calendarTools: RegisteredTool[] = [
  {
    name: 'calendar_today',
    title: "Today's calendar",
    description:
      "List today's calendar events. Use for 'what's on my calendar today', 'what does today look like'.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!calendarConfigured()) return unavailable();
      const events = await eventsForDay(new Date());
      return {
        success: true,
        source: 'calendar',
        count: events.length,
        events: events.map(fmt),
      };
    },
  },
  {
    name: 'calendar_tomorrow',
    title: "Tomorrow's calendar",
    description:
      "List tomorrow's calendar events. Use for 'what's on my calendar tomorrow', 'what do I have tomorrow'.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!calendarConfigured()) return unavailable();
      const d = new Date();
      d.setDate(d.getDate() + 1);
      const events = await eventsForDay(d);
      return {
        success: true,
        source: 'calendar',
        count: events.length,
        events: events.map(fmt),
      };
    },
  },
  {
    name: 'calendar_events',
    title: 'Calendar events',
    description: 'List calendar events between two dates (inclusive start, exclusive end).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date ISO, e.g. 2026-10-03' },
        to: { type: 'string', description: 'End date exclusive, ISO' },
      },
      required: ['from', 'to'],
    },
    handler: async (input) => {
      if (!calendarConfigured()) return unavailable();
      const { from, to } = RangeInput.parse(input);
      const { events } = await listEvents(new Date(from), new Date(to));
      return { success: true, source: 'calendar', count: events.length, events: events.map(fmt) };
    },
  },
];
