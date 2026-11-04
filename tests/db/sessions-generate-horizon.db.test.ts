import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ForbiddenError } from '@/server/auth/caller';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { earlyNow, guest, ops, sessionsFixtures } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - an over-long range throws
// - generation refuses a toDate past the horizon (a year past now) with nothing written, allows the
//   horizon itself, and near the end of year 9999 stays inside the CHECK ranges in a zone 14 hours ahead

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  sessionData = await import('@/server/db/sessions');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { setup, createTemplate, sessionsOf, countSessions } = sessionsFixtures(
  () => client,
  () => sessionData,
);

describe('generateSessions', () => {
  const range = { fromDate: '2026-06-06', toDate: '2026-06-27' };

  describe('horizon', () => {
    const now = new Date('2026-10-26T12:00:00Z');

    it('allows a toDate on the horizon and refuses the day after, writing nothing', async () => {
      const { experience, owner } = await setup();
      const template = await createTemplate(experience.id, {}, owner);

      const beyond = await sessionData.generateSessions(
        owner,
        {
          templateId: template.id,
          fromDate: '2027-10-01',
          toDate: '2027-10-28',
        },
        now,
      );
      const refusedCount = await countSessions(experience.id);
      const onTheHorizon = await sessionData.generateSessions(
        owner,
        {
          templateId: template.id,
          fromDate: '2027-10-01',
          toDate: '2027-10-27',
        },
        now,
      );

      expect(beyond).toEqual({ ok: false, reason: 'beyond_horizon' });
      expect(refusedCount).toBe(0);
      expect(onTheHorizon.ok && onTheHorizon.created).toHaveLength(4);
    });

    it('fits a 12-week rolling window with room to spare', async () => {
      const { experience } = await setup();
      const template = await createTemplate(experience.id);

      const result = await sessionData.generateSessions(
        ops,
        {
          templateId: template.id,
          fromDate: '2026-10-26',
          toDate: '2027-01-17',
        },
        now,
      );

      expect(result.ok && result.created).toHaveLength(12);
    });

    it.each([
      ['year 9999', '9999-12-25', '9999-12-31'],
      ['a year and two days ahead', '2027-10-20', '2027-10-29'],
    ])(
      'refuses a range in %s, writing nothing',
      async (_name, fromDate, toDate) => {
        const { experience } = await setup();
        const template = await createTemplate(experience.id);

        const result = await sessionData.generateSessions(
          ops,
          { templateId: template.id, fromDate, toDate },
          now,
        );

        expect(result).toEqual({ ok: false, reason: 'beyond_horizon' });
        expect(await countSessions(experience.id)).toBe(0);
      },
    );

    it('refuses a caller who may not act before it reports the horizon', async () => {
      const { experience } = await setup();
      const template = await createTemplate(experience.id);

      await expect(
        sessionData.generateSessions(
          guest,
          {
            templateId: template.id,
            fromDate: '9999-12-25',
            toDate: '9999-12-31',
          },
          now,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws for a clock it cannot trust', async () => {
      const { experience } = await setup();
      const template = await createTemplate(experience.id);

      await expect(
        sessionData.generateSessions(
          ops,
          { templateId: template.id, ...range },
          new Date(Number.NaN),
        ),
      ).rejects.toThrow(RangeError);
    });

    it('reaches the last generable day of year 9999 in a zone 14 hours ahead, inside the CHECK ranges', async () => {
      const { experience } = await setup('Pacific/Kiritimati');
      const wednesday = await createTemplate(experience.id, {
        weekday: 3,
        startTime: '23:59',
        durationMinutes: 1440,
      });
      const friday = await createTemplate(experience.id, { weekday: 5 });
      const lateNow = new Date('9999-12-01T00:00:00Z');

      const reached = await sessionData.generateSessions(
        ops,
        {
          templateId: wednesday.id,
          fromDate: '9999-12-22',
          toDate: '9999-12-29',
        },
        lateNow,
      );
      const past = await sessionData.generateSessions(
        ops,
        { templateId: friday.id, fromDate: '9999-12-25', toDate: '9999-12-31' },
        lateNow,
      );

      expect(reached.ok && reached.created.map((row) => row.localDate)).toEqual(
        ['9999-12-22', '9999-12-29'],
      );
      expect(past).toEqual({ ok: false, reason: 'beyond_horizon' });
      const stored = await sessionsOf(wednesday.id);
      expect(stored.at(-1)?.endsAt.getTime()).toBeLessThan(
        Date.UTC(10000, 0, 1),
      );
    });
  });

  it.each([
    ['a range over 366 days', { fromDate: '2028-01-01', toDate: '2029-01-01' }],
    [
      'a range that runs backwards',
      { fromDate: '2026-06-27', toDate: '2026-06-06' },
    ],
    [
      'a date that is not real',
      { fromDate: '2026-02-30', toDate: '2026-03-30' },
    ],
    ['a malformed template id', { templateId: 'nope', ...range }],
  ])('throws for %s, and writes nothing', async (_name, override) => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await expect(
      sessionData.generateSessions(
        ops,
        { templateId: template.id, ...range, ...override },
        earlyNow,
      ),
    ).rejects.toThrow(ZodError);
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('accepts a range of exactly 366 days, the longest one call covers', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    const result = await sessionData.generateSessions(
      ops,
      { templateId: template.id, fromDate: '2028-01-01', toDate: '2028-12-31' },
      new Date('2027-12-31T00:00:00Z'),
    );

    const dates = result.ok ? result.created.map((row) => row.localDate) : [];
    // 2028 is a leap year that starts on a Saturday: 53 Saturdays in a 366-day range.
    expect(dates).toHaveLength(53);
    expect([dates.at(0), dates.at(-1)]).toEqual(['2028-01-01', '2028-12-30']);
  });
});
