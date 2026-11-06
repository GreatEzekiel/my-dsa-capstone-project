// dates.js
// Strict, predictable date handling. Dates are ISO 8601 strings everywhere in this project.
//
// Why not just call Date.parse()? Because it is lenient and depends on the machine:
//   - it accepts odd formats ("Dec 5, 2026") that behave differently in different browsers,
//   - a time written with no zone ("2026-12-05T17:00:00") means "this computer's local time",
//     so the same event would land on different instants on different computers.
// This file accepts only ISO strings, checks that the date REALLY exists, and gives every
// string without a zone one fixed meaning: Lagos time.

import { DomainError, ErrorCode } from './errors.js';

// Nigeria does not use daylight saving, so Lagos is always UTC+01:00.
export const LAGOS_OFFSET_MINUTES = 60;

// The accepted shapes, with each piece captured in a group:
//   2026-12-05                      a date only
//   2026-12-05T17:00                date and time
//   2026-12-05T17:00:00.250         with seconds and milliseconds
//   2026-12-05T17:00:00Z            ...with a zone: Z (UTC) or +01:00 / -05:30
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// True for "2026-12-05" (a calendar day with no time of day).
// A date-only "to" in a search means "up to the END of that day".
export const isDateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });

/**
 * Turns an ISO string into milliseconds since 1970 (the same unit as Date.now()).
 * Throws VALIDATION for anything that is not a real ISO date.
 *
 * endOfDay: for a date-only string, use 23:59:59.999 instead of 00:00:00.000.
 */
export function parseWhen(value, field = 'date', { endOfDay = false } = {}) {
  if (typeof value !== 'string') throw bad(field, 'must be an ISO date string, like 2026-12-05 or 2026-12-05T18:00:00+01:00');
  const m = ISO_PATTERN.exec(value.trim());
  if (!m) throw bad(field, 'must be an ISO date string, like 2026-12-05 or 2026-12-05T18:00:00+01:00');

  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);

  // For a date-only value the clock part is 00:00:00.000, or 23:59:59.999 at the end of the day.
  const dateOnly = h === undefined;
  const hour = dateOnly ? (endOfDay ? 23 : 0) : Number(h);
  const minute = dateOnly ? (endOfDay ? 59 : 0) : Number(mi);
  const second = dateOnly ? (endOfDay ? 59 : 0) : Number(s ?? 0);
  // ".5" means 500 ms, not 5 ms, so pad to three digits on the right first.
  const milli = dateOnly ? (endOfDay ? 999 : 0) : Number((frac ?? '0').padEnd(3, '0'));

  if (year < 1000) throw bad(field, 'year must have four digits');
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) throw bad(field, 'is not a real date');

  // Is the DAY real? Date.UTC "rolls over": 30 February silently becomes 2 March.
  // So build the date, read the pieces back, and insist they are what was written.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw bad(field, 'is not a real date');
  }

  // Which zone was the time written in? Z = UTC, +hh:mm = that offset, nothing = Lagos.
  let offsetMinutes = LAGOS_OFFSET_MINUTES;
  if (zone === 'Z') offsetMinutes = 0;
  else if (zone) {
    const sign = zone[0] === '-' ? -1 : 1;
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59) throw bad(field, 'has an invalid time zone');
    offsetMinutes = sign * (zh * 60 + zm);
  }

  // "17:00 in zone +01:00" happened at 16:00 UTC, so subtract the offset.
  return Date.UTC(year, month - 1, day, hour, minute, second, milli) - offsetMinutes * 60_000;
}
