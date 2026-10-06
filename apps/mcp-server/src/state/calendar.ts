/**
 * Calendar — dependency-free iCal/CalDAV adapter (spec §43).
 *
 * Works without any npm SDK by understanding the .ics format, which is how
 * every real calendar (Apple, Google, Outlook) offers a read-only view.
 *
 * Two ways to connect (set whichever you have):
 *   CALENDAR_ICS_URL    — secret .ics subscription URL (iCloud/Google) — easiest
 *   CALDAV_URL + CALDAV_USERNAME + CALDAV_PASSWORD — for self-hosted/Nextcloud
 *
 * This is aggressively normalised to a tiny, voice-digestible shape.
 */
import { config } from '../config.js';

export type CalendarEvent = {
  summary: string;
  start: string; // ISO
  end: string;
  allDay: boolean;
  location?: string;
};

const TIMEOUT_MS = 8_000;

function configured(): boolean {
  return Boolean(config.calendar.icsUrl || config.calendar.caldavUrl);
}

export function calendarConfigured(): boolean {
  return configured();
}

/* ---------------- iCal parsing ---------------- */

function unfoldIcs(text: string): string[] {
  // RFC 5545 line-folding: a line starting with space/tab continues the previous.
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw.trim() !== '') {
      out.push(raw);
    }
  }
  return out;
}

function parseDate(value: string): { iso: string; allDay?: boolean } {
  // Handles: 20261005T090000Z · 20261005T090000 · 20261005 (all-day)
  const allDay = /^\d{8}$/.test(value);
  const clean = value.replace(/[^0-9TZ]/gi, '');
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?/);
  if (!m) return { iso: new Date().toISOString(), allDay };
  const [, y, mo, d, h = '00', mi = '00', s = '00', z = ''] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z === 'Z' ? 'Z' : ''}`;
  // Naive local times lack zone; treat as local.
  return { iso: z === 'Z' || allDay ? iso : new Date(iso).toISOString(), allDay };
}

function unescapeText(t: string): string {
  return t
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

export function parseIcs(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let cur: Partial<CalendarEvent> | null = null;
  for (const line of unfoldIcs(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT' && cur) {
      if (cur.summary && cur.start) {
        events.push({
          summary: cur.summary,
          start: cur.start,
          end: cur.end ?? cur.start,
          allDay: cur.allDay ?? false,
          location: cur.location,
        } as CalendarEvent);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const [keyRaw, ...rest] = line.split(':');
    const value = rest.join(':');
    const key = keyRaw.split(';')[0]?.toUpperCase() ?? '';
    if (key === 'SUMMARY') cur.summary = unescapeText(value);
    else if (key === 'DTSTART') {
      const { iso, allDay } = parseDate(value);
      cur.start = iso;
      cur.allDay = allDay;
    } else if (key === 'DTEND') {
      const { iso } = parseDate(value);
      cur.end = iso;
    } else if (key === 'LOCATION') cur.location = unescapeText(value);
  }
  return events;
}

/* ---------------- fetching ---------------- */

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIcsText(): Promise<string> {
  if (config.calendar.icsUrl) {
    return fetchText(config.calendar.icsUrl);
  }
  if (config.calendar.caldavUrl) {
    // Minimal CalDAV REPORT for the coming 90 days. Works with Nextcloud,
    // Baikal, iCloud (app-specific password), and Fastmail.
    const auth = Buffer.from(
      `${config.calendar.username}:${config.calendar.password}`,
    ).toString('base64');
    const now = new Date();
    const in90 = new Date(Date.now() + 90 * 864e5);
    const stamp = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    return fetchText(config.calendar.caldavUrl, {
      method: 'REPORT',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/xml; charset=utf-8',
        depth: '1',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR">
    <c:comp-filter name="VEVENT">
      <c:time-range start="${stamp(now)}" end="${stamp(in90)}"/>
    </c:comp-filter>
  </c:comp-filter></c:filter>
</c:calendar-query>`,
    });
  }
  throw new Error(
    'Calendar not configured — set CALENDAR_ICS_URL or CALDAV_* in .env',
  );
}

export async function listEvents(
  from: Date,
  to: Date,
): Promise<{ events: CalendarEvent[]; source: 'calendar' }> {
  const raw = await fetchIcsText();
  // CalDAV wraps each event's ics in <cal:calendar-data>; strip XML if present.
  const icsChunks = raw.includes('BEGIN:VCALENDAR')
    ? [raw.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g)?.join('\n') ?? raw]
    : [raw];
  const events = icsChunks.flatMap(parseIcs);
  const filtered = events
    .filter((e) => {
      const s = new Date(e.start);
      return s >= from && s < to;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  return { events: filtered, source: 'calendar' };
}

export async function eventsForDay(day: Date): Promise<CalendarEvent[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { events } = await listEvents(start, end);
  return events;
}

export async function today(): Promise<CalendarEvent[]> {
  return eventsForDay(new Date());
}

export async function tomorrow(): Promise<CalendarEvent[]> {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return eventsForDay(d);
}
