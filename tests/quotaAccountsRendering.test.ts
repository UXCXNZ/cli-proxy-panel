import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import {
  AccountCardView,
  type AccountCardViewProps,
} from '../src/features/quota/accounts/AccountCardView';
import { resetsFromClaudeGrants } from '../src/features/quota/accounts/accountsModel';
import { verdictFor, type AccountLimit } from '../src/features/quota/accounts/accountsRules';
import { ResetModalContent } from '../src/features/quota/accounts/ResetModal';
import { privateLabel } from '../src/features/quota/accounts/useAccount';
import { AccountsView } from '../src/features/quota/accounts/AccountsView';
import type { AccountsSettings } from '../src/features/quota/accounts/accountsSettings';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import type { QuotaCardState } from '../src/features/quota/providers';
import { AntigravityQuotaBody } from '../src/features/quota/providers/antigravity/AntigravityQuotaBody';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '../src/features/quota/types';
import type { AntigravityQuotaState } from '../src/types';

const NOW = Date.parse('2026-11-17T00:34:00Z');
const DAY = 24 * 3_600_000;

const limits: AccountLimit[] = [
  {
    id: 'seven-day',
    scope: 'account',
    window: 'weekly',
    name: null,
    left: 15,
    resetAtMs: NOW + 4 * DAY,
  },
  {
    id: 'seven-day-fable',
    scope: 'model',
    window: 'weekly',
    name: 'Fable',
    left: 0,
    resetAtMs: NOW + DAY,
  },
];

const cardProps = (overrides: Partial<AccountCardViewProps> = {}): AccountCardViewProps => ({
  identity: { name: 'ada@example.com', providerType: 'claude', planLabel: 'Max 20x' },
  theme: 'dark',
  mode: 'left',
  now: NOW,
  status: 'success',
  hasFigures: true,
  limits,
  verdict: verdictFor(limits, () => 4, NOW),
  idleText: 'Click here to refresh quota',
  loadingText: 'Loading quota...',
  errorText: 'Failed to load quota: boom',
  emptyText: 'No quota data available',
  resets: { count: 4, firstExpiryMs: NOW + 23 * DAY, note: '', message: '' },
  canUseReset: true,
  onUseReset: () => undefined,
  canRefresh: true,
  refreshDisabled: false,
  onRefresh: () => undefined,
  detailsOpen: false,
  onToggleDetails: () => undefined,
  onShowResets: () => undefined,
  details: 'DETAILS',
  ...overrides,
});

