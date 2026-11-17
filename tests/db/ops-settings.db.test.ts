import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { opsAreaIds } from '@/lib/opsAudit';
import { settingsBounds } from '@/lib/settings';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog, settings } from '@/server/db/schema';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  type FreshDatabase,
  type RaceHooks,
} from './harness';

const cache = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock('next/cache', () => ({
  updateTag: cache.updateTag,
  revalidateTag: vi.fn(),
}));

// Behaviours under test, against the real database, one per decision, branch or risk:
// - a guest, a host owner and nobody are refused with the same ForbiddenError for a read and for a save, and a refused save changes nothing, audit and cache included
// - ops and admin read every setting, and either may save
// - a save writes one audit row naming the user and the settings area, with old and new numbers, the new value of a switch, and the banner only flagged
// - the update and its audit row are one transaction: an audit row the log refuses rolls the update back
// - a save of the stored values writes nothing: no audit row, no new update time, no cache clearing
// - a save that names some changed and some stored settings audits only the changed ones
// - a save that changed something clears the settings tag after the commit
// - the database refuses every out-of-range value and a blank banner, whatever Zod does
// - a save that waits for another transaction's lock on the row judges what changed against what that transaction committed

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let api: typeof import('@/server/db/settings');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  api = await import('@/server/db/settings');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const baseline = {
  bannerText: null,
  bookingsPaused: false,
  checkoutMaintenance: false,
  holdMinutes: 10,
  paymentGraceMinutes: 5,
  taxRatePpm: 88_750,
};

beforeEach(async () => {
  await client.db.update(settings).set(baseline).where(eq(settings.id, true));
  cache.updateTag.mockClear();
});

const ops = testCaller({ roles: [Role.Ops] });
const admin = testCaller({ roles: [Role.Admin] });
const guest = testCaller({ roles: [Role.Guest] });
const hostOwner = testCaller({
  roles: [Role.HostOwner],
  hostIds: ['00000000-0000-4000-8000-0000000000b1'],
});

const rows = () =>
  client.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, 'settings.changed'));
const stored = async () => {
  const [row] = await client.db.select().from(settings);
  if (!row) throw new Error('The migration inserts the settings row');
  return row;
};

describe('refusals', () => {
  const refused: [string, Caller][] = [
    ['a guest', guest],
    ['a host owner', hostOwner],
    ['nobody signed in', anonymousCaller],
  ];

  it.each(refused)(
    'refuses %s the same way for a read and a save',
    async (_who, caller) => {
      const before = (await rows()).length;
      const errors = await Promise.all([
        api.readSettings(caller).catch((e: unknown) => e),
        api
          .updateSettings(caller, { holdMinutes: 20 })
          .catch((e: unknown) => e),
      ]);
      for (const error of errors) expect(error).toBeInstanceOf(ForbiddenError);
      expect((errors[0] as Error).message).toBe((errors[1] as Error).message);
      expect((await stored()).holdMinutes).toBe(10);
      expect((await rows()).length).toBe(before);
      expect(cache.updateTag).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s read every setting', async (_who, caller) => {
    await expect(api.readSettings(caller)).resolves.toMatchObject({
      holdMinutes: 10,
      giftsEnabled: expect.any(Boolean) as boolean,
    });
  });
});

