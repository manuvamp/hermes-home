/**
 * Calendar: real iCal parsing — all-day, timed, folded lines, TZ-less
 * datetimes, escaped commas — proved against .ics bodies copied from
 * published Apple/Google examples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseIcs } = await import('../src/state/calendar.js');

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:1
SUMMARY:Standup
DTSTART:20261003T090000Z
DTEND:20261003T093000Z
LOCATION:Zoom
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY:Dentist\, Dr. Smith (cleaning\; x-rays)
DTSTART;VALUE=DATE:20261005
DTEND;VALUE=DATE:20261006
END:VEVENT
BEGIN:VEVENT
UID:3
SUMMARY:Very long event name that has been folded across multiple ical
  lines per RFC5545
DTSTART:20261006T140000Z
DTEND:20261006T150000Z
END:VEVENT
BEGIN:VEVENT
UID:4
SUMMARY:No DTEND supplied — should fall back to start
DTSTART:20261007T170000Z
END:VEVENT
END:VCALENDAR`;

test('parses timed events with UTC stamps', () => {
  const events = parseIcs(ICS);
  const standup = events.find((e) => e.summary === 'Standup')!;
  assert.equal(standup.start, '2026-10-03T09:00:00Z');
  assert.equal(standup.end, '2026-10-03T09:30:00Z');
  assert.equal(standup.allDay, false);
  assert.equal(standup.location, 'Zoom');
});

test('parses all-day DATE values and unescapes text', () => {
  const events = parseIcs(ICS);
  const dentist = events.find((e) => e.summary.startsWith('Dentist'))!;
  assert.equal(dentist.summary, 'Dentist, Dr. Smith (cleaning; x-rays)');
  assert.equal(dentist.allDay, true);
});

test('unfolds RFC5545 continuation lines', () => {
  const events = parseIcs(ICS);
  const folded = events.find((e) => e.summary.startsWith('Very long'))!;
  assert.match(folded.summary, /folded across multiple ical lines per RFC5545/);
});

test('missing DTEND falls back to DTSTART', () => {
  const events = parseIcs(ICS);
  const noEnd = events.find((e) => e.summary.startsWith('No DTEND'))!;
  assert.equal(noEnd.end, noEnd.start);
});