const render = (overrides?: Partial<AccountCardViewProps>) =>
  renderToStaticMarkup(createElement(AccountCardView, cardProps(overrides)));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('account card rendering', () => {
  test('every figure carries its word, and flips with the page-wide count', () => {
    const left = render();
    expect(left).toContain('15%<small>left</small>');
    expect(left).toContain('0%<small>left</small>');
    expect(left).toContain('width:15%');
    expect(left).not.toContain('<small>used</small>');

    const used = render({ mode: 'used' });
    expect(used).toContain('85%<small>used</small>');
    expect(used).toContain('100%<small>used</small>');
    expect(used).toContain('width:85%');
    expect(used).not.toContain('<small>left</small>');
    // Colour still describes what is left.
    expect(used.match(/data-tone="low"/g)?.length).toBe(left.match(/data-tone="low"/g)?.length);
  });

  test('shows the verdict, the resets line and all three actions', () => {
    const markup = render();
    expect(markup).toContain('Fable is spent');
    expect(markup).toContain('Or use a free reset.');
    expect(markup).toContain('4 free resets · first expires');
    for (const action of ['Use a reset', 'Details', 'Refresh']) expect(markup).toContain(action);
    expect(markup).not.toContain('DETAILS');
    expect(render({ detailsOpen: true })).toContain('DETAILS');
    expect(render({ canUseReset: false })).not.toContain('Use a reset');
  });

  test('keeps the idle, loading and error states', () => {
    const idle = render({ status: 'idle', hasFigures: false, limits: [], verdict: null });
    expect(idle).toContain('Click here to refresh quota');
    expect(idle).not.toContain('Details');

    const loading = render({ status: 'loading', hasFigures: false, limits: [], verdict: null });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('Fable is spent');

    // Claude keeps its last figures while it refreshes or after a failed read.
    const retained = render({ status: 'loading' });
    expect(retained).toContain('Loading quota...');
    expect(retained).toContain('Fable is spent');

    const failed = render({ status: 'error' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Failed to load quota: boom');
  });

  test('a reset status that needs attention stays in view', () => {
    const markup = render({
      resets: { count: null, firstExpiryMs: null, note: '', message: 'The outcome is unknown.' },
      resetActionLabel: 'Retry the same claim',
    });
    expect(markup).toContain('The outcome is unknown.');
    expect(markup).toContain('Retry the same claim');
  });
});

describe('reset confirmation rendering', () => {
  const resets = resetsFromClaudeGrants([
    {
      id: 'fable_launch',
      label: 'New model launch',
      resetsTotal: 1,
      resetsLeft: 1,
      startsAt: null,
      endsAt: new Date(NOW + 112 * DAY).toISOString(),
      clears: [],
      paused: false,
      usableNow: true,
      useRequiresLimit: false,
      percentUsed: {},
      givesBackWeekly: true,
    },
  ]);
  const content = (selectedId: string | null, loading = false) =>
    renderToStaticMarkup(
      createElement(ResetModalContent, {
        provider: 'claude',
        account: 'a…@example.com',
        limits,
        resets,
        selectedId,
        canUse: () => true,
        onSelect: () => undefined,
        loading,
        message: '',
        now: NOW,
      })
    );

  test('says what a model-only reset does to each limit', () => {
    const markup = content('fable_launch');
    expect(markup).toContain('Resets Fable only, now.');
    expect(markup).toContain('<s>0%</s><em>to</em>100% left');
    expect(markup).toContain('15% left, gets some back');
    expect(markup).toContain('If you wait, it comes back');
    expect(markup).toContain('in 1 day');
  });

  test('with no reset chosen it lists them instead of picking one', () => {
    const markup = content(null);
    expect(markup).toContain('Choose which reset to use.');
    expect(markup).toContain('Fable only');
    expect(markup).not.toContain('100% left');
    expect(content(null, true)).toContain('aria-busy="true"');
  });
});

describe('privacy', () => {
  test('addresses are masked unless emails are shown, in names and file names alike', () => {
    expect(privateLabel('ada@example.com', true)).toBe('ada@example.com');
    expect(privateLabel('ada@example.com', false)).toBe('a…@example.com');
    expect(privateLabel('claude-ada@example.com.json', false)).toBe('c…@example.com.json');
    expect(privateLabel('codex-team.json', false)).toBe('codex-team.json');
  });
});

describe('accounts view on the quota page', () => {
  const entries: QuotaFileEntry[] = [
    {
      type: 'claude',
      file: { name: 'claude-ada@example.com.json', type: 'claude', email: 'ada@example.com' },
    },
    { type: 'codex', file: { name: 'codex-team.json', type: 'codex' } },
    {
      type: 'antigravity',
      file: {
        name: 'antigravity-gemini@example.com.json',
        type: 'antigravity',
        email: 'gemini@example.com',
      },
    },
    { type: 'kimi', file: { name: 'kimi.json', type: 'kimi' } },
  ];
  const quotas: Record<string, QuotaCardState & Record<string, unknown>> = {
    claude: {
      status: 'success',
      planType: 'plan_max20',
      windows: [
        { id: 'seven-day', label: '', usedPercent: 31, resetLabel: '', resetAtMs: NOW + 4 * DAY },
        { id: 'seven-day-fable', label: '', usedPercent: 55, resetLabel: '', resetAtMs: NOW + DAY },
      ],
    },
    codex: {
      status: 'success',
      planType: 'pro',
      rateLimitResetCreditsAvailableCount: 3,
      windows: [
        { id: 'weekly', label: '', usedPercent: 35, resetLabel: '', resetAtMs: NOW + 2 * DAY },
      ],
    },
    antigravity: {
      status: 'success',
      subscription: { plan: 'pro', tierName: null, tierId: null },
      groups: [
        {
          id: 'gemini',
          label: 'Gemini models',
          buckets: [
            { id: 'gemini-5h', label: '5-hour limit', remainingFraction: 0.9924027 },
            { id: 'gemini-weekly', label: 'Weekly limit', remainingFraction: 0.9978293 },
          ],
        },
        {
          id: 'third-party',
          label: 'Claude and GPT models',
          buckets: [{ id: '3p-weekly', label: 'Weekly limit', remainingFraction: 0.42 }],
        },
      ],
    },
  };
  const view = (settings: AccountsSettings, showEmails = true) =>
    renderToStaticMarkup(
      createElement(AccountsView, {
        entries,
        quotaFor: (entry) => quotas[entry.type],
        resolvedTheme: 'dark',
        settings,
        showEmails,
        canUseActions: true,
        resettingKey: null,
        creditOverageCountFor: () => 1,
        onRefresh: () => undefined,
        onReset: () => undefined,
        renderLegacyCard: (entry) =>
          createElement('div', { key: entry.file.name }, `LEGACY ${entry.file.name}`),
      })
    );

  test('cards: Claude and Codex keep their figures and reset actions', () => {
    const markup = view({ view: 'cards', mode: 'left' });
    expect(markup).toContain('ada@example.com');
    expect(markup).not.toContain('claude-ada@example.com.json');
    expect(markup).toContain('codex-team.json');
    expect(markup).toContain('69%<small>left</small>');
    expect(markup).toContain('65%<small>left</small>');
    expect(markup).toContain('3 free resets');
    expect(markup).toContain('LEGACY kimi.json');
    expect(markup.match(/<article/g)?.length).toBe(3);
  });

  test('Antigravity has two Gemini figures, a Pro badge, Other Google limits and Refresh', () => {
    const card = view({ view: 'cards', mode: 'left' })
      .split('<article')
      .find((item) => item.includes('gemini@example.com'));
    expect(card).toContain('>Pro</span>');
    expect(card).toContain('Gemini 5-hour');
    expect(card).toContain('99.24%<small>left</small>');
    expect(card).toContain('Gemini weekly');
    expect(card).toContain('99.78%<small>left</small>');
    expect(card).toContain('>Other Google limits</button>');
    expect(card).toContain('>Refresh</button>');
    expect(card).not.toContain('Claude and GPT models');
    expect(card).not.toContain('free resets');
    expect(card).not.toContain('Use a reset');
  });

  test('Other Google limits keeps the extra groups and removes the summary rows and plan', () => {
    const quota = quotas.antigravity as unknown as AntigravityQuotaState;
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test'
    );
    const argon = {
      id: 'argon',
      label: 'Gemini 4 Argon',
      buckets: [{ id: 'gemini-argon-wtu-weekly', label: 'Weekly limit', remainingFraction: 0.8 }],
    };
    const markup = renderToStaticMarkup(
      createElement(AntigravityQuotaBody, {
        classes,
        quota: { ...quota, groups: [...quota.groups, argon] },
        otherLimitsOnly: true,
      })
    );
    expect(markup).toContain('Claude and GPT models');
    expect(markup).toContain('Gemini 4 Argon');
    expect(markup).toContain('42% remaining');
    expect(markup).not.toContain('Gemini models');
    expect(markup).not.toContain('data-quota-plan');
    expect(markup).not.toContain('class="quotaBar"');

    const full = renderToStaticMarkup(createElement(AntigravityQuotaBody, { classes, quota }));
    expect(full).toContain('Gemini models');
    expect(full).toContain('99.24% remaining');
    expect(full).toContain('data-quota-plan');
  });

  test('hiding emails masks the name', () => {
    const markup = view({ view: 'cards', mode: 'left' }, false);
    expect(markup).toContain('a…@example.com');
    expect(markup).not.toContain('ada@example.com');
  });

  test('table: one row per account of ours, a column per limit, same count as the cards', () => {
    const markup = view({ view: 'table', mode: 'used' });
    expect(markup.match(/<tr>/g)?.length).toBe(3);
    for (const heading of ['Account', 'Plan', 'Weekly', 'Fable', 'Resets', 'Free resets']) {
      expect(markup).toContain(`>${heading}</th>`);
    }
    expect(markup).toContain('31%<small>used</small>');
    expect(markup).toContain('35%<small>used</small>');
    expect(markup).toContain('Not on this plan');
    expect(markup).toContain('Use one');
    expect(markup).toContain('LEGACY antigravity-gemini@example.com.json');
    expect(markup).toContain('LEGACY kimi.json');
  });
});
