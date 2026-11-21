/**
 * Words for the account cards: limit names, what a reset refills, the verdict
 * and its sub line. Kept apart from the components so cards, table and modal
 * say the same thing.
 */

import type { TFunction } from 'i18next';
import type { AntigravityQuotaState } from '@/types';
import {
  BUSINESS_PREMIUM_CODEX_PLAN_TYPE,
  PRO_CODEX_PLAN_TYPE,
  PRO_LITE_CODEX_PLAN_TYPES,
  PRO_MAX_CODEX_PLAN_TYPES,
  normalizePlanType,
} from '@/utils/quota';
import { getAntigravityPlanLabel } from '../providers/antigravity/labels';
import type { QuotaProviderType } from '../providers/types';
import { formatDay, formatIn, formatWhen } from './accountsFormat';
import type { FreeReset, ResetScope } from './accountsModel';
import { figureFor, type AccountLimit, type Verdict } from './accountsRules';

const K = 'quota_management.accounts';

export function limitLabel(t: TFunction, limit: AccountLimit): string {
  if (limit.labelKey) return t(limit.labelKey);
  if (limit.scope === 'model') {
    const name = limit.name ?? '';
    return limit.verbatim || limit.window !== 'session'
      ? name
      : t(`${K}.limit_named_session`, { name });
  }
  return t(`${K}.limit_${limit.window}`);
}

/** "Everything", "Fable only", or a neutral word when the provider does not say. */
export function resetScopeLabel(t: TFunction, scope: ResetScope): string {
  if (scope.kind === 'all') return t(`${K}.scope_all`);
  if (scope.kind === 'unknown') return t(`${K}.scope_unknown`);
  const label = scope.kind === 'model' ? scope.name : t(`${K}.limit_${scope.kind}`);
  return t(`${K}.scope_only`, { label });
}

/** The one plain line in the confirmation saying what the reset does. */
export function resetWhatLine(t: TFunction, scope: ResetScope): string {
  if (scope.kind === 'all') return t(`${K}.modal_what_all`);
  if (scope.kind === 'unknown') return t(`${K}.modal_what_unknown`);
  const label = scope.kind === 'model' ? scope.name : t(`${K}.limit_${scope.kind}`);
  return t(`${K}.modal_what_only`, { label });
}

export function resetDescription(
  t: TFunction,
  provider: QuotaProviderType,
  reset: FreeReset,
  index: number
): string {
  const base =
    reset.description ||
    (provider === 'codex'
      ? t('codex_quota.reset_credit_number', { index: index + 1 })
      : t('claude_reset.grant_number', { index: index + 1 }));
  return reset.total > 1
    ? `${base} · ${t('claude_reset.count', { left: reset.left, total: reset.total })}`
    : base;
}

/** "4 free resets · first expires 11 Dec", or "No free resets". */
export function resetsSummaryLine(
  t: TFunction,
  count: number,
  firstExpiryMs: number | null
): string {
  if (count <= 0) return t(`${K}.resets_none`);
  const head = t(`${K}.resets_count`, { count });
  return firstExpiryMs === null
    ? head
    : `${head} · ${t(`${K}.resets_first_expires`, { date: formatDay(firstExpiryMs) })}`;
}

export interface VerdictText {
  title: string;
  sub: string;
}

/** `language` words the duration ("in 4 days"); day and time follow the browser. */
export function verdictText(
  t: TFunction,
  verdict: Verdict,
  now: number,
  language?: string
): VerdictText {
  const at = verdict.resetAtMs;
  const when =
    at !== null && at > now
      ? { time: formatWhen(at, now), duration: formatIn(at - now, language) }
      : null;
  const parts: string[] = [];

  if (verdict.kind === 'spent') {
    const label = limitLabel(t, verdict.limit);
    if (when) parts.push(t(`${K}.sub_back`, when));
    if (verdict.freeResets > 0) parts.push(t(`${K}.sub_or_reset`, { count: verdict.freeResets }));
    return {
      title: t(
        verdict.limit.scope === 'account' ? `${K}.verdict_spent_account` : `${K}.verdict_spent`,
        { label }
      ),
      sub: parts.join(' '),
    };
  }

  if (verdict.kind === 'low') {
    parts.push(
      t(`${K}.sub_low`, {
        label: limitLabel(t, verdict.limit),
        percent: figureFor(verdict.limit.left, 'left'),
      })
    );
  }
  if (when) parts.push(t(`${K}.sub_resets`, when));
  return {
    title: t(verdict.kind === 'low' ? `${K}.verdict_low` : `${K}.verdict_plenty`),
    sub: parts.join(' '),
  };
}

/** The plan chip, in the words upstream's own card uses. */
export function planLabelFor(
  t: TFunction,
  provider: QuotaProviderType,
  quota: unknown
): string | null {
  if (provider === 'antigravity') {
    return getAntigravityPlanLabel((quota as AntigravityQuotaState | undefined)?.subscription, t);
  }
  const planType = (quota as { planType?: string | null } | undefined)?.planType;
  if (!planType) return null;
  if (provider === 'claude') return t(`claude_quota.${planType}`);
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === BUSINESS_PREMIUM_CODEX_PLAN_TYPE)
    return t('codex_quota.plan_business_premium');
  if (PRO_MAX_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_promax');
  if (normalized === PRO_CODEX_PLAN_TYPE) return t('codex_quota.plan_pro');
  if (PRO_LITE_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus' || normalized === 'team' || normalized === 'free') {
    return t(`codex_quota.plan_${normalized}`);
  }
  return planType;
}
