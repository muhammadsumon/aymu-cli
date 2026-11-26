// GLOSSARY 2.2 / ARCHITECTURE ADR-09: D1 stores UTC epoch milliseconds; the wire uses ISO 8601 UTC with
// milliseconds and `Z`; Paddle ordering uses epoch microseconds parsed from RFC 3339 `occurred_at`.
import { z } from 'zod';

export const DAY_MS = 86_400_000;

/** Wire instant: `2026-11-22T11:38:00.000Z` (exactly millisecond precision, no offset). https://zod.dev/api#iso-datetimes */
export const Instant = z.iso.datetime({ precision: 3 });
export type Instant = z.infer<typeof Instant>;

/** Date → wire instant. `Date#toISOString` always emits UTC with milliseconds and `Z`. */
export function toInstant(date: Date): Instant {
  return date.toISOString();
}

export function toInstantOrNull(date: Date | null): Instant | null {
  return date === null ? null : date.toISOString();
}

/** `utc_day = floor(epoch_ms / 86_400_000)` (GLOSSARY 2.2). */
export function utcDay(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

/** Fair-use windows run from 00:00:00.000Z to 23:59:59.999Z; this is the last millisecond of `at`'s UTC day. */
export function utcDayEnd(at: Date): Date {
  return new Date((utcDay(at) + 1) * DAY_MS - 1);
}

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Parses an RFC 3339 timestamp (https://www.rfc-editor.org/rfc/rfc3339#section-5.6) into UTC epoch
 * **microseconds**, keeping sub-millisecond digits so that two Paddle events in the same millisecond still order
 * strictly (GLOSSARY 2.2, `last_event_occurred_us`). Digits beyond microseconds are truncated. Returns null when
 * the input is not RFC 3339 or names an impossible date.
 */
export function rfc3339ToEpochMicros(value: string): number | null {
  const m = RFC3339_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac = '', zone = 'Z'] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) ||
    check.getUTCHours() !== Number(h) ||
    check.getUTCMinutes() !== Number(mi) ||
    check.getUTCSeconds() !== Number(s)
  ) {
    return null;
  }
  const micros = Number((frac + '000000').slice(0, 6));
  let offsetMinutes = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  }
  const result = (ms - offsetMinutes * 60_000) * 1000 + micros;
  return Number.isSafeInteger(result) ? result : null;
}

/** Adds whole calendar months in UTC, clamping a day-of-month missing from the target month to its last day. */
export function addUtcMonthsClamped(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}
