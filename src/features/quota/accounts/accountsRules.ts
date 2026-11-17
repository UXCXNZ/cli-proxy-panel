/**
 * The rules behind an account card: thresholds, colours, figures and the
 * one-line verdict. Pure and clock-free (`now` is passed in) so the numbers
 * here are easy to change and directly testable.
 */

/** At or below this much LEFT a limit is "low" (red). */
export const LOW_LEFT_PERCENT = 20;
/** At or below this much LEFT a limit is "mid" (amber). */
export const MID_LEFT_PERCENT = 50;
/** A free reset expiring within this many days is highlighted. */
export const EXPIRING_SOON_DAYS = 7;

export type CountMode = 'left' | 'used';
export type Tone = 'low' | 'mid' | 'ok';

export type LimitScope = 'account' | 'model';
export type LimitWindow = 'session' | 'weekly' | 'monthly';

/** One quota limit on an account, already reduced to whole percent left. */
export interface AccountLimit {
  id: string;
  scope: LimitScope;
  window: LimitWindow;
  /** Model or feature name for a scoped limit; null for a whole-account limit. */
  name: string | null;
  /** True when `name` is the provider's own full label, shown as it is. */
  verbatim?: boolean;
  /** Whole percent left, 0..100. */
  left: number;
  resetAtMs: number | null;
}

/** Colour always describes what is LEFT, whichever way the figure is counted. */
export const toneFor = (left: number): Tone =>
  left <= LOW_LEFT_PERCENT ? 'low' : left <= MID_LEFT_PERCENT ? 'mid' : 'ok';

/**
 * The number shown for a limit, and the width of its bar. In Used the bar
 * fills as quota is spent; in Left it empties.
 */
export const figureFor = (left: number, mode: CountMode): number =>
  mode === 'left' ? left : 100 - left;

export const isSpent = (limit: AccountLimit): boolean => limit.left <= 0;

/** Whole-account limits outrank model limits; a long window outranks the session one. */
const importance = (limit: AccountLimit): number =>
  limit.scope === 'account' ? (limit.window === 'session' ? 1 : 0) : 2;

/** Reading order on a card and in the table: Weekly, Monthly, models, then 5-hour. */
const displayRank = (limit: AccountLimit): number => {
  if (limit.window === 'session') return limit.scope === 'account' ? 3 : 4;
  if (limit.scope === 'model') return 2;
  return limit.window === 'weekly' ? 0 : 1;
};

export const sortLimits = (limits: readonly AccountLimit[]): AccountLimit[] =>
  limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => displayRank(a.limit) - displayRank(b.limit) || a.index - b.index)
    .map((item) => item.limit);

export type Verdict =
  | { kind: 'spent'; limit: AccountLimit; resetAtMs: number | null; freeResets: number }
  | { kind: 'low'; limit: AccountLimit; resetAtMs: number | null }
  | { kind: 'plenty'; resetAtMs: number | null };

/**
 * The card's headline.
 *
 * - any limit at 0% left: that limit "is spent" (the whole-account one wins);
 * - else the lowest limit at LOW_LEFT_PERCENT or less: "Running low";
 * - else "Plenty left", with the soonest upcoming reset.
 *
 * `freeResetsFor` says how many usable free resets would refill a limit.
 * Returns null when there are no limits to judge.
 */
export function verdictFor(
  limits: readonly AccountLimit[],
  freeResetsFor: (limit: AccountLimit) => number,
  now: number
): Verdict | null {
  if (limits.length === 0) return null;
  const ranked = limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => importance(a.limit) - importance(b.limit) || a.index - b.index)
    .map((item) => item.limit);

  const spent = ranked.find(isSpent);
  if (spent) {
    return {
      kind: 'spent',
      limit: spent,
      resetAtMs: spent.resetAtMs,
      freeResets: freeResetsFor(spent),
    };
  }

  const lowest = ranked.reduce((best, limit) => (limit.left < best.left ? limit : best));
  if (lowest.left <= LOW_LEFT_PERCENT) {
    return { kind: 'low', limit: lowest, resetAtMs: lowest.resetAtMs };
  }

  const upcoming = limits
    .map((limit) => limit.resetAtMs)
    .filter((at): at is number => at !== null && at > now);
  return { kind: 'plenty', resetAtMs: upcoming.length > 0 ? Math.min(...upcoming) : null };
}

export const verdictTone = (verdict: Verdict): Tone =>
  verdict.kind === 'spent' ? 'low' : verdict.kind === 'low' ? 'mid' : 'ok';
