/**
 * The confirmation before a free reset is spent.
 *
 * Presentation only. Spending, request ids, retries and the "outcome unknown"
 * state belong to upstream's `useClaudeResetGrants`; this modal shows what the
 * chosen reset would do and passes Confirm and Cancel straight through. With
 * no reset chosen yet it lists them, so one is never picked on the user's behalf.
 */

import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { QuotaProviderType } from '../providers/types';
import { formatIn, formatWhen } from './accountsFormat';
import { limitLabel, resetWhatLine } from './accountsLabels';
import { naturalReturnMs, resetEffect, type FreeReset } from './accountsModel';
import { toneFor, type AccountLimit } from './accountsRules';
import { ResetsList } from './ResetsList';
import styles from './Accounts.module.scss';

const K = 'quota_management.accounts';
const CANCEL_ATTR = 'data-accounts-reset-cancel';

export interface ResetModalContentProps {
  provider: QuotaProviderType;
  /** Provider mark and account name, as the card header shows them. */
  account: ReactNode;
  limits: readonly AccountLimit[];
  resets: readonly FreeReset[];
  selectedId: string | null;
  canUse: (id: string) => boolean;
  onSelect: (id: string) => void;
  /** Reset grants are still being read. */
  loading: boolean;
  /** Already translated; shown as a status line. */
  message: string;
  now: number;
}

function ChangeRow({ limit, reset }: { limit: AccountLimit; reset: FreeReset }) {
  const { t } = useTranslation();
  const effect = resetEffect(reset, limit);
  const label = limitLabel(t, limit);
  const bar = (
    <div className={styles.duo}>
      {effect === 'full' && <span className={styles.duoAfter} />}
      <span
        className={styles.duoNow}
        data-tone={toneFor(limit.left)}
        style={{ width: `${limit.left}%` }}
      />
    </div>
  );
  if (effect === 'full') {
    return (
      <>
        <span className={styles.changeLabel}>{label}</span>
        {bar}
        <span className={styles.changeNums}>
          <s>{limit.left}%</s>
          <em>{t(`${K}.modal_to`)}</em>
          100% {t(`${K}.figure_left`)}
        </span>
      </>
    );
  }
  const key =
    effect === 'none' ? 'modal_unchanged' : effect === 'partial' ? 'modal_partial' : 'modal_maybe';
  return (
    <>
      <span className={styles.changeLabel}>{label}</span>
      {bar}
      <span className={`${styles.changeNums} ${styles.changeSame}`}>
        {t(`${K}.${key}`, { percent: limit.left })}
      </span>
    </>
  );
}

export function ResetModalContent(props: ResetModalContentProps) {
  const { provider, account, limits, resets, selectedId, canUse, onSelect, loading, message, now } =
    props;
  const { t, i18n } = useTranslation();
  const reset = resets.find((candidate) => candidate.id === selectedId);
  const returnMs = reset ? naturalReturnMs(reset, limits) : null;

  return (
    <>
      <div className={styles.modalAccount}>{account}</div>
      {loading ? (
        <p role="status" aria-busy="true">
          {t('common.loading')}
        </p>
      ) : !reset ? (
        resets.length === 0 ? (
          <p>{t('claude_reset.no_grants')}</p>
        ) : (
          <>
            <p className={styles.modalLead}>{t(`${K}.modal_choose`)}</p>
            <ResetsList
              provider={provider}
              resets={resets}
              now={now}
              canUse={canUse}
              onUse={onSelect}
            />
          </>
        )
      ) : (
        <>
          <p className={styles.modalLead}>{resetWhatLine(t, reset.scope)}</p>
          <div className={styles.change}>
            {limits.map((limit) => (
              <ChangeRow key={limit.id} limit={limit} reset={reset} />
            ))}
          </div>
          {reset.givesBackWeekly && (
            <p className={styles.modalNote}>{t('claude_reset.fable_hint')}</p>
          )}
          {returnMs !== null && returnMs > now && (
            <p className={styles.modalElse}>
              {t(`${K}.modal_wait`, {
                time: formatWhen(returnMs, now),
                duration: formatIn(returnMs - now, i18n.resolvedLanguage),
              })}
            </p>
          )}
          {!canUse(reset.id) && (
            <p role="status" className={styles.modalNote}>
              {t(reset.noUsage ? 'claude_reset.no_usage' : 'claude_reset.grant_unavailable')}
            </p>
          )}
        </>
      )}
      {message && (
        <p role="status" className={styles.modalNote}>
          {message}
        </p>
      )}
    </>
  );
}

export interface ResetModalFooterProps {
  /** Free resets the account holds now; null when not known. */
  count: number | null;
  canConfirm: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ResetModalFooter({
  count,
  canConfirm,
  busy,
  onConfirm,
  onClose,
}: ResetModalFooterProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.modalTail}>
      <span className={styles.modalKeep}>
        {count !== null && count > 0 && <b>{t(`${K}.modal_left_after`, { count: count - 1 })}</b>}
        {t(`${K}.modal_no_undo`)}
      </span>
      <span className={styles.modalActions}>
        <Button variant="ghost" onClick={onClose} disabled={busy} {...{ [CANCEL_ATTR]: '' }}>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} loading={busy} disabled={!canConfirm}>
          {t(`${K}.modal_confirm`)}
        </Button>
      </span>
    </div>
  );
}

export type ResetModalProps = ResetModalContentProps &
  Omit<ResetModalFooterProps, 'canConfirm'> & { open: boolean };

export function ResetModal(props: ResetModalProps) {
  const { open, busy, onClose, onConfirm, count, selectedId, canUse } = props;
  const { t } = useTranslation();

  // The shared Modal focuses its close button; Cancel is the safe first stop here.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[${CANCEL_ATTR}]`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // The shared Modal has no backdrop dismissal; a press on the backdrop itself cancels.
  useEffect(() => {
    if (!open || busy) return;
    const onPress = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains('modal-overlay')) onClose();
    };
    document.addEventListener('mousedown', onPress);
    return () => document.removeEventListener('mousedown', onPress);
  }, [open, busy, onClose]);

  return (
    <Modal
      open={open}
      title={t(`${K}.modal_title`)}
      onClose={onClose}
      closeDisabled={busy}
      width={440}
      footer={
        <ResetModalFooter
          count={count}
          busy={busy}
          canConfirm={selectedId !== null && canUse(selectedId)}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      }
    >
      <ResetModalContent {...props} />
    </Modal>
  );
}
