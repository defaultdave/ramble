import { updateTag } from 'next/cache';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ForbiddenError, Role, anonymousCaller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { settings } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { doc, helpInput, saved } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the database refuses settings out of range and a second settings row, and the migration seeds one
// - every staff read and write refuses a guest, a host owner, and nobody signed in, and accepts ops and admin
// - a legal version is numbered one above the last, a draft is editable, publishing makes it current and
//   invalidates its page, a stale draft is superseded
// - the settings update changes only the named settings, invalidates the settings tag, and a guest sees no rate

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let legal: typeof import('@/server/db/legal');
let settingsApi: typeof import('@/server/db/settings');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  legal = await import('@/server/db/legal');
  settingsApi = await import('@/server/db/settings');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const ops = testCaller({ roles: [Role.Ops] });
const admin = testCaller({ roles: [Role.Admin] });
const guest = testCaller();
const hostOwner = testCaller({ roles: [Role.HostOwner], hostIds: ['h'] });

const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

describe('settings in the database', () => {
  it('cannot be deleted or truncated', async () => {
    await expect(client.db.delete(settings)).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining('never deleted') as string,
      },
    });
    await expect(
      client.db.execute(sql`TRUNCATE TABLE settings`),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining('never deleted') as string,
      },
    });
    expect(await client.db.select().from(settings)).toHaveLength(1);
  });

  it('starts as one row at the defaults, with the NYC tax rate', async () => {
    const rows = await client.db.select().from(settings);

    expect(rows).toEqual([
      expect.objectContaining({
        id: true,
        bannerText: null,
        bookingsPaused: false,
        giftsEnabled: true,
        checkoutMaintenance: false,
        holdMinutes: 10,
        paymentGraceMinutes: 5,
        giftValidityMonths: 12,
        giftExpiryAction: 'refund_buyer',
        taxRatePpm: 88_750,
      }),
    ]);
  });

  it('cannot hold a second row', async () => {
    await expect(client.db.insert(settings).values({})).rejects.toMatchObject({
      cause: { constraint: 'settings_pkey' },
    });
    await expect(
      client.db.insert(settings).values({ id: false }),
    ).rejects.toMatchObject({ cause: { constraint: 'settings_single_row' } });
  });

  it.each([
    ['hold length 0', { holdMinutes: 0 }, 'settings_hold_minutes'],
    ['hold length 61', { holdMinutes: 61 }, 'settings_hold_minutes'],
    ['grace -1', { paymentGraceMinutes: -1 }, 'settings_payment_grace_minutes'],
    ['grace 31', { paymentGraceMinutes: 31 }, 'settings_payment_grace_minutes'],
    [
      'gift validity 0',
      { giftValidityMonths: 0 },
      'settings_gift_validity_months',
    ],
    [
      'gift validity 121',
      { giftValidityMonths: 121 },
      'settings_gift_validity_months',
    ],
    ['a negative tax rate', { taxRatePpm: -1 }, 'settings_tax_rate_ppm'],
    [
      'a tax rate over 25 percent',
      { taxRatePpm: 250_001 },
      'settings_tax_rate_ppm',
    ],
    ['a blank banner', { bannerText: '  ' }, 'settings_banner_text'],
    [
      'a banner over the limit',
      { bannerText: 'a'.repeat(281) },
      'settings_banner_text',
    ],
  ])('refuse %s', async (_name, change, constraint) => {
    await expect(client.db.update(settings).set(change)).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it('accept the lowest and highest values', async () => {
    await client.db.update(settings).set({
      holdMinutes: 1,
      paymentGraceMinutes: 0,
      giftValidityMonths: 120,
      taxRatePpm: 250_000,
      bannerText: 'a'.repeat(280),
    });
    await client.db.update(settings).set({
      holdMinutes: 60,
      paymentGraceMinutes: 30,
      giftValidityMonths: 1,
      taxRatePpm: 0,
      bannerText: null,
    });
    await client.db.update(settings).set({
      holdMinutes: 10,
      paymentGraceMinutes: 5,
      giftValidityMonths: 12,
      taxRatePpm: 88_750,
    });
  });
});

