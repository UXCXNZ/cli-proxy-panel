/**
 * One account as a card: who, a verdict, one block per limit, free resets and
 * the actions. Presentation only, so the DEV preview can draw it from fixtures.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { Figure, ProviderMark, Track, type AccountIdentity } from './AccountParts';
import { limitLabel, resetsSummaryLine, verdictText } from './accountsLabels';
import {
  isSpent,
  verdictTone,
  type AccountLimit,
  type CountMode,
  type Verdict,
} from './accountsRules';
import styles from './Accounts.module.scss';

const K = 'quota_management.accounts';

export interface ResetsSummary {
  /** Free resets held; null while unknown. */
  count: number | null;
  firstExpiryMs: number | null;
  /** Shown in place of the count while it is still being read. */
  note: string;
  /** A reset status that must stay in view: a read error, or an unresolved claim. */
  message: string;
}

export interface AccountCardViewProps {
  identity: AccountIdentity;
  theme: ResolvedTheme;
  mode: CountMode;
  now: number;
  status: 'idle' | 'loading' | 'error' | 'success';
  /** True on success, and while Claude keeps its last figures during a refresh or after an error. */
  hasFigures: boolean;
  limits: readonly AccountLimit[];
  verdict: Verdict | null;
  idleText: string;
  loadingText: string;
  errorText: string;
  emptyText: string;
  resets: ResetsSummary;
  canUseReset: boolean;
  /** Replaces "Use a reset" when set. */
  resetActionLabel?: string;
  onUseReset: () => void;
  canRefresh: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
  detailsOpen: boolean;
  detailsLabel?: string;
  onToggleDetails: () => void;
  /** Opens Details at the resets list. */
  onShowResets: () => void;
  details: ReactNode;
  /** Portalled dialogs owned by the connected card. */
  children?: ReactNode;
}

export function AccountCardView(props: AccountCardViewProps) {
  const { identity, mode, now, status, hasFigures, limits, verdict, resets } = props;
  const { t, i18n } = useTranslation();
  const words = verdict ? verdictText(t, verdict, now, i18n.resolvedLanguage) : null;

  return (
    <article className={styles.card}>
      <header className={styles.who}>
        <ProviderMark type={identity.providerType} theme={props.theme} />
        <span className={styles.name} title={identity.name}>
          {identity.name}
        </span>
        {identity.planLabel && <span className={styles.plan}>{identity.planLabel}</span>}
      </header>

      {status === 'idle' ? (
        <button
          type="button"
          className={styles.idle}
          onClick={props.onRefresh}
          disabled={!props.canRefresh}
        >
          <IconRefreshCw size={15} aria-hidden="true" />
          <span>{props.idleText}</span>
        </button>
      ) : (
        <>
          {status === 'error' && (
            <div className={styles.error} role="alert">
              {props.errorText}
            </div>
          )}
          {status === 'loading' &&
            (hasFigures ? (
              <div role="status" aria-busy="true" className={styles.note}>
                {props.loadingText}
              </div>
            ) : (
              <div className={styles.skeleton} aria-busy="true">
                <span className={styles.srOnly}>{props.loadingText}</span>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            ))}
          {hasFigures && (
            <>
              {verdict && words && (
                <>
                  <p className={styles.verdict} data-tone={verdictTone(verdict)}>
                    {words.title}
                  </p>
                  {words.sub && <p className={styles.sub}>{words.sub}</p>}
                </>
              )}
              {limits.length === 0 && <p className={styles.note}>{props.emptyText}</p>}
              {limits.map((limit) => (
                <div key={limit.id} className={styles.limit}>
                  <span className={styles.limitLabel}>{limitLabel(t, limit)}</span>
                  <span className={styles.limitNum} data-spent={isSpent(limit) ? '' : undefined}>
                    <Figure left={limit.left} mode={mode} />
                  </span>
                  <Track left={limit.left} mode={mode} />
                </div>
              ))}
            </>
          )}

          <footer className={styles.foot}>
            {hasFigures &&
              (resets.count === null ? (
                resets.note && <span>{resets.note}</span>
              ) : resets.count > 0 ? (
                <button type="button" className={styles.footLink} onClick={props.onShowResets}>
                  {resetsSummaryLine(t, resets.count, resets.firstExpiryMs)}
                </button>
              ) : (
                <span>{resetsSummaryLine(t, 0, null)}</span>
              ))}
            {resets.message && (
              <div role="status" className={styles.footMessage}>
                {resets.message}
              </div>
            )}
            <div className={styles.buttons}>
              {props.canUseReset && (
                <button
                  type="button"
                  className={styles.quiet}
                  onClick={props.onUseReset}
                  aria-haspopup="dialog"
                >
                  {props.resetActionLabel || t(`${K}.use_reset`)}
                </button>
              )}
              <button
                type="button"
                className={styles.quiet}
                onClick={props.onToggleDetails}
                aria-expanded={props.detailsOpen}
              >
                {props.detailsLabel ?? t(`${K}.details`)}
              </button>
              <button
                type="button"
                className={styles.quiet}
                onClick={props.onRefresh}
                disabled={props.refreshDisabled}
                title={t('auth_files.quota_refresh_hint')}
              >
                {t(`${K}.refresh`)}
              </button>
            </div>
          </footer>
          {props.detailsOpen && (
            <div
              className={
                identity.providerType === 'antigravity' ? styles.googleDetails : styles.details
              }
            >
              {props.details}
            </div>
          )}
        </>
      )}
      {props.children}
    </article>
  );
}
