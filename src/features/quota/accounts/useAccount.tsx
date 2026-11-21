/**
 * Everything one account needs, for the card and the table row alike: its
 * figures, verdict, free resets, and the reset dialogs.
 *
 * Spending a Claude reset is upstream's `useClaudeResetGrants` from start to
 * finish; this hook only chooses which grant the dialog opens on and which
 * dialog draws it. Codex keeps upstream's own `onReset` confirmation.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { CodexQuotaState, ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { maskLabel } from '../pool/poolFormat';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { ClaudeResetGrantDialog } from '../providers/claude/ClaudeResetGrantDialog';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ProviderMark, type AccountIdentity } from './AccountParts';
import type { ResetsSummary } from './AccountCardView';
import { planLabelFor } from './accountsLabels';
import {
  accountFigures,
  firstExpiryMs,
  resetEffect,
  resetsFromClaudeGrants,
  resetsFromCodexCredits,
  totalResets,
  type FreeReset,
} from './accountsModel';
import { verdictFor, type AccountLimit, type CountMode, type Verdict } from './accountsRules';
import { ResetModal } from './ResetModal';
import styles from './Accounts.module.scss';

export interface AccountProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  mode: CountMode;
  showEmails: boolean;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}

/** Hide an address unless emails are shown; a file name often carries one too. */
export const privateLabel = (label: string, showEmails: boolean): string =>
  showEmails || !label.includes('@') ? label : maskLabel(label);

export interface AccountState {
  identity: AccountIdentity;
  theme: ResolvedTheme;
  mode: CountMode;
  now: number;
  status: 'idle' | 'loading' | 'error' | 'success';
  hasFigures: boolean;
  limits: AccountLimit[];
  verdict: Verdict | null;
  idleText: string;
  loadingText: string;
  errorText: string;
  emptyText: string;
  resets: ResetsSummary;
  resetList: FreeReset[];
  canUse: (id: string) => boolean;
  canUseReset: boolean;
  /** Replaces "Use a reset" while an unresolved claim can only be retried. */
  resetActionLabel: string;
  /** Open the confirmation, on one reset when given or when only one can be used. */
  requestUse: (id?: string) => void;
  onUseReset: () => void;
  canRefresh: boolean;
  refreshDisabled: boolean;
  /** Actions that write are off: not connected, loading, or a reset in flight. */
  disabled: boolean;
  onRefresh: () => void;
  dialogs: ReactNode;
}

export function useAccount(props: AccountProps): AccountState {
  const { entry, quota, resolvedTheme, canRefresh, resetting, onRefresh, onReset } = props;
  const { t } = useTranslation();
  const now = useNow();
  const file = entry.file;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const isClaude = entry.type === 'claude';
  const isCodex = entry.type === 'codex';
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const disabled = !canRefresh || loading || resetting;
  const { hasFigures, limits } = accountFigures(entry.type, quota);

  const name = privateLabel(file.email?.trim() || getQuotaDisplayName(file), props.showEmails);
  const identity: AccountIdentity = {
    name,
    providerType: entry.type,
    planLabel: hasFigures ? planLabelFor(t, entry.type, quota) : null,
  };

  // Same arguments upstream's card passes, so reads and blocking behave the same.
  const claude = useClaudeResetGrants(
    file,
    isClaude && status !== 'idle',
    disabled,
    quota,
    onRefresh
  );
  const codex = isCodex && status === 'success' ? (quota as CodexQuotaState) : undefined;
  const canResetCodex =
    Boolean(codex) &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  const resetList = isClaude
    ? resetsFromClaudeGrants(claude.grants)
    : resetsFromCodexCredits(codex?.rateLimitResetCredits);
  const canUse = (id: string) =>
    isClaude ? claude.canRedeemGrant(id) : canResetCodex && !disabled;
  const usable = resetList.filter((reset) => canUse(reset.id));
  const pending = isClaude ? claude.pendingGrantId : undefined;

  const count = isClaude
    ? claude.count
    : codex
      ? (codex.rateLimitResetCreditsAvailableCount ?? resetList.length)
      : null;
  const resets: ResetsSummary = {
    count,
    firstExpiryMs: firstExpiryMs(resetList),
    note: isClaude && claude.loading && !disabled ? t('claude_reset.loading') : '',
    message: isClaude && claude.message ? t(`claude_reset.${claude.message}`) : '',
  };

  const verdict = verdictFor(
    limits,
    (limit) =>
      isClaude
        ? totalResets(usable.filter((reset) => resetEffect(reset, limit) === 'full'))
        : canResetCodex && limit.scope === 'account'
          ? (codex?.rateLimitResetCreditsApplicableAvailableCount ??
            codex?.rateLimitResetCreditsAvailableCount ??
            0)
          : 0,
    now
  );

  // `selectGrant` only works once the dialog is open, so the choice waits one render.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    if (wanted === null) return;
    if (claude.open && !claude.selected) claude.selectGrant(wanted);
    setWanted(null);
  }, [wanted, claude]);

  const requestUse = (id?: string) => {
    if (isCodex) {
      onReset();
      return;
    }
    if (!isClaude) return;
    // An unresolved claim can only be retried; upstream's dialog owns that.
    if (!pending) setWanted(id ?? (usable.length === 1 ? usable[0].id : null));
    claude.openDialog();
  };

  const account = (
    <>
      <ProviderMark type={entry.type} theme={resolvedTheme} />
      <span className={styles.name}>{name}</span>
    </>
  );
  const dialogs = !isClaude ? null : pending ? (
    <ClaudeResetGrantDialog
      open={claude.open}
      grants={claude.grants}
      selected={claude.selected}
      canRedeemGrant={claude.canRedeemGrant}
      onSelect={claude.selectGrant}
      busy={claude.busy}
      loading={claude.loading}
      pendingGrantId={claude.pendingGrantId}
      message={claude.message}
      name={name}
      onConfirm={() => void claude.confirm()}
      onClose={claude.closeDialog}
    />
  ) : (
    <ResetModal
      open={claude.open}
      provider={entry.type}
      account={account}
      limits={limits}
      resets={resetList}
      selectedId={claude.selected}
      canUse={canUse}
      onSelect={claude.selectGrant}
      loading={claude.loading}
      message={resets.message}
      count={count}
      busy={claude.busy}
      now={now}
      onConfirm={() => void claude.confirm()}
      onClose={claude.closeDialog}
    />
  );

  return {
    identity,
    theme: resolvedTheme,
    mode: props.mode,
    now,
    status,
    hasFigures,
    limits,
    verdict,
    idleText: t(`${adapter.i18nPrefix}.idle`),
    loadingText: t(`${adapter.i18nPrefix}.loading`),
    errorText: t(`${adapter.i18nPrefix}.load_failed`, {
      message: resolveQuotaErrorMessage(
        t,
        quota?.errorStatus,
        quota?.error || t('common.unknown_error')
      ),
    }),
    emptyText: t(
      entry.type === 'antigravity'
        ? 'antigravity_quota.empty_models'
        : `${adapter.i18nPrefix}.empty_windows`
    ),
    resets,
    resetList,
    canUse,
    // Codex can hold resets whose expiry list failed to load, so it goes by the count.
    canUseReset:
      hasFigures &&
      (isClaude ? (pending ? !claude.blocked : usable.length > 0) : canResetCodex && !disabled),
    resetActionLabel: pending ? t('claude_reset.retry') : '',
    requestUse,
    onUseReset: () => requestUse(),
    canRefresh,
    refreshDisabled: isQuotaRefreshDisabled(canRefresh, loading, resetting || claude.busy),
    disabled,
    onRefresh,
    dialogs,
  };
}
