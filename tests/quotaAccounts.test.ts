import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  formatDay,
  formatIn,
  formatSpan,
  formatWhen,
} from '@/features/quota/accounts/accountsFormat';
import {
  resetScopeLabel,
  resetsSummaryLine,
  verdictText,
} from '@/features/quota/accounts/accountsLabels';
import {
  accountFigures,
  deriveLimits,
  expiresSoon,
  naturalReturnMs,
  resetEffect,
  resetsFromClaudeGrants,
  resetsFromCodexCredits,
  tableColumns,
  totalResets,
} from '@/features/quota/accounts/accountsModel';
import {
  figureFor,
  toneFor,
  verdictFor,
  verdictTone,
  type AccountLimit,
} from '@/features/quota/accounts/accountsRules';
import { parseAccountsSettings } from '@/features/quota/accounts/accountsSettings';
import { buildClaudeQuotaWindows } from '@/features/quota/providers/claude/data';
import { buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import en from '@/i18n/locales/en.json';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-17T00:34:00Z');
const UTC = { locale: 'en-US', timeZone: 'UTC' };

const keyT = ((key: string) => key) as TFunction;

/** English strings with interpolation and the one/other plural, enough for these tests. */
const t = ((key: string, params: Record<string, string | number> = {}) => {
  const lookup = (path: string) =>
    path
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  const plural = typeof params.count === 'number' ? (params.count === 1 ? '_one' : '_other') : '';
  const template = lookup(`${key}${plural}`) ?? lookup(key);
  if (typeof template !== 'string') return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name]));
}) as TFunction;

const limit = (id: string, left: number, extra: Partial<AccountLimit> = {}): AccountLimit => ({
  id,
  scope: 'account',
  window: 'weekly',
  name: null,
  left,
  resetAtMs: NOW + 4 * DAY,
  ...extra,
});
const weekly = (left: number, resetAtMs = NOW + 4 * DAY) => limit('seven-day', left, { resetAtMs });
const fable = (left: number, resetAtMs = NOW + 19 * HOUR) =>
  limit('seven-day-fable', left, { scope: 'model', name: 'Fable', resetAtMs });
const session = (left: number, resetAtMs = NOW + 2 * HOUR) =>
  limit('five-hour', left, { window: 'session', resetAtMs });

const grant = (id: string, extra: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id,
  label: '',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: null,
  clears: [],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...extra,
});

describe('left and used figures', () => {
  test('the figure and bar flip with the count, and always sum to the whole', () => {
    expect(figureFor(69, 'left')).toBe(69);
    expect(figureFor(69, 'used')).toBe(31);
    expect(figureFor(0, 'used')).toBe(100);
  });

  test('colour describes what is left, whichever way it is counted', () => {
    expect(toneFor(0)).toBe('low');
    expect(toneFor(20)).toBe('low');
    expect(toneFor(21)).toBe('mid');
    expect(toneFor(50)).toBe('mid');
    expect(toneFor(51)).toBe('ok');
  });
});

