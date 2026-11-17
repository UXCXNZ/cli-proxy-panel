/**
 * Quota recorder client.
 *
 * The recorder runs next to the proxy and saves what every credential has left
 * on a schedule; a small read-only server beside it answers `GET /history`.
 * It is a separate origin, so this does not go through `apiClient`, and it
 * takes no key: the management key is never sent anywhere but the proxy.
 */

import axios from 'axios';
import type { PoolSnapshot } from '@/features/quota/pool/poolModel';
import { normalizeApiBase } from '@/utils/connection';

/** Port the recorder listens on next to the proxy. */
export const DEFAULT_RECORDER_PORT = 8318;

const RECORDER_TIMEOUT_MS = 20_000;

export interface RecorderHistory {
  intervalMs: number;
  lastPollAt: number | null;
  snapshots: PoolSnapshot[];
}

/** Default recorder URL: the proxy's host on the recorder port. */
export function defaultRecorderUrl(apiBase: string): string {
  const base = normalizeApiBase(apiBase);
  if (!base) return '';
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.hostname}:${DEFAULT_RECORDER_PORT}`;
  } catch {
    return '';
  }
}

export const normalizeRecorderUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

const isSnapshot = (value: unknown): value is PoolSnapshot =>
  Boolean(value) &&
  typeof (value as PoolSnapshot).t === 'number' &&
  Array.isArray((value as PoolSnapshot).samples);

export const quotaRecorderApi = {
  async history(
    recorderUrl: string,
    fromMs: number,
    toMs: number
  ): Promise<RecorderHistory> {
    const response = await axios.get<Partial<RecorderHistory>>(`${recorderUrl}/history`, {
      params: { from: Math.floor(fromMs), to: Math.ceil(toMs) },
      timeout: RECORDER_TIMEOUT_MS,
    });
    const body = response.data ?? {};
    return {
      intervalMs: typeof body.intervalMs === 'number' ? body.intervalMs : 0,
      lastPollAt: typeof body.lastPollAt === 'number' ? body.lastPollAt : null,
      snapshots: Array.isArray(body.snapshots) ? body.snapshots.filter(isSnapshot) : [],
    };
  },
};