describe('who may use the staff functions', () => {
  const garbage = {} as never;
  const staffCalls = [
    [
      'listCollectionsForEditing',
      (c: typeof ops) => editorial.listCollectionsForEditing(c),
    ],
    [
      'listHomeModulesForEditing',
      (c: typeof ops) => editorial.listHomeModulesForEditing(c),
    ],
    [
      'listPageCopyForEditing',
      (c: typeof ops) => editorial.listPageCopyForEditing(c),
    ],
    [
      'listHelpArticlesForEditing',
      (c: typeof ops) => editorial.listHelpArticlesForEditing(c),
    ],
    ['saveCollection', (c: typeof ops) => editorial.saveCollection(c, garbage)],
    [
      'saveHomeModules',
      (c: typeof ops) => editorial.saveHomeModules(c, garbage),
    ],
    ['savePageCopy', (c: typeof ops) => editorial.savePageCopy(c, garbage)],
    [
      'saveHelpArticle',
      (c: typeof ops) => editorial.saveHelpArticle(c, garbage),
    ],
    [
      'listLegalVersions',
      (c: typeof ops) => legal.listLegalVersions(c, 'terms'),
    ],
    ['createLegalDraft', (c: typeof ops) => legal.createLegalDraft(c, garbage)],
    [
      'editLegalDraft',
      (c: typeof ops) => legal.editLegalDraft(c, uuid(1), garbage),
    ],
    [
      'publishLegalDocument',
      (c: typeof ops) => legal.publishLegalDocument(c, uuid(1)),
    ],
    [
      'updateSettings',
      (c: typeof ops) => settingsApi.updateSettings(c, garbage),
    ],
  ] as const;

  describe.each([
    ['a guest', guest],
    ['a host owner', hostOwner],
    ['nobody signed in', anonymousCaller],
  ])('%s', (_who, caller) => {
    it.each(staffCalls)('is refused by %s', async (_name, call) => {
      await expect(call(caller)).rejects.toThrow(ForbiddenError);
    });
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s read', async (_who, caller) => {
    await expect(
      editorial.listCollectionsForEditing(caller),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      legal.listLegalVersions(caller, 'terms'),
    ).resolves.toBeInstanceOf(Array);
  });

  it('lets admin save', async () => {
    await expect(
      editorial.saveHelpArticle(admin, helpInput()),
    ).resolves.toMatchObject({ status: 'saved' });
  });
});