describe('verdict rules', () => {
  test('a spent limit names itself, with the natural return and any free reset', () => {
    const verdict = verdictFor([weekly(15), fable(0)], () => 4, NOW);
    expect(verdict).toMatchObject({ kind: 'spent', freeResets: 4 });
    expect(verdictTone(verdict!)).toBe('low');
    const words = verdictText(t, verdict!, NOW, 'en');
    expect(words.title).toBe('Fable is spent');
    expect(words.sub).toMatch(/^Back .+, in 19 hours\. Or use a free reset\.$/);
  });

  test('with several spent, the whole-account weekly limit wins', () => {
    const verdict = verdictFor([session(0), fable(0), weekly(0)], () => 0, NOW);
    const words = verdictText(t, verdict!, NOW, 'en');
    expect(words.title).toBe('Weekly limit is spent');
    expect(words.sub).toMatch(/^Back .+, in 4 days\.$/);
  });

  test('the sub line never states a count, so it cannot disagree with the footer', () => {
    const words = verdictText(
      t,
      verdictFor([weekly(0)], () => 1, NOW)!,
      NOW,
      'en'
    );
    expect(words.sub).toEndWith('Or use a free reset.');
  });

  test('the lowest limit at the threshold or under reads as running low', () => {
    const verdict = verdictFor([weekly(15), fable(45)], () => 0, NOW);
    expect(verdict).toMatchObject({ kind: 'low' });
    expect(verdictTone(verdict!)).toBe('mid');
    const words = verdictText(t, verdict!, NOW, 'en');
    expect(words.title).toBe('Running low');
    expect(words.sub).toMatch(/^Weekly has 15% left\. Resets .+, in 4 days\.$/);
    expect(verdictFor([weekly(21)], () => 0, NOW)?.kind).toBe('plenty');
  });

  test('otherwise there is plenty left, until the soonest upcoming reset', () => {
    const verdict = verdictFor([weekly(69), fable(45, NOW + 6 * DAY), session(90)], () => 0, NOW);
    expect(verdict).toEqual({ kind: 'plenty', resetAtMs: NOW + 2 * HOUR });
    expect(verdictTone(verdict!)).toBe('ok');
    const words = verdictText(t, verdict!, NOW, 'en');
    expect(words.title).toBe('Plenty left');
    expect(words.sub).toMatch(/^Resets .+, in 2 hours\.$/);
  });

  test('no limits means no verdict, and a passed reset is not promised', () => {
    expect(verdictFor([], () => 0, NOW)).toBeNull();
    expect(verdictFor([weekly(80, NOW - HOUR)], () => 0, NOW)).toEqual({
      kind: 'plenty',
      resetAtMs: null,
    });
  });
});

describe('limits derived from upstream quota states', () => {
  test('Claude: weekly, the model limit by name, then the 5-hour window', () => {
    const windows = buildClaudeQuotaWindows(
      {
        five_hour: { utilization: 10, resets_at: '2026-11-17T03:00:00Z' },
        seven_day: { utilization: 31.4, resets_at: '2026-11-21T08:00:00Z' },
        limits: [
          {
            kind: 'weekly_scoped',
            group: 'weekly',
            percent: 100,
            resets_at: '2026-11-17T20:00:00Z',
            is_active: true,
            scope: { model: { id: null, display_name: 'Fable' } },
          },
        ],
      },
      keyT
    );
    const limits = deriveLimits('claude', { status: 'success', windows });
    expect(limits).toEqual([
      {
        id: 'seven-day',
        scope: 'account',
        window: 'weekly',
        name: null,
        left: 69,
        resetAtMs: Date.parse('2026-11-21T08:00:00Z'),
      },
      {
        id: 'seven-day-fable',
        scope: 'model',
        window: 'weekly',
        name: 'Fable',
        left: 0,
        resetAtMs: Date.parse('2026-11-17T20:00:00Z'),
      },
      {
        id: 'five-hour',
        scope: 'account',
        window: 'session',
        name: null,
        left: 90,
        resetAtMs: Date.parse('2026-11-17T03:00:00Z'),
      },
    ]);
  });

  test('Claude: a dollar credit pool and a window with no figure are not limits', () => {
    const limits = deriveLimits('claude', {
      status: 'success',
      windows: [
        { id: 'cloud-session-credits', label: 'Cloud session credits', usedPercent: 5 },
        { id: 'seven-day', label: 'Weekly limit', usedPercent: null },
      ],
    });
    expect(limits).toEqual([]);
  });

  test('Codex: weekly, then an additional limit under its model name', () => {
    const windows = buildCodexQuotaWindows(
      {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 35, limit_window_seconds: 604800, reset_at: 1785902974 },
          secondary_window: null,
        },
        additional_rate_limits: [
          {
            limit_name: 'GPT-5.3-Codex-Spark',
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: {
                used_percent: 0,
                limit_window_seconds: 604800,
                reset_at: 1785903197,
              },
              secondary_window: null,
            },
          },
        ],
      },
      keyT
    );
    const limits = deriveLimits('codex', { status: 'success', windows }) ?? [];
    expect(limits.map(({ scope, window, name, left }) => ({ scope, window, name, left }))).toEqual([
      { scope: 'account', window: 'weekly', name: null, left: 65 },
      { scope: 'model', window: 'weekly', name: 'GPT-5.3-Codex-Spark', left: 100 },
    ]);
    expect(limits[0].resetAtMs).toBe(1785902974 * 1000);
  });

  test('Antigravity keeps fractional Gemini limits and leaves the other groups to Details', () => {
    const resetTime = '2026-11-21T04:30:15Z';
    const limits = deriveLimits('antigravity', {
      groups: [
        {
          id: 'third-party',
          buckets: [{ id: '3p-5h', remainingFraction: 0.3 }],
        },
        {
          id: 'gemini',
          buckets: [
            { id: 'gemini-weekly', remainingFraction: 0.9978293 },
            { id: 'gemini-5h', remainingFraction: 0.9924027, resetTime },
          ],
        },
        {
          id: 'argon',
          buckets: [{ id: 'gemini-argon-wtu-weekly', remainingFraction: 0.2 }],
        },
      ],
    });

    expect(limits?.map(({ id }) => id)).toEqual(['gemini-5h', 'gemini-weekly']);
    expect(limits?.[0].resetAtMs).toBe(Date.parse(resetTime));
    expect(limits?.map(({ left }) => figureFor(left, 'left'))).toEqual([99.24, 99.78]);
    expect(limits?.map(({ left }) => figureFor(left, 'used'))).toEqual([0.76, 0.22]);
    expect(deriveLimits('antigravity', { groups: [{ buckets: [] }] })).toEqual([]);
  });

  test('other providers are not derived, so the page keeps upstream cards for them', () => {
    expect(deriveLimits('kimi', { status: 'success', rows: [] })).toBeNull();
  });

  test('Claude keeps its last figures while refreshing; other states need success', () => {
    const windows = [{ id: 'seven-day', label: '', usedPercent: 40, resetLabel: '' }];
    expect(accountFigures('claude', { status: 'loading', windows } as never).hasFigures).toBeTrue();
    expect(accountFigures('codex', { status: 'loading', windows } as never).hasFigures).toBeFalse();
    expect(accountFigures('codex', undefined)).toEqual({ hasFigures: false, limits: [] });
  });

  test('the table has one column per kind of limit, weekly first', () => {
    const columns = tableColumns([[weekly(65)], [fable(0), weekly(15)], [session(50)]]);
    expect(columns.map((column) => column.id)).toEqual([
      'seven-day',
      'seven-day-fable',
      'five-hour',
    ]);
  });
});

