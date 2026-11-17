import { describe, expect, test } from 'bun:test';
import {
  accountBurnRate,
  buildPoolAccounts,
  buildRecordedSeries,
  nextResetAfter,
  poolBurnRate,
  poolSpan,
  projectPool,
  recordedValueAt,
  sampleFromQuota,
  summarizePool,
  weightKey,
  type PoolSample,
  type PoolSnapshot,
} from '../src/features/quota/pool/poolModel';

const HOUR = 3_600_000;
const T0 = new Date(2026, 9, 26, 0, 0).getTime();

const sample = (
  id: string,
  remaining: number,
  resetAtMs: number | null,
  extra: Partial<PoolSample> = {}
): PoolSample => ({
  id,
  provider: 'claude',
  label: `${id}@example.com`,
  plan: 'plan_pro',
  remaining,
  resetAtMs,
  periodHours: 168,
  ...extra,
});

/** Hourly snapshots of one account draining `perHour` from `start`. */
const draining = (id: string, start: number, perHour: number, hours: number, resetAtMs: number) =>
  Array.from({ length: hours + 1 }, (_, h): PoolSnapshot => ({
    t: T0 + h * HOUR,
    samples: [sample(id, start - perHour * h, resetAtMs)],
  }));

describe('sampleFromQuota', () => {
  test('reads the weekly Claude window as remaining percent', () => {
    const resetAt = T0 + 48 * HOUR;
    const result = sampleFromQuota(
      { id: 'a.json', provider: 'claude', label: 'a@example.com' },
      {
        status: 'success',
        planType: 'plan_max5',
        windows: [
          { id: 'five-hour', usedPercent: 90, resetAtMs: T0 + HOUR, periodHours: 5 },
          { id: 'seven-day', usedPercent: 25, resetAtMs: resetAt, periodHours: 168 },
        ],
      }
    );
    expect(result).toEqual({
      id: 'a.json',
      provider: 'claude',
      label: 'a@example.com',
      plan: 'plan_max5',
      remaining: 75,
      resetAtMs: resetAt,
      periodHours: 168,
    });
  });

  test('returns null when the state has no window', () => {
    expect(
      sampleFromQuota({ id: 'a', provider: 'claude', label: 'a' }, { status: 'error' })
    ).toBeNull();
  });
});

describe('recorded values', () => {
  test('carry forward until the sampled window resets, then read full', () => {
    const accounts = buildPoolAccounts(
      [{ t: T0, samples: [sample('a', 40, T0 + 5 * HOUR)] }],
      'claude',
      {}
    );
    expect(recordedValueAt(accounts[0], T0 - 1)).toBeNull();
    expect(recordedValueAt(accounts[0], T0 + 4 * HOUR)).toBe(40);
    expect(recordedValueAt(accounts[0], T0 + 5 * HOUR)).toBe(100);
  });

  test('pool line sums weighted accounts and labels reset jumps', () => {
    const snapshots: PoolSnapshot[] = [
      { t: T0, samples: [sample('a', 50, T0 + 2 * HOUR), sample('b', 80, null, { plan: 'pro' })] },
      {
        t: T0 + HOUR,
        samples: [sample('a', 40, T0 + 2 * HOUR), sample('b', 70, null, { plan: 'pro' })],
      },
    ];
    const accounts = buildPoolAccounts(snapshots, 'claude', { [weightKey('claude', 'pro')]: 2 });
    const series = buildRecordedSeries(accounts, T0, T0 + 3 * HOUR);
    expect(series.points.map((p) => p.value)).toEqual([50 + 160, 40 + 140, 40 + 140, 100 + 140]);
    expect(series.points[2].t).toBe(T0 + 2 * HOUR);
    expect(series.jumps).toEqual([{ t: T0 + 2 * HOUR, gain: 60 }]);
  });

  test('an account appearing mid-span is not labelled as a reset', () => {
    const snapshots: PoolSnapshot[] = [
      { t: T0, samples: [sample('a', 50, null)] },
      { t: T0 + HOUR, samples: [sample('a', 50, null), sample('b', 90, null)] },
    ];
    const series = buildRecordedSeries(buildPoolAccounts(snapshots, 'claude', {}), T0, T0 + HOUR);
    expect(series.jumps).toEqual([]);
  });
});

describe('burn rate', () => {
  test('averages decreases over the covered window and ignores resets', () => {
    const snapshots = [
      ...draining('a', 90, 2, 3, T0 + 100 * HOUR),
      { t: T0 + 4 * HOUR, samples: [sample('a', 100, T0 + 268 * HOUR)] },
    ];
    const [account] = buildPoolAccounts(snapshots, 'claude', {});
    expect(accountBurnRate(account, T0 + 3 * HOUR, 3)).toBeCloseTo(2);
    // The 84 -> 100 rise is a reset, not negative usage.
    expect(accountBurnRate(account, T0 + 4 * HOUR, 6)).toBeCloseTo(6 / 4);
  });

  test('needs enough coverage before reporting a rate', () => {
    const [account] = buildPoolAccounts(
      [{ t: T0, samples: [sample('a', 90, null)] }],
      'claude',
      {}
    );
    expect(accountBurnRate(account, T0, 3)).toBeNull();
    expect(poolBurnRate([account], T0, 3)).toBeNull();
  });
});

