/**
 * The connected account card, and what "Details" opens: the file name,
 * upstream's own provider body (extra usage, credit balance, renewal, the
 * provider's reset list) and our free resets list.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AntigravityQuotaState, CodexQuotaState } from '@/types';
import bodyStyles from '../components/QuotaBody.module.scss';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { AntigravityQuotaBody } from '../providers/antigravity/AntigravityQuotaBody';
import { CodexCreditOverageDialog } from '../providers/codex/CodexCreditOverageDialog';
import { CodexCreditOverageRow } from '../providers/codex/CodexCreditOverageRow';
import { useCodexCreditOverage } from '../providers/codex/useCodexCreditOverage';
import { bindQuotaClasses, type QuotaClassMap } from '../types';
import { AccountCardView } from './AccountCardView';
import { ResetsList } from './ResetsList';
import { privateLabel, useAccount, type AccountProps } from './useAccount';
import styles from './Accounts.module.scss';

// Bound when Details first opens. Upstream's QuotaCard binds the same module at
// load, so a missing class still fails at startup.
let boundClasses: QuotaClassMap | undefined;
const getQuotaClasses = (): QuotaClassMap =>
  (boundClasses ??= bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss'));

interface AccountDetailsProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  showBody: boolean;
  name: string;
  fileLabel: string;
  disabled: boolean;
  creditOverageSharedCount: number;
}

/** Mounted only while Details is open, so the Codex credit setting is read on demand. */
function AccountDetails(props: AccountDetailsProps) {
  const { entry, quota } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const quotaClasses = getQuotaClasses();
  const creditOverage = useCodexCreditOverage(
    entry.file,
    entry.type === 'codex' ? (quota as CodexQuotaState | undefined) : undefined,
    props.disabled
  );
  if (entry.type === 'antigravity') {
    return props.showBody && quota ? (
      <AntigravityQuotaBody
        quota={quota as AntigravityQuotaState}
        classes={quotaClasses}
        otherLimitsOnly
      />
    ) : (
      <div className={quotaClasses.quotaMessage}>{t('antigravity_quota.empty_models')}</div>
    );
  }
  return (
    <>
      <div className={styles.fileRow}>
        <span>{t('quota_management.accounts.file_name')}</span>
        <code title={props.fileLabel}>{props.fileLabel}</code>
      </div>
      {props.showBody && quota && (
        <div className={styles.detailsBody}>
          <adapter.Body
            quota={quota}
            classes={quotaClasses}
            afterPlan={
              creditOverage.visible ? (
                <CodexCreditOverageRow
                  entry={creditOverage.entry}
                  classes={quotaClasses}
                  disabled={creditOverage.blocked}
                  name={props.name}
                  onManage={creditOverage.openDialog}
                />
              ) : undefined
            }
          />
        </div>
      )}
      {creditOverage.context && (
        <CodexCreditOverageDialog
          open={creditOverage.open}
          context={creditOverage.context}
          entry={creditOverage.entry}
          operation={creditOverage.operation}
          writeDisabled={creditOverage.writeDisabled}
          contextCurrent={creditOverage.contextCurrent}
          sharedCredentialCount={props.creditOverageSharedCount}
          selection={creditOverage.selection}
          pendingTarget={creditOverage.pendingTarget}
          feedback={creditOverage.feedback}
          onSelect={creditOverage.selectValue}
          onSave={() => void creditOverage.save()}
          onClose={creditOverage.closeDialog}
        />
      )}
    </>
  );
}

export type AccountCardProps = AccountProps & {
  /** Codex only: credentials in the panel sharing this account user's credit setting. */
  creditOverageSharedCount?: number;
};

export function AccountCard(props: AccountCardProps) {
  const { t } = useTranslation();
  const account = useAccount(props);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const resetsRef = useRef<HTMLDivElement>(null);

  const showResets = () => {
    setDetailsOpen(true);
    requestAnimationFrame(() => resetsRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  return (
    <AccountCardView
      {...account}
      detailsOpen={detailsOpen}
      detailsLabel={
        props.entry.type === 'antigravity' ? t('antigravity_quota.other_google_limits') : undefined
      }
      onToggleDetails={() => setDetailsOpen((open) => !open)}
      onShowResets={showResets}
      details={
        <>
          <AccountDetails
            entry={props.entry}
            quota={props.quota}
            showBody={account.hasFigures}
            name={account.identity.name}
            fileLabel={privateLabel(props.entry.file.name, props.showEmails)}
            disabled={account.disabled}
            creditOverageSharedCount={props.creditOverageSharedCount ?? 1}
          />
          {account.resetList.length > 0 && (
            <div ref={resetsRef}>
              <ResetsList
                provider={props.entry.type}
                resets={account.resetList}
                now={account.now}
                canUse={account.canUse}
                onUse={account.requestUse}
              />
            </div>
          )}
        </>
      }
    >
      {account.dialogs}
    </AccountCardView>
  );
}