describe('free resets', () => {
  const grants = [
    grant('fable_a', {
      label: 'New model launch',
      endsAt: '2027-03-09T00:00:00Z',
      givesBackWeekly: true,
    }),
    grant('spent', { resetsLeft: 0, endsAt: '2026-11-18T00:00:00Z' }),
    grant('no_expiry', { resetType: 'session' }),
    grant('full', {
      resetType: 'full',
      endsAt: '2026-12-11T00:00:00Z',
      resetsLeft: 2,
      resetsTotal: 2,
    }),
    grant('weekly', { resetType: 'weekly', endsAt: '2027-03-09T00:00:00Z' }),
  ];
  const resets = resetsFromClaudeGrants(grants);

  test('sorted by soonest expiry, ties in the order given, unknown expiry last', () => {
    expect(resets.map((reset) => reset.id)).toEqual(['full', 'fable_a', 'weekly', 'no_expiry']);
    expect(totalResets(resets)).toBe(5);
  });

  test('each says what it resets', () => {
    expect(resets.map((reset) => resetScopeLabel(t, reset.scope))).toEqual([
      'Everything',
      'Fable only',
      'Weekly only',
      '5-hour only',
    ]);
    expect(resetScopeLabel(t, resetsFromClaudeGrants([grant('plain')])[0].scope)).toBe(
      'Limit reset'
    );
  });

  test('a reset expiring within a week is flagged', () => {
    const soon = resetsFromClaudeGrants([
      grant('soon', { endsAt: new Date(NOW + 6 * DAY).toISOString() }),
      grant('later', { endsAt: new Date(NOW + 8 * DAY).toISOString() }),
    ]);
    expect(soon.map((reset) => expiresSoon(reset, NOW))).toEqual([true, false]);
  });

  test('a model-only reset refills that model and nothing else in full', () => {
    const fableReset = resets.find((reset) => reset.id === 'fable_a')!;
    expect(resetEffect(fableReset, fable(0))).toBe('full');
    // Upstream: the model's share returns to the weekly allowance, by an unstated amount.
    expect(resetEffect(fableReset, weekly(15))).toBe('partial');
    expect(resetEffect(fableReset, session(40))).toBe('none');
    expect(
      resetEffect(fableReset, limit('seven-day-opus', 30, { scope: 'model', name: 'Opus' }))
    ).toBe('none');
    expect(naturalReturnMs(fableReset, [weekly(15), fable(0)])).toBe(NOW + 19 * HOUR);
  });

  test('a full reset refills everything; narrower ones leave the rest alone', () => {
    const byId = (id: string) => resets.find((reset) => reset.id === id)!;
    expect([weekly(0), fable(0), session(0)].map((l) => resetEffect(byId('full'), l))).toEqual([
      'full',
      'full',
      'full',
    ]);
    // Whether a weekly reset also covers a model's weekly limit is not stated.
    expect([weekly(0), fable(0), session(0)].map((l) => resetEffect(byId('weekly'), l))).toEqual([
      'full',
      'unknown',
      'none',
    ]);
    expect([weekly(0), fable(0), session(0)].map((l) => resetEffect(byId('no_expiry'), l))).toEqual(
      ['none', 'none', 'full']
    );
  });

  test('windows the provider lists as cleared are certain even on an unnamed grant', () => {
    const [unnamed] = resetsFromClaudeGrants([grant('plain', { clears: ['five_hour'] })]);
    expect(resetEffect(unnamed, session(0))).toBe('full');
    expect(resetEffect(unnamed, weekly(0))).toBe('unknown');
  });

  test('Codex credits: only available ones, and their scope is not claimed', () => {
    const credits = resetsFromCodexCredits([
      { id: 'b', status: 'available', grantedAt: '', expiresAt: '2026-12-20T00:00:00Z' },
      { id: 'used', status: 'redeemed', grantedAt: '', expiresAt: '2026-11-20T00:00:00Z' },
      { id: 'a', status: 'available', grantedAt: '', expiresAt: '2026-12-01T00:00:00Z' },
    ]);
    expect(credits.map((credit) => credit.id)).toEqual(['a', 'b']);
    expect(credits[0].scope).toEqual({ kind: 'unknown' });
  });

  test('the footer line counts them and names the first expiry', () => {
    expect(resetsSummaryLine(t, 0, null)).toBe('No free resets');
    expect(resetsSummaryLine(t, 1, null)).toBe('1 free reset');
    expect(resetsSummaryLine(t, 4, Date.parse('2026-12-11T12:00:00Z'))).toMatch(
      /^4 free resets · first expires .*11.*$/
    );
  });
});

