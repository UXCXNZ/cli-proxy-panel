/**
 * The accounts on the quota page, as cards or as a table.
 *
 * Claude, Codex and Antigravity share the account card. The table summarizes
 * Claude and Codex; Antigravity keeps its full grouped card in that view.
 */

import type { ReactNode } from 'react';
import type { ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { AccountCard } from './AccountCard';
import { AccountRowView, AccountsTableView } from './AccountsTableView';
import { accountFigures, isAccountCardProvider, tableColumns } from './accountsModel';
import type { AccountLimit } from './accountsRules';
import type { AccountsSettings } from './accountsSettings';
import { useAccount, type AccountProps } from './useAccount';
import styles from './Accounts.module.scss';

export interface AccountsViewProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  settings: AccountsSettings;
  showEmails: boolean;
  /** Connected, list settled and current: actions may run. */
  canUseActions: boolean;
  /** Cache key of the credential whose Codex reset is in flight. */
  resettingKey: string | null;
  creditOverageCountFor: (entry: QuotaFileEntry) => number | undefined;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
  /** Upstream's card, for providers not drawn here. Must set its own key. */
  renderLegacyCard: (entry: QuotaFileEntry, index: number) => ReactNode;
}

function AccountRow(props: AccountProps & { columns: readonly AccountLimit[] }) {
  const account = useAccount(props);
  return (
    <AccountRowView {...account} columns={props.columns}>
      {account.dialogs}
    </AccountRowView>
  );
}

export function AccountsView(props: AccountsViewProps) {
  const { entries, quotaFor, settings } = props;
  const keyOf = (entry: QuotaFileEntry) => `${entry.type}:${getQuotaCacheKey(entry.file)}`;
  const accountProps = (entry: QuotaFileEntry): AccountProps => ({
    entry,
    quota: quotaFor(entry),
    resolvedTheme: props.resolvedTheme,
    mode: settings.mode,
    showEmails: props.showEmails,
    canRefresh: props.canUseActions && !entry.file.disabled,
    resetting: props.resettingKey === getQuotaCacheKey(entry.file),
    onRefresh: () => props.onRefresh(entry),
    onReset: () => props.onReset(entry),
  });

  if (settings.view === 'cards') {
    return (
      <div className={styles.grid}>
        {entries.map((entry, index) =>
          isAccountCardProvider(entry.type) ? (
            <AccountCard
              key={keyOf(entry)}
              {...accountProps(entry)}
              creditOverageSharedCount={
                entry.type === 'codex' ? props.creditOverageCountFor(entry) : undefined
              }
            />
          ) : (
            props.renderLegacyCard(entry, index)
          )
        )}
      </div>
    );
  }

  const isTableEntry = (entry: QuotaFileEntry) => entry.type === 'claude' || entry.type === 'codex';
  const rows = entries.filter(isTableEntry);
  const columns = tableColumns(
    rows.map((entry) => accountFigures(entry.type, quotaFor(entry)).limits)
  );
  return (
    <>
      {rows.length > 0 && (
        <AccountsTableView columns={columns}>
          {rows.map((entry) => (
            <AccountRow key={keyOf(entry)} {...accountProps(entry)} columns={columns} />
          ))}
        </AccountsTableView>
      )}
      {rows.length < entries.length && (
        <div className={styles.grid}>
          {entries.map((entry, index) =>
            isTableEntry(entry) ? null : props.renderLegacyCard(entry, index)
          )}
        </div>
      )}
    </>
  );
}