describe('legal drafts and publishing', () => {
  it('numbers each document from one and each draft one above the last', async () => {
    const key = 'waiver-numbering';
    const other = 'waiver-numbering-other';

    const first = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'A',
      body: doc(),
    });
    const second = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'B',
      body: doc(),
    });
    const otherFirst = await legal.createLegalDraft(ops, {
      doc: other,
      title: 'C',
      body: doc(),
    });

    expect([first.version, second.version, otherFirst.version]).toEqual([
      1, 2, 1,
    ]);
    expect(first.status).toBe('draft');
  });

  it('gives two drafts made at the same moment two different numbers', async () => {
    const key = 'waiver-race';

    const made = await Promise.all([
      legal.createLegalDraft(ops, { doc: key, title: 'A', body: doc() }),
      legal.createLegalDraft(ops, { doc: key, title: 'B', body: doc() }),
      legal.createLegalDraft(ops, { doc: key, title: 'C', body: doc() }),
    ]);

    expect(made.map((entry) => entry.version).toSorted()).toEqual([1, 2, 3]);
  });

  it('edits a draft and refuses to edit a published version', async () => {
    const draft = await legal.createLegalDraft(ops, {
      doc: 'waiver-edit',
      title: 'Old',
      body: doc('Old'),
    });

    const edited = await legal.editLegalDraft(ops, draft.id, {
      title: 'New',
      body: doc('New'),
    });
    await saved(legal.publishLegalDocument(ops, draft.id));
    const late = await legal.editLegalDraft(ops, draft.id, {
      title: 'Late',
      body: doc(),
    });

    expect(edited).toMatchObject({
      status: 'saved',
      value: { title: 'New', body: doc('New') },
    });
    expect(late).toEqual({ status: 'not_a_draft' });
    expect(
      await legal.editLegalDraft(ops, 'nope', { title: 'x', body: doc() }),
    ).toEqual({
      status: 'not_a_draft',
    });
  });

  it('publishes a draft, which stamps the time, makes it current, and invalidates its page', async () => {
    const draft = await legal.createLegalDraft(ops, {
      doc: 'terms',
      title: 'Terms v1',
      body: doc(),
    });
    expect(updateTag).not.toHaveBeenCalled();

    const published = await saved(legal.publishLegalDocument(ops, draft.id));

    expect(published.value.status).toBe('published');
    expect(published.value.publishedAt).toBeInstanceOf(Date);
    expect(tagsUpdated()).toEqual(['legal:terms']);
    expect((await legal.getCurrentLegalDocument('terms'))?.id).toBe(draft.id);
  });

  it('refuses to publish a version already published, a missing one, and a draft below a published version', async () => {
    const key = 'waiver-stale';
    const old = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'Old',
      body: doc(),
    });
    const newer = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'Newer',
      body: doc(),
    });
    await saved(legal.publishLegalDocument(ops, newer.id));
    vi.mocked(updateTag).mockClear();

    await expect(legal.publishLegalDocument(ops, old.id)).resolves.toEqual({
      status: 'superseded',
    });
    await expect(legal.publishLegalDocument(ops, newer.id)).resolves.toEqual({
      status: 'not_a_draft',
    });
    await expect(legal.publishLegalDocument(ops, uuid(404))).resolves.toEqual({
      status: 'not_a_draft',
    });
    await expect(legal.publishLegalDocument(ops, 'nope')).resolves.toEqual({
      status: 'not_a_draft',
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('refuses a key and a body the schema refuses, without writing', async () => {
    await expect(
      legal.createLegalDraft(ops, { doc: 'Cookies', title: 'x', body: doc() }),
    ).rejects.toThrow();
    await expect(
      legal.createLegalDraft(ops, {
        doc: 'terms',
        title: 'x',
        body: { type: 'doc', content: [{ type: 'script' }] } as never,
      }),
    ).rejects.toThrow();
  });
});

describe('updating settings', () => {
  it('changes only the named settings and bumps the update time', async () => {
    const [before] = await client.db.select().from(settings);
    if (!before) throw new Error('The migration inserts the settings row');

    const after = await settingsApi.updateSettings(ops, {
      holdMinutes: 15,
      giftsEnabled: false,
      taxRatePpm: 80_000,
    });

    expect(after).toMatchObject({
      holdMinutes: 15,
      giftsEnabled: false,
      taxRatePpm: 80_000,
      paymentGraceMinutes: before.paymentGraceMinutes,
      giftValidityMonths: before.giftValidityMonths,
      bookingsPaused: before.bookingsPaused,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
    await settingsApi.updateSettings(admin, {
      holdMinutes: 10,
      giftsEnabled: true,
      taxRatePpm: 88_750,
    });
  });

  it('turns a banner on and off', async () => {
    const on = await settingsApi.updateSettings(ops, {
      bannerText: 'Maintenance tonight',
    });
    const off = await settingsApi.updateSettings(ops, { bannerText: null });

    expect(on.bannerText).toBe('Maintenance tonight');
    expect(off.bannerText).toBeNull();
  });

  it('invalidates the settings tag', async () => {
    await settingsApi.updateSettings(ops, { checkoutMaintenance: true });
    await settingsApi.updateSettings(ops, { checkoutMaintenance: false });

    expect(tagsUpdated()).toEqual(['settings', 'settings']);
  });

  it.each([
    ['a hold length out of range', { holdMinutes: 61 }],
    ['nothing at all', {}],
    ['a setting that does not exist', { hostPayoutDay: 3 }],
  ])('refuses %s and invalidates nothing', async (_name, change) => {
    await expect(
      settingsApi.updateSettings(ops, change as never),
    ).rejects.toThrow();

    expect(updateTag).not.toHaveBeenCalled();
    expect((await client.db.select().from(settings))[0]?.holdMinutes).toBe(10);
  });
});
