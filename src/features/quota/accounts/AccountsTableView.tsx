/**
 * The same accounts as rows: Account, Plan, one column per kind of limit,
 * Resets, Free resets, and the actions. Presentation only.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { Figure, ProviderMark, Track, type AccountIdentity } from './AccountParts';
import type { ResetsSummary } from './AccountCardView';
import { formatSpan, formatWhen } from './accountsFormat';
import { limitLabel, resetsSummaryLine } from './accountsLabels';
import { limitKey } from './accountsModel';
import { isSpent, type AccountLimit, type CountMode, type Verdict } from './accountsRules';
import styles from './Accounts.module.scss';

const K = 'quota_management.accounts';

export function AccountsTableView(props: {
  columns: readonly AccountLimit[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t(`${K}.table_account`)}</th>
            <th scope="col">{t(`${K}.table_plan`)}</th>
            {props.columns.map((column) => (
              <th scope="col" key={limitKey(column)}>
                {limitLabel(t, column)}
              </th>
            ))}
            <th scope="col">{t(`${K}.table_resets`)}</th>
            <th scope="col">{t(`${K}.table_free_resets`)}</th>
            <th scope="col">
              <span className={styles.srOnly}>{t(`${K}.table_actions`)}</span>
            </th>
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export interface AccountRowViewProps {
  identity: AccountIdentity;
  theme: ResolvedTheme;
  mode: CountMode;
  now: number;
  columns: readonly AccountLimit[];
  status: 'idle' | 'loading' | 'error' | 'success';
  hasFigures: boolean;
  limits: readonly AccountLimit[];
  verdict: Verdict | null;
  idleText: string;
  loadingText: string;
  errorText: string;
  resets: ResetsSummary;
  canUseReset: boolean;
  resetActionLabel?: string;
  onUseReset: () => void;
  canRefresh: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
  /** Portalled dialogs owned by the connected row. */
  children?: ReactNode;
}

export function AccountRowView(props: AccountRowViewProps) {
  const { identity, mode, now, columns, status, hasFigures, limits, verdict, resets } = props;
  const { t, i18n } = useTranslation();
  const resetAtMs = verdict?.resetAtMs ?? null;

  return (
    <tr>
      <th scope="row">
        <span className={styles.rowWho}>
          <ProviderMark type={identity.providerType} theme={props.theme} />
          <span>{identity.name}</span>
        </span>
      </th>
      <td className={styles.dim}>{identity.planLabel ?? ''}</td>
      {hasFigures ? (
        <>
          {columns.map((column) => {
            const limit = limits.find((candidate) => limitKey(candidate) === limitKey(column));
            return (
              <td key={limitKey(column)}>
                {limit ? (
                  <div className={styles.cell}>
                    <b data-spent={isSpent(limit) ? '' : undefined}>
                      <Figure left={limit.left} mode={mode} />
                    </b>
                    <Track left={limit.left} mode={mode} />
                  </div>
                ) : (
                  <span className={styles.faint}>{t(`${K}.table_not_on_plan`)}</span>
                )}
              </td>
            );
          })}
          <td className={styles.dim}>
            {resetAtMs !== null && resetAtMs > now
              ? `${formatWhen(resetAtMs, now)} · ${formatSpan(resetAtMs - now, i18n.resolvedLanguage)}`
              : ''}
            {status !== 'success' && (
              <span role={status === 'error' ? 'alert' : 'status'} className={styles.rowNote}>
                {status === 'error' ? props.errorText : props.loadingText}
              </span>
            )}
          </td>
          <td>
            {resets.count === null ? (
              <span className={styles.faint}>{resets.note}</span>
            ) : resets.count > 0 ? (
              resetsSummaryLine(t, resets.count, resets.firstExpiryMs)
            ) : (
              <span className={styles.faint}>{t(`${K}.table_none`)}</span>
            )}
            {resets.message && (
              <span role="status" className={styles.rowNote}>
                {resets.message}
              </span>
            )}
          </td>
        </>
      ) : (
        <td colSpan={columns.length + 2} className={styles.dim}>
          {status === 'idle' ? (
            <button
              type="button"
              className={styles.footLink}
              onClick={props.onRefresh}
              disabled={!props.canRefresh}
            >
              {props.idleText}
            </button>
          ) : status === 'error' ? (
            <span role="alert">{props.errorText}</span>
          ) : (
            <span role="status" aria-busy="true">
              {props.loadingText}
            </span>
          )}
        </td>
      )}
      <td>
        <span className={styles.rowActions}>
          {props.canUseReset && (
            <button
              type="button"
              className={styles.quiet}
              onClick={props.onUseReset}
              aria-haspopup="dialog"
            >
              {props.resetActionLabel || t(`${K}.use_one`)}
            </button>
          )}
          {status !== 'idle' && (
            <button
              type="button"
              className={styles.quiet}
              onClick={props.onRefresh}
              disabled={props.refreshDisabled}
              title={t('auth_files.quota_refresh_hint')}
            >
              {t(`${K}.refresh`)}
            </button>
          )}
        </span>
        {props.children}
      </td>
    </tr>
  );
}
