/**
 * DEV-ONLY preview of the account cards, table, resets list and confirmation.
 *
 * Registered in App.tsx only when `import.meta.env.DEV` is true, outside the
 * auth guard, so it opens without a backend or real accounts:
 *   http://localhost:5173/#/__preview/accounts
 * Invented accounts run through the real model and components. Nothing here
 * can spend a reset: Confirm only closes the dialog. Page copy is not
 * localized, because this page never ships.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import { useThemeStore } from '@/stores';
import type { ClaudeQuotaState, CodexQuotaState, Theme } from '@/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { QuotaProviderType } from '../../providers/types';
import { AccountCardView } from '../AccountCardView';
import { ProviderMark } from '../AccountParts';
import { AccountsSwitches, Segmented } from '../AccountsSwitches';
import { AccountRowView, AccountsTableView } from '../AccountsTableView';
import { planLabelFor } from '../accountsLabels';
import {
  accountFigures,
  firstExpiryMs,
  resetEffect,
  resetsFromClaudeGrants,
  resetsFromCodexCredits,
  tableColumns,
  totalResets,
  type FreeReset,
} from '../accountsModel';
import { verdictFor } from '../accountsRules';
import { useAccountsSettings } from '../accountsSettings';
import { ResetModal, ResetModalContent, ResetModalFooter } from '../ResetModal';
import { ResetsList } from '../ResetsList';
import { privateLabel } from '../useAccount';
import accountStyles from '../Accounts.module.scss';
import styles from './AccountsPreview.module.scss';

interface PreviewAccount {
  provider: QuotaProviderType;
  email: string;
  quota: ClaudeQuotaState | CodexQuotaState;
  resets: FreeReset[];
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Paper' },
  { value: 'white', label: 'White' },
  { value: 'dark', label: 'Dark' },
];

const grant = (
  id: string,
  label: string,
  endsInDays: number,
  now: number,
  extra: Partial<AnthropicResetGrant>
): AnthropicResetGrant => ({
  id,
  label,
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: new Date(now + endsInDays * DAY_MS).toISOString(),
  clears: [],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...extra,
});

const claudeQuota = (
  now: number,
  weeklyUsed: number,
  fableUsed: number,
  fableResetMs: number
): ClaudeQuotaState => ({
  status: 'success',
  planType: 'plan_max20',
  windows: [
    {
      id: 'seven-day',
      label: 'Weekly limit',
      usedPercent: weeklyUsed,
      resetLabel: '',
      resetAtMs: now + 4 * DAY_MS,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: 'Weekly Fable 5 limit',
      usedPercent: fableUsed,
      resetLabel: '',
      resetAtMs: now + fableResetMs,
      periodHours: 168,
    },
  ],
});

/** The drawing's three accounts, with example.com addresses. */
function buildAccounts(now: number): PreviewAccount[] {
  const fableGrant = (id: string, label: string) =>
    grant(id, label, 112, now, { givesBackWeekly: true, percentUsed: { fable: 100 } });
  return [
    {
      provider: 'claude',
      email: 'ada@example.com',
      quota: claudeQuota(now, 31, 55, 4 * DAY_MS),
      resets: [],
    },
    {
      provider: 'claude',
      email: 'grace@example.com',
      quota: claudeQuota(now, 85, 100, 19 * HOUR_MS),
      resets: resetsFromClaudeGrants([
        fableGrant('fable_max', 'New model launch, for Max plans'),
        fableGrant('fable_12m', "New model launch, 12 months' tenure"),
        grant('full_nov', 'One full limit reset, November 2026', 23, now, { resetType: 'full' }),
        fableGrant('fable_6m', "New model launch, 6 months' tenure"),
      ]),
    },
    {
      provider: 'codex',
      email: 'linus@example.com',
      quota: {
        status: 'success',
        planType: 'pro',
        rateLimitResetCreditsAvailableCount: 3,
        rateLimitResetCreditsApplicableAvailableCount: 3,
        windows: [
          {
            id: 'weekly',
            label: 'Weekly limit',
            usedPercent: 35,
            resetLabel: '',
            resetAtMs: now + 31 * HOUR_MS,
            periodHours: 168,
          },
        ],
      },
      resets: resetsFromCodexCredits(
        [14, 30, 44].map((days, index) => ({
          id: `credit_${index}`,
          status: 'available',
          grantedAt: new Date(now - DAY_MS).toISOString(),
          expiresAt: new Date(now + days * DAY_MS).toISOString(),
        }))
      ),
    },
  ];
}

