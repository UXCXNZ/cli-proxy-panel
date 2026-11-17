/**
 * Account view preferences, kept per browser in localStorage: Cards or Table,
 * and whether figures count what is Left or what is Used.
 */

import { useCallback, useState } from 'react';
import type { CountMode } from './accountsRules';

/** Off returns the page to upstream's cards and layout switch. */
export const ACCOUNTS_VIEW_ENABLED: boolean = true;

export type AccountsView = 'cards' | 'table';

export interface AccountsSettings {
  view: AccountsView;
  mode: CountMode;
}

export const DEFAULT_ACCOUNTS_SETTINGS: AccountsSettings = { view: 'cards', mode: 'left' };

const STORAGE_KEY = 'quotaPage.accounts';

export function parseAccountsSettings(raw: unknown): AccountsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ACCOUNTS_SETTINGS };
  const value = raw as Partial<Record<keyof AccountsSettings, unknown>>;
  return {
    view: value.view === 'table' ? 'table' : 'cards',
    mode: value.mode === 'used' ? 'used' : 'left',
  };
}

export function readAccountsSettings(): AccountsSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_ACCOUNTS_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseAccountsSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_ACCOUNTS_SETTINGS };
  }
}

export function writeAccountsSettings(settings: AccountsSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or disabled: the choice just won't persist.
  }
}

export interface AccountsSettingsControl extends AccountsSettings {
  setView: (view: AccountsView) => void;
  setMode: (mode: CountMode) => void;
}

/** Page-wide: one instance feeds the toolbar switches, the cards and the table. */
export function useAccountsSettings(): AccountsSettingsControl {
  const [settings, setSettings] = useState(readAccountsSettings);
  const update = useCallback((patch: Partial<AccountsSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writeAccountsSettings(next);
      return next;
    });
  }, []);
  const setView = useCallback((view: AccountsView) => update({ view }), [update]);
  const setMode = useCallback((mode: CountMode) => update({ mode }), [update]);
  return { ...settings, setView, setMode };
}
