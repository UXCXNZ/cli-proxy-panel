/** The two page-wide choices in the toolbar: Left | Used and Cards | Table. */

import { useTranslation } from 'react-i18next';
import type { AccountsSettingsControl } from './accountsSettings';
import styles from './Accounts.module.scss';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AccountsSwitches({ settings }: { settings: AccountsSettingsControl }) {
  const { t } = useTranslation();
  return (
    <>
      <Segmented
        label={t('quota_management.accounts.count_label')}
        value={settings.mode}
        onChange={settings.setMode}
        options={[
          { value: 'left', label: t('quota_management.accounts.count_left') },
          { value: 'used', label: t('quota_management.accounts.count_used') },
        ]}
      />
      <Segmented
        label={t('quota_management.accounts.view_label')}
        value={settings.view}
        onChange={settings.setView}
        options={[
          { value: 'cards', label: t('quota_management.accounts.view_cards') },
          { value: 'table', label: t('quota_management.accounts.view_table') },
        ]}
      />
    </>
  );
}