export function AccountsPreview() {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const settings = useAccountsSettings();
  const [now] = useState(() => Date.now());
  const [accounts] = useState(() => buildAccounts(now));
  const [showEmails, setShowEmails] = useState(true);
  const [openDetails, setOpenDetails] = useState<ReadonlySet<number>>(() => new Set());
  // The confirmation: which account, and which reset once one is chosen.
  const [dialog, setDialog] = useState<{ account: number; selected: string | null } | null>(null);

  const canUse = () => true;
  const rows = accounts.map((account, index) => {
    const { hasFigures, limits } = accountFigures(account.provider, account.quota);
    const isClaude = account.provider === 'claude';
    const name = privateLabel(account.email, showEmails);
    const openDialog = (selected?: string) => {
      // Codex keeps upstream's own confirmation, which this page does not draw.
      if (!isClaude) return;
      setDialog({
        account: index,
        selected: selected ?? (account.resets.length === 1 ? account.resets[0].id : null),
      });
    };
    return {
      account,
      name,
      limits,
      openDialog,
      view: {
        identity: {
          name,
          providerType: account.provider,
          planLabel: planLabelFor(t, account.provider, account.quota),
        },
        theme: resolvedTheme,
        mode: settings.mode,
        now,
        status: 'success' as const,
        hasFigures,
        limits,
        verdict: verdictFor(
          limits,
          (limit) =>
            isClaude
              ? totalResets(account.resets.filter((reset) => resetEffect(reset, limit) === 'full'))
              : account.resets.length,
          now
        ),
        idleText: '',
        loadingText: '',
        errorText: '',
        emptyText: '',
        resets: {
          count: totalResets(account.resets),
          firstExpiryMs: firstExpiryMs(account.resets),
          note: '',
          message: '',
        },
        canUseReset: account.resets.length > 0,
        onUseReset: () => openDialog(),
        canRefresh: true,
        refreshDisabled: false,
        onRefresh: () => undefined,
      },
    };
  });

  const columns = tableColumns(rows.map((row) => row.limits));
  const withResets = rows[1];
  const fableReset = withResets.account.resets.find((reset) => reset.givesBackWeekly);
  const dialogRow = dialog ? rows[dialog.account] : null;
  const accountLine = (row: (typeof rows)[number]) => (
    <>
      <ProviderMark type={row.account.provider} theme={resolvedTheme} />
      <span className={accountStyles.name}>{row.name}</span>
    </>
  );

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <div>
          <h1 className={styles.title}>Accounts</h1>
          <p className={styles.caption}>
            Development preview with invented accounts. Nothing here can spend a reset. Codex keeps
            upstream's own confirmation, so its Use buttons do nothing on this page.
          </p>
        </div>
        <div className={styles.controls}>
          <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
          <Segmented
            label="Emails"
            value={showEmails ? 'shown' : 'hidden'}
            options={[
              { value: 'shown', label: 'Emails shown' },
              { value: 'hidden', label: 'Emails hidden' },
            ]}
            onChange={(value) => setShowEmails(value === 'shown')}
          />
          <AccountsSwitches settings={settings} />
        </div>
      </header>

      {settings.view === 'cards' ? (
        <div className={accountStyles.grid}>
          {rows.map((row, index) => (
            <AccountCardView
              key={row.account.email}
              {...row.view}
              detailsOpen={openDetails.has(index)}
              onToggleDetails={() =>
                setOpenDetails((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(index)) next.add(index);
                  return next;
                })
              }
              onShowResets={() => setOpenDetails((previous) => new Set(previous).add(index))}
              details={
                row.account.resets.length > 0 ? (
                  <ResetsList
                    provider={row.account.provider}
                    resets={row.account.resets}
                    now={now}
                    canUse={canUse}
                    onUse={row.openDialog}
                  />
                ) : (
                  <span>Upstream's provider body is drawn here on the real page.</span>
                )
              }
            />
          ))}
        </div>
      ) : (
        <AccountsTableView columns={columns}>
          {rows.map((row) => (
            <AccountRowView key={row.account.email} {...row.view} columns={columns} />
          ))}
        </AccountsTableView>
      )}

      <section className={styles.section}>
        <h2 className={styles.heading}>The resets list, opened</h2>
        <p className={styles.caption}>Sorted so the one that would be lost first is on top.</p>
        <div className={styles.narrow}>
          <ResetsList
            provider={withResets.account.provider}
            resets={withResets.account.resets}
            now={now}
            canUse={canUse}
            onUse={withResets.openDialog}
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The confirmation</h2>
        <p className={styles.caption}>
          Drawn in place for a Fable-only reset. It opens over the page from Use or Use a reset.
        </p>
        <div className={styles.staticModal}>
          <h3>{t('quota_management.accounts.modal_title')}</h3>
          <ResetModalContent
            provider={withResets.account.provider}
            account={accountLine(withResets)}
            limits={withResets.limits}
            resets={withResets.account.resets}
            selectedId={fableReset?.id ?? null}
            canUse={canUse}
            onSelect={() => undefined}
            loading={false}
            message=""
            now={now}
          />
          <div className={styles.staticFooter}>
            <ResetModalFooter
              count={totalResets(withResets.account.resets)}
              canConfirm
              busy={false}
              onConfirm={() => undefined}
              onClose={() => undefined}
            />
          </div>
        </div>
      </section>

      {dialogRow && (
        <ResetModal
          open
          provider={dialogRow.account.provider}
          account={accountLine(dialogRow)}
          limits={dialogRow.limits}
          resets={dialogRow.account.resets}
          selectedId={dialog?.selected ?? null}
          canUse={canUse}
          onSelect={(selected) => setDialog((current) => current && { ...current, selected })}
          loading={false}
          message=""
          count={totalResets(dialogRow.account.resets)}
          busy={false}
          now={now}
          onConfirm={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
