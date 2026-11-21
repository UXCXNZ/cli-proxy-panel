/**
 * Account cards model: which limits an account has, which free resets it
 * holds, and what each reset would refill. Pure functions over the provider
 * quota states upstream already builds; no React and no clock.
 */

import { resetGrantHasNoUsage, type AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import type { AntigravityQuotaState, ClaudeQuotaState, CodexRateLimitResetCredit } from '@/types';
import { DAY_MS } from '@/utils/time/durations';
import { hasClaudeUsageData } from '../providers/claude/data';
import type { QuotaProviderType } from '../providers/types';
import {
  EXPIRING_SOON_DAYS,
  sortLimits,
  type AccountLimit,
  type LimitWindow,
} from './accountsRules';

/** Providers drawn as account cards. Every other provider keeps upstream's card. */
export const ACCOUNT_CARD_PROVIDERS: readonly QuotaProviderType[] = [
  'claude',
  'codex',
  'antigravity',
];

export const isAccountCardProvider = (provider: QuotaProviderType): boolean =>
  ACCOUNT_CARD_PROVIDERS.includes(provider);

/* -------------------------------------------------------------- limits */

interface WindowLike {
  id?: string;
  label?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
}

/** Claude's model-scoped weekly windows, by the id upstream gives them. */
const CLAUDE_MODEL_NAMES: Record<string, string> = {
  'seven-day-opus': 'Opus',
  'seven-day-sonnet': 'Sonnet',
  'seven-day-fable': 'Fable',
  'seven-day-cowork': 'Cowork',
  'seven-day-oauth-apps': 'OAuth apps',
};

type LimitShape = Pick<AccountLimit, 'scope' | 'window' | 'name' | 'verbatim'>;

const windowFromId = (id: string): LimitWindow =>
  id.includes('five-hour') ? 'session' : id.includes('monthly') ? 'monthly' : 'weekly';

function claudeShape(window: WindowLike): LimitShape | null {
  const id = window.id ?? '';
  // A dollar credit pool, not a limit that refills on a schedule: left to Details.
  if (id === 'cloud-session-credits') return null;
  if (id === 'five-hour') return { scope: 'account', window: 'session', name: null };
  if (id === 'seven-day') return { scope: 'account', window: 'weekly', name: null };
  const model = CLAUDE_MODEL_NAMES[id];
  if (model) return { scope: 'model', window: 'weekly', name: model };
  return { scope: 'model', window: windowFromId(id), name: window.label ?? id, verbatim: true };
}

function codexShape(window: WindowLike): LimitShape {
  const id = window.id ?? '';
  if (id === 'five-hour') return { scope: 'account', window: 'session', name: null };
  if (id === 'weekly') return { scope: 'account', window: 'weekly', name: null };
  if (id === 'monthly') return { scope: 'account', window: 'monthly', name: null };
  // Additional limits carry the model or feature name upstream put in the label.
  const named = window.labelParams?.name;
  if (named !== undefined && String(named).trim()) {
    return { scope: 'model', window: windowFromId(id), name: String(named).trim() };
  }
  return { scope: 'model', window: windowFromId(id), name: window.label ?? id, verbatim: true };
}

const GEMINI_SUMMARY_LIMITS = [
  { id: 'gemini-5h', window: 'session', labelKey: 'antigravity_quota.summary_five_hour' },
  { id: 'gemini-weekly', window: 'weekly', labelKey: 'antigravity_quota.summary_weekly' },
] as const;

function antigravityLimits(quota: AntigravityQuotaState | undefined): AccountLimit[] {
  const buckets = quota?.groups.flatMap((group) => group.buckets) ?? [];
  return GEMINI_SUMMARY_LIMITS.flatMap(({ id, window, labelKey }) => {
    const bucket = buckets.find((item) => item.id.toLowerCase() === id);
    if (!bucket || !Number.isFinite(bucket.remainingFraction)) return [];
    return [
      {
        id: bucket.id,
        scope: 'model',
        name: 'Gemini',
        window,
        labelKey,
        left: Math.min(1, Math.max(0, bucket.remainingFraction)) * 100,
        resetAtMs: bucket.resetAtMs ?? parseMs(bucket.resetTime),
      },
    ];
  });
}

/**
 * Reduce a provider quota state to its limits, in reading order.
 *
 * Returns null for a provider whose limits are not derived here, which the
 * page reads as "draw upstream's card". Reads the windows whatever the status,
 * because Claude keeps its last windows while refreshing or after a failed read.
 */
export function deriveLimits(provider: QuotaProviderType, quota: unknown): AccountLimit[] | null {
  if (provider === 'antigravity')
    return antigravityLimits(quota as AntigravityQuotaState | undefined);
  if (provider !== 'claude' && provider !== 'codex') return null;
  const windows = (quota as { windows?: WindowLike[] } | undefined)?.windows ?? [];
  const limits: AccountLimit[] = [];
  windows.forEach((window, index) => {
    const used = window.usedPercent;
    if (typeof used !== 'number' || !Number.isFinite(used)) return;
    const shape = provider === 'claude' ? claudeShape(window) : codexShape(window);
    if (!shape) return;
    const resetAtMs = window.resetAtMs;
    limits.push({
      ...shape,
      id: window.id ?? `window-${index}`,
      left: Math.round(Math.min(100, Math.max(0, 100 - used))),
      resetAtMs: typeof resetAtMs === 'number' && Number.isFinite(resetAtMs) ? resetAtMs : null,
    });
  });
  return sortLimits(limits);
}

/**
 * Whether an account has figures to show, and its limits when it does. Claude
 * keeps its last figures while refreshing and after a failed read; every other
 * state has figures only on success.
 */
export function accountFigures(
  provider: QuotaProviderType,
  quota: { status?: string } | undefined
): { hasFigures: boolean; limits: AccountLimit[] } {
  const retained =
    provider === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const hasFigures = Boolean(quota) && (quota?.status === 'success' || retained);
  return { hasFigures, limits: hasFigures ? (deriveLimits(provider, quota) ?? []) : [] };
}

/** Table columns: one per kind of limit present, in reading order. */
export const limitKey = (limit: AccountLimit): string =>
  limit.scope === 'account' ? `account:${limit.window}` : `model:${limit.name}:${limit.window}`;

export function tableColumns(accounts: readonly (readonly AccountLimit[])[]): AccountLimit[] {
  const seen = new Map<string, AccountLimit>();
  accounts.forEach((limits) =>
    limits.forEach((limit) => {
      if (!seen.has(limitKey(limit))) seen.set(limitKey(limit), limit);
    })
  );
  return sortLimits([...seen.values()]);
}

/* --------------------------------------------------------- free resets */

/** What a free reset refills. `unknown` when the provider does not say. */
export type ResetScope =
  | { kind: 'all' }
  | { kind: 'weekly' }
  | { kind: 'session' }
  | { kind: 'model'; name: string }
  | { kind: 'unknown' };

export interface FreeReset {
  id: string;
  scope: ResetScope;
  /** The provider's own description; empty when it gave none. */
  description: string;
  expiresAtMs: number | null;
  /** Uses left on this grant, and how many it started with. */
  left: number;
  total: number;
  /** Usage windows the provider says this clears (Claude). */
  clears: readonly string[];
  /** Refills one model and hands its share back to the weekly limit (Claude Fable). */
  givesBackWeekly: boolean;
  /** The model it would refill has no usage, so spending it would be wasted. */
  noUsage: boolean;
}

const parseMs = (value: string | null | undefined): number | null => {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Soonest expiry first, so the reset that would be lost first is on top. */
export function sortResets(resets: readonly FreeReset[]): FreeReset[] {
  return resets
    .map((reset, index) => ({ reset, index }))
    .sort(
      (a, b) =>
        (a.reset.expiresAtMs ?? Infinity) - (b.reset.expiresAtMs ?? Infinity) || a.index - b.index
    )
    .map((item) => item.reset);
}

function claudeScope(grant: AnthropicResetGrant): ResetScope {
  if (grant.givesBackWeekly) return { kind: 'model', name: 'Fable' };
  if (grant.resetType === 'full') return { kind: 'all' };
  if (grant.resetType === 'weekly') return { kind: 'weekly' };
  if (grant.resetType === 'session') return { kind: 'session' };
  return { kind: 'unknown' };
}

export function resetsFromClaudeGrants(grants: readonly AnthropicResetGrant[]): FreeReset[] {
  return sortResets(
    grants
      .filter((grant) => grant.resetsLeft > 0)
      .map((grant) => ({
        id: grant.id,
        scope: claudeScope(grant),
        description: grant.label,
        expiresAtMs: parseMs(grant.endsAt),
        left: grant.resetsLeft,
        total: grant.resetsTotal,
        clears: grant.clears,
        givesBackWeekly: Boolean(grant.givesBackWeekly),
        noUsage: resetGrantHasNoUsage(grant),
      }))
  );
}

/** Codex does not say which limits a manual reset clears, so its scope is unknown. */
export function resetsFromCodexCredits(
  credits: readonly CodexRateLimitResetCredit[] | undefined
): FreeReset[] {
  return sortResets(
    (credits ?? [])
      .filter((credit) => credit.status === 'available')
      .map((credit) => ({
        id: credit.id,
        scope: { kind: 'unknown' } as const,
        description: '',
        expiresAtMs: parseMs(credit.expiresAt),
        left: 1,
        total: 1,
        clears: [],
        givesBackWeekly: false,
        noUsage: false,
      }))
  );
}

export const totalResets = (resets: readonly FreeReset[]): number =>
  resets.reduce((sum, reset) => sum + reset.left, 0);

export const firstExpiryMs = (resets: readonly FreeReset[]): number | null =>
  resets.reduce<number | null>(
    (first, reset) =>
      reset.expiresAtMs !== null && (first === null || reset.expiresAtMs < first)
        ? reset.expiresAtMs
        : first,
    null
  );

export const expiresSoon = (reset: FreeReset, now: number): boolean =>
  reset.expiresAtMs !== null && reset.expiresAtMs - now <= EXPIRING_SOON_DAYS * DAY_MS;

/**
 * What a reset does to one limit.
 * - `full`: back to 100% left.
 * - `partial`: gets some back, by an amount the provider does not state.
 * - `unknown`: the provider does not say whether this limit is covered.
 * - `none`: unchanged.
 */
export type ResetEffect = 'full' | 'partial' | 'unknown' | 'none';

export function resetEffect(reset: FreeReset, limit: AccountLimit): ResetEffect {
  const wholeAccount = limit.scope === 'account';
  // What the provider lists as cleared is certain, whatever the grant is called.
  if (wholeAccount && limit.window === 'session' && reset.clears.includes('five_hour'))
    return 'full';
  if (wholeAccount && limit.window === 'weekly' && reset.clears.includes('seven_day'))
    return 'full';

  const { scope } = reset;
  if (scope.kind === 'all') return 'full';
  if (scope.kind === 'unknown') return 'unknown';
  if (scope.kind === 'model') {
    if (
      limit.scope === 'model' &&
      limit.window !== 'session' &&
      limit.name?.toLowerCase() === scope.name.toLowerCase()
    )
      return 'full';
    // The refilled model's share comes off the weekly limit's usage too.
    if (reset.givesBackWeekly && wholeAccount && limit.window === 'weekly') return 'partial';
    return 'none';
  }
  if (scope.kind === 'weekly') {
    if (limit.window === 'session') return 'none';
    return wholeAccount ? 'full' : 'unknown';
  }
  // A session reset.
  if (limit.window !== 'session') return 'none';
  return wholeAccount ? 'full' : 'unknown';
}

/** When the limits a reset refills would have come back on their own. */
export function naturalReturnMs(reset: FreeReset, limits: readonly AccountLimit[]): number | null {
  const times = limits
    .filter((limit) => resetEffect(reset, limit) === 'full' && limit.left < 100)
    .map((limit) => limit.resetAtMs)
    .filter((at): at is number => at !== null);
  return times.length > 0 ? Math.max(...times) : null;
}