describe('saving', () => {
  it('writes one audit row with the numbers, the switch and a flagged banner', async () => {
    const before = (await rows()).length;
    const saved = await api.updateSettings(ops, {
      bannerText: 'Closed Monday',
      bookingsPaused: true,
      holdMinutes: 15,
      taxRatePpm: 80_000,
    });

    expect(saved.changed).toEqual([
      'bannerText',
      'bookingsPaused',
      'holdMinutes',
      'taxRatePpm',
    ]);
    const written = (await rows()).slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      actorKind: 'user',
      actorId: ops.userId,
      subjectKind: 'settings',
      subjectId: opsAreaIds.settings,
      details: {
        banner_text_changed: true,
        bookings_paused: true,
        hold_minutes_from: 10,
        hold_minutes_to: 15,
        tax_rate_ppm_from: 88_750,
        tax_rate_ppm_to: 80_000,
      },
    });
    expect(JSON.stringify(written[0])).not.toContain('Closed Monday');
  });

  it('lets admin save, auditing the admin', async () => {
    const before = (await rows()).length;
    await api.updateSettings(admin, { checkoutMaintenance: true });
    const [row] = (await rows()).slice(before);
    expect(row).toMatchObject({
      actorId: admin.userId,
      details: { checkout_maintenance: true },
    });
  });

  it('audits only the settings that differ from the stored ones', async () => {
    const before = (await rows()).length;
    const saved = await api.updateSettings(ops, {
      holdMinutes: 10,
      paymentGraceMinutes: 7,
    });
    expect(saved.changed).toEqual(['paymentGraceMinutes']);
    const [row] = (await rows()).slice(before);
    expect(row?.details).toEqual({
      payment_grace_minutes_from: 5,
      payment_grace_minutes_to: 7,
    });
  });

  it('clears the settings tag after a change', async () => {
    await api.updateSettings(ops, { holdMinutes: 20 });
    expect(cache.updateTag).toHaveBeenCalledExactlyOnceWith('settings');
  });

  it('writes nothing for the stored values: no audit row, no update time, no cache clearing', async () => {
    const before = await stored();
    const count = (await rows()).length;
    const saved = await api.updateSettings(ops, {
      holdMinutes: before.holdMinutes,
      bannerText: before.bannerText,
      taxRatePpm: before.taxRatePpm,
    });
    expect(saved.changed).toEqual([]);
    expect((await rows()).length).toBe(count);
    expect((await stored()).updatedAt).toEqual(before.updatedAt);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('rolls the update back when the audit row is refused', async () => {
    const count = (await rows()).length;
    const badActor = testCaller({ userId: 'not-an-id', roles: [Role.Ops] });
    await expect(
      api.updateSettings(badActor, { holdMinutes: 30 }),
    ).rejects.toThrow();
    expect((await stored()).holdMinutes).toBe(10);
    expect((await rows()).length).toBe(count);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('the database refuses what the form would not send', () => {
  const { holdMinutes, paymentGraceMinutes, taxRatePpm, bannerChars } =
    settingsBounds;
  it.each([
    ['a hold under the minimum', { holdMinutes: holdMinutes.min - 1 }],
    ['a hold over the maximum', { holdMinutes: holdMinutes.max + 1 }],
    [
      'a grace under the minimum',
      { paymentGraceMinutes: paymentGraceMinutes.min - 1 },
    ],
    [
      'a grace over the maximum',
      { paymentGraceMinutes: paymentGraceMinutes.max + 1 },
    ],
    ['a rate under the minimum', { taxRatePpm: taxRatePpm.min - 1 }],
    ['a rate over the maximum', { taxRatePpm: taxRatePpm.max + 1 }],
    ['a blank banner', { bannerText: '   ' }],
    ['a banner over the limit', { bannerText: 'x'.repeat(bannerChars + 1) }],
  ])('refuses %s', async (_name, change) => {
    await expect(
      client.db.update(settings).set(change).where(eq(settings.id, true)),
    ).rejects.toThrow();
    expect(await stored()).toMatchObject(baseline);
  });

  it('accepts the edges', async () => {
    await client.db
      .update(settings)
      .set({
        holdMinutes: holdMinutes.max,
        paymentGraceMinutes: paymentGraceMinutes.min,
        taxRatePpm: taxRatePpm.max,
        bannerText: 'x'.repeat(bannerChars),
      })
      .where(eq(settings.id, true));
    expect((await stored()).holdMinutes).toBe(holdMinutes.max);
  });
});

describe('a save that waits for the row lock', () => {
  type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
  const raceAgainstOpenTransaction = <T>(
    holder: (tx: Tx) => Promise<void>,
    challenger: () => Promise<T>,
    hooks: RaceHooks<Tx> = {},
  ) =>
    race<Tx, T>(
      (body) => client.db.transaction(body),
      holder,
      challenger,
      hooks,
    );

  it('finds nothing to change when the holder committed the same value, and writes no audit row', async () => {
    const count = (await rows()).length;
    const saved = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(settings)
          .set({ holdMinutes: 25 })
          .where(eq(settings.id, true));
      },
      () => api.updateSettings(ops, { holdMinutes: 25 }),
    );
    expect(saved.changed).toEqual([]);
    expect((await rows()).length).toBe(count);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('records the value the holder committed as the old one', async () => {
    const count = (await rows()).length;
    await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(settings)
          .set({ holdMinutes: 25 })
          .where(eq(settings.id, true));
      },
      () => api.updateSettings(ops, { holdMinutes: 30 }),
    );
    const [row] = (await rows()).slice(count);
    expect(row?.details).toEqual({
      hold_minutes_from: 25,
      hold_minutes_to: 30,
    });
  });
});