describe('projection', () => {
  test('drains to empty, refills at reset, and reports the summary instants', () => {
    // 10%/h with 30% left: empty three hours after now; window resets at +10h.
    const now = T0 + 3 * HOUR;
    const accounts = buildPoolAccounts(draining('a', 60, 10, 3, T0 + 13 * HOUR), 'claude', {});
    const projection = projectPool(accounts, now, now + 20 * HOUR, 3, 'same');

    expect(projection.burnRate).toBeCloseTo(10);
    expect(projection.firstEmpty?.atMs).toBeCloseTo(now + 3 * HOUR);
    expect(projection.poolEmptyAtMs).toBeCloseTo(now + 3 * HOUR);
    expect(projection.nextReset).toEqual({ t: T0 + 13 * HOUR, gain: 100 });
    // After the reset it drains again from 100 at 10%/h and is empty 10h later.
    const end = projection.points[projection.points.length - 1];
    expect(end.t).toBe(now + 20 * HOUR);
    expect(end.value).toBeCloseTo(0);
  });

  test('staggered resets keep a gently drained pool above empty', () => {
    const now = T0 + 3 * HOUR;
    const snapshots = [0, 1, 2, 3].map((h): PoolSnapshot => ({
      t: T0 + h * HOUR,
      samples: [sample('a', 80 - h, T0 + 30 * HOUR), sample('b', 60 - h, T0 + 60 * HOUR)],
    }));
    const projection = projectPool(
      buildPoolAccounts(snapshots, 'claude', {}),
      now,
      now + 3 * 24 * HOUR,
      3,
      'same'
    );
    expect(projection.poolEmptyAtMs).toBeNull();
    expect(projection.jumps.map((jump) => jump.t)).toEqual([T0 + 30 * HOUR, T0 + 60 * HOUR]);
  });

  test("'none' keeps the pool flat apart from resets", () => {
    const now = T0 + 3 * HOUR;
    const accounts = buildPoolAccounts(draining('a', 60, 10, 3, T0 + 13 * HOUR), 'claude', {});
    const projection = projectPool(accounts, now, now + 5 * HOUR, 3, 'none');
    expect(projection.points.map((p) => p.value)).toEqual([30, 30]);
    expect(projection.firstEmpty).toBeNull();
  });

  test('summary weights capacity by plan', () => {
    const accounts = buildPoolAccounts(
      [{ t: T0, samples: [sample('a', 50, null), sample('b', 50, null, { plan: 'pro' })] }],
      'claude',
      { [weightKey('claude', 'pro')]: 2.5 }
    );
    expect(summarizePool(accounts, T0)).toEqual({ remaining: 50 + 125, capacity: 350 });
  });
});

describe('helpers', () => {
  test('rolls a stale reset anchor forward by whole periods', () => {
    const point = { t: T0, remaining: 10, resetAtMs: T0 - HOUR, periodHours: 5 };
    expect(nextResetAfter(point, T0)).toBe(T0 + 4 * HOUR);
  });

  test('span starts three days before today and covers fourteen days', () => {
    const span = poolSpan(T0 + 15 * HOUR, 0);
    expect(new Date(span.startMs).getDate()).toBe(23);
    expect(new Date(span.endMs).getDate()).toBe(6);
    expect(new Date(poolSpan(T0, -1).startMs).getDate()).toBe(16);
  });
});

describe('drain projection', () => {
  test('steps down when an account runs dry instead of sloping', () => {
    const now = T0 + 3 * HOUR;
    const accounts = buildPoolAccounts(draining('a', 60, 10, 3, T0 + 13 * HOUR), 'claude', {});
    const { drain } = projectPool(accounts, now, now + 5 * HOUR, 3, 'same');
    const emptyAt = now + 3 * HOUR;
    expect(drain.filter((point) => Math.abs(point.t - emptyAt) < 1).map((p) => p.value)).toEqual([
      10, 0,
    ]);
  });
});

describe('load moves to the accounts that are left', () => {
  // a has 10 left and b has 75; each burns 5 an hour, so the pool burns 10 an hour.
  const snapshots = Array.from({ length: 5 }, (_, h): PoolSnapshot => ({
    t: T0 + h * HOUR,
    samples: [sample('a', 30 - 5 * h, T0 + 400 * HOUR), sample('b', 95 - 5 * h, T0 + 400 * HOUR)],
  }));
  const now = T0 + 4 * HOUR;
  const accounts = buildPoolAccounts(snapshots, 'claude', {});
  const projection = projectPool(accounts, now, now + 48 * HOUR, 3, 'same');

  test('the pool keeps burning at the same rate after one account runs dry', () => {
    // a is dry after 2 hours. b then carries all 10 an hour: 65 left lasts 6.5 more hours.
    expect(projection.firstEmpty?.accountId).toBe('a');
    expect(projection.firstEmpty?.atMs).toBeCloseTo(now + 2 * HOUR, -3);
    expect(projection.poolEmptyAtMs).toBeCloseTo(now + 8.5 * HOUR, -3);
  });

  test('demand is unmet, not gone, once every account is dry', () => {
    const rates = projection.drain.filter((point) => point.t < now + 8 * HOUR);
    expect(rates.every((point) => Math.abs(point.value - 10) < 1e-6)).toBe(true);
    expect(projection.drain[projection.drain.length - 1].value).toBe(0);
  });
});

describe('too little history', () => {
  test('burn is unknown, never zero, from a single reading', () => {
    const accounts = buildPoolAccounts(
      [{ t: T0, samples: [sample('a', 80, T0 + 100 * HOUR)] }],
      'claude',
      {}
    );
    const projection = projectPool(accounts, T0 + HOUR, T0 + 48 * HOUR, 3, 'same');
    expect(projection.burnRate).toBeNull();
  });

  test("'none' is a chosen zero, not an unknown", () => {
    const accounts = buildPoolAccounts(
      [{ t: T0, samples: [sample('a', 80, T0 + 100 * HOUR)] }],
      'claude',
      {}
    );
    expect(projectPool(accounts, T0 + HOUR, T0 + 48 * HOUR, 3, 'none').burnRate).toBe(0);
  });
});
