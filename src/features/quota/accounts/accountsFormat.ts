/**
 * Times in words for the account cards: "Sat 9:00pm", "in 4 days", "11 Dec",
 * "23 days". Day and time follow the browser locale unless one is passed.
 * React-free; locale and time zone are parameters so tests are deterministic.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export interface TimeFormatOptions {
  /** BCP 47 tag; undefined means the browser's own locale. */
  locale?: string;
  timeZone?: string;
}

/** "9:00 PM" reads better tight in a sentence: "9:00pm". Other shapes are left alone. */
const tightenDayPeriod = (time: string): string =>
  time.replace(/\s?([AP])\.?M\.?$/i, (_match, letter: string) => `${letter.toLowerCase()}m`);

/** "11 Dec" (or "Dec 11", as the locale orders it). */
export function formatDay(ms: number, { locale, timeZone }: TimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(ms);
}

/**
 * "Sat 9:00pm" for an instant within a week of `now`; further out the weekday
 * is ambiguous, so the date takes its place: "11 Dec 9:00pm".
 */
export function formatWhen(ms: number, now: number, options: TimeFormatOptions = {}): string {
  const { locale, timeZone } = options;
  const time = tightenDayPeriod(
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(ms)
  );
  const day =
    Math.abs(ms - now) < 7 * DAY_MS
      ? new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(ms)
      : formatDay(ms, options);
  return `${day} ${time}`;
}

type SpanUnit = 'minute' | 'hour' | 'day';

/** Minutes under an hour, hours under a day, whole days after that. */
function spanParts(durationMs: number): { value: number; unit: SpanUnit } {
  const ms = Math.max(0, durationMs);
  if (ms < HOUR_MS) return { value: Math.max(1, Math.round(ms / MINUTE_MS)), unit: 'minute' };
  if (ms < DAY_MS) return { value: Math.round(ms / HOUR_MS), unit: 'hour' };
  return { value: Math.round(ms / DAY_MS), unit: 'day' };
}

/** "23 days", "19 hours". */
export function formatSpan(durationMs: number, locale?: string): string {
  const { value, unit } = spanParts(durationMs);
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

/** "in 4 days", "in 19 hours". */
export function formatIn(durationMs: number, locale?: string): string {
  const { value, unit } = spanParts(durationMs);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(value, unit);
}