describe('times in words', () => {
  test('day and time within a week, the date beyond it', () => {
    const saturday = Date.parse('2026-11-21T21:00:00Z');
    expect(formatWhen(saturday, NOW, UTC)).toBe('Sat 9:00pm');
    expect(formatWhen(Date.parse('2026-12-11T09:05:00Z'), NOW, UTC)).toBe('Dec 11 9:05am');
    expect(formatWhen(saturday, NOW, { locale: 'de-DE', timeZone: 'UTC' })).toBe('Sa 21:00');
    expect(
      formatDay(Date.parse('2026-12-11T09:05:00Z'), { locale: 'en-GB', timeZone: 'UTC' })
    ).toBe('11 Dec');
  });

  test('durations pick minutes, hours or whole days', () => {
    expect(formatIn(19 * HOUR, 'en')).toBe('in 19 hours');
    expect(formatIn(31 * HOUR, 'en')).toBe('in 1 day');
    expect(formatIn(4 * DAY + HOUR, 'en')).toBe('in 4 days');
    expect(formatIn(20 * 60_000, 'en')).toBe('in 20 minutes');
    expect(formatSpan(23 * DAY, 'en')).toBe('23 days');
  });
});

describe('view preferences', () => {
  test('anything unrecognised falls back to cards and left', () => {
    expect(parseAccountsSettings(null)).toEqual({ view: 'cards', mode: 'left' });
    expect(parseAccountsSettings({ view: 'grid', mode: 7 })).toEqual({
      view: 'cards',
      mode: 'left',
    });
    expect(parseAccountsSettings({ view: 'table', mode: 'used' })).toEqual({
      view: 'table',
      mode: 'used',
    });
  });
});
