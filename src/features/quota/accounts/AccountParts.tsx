/** Pieces the card, the table and the modal share: the provider mark and a limit's figure. */

import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { figureFor, toneFor, type CountMode } from './accountsRules';
import styles from './Accounts.module.scss';

/** What every view needs to name an account. `name` is already masked if emails are hidden. */
export interface AccountIdentity {
  name: string;
  providerType: string;
  planLabel: string | null;
}

export function ProviderMark({ type, theme }: { type: string; theme: ResolvedTheme }) {
  const { t } = useTranslation();
  const src = getAuthFileIcon(type, theme);
  const label = getTypeLabel(t, type);
  return (
    <span
      className={styles.mark}
      title={label}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(theme) }
          : undefined
      }
    >
      {src ? <img src={src} alt="" /> : <span>{label.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

/** "69%" with its word, never a bare percent. */
export function Figure({ left, mode }: { left: number; mode: CountMode }) {
  const { t } = useTranslation();
  return (
    <>
      {figureFor(left, mode)}%<small>{t(`quota_management.accounts.figure_${mode}`)}</small>
    </>
  );
}

/** The thin bar: fills as quota is spent in Used, empties in Left; colour is what is left. */
export function Track({ left, mode }: { left: number; mode: CountMode }) {
  return (
    <div className={styles.track}>
      <i data-tone={toneFor(left)} style={{ width: `${figureFor(left, mode)}%` }} />
    </div>
  );
}
