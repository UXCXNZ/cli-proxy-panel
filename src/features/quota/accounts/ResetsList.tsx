/**
 * An account's free resets, the one that expires first on top. Each row says
 * what it refills, where it came from, when it expires, and offers "Use".
 */

import { useTranslation } from 'react-i18next';
import type { QuotaProviderType } from '../providers/types';
import { formatDay, formatSpan } from './accountsFormat';
import { resetDescription, resetScopeLabel } from './accountsLabels';
import { expiresSoon, sortResets, type FreeReset } from './accountsModel';
import styles from './Accounts.module.scss';

export interface ResetsListProps {
  provider: QuotaProviderType;
  resets: readonly FreeReset[];
  now: number;
  canUse: (id: string) => boolean;
  onUse: (id: string) => void;
}

export function ResetsList({ provider, resets, now, canUse, onUse }: ResetsListProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  return (
    <ul className={styles.resets}>
      {sortResets(resets).map((reset, index) => {
        const usable = canUse(reset.id);
        const scope = resetScopeLabel(t, reset.scope);
        return (
          <li key={reset.id} className={styles.resetRow}>
            <div className={styles.resetWhat}>
              <b>{scope}</b>
              <span>{resetDescription(t, provider, reset, index)}</span>
              {reset.noUsage && <span>{t('claude_reset.no_usage')}</span>}
            </div>
            <span className={expiresSoon(reset, now) ? styles.resetSoon : styles.resetExpiry}>
              {reset.expiresAtMs === null
                ? t('claude_reset.expiry_unknown')
                : `${t('quota_management.accounts.reset_expires', {
                    date: formatDay(reset.expiresAtMs),
                  })} · ${formatSpan(reset.expiresAtMs - now, language)}`}
            </span>
            <button
              type="button"
              className={styles.quiet}
              disabled={!usable}
              onClick={() => onUse(reset.id)}
              aria-label={`${t('quota_management.accounts.use')}: ${scope}`}
              title={usable || reset.noUsage ? undefined : t('claude_reset.grant_unavailable')}
            >
              {t('quota_management.accounts.use')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
