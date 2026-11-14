import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isoDateOf, msPerDay } from '@/lib/time';
import { hostId as seededHostId } from '@/lib/seed/rows';
import {
  ForbiddenError,
  requireRole,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { experiences } from '@/server/db/schema';
import { createFakeStorageAdapter } from '@/server/ports/storage/fake';
import { personaHostSlugs } from '@/lib/seed/personas';
import { editorialListRows } from './authzEditorialRows';
import { experienceEditorRows } from './authzExperienceRows';
import { accountBookingsRows } from './authzAccountRows';
import { hostSetupRows } from './authzHostRows';
import { opsBookingActionRows } from './authzBookingActionRows';
import { opsBookingRows } from './authzBookingRows';
import {
  hostReaderFunctions,
  hostReaders,
  hostStaffRows,
} from './authzHostStaffRows';
import { seedRows } from './authzSeedRows';
import { opsSessionRows } from './authzOpsSessionRows';
import { staffRows } from './authzStaffRows';
import { supportQueueRows } from './authzSupportRows';
import { experienceReviewRows } from './authzReviewRows';
import { cancelSessionRows } from './authzSessionRows';
import { collectionInput, doc, helpInput } from './editorialFixtures';
import {
  client,
  setupAuthzDatabase,
  signInEverySubject,
  subjects,
  type Subject,
} from './authzFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, with every caller made by a real sign-in by
// link as a seeded persona. One row per guarded function and resource, and each row names who gets
// through; every other subject must be refused with a ForbiddenError, and a subject listed must not be:
// - nobody signed in, a guest, and the owner or staff of the other host are refused everywhere a
//   host owner or staff member is required; host staff of a host read its dashboard, week and
//   guest lists and are refused every other function, including every write and staff management
// - platform actions (editorial, legal, settings, finance, privacy, seed) admit ops and admin, or ops
//   alone where the function says so, and no host role
// - host-owner-only actions admit the owner of that host only: not ops, not admin, not the other owner
// - session and photo actions admit the owner of the host, and ops and admin on any host; a template
//   or session sourced from an allocation is staff only, so its own host's owner is refused
// - a missing row is refused to everyone but staff, so the answer does not say which ids exist
// - requireRole on its own: a guest owns only their row; a host role needs its host; one role never satisfies another
// - coverage: every function in src/server that takes a Caller is a row here or a named guard, so a new one fails until added

setupAuthzDatabase();

type Data = {
  audit: typeof import('@/server/db/audit');
  anonymize: typeof import('@/server/db/anonymize');
  catalog: typeof import('@/server/db/catalog');
  editorial: typeof import('@/server/db/editorial');
  guests: typeof import('@/server/db/guests');
  hostDashboard: typeof import('@/server/db/hostDashboard');
  hostGuestLists: typeof import('@/server/db/hostGuestLists');
  ledger: typeof import('@/server/db/ledger');
  legal: typeof import('@/server/db/legal');
  photos: typeof import('@/server/db/photos');
  sessions: typeof import('@/server/db/sessions');
  settings: typeof import('@/server/db/settings');
};

/** Where an action lands. A host owner is checked against the host of the row, so each place is one cell of the matrix. */
const places = [
  'hostA',
  'hostB',
  'allocationOnHostA',
  'missing',
  'platform',
] as const;
type Place = (typeof places)[number];

type Target = {
  hostId: string;
  experienceId: string;
  templateId: string;
  sessionId: string;
  source: 'ramble' | 'allocation';
};

type Row = {
  /** The exported function, as the coverage check reads it from the source. */
  fn: string;
  invoke: (caller: Caller, target: Target) => Promise<unknown>;
  /** Who is let through, by place. Every subject not listed is refused. */
  allows: Partial<Record<Place, readonly Subject[]>>;
};

let data: Data;
let people: Record<Subject, Caller>;
let target: Record<Place, Target>;
let legalDraftId: string;
let categoryId: string;
let upload: Buffer;
const storage = createFakeStorageAdapter({ now: () => new Date() });

const staff = ['ops', 'admin'] as const;
const opsOnly = ['ops'] as const;

const window = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-11-01T00:00:00Z'),
};

const platform = (...who: readonly Subject[]) => ({ platform: who });

beforeAll(async () => {
  data = {
    audit: await import('@/server/db/audit'),
    anonymize: await import('@/server/db/anonymize'),
    catalog: await import('@/server/db/catalog'),
    editorial: await import('@/server/db/editorial'),
    guests: await import('@/server/db/guests'),
    hostDashboard: await import('@/server/db/hostDashboard'),
    hostGuestLists: await import('@/server/db/hostGuestLists'),
    ledger: await import('@/server/db/ledger'),
    legal: await import('@/server/db/legal'),
    photos: await import('@/server/db/photos'),
    sessions: await import('@/server/db/sessions'),
    settings: await import('@/server/db/settings'),
  };
  people = await signInEverySubject();
  upload = await sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  const ops = people.ops;
  const [category] = await client.db.query.categories.findMany({ limit: 1 });
  categoryId = category?.id ?? '';
  const draft = await data.legal.createLegalDraft(ops, {
    doc: 'terms',
    title: 'A draft to publish',
    body: doc(),
  });
  legalDraftId = draft.id;

  const hostIds = {
    hostA: seededHostId(personaHostSlugs.a),
    hostB: seededHostId(personaHostSlugs.b),
  };
  const gone = randomUUID();
  const from = isoDateOf(new Date(Date.now() + msPerDay));
  const to = isoDateOf(new Date(Date.now() + 7 * msPerDay));
  // A slot no seeded template uses, so the templates made here are new whatever the seed holds.
  let slot = 0;
  async function scheduled(
    host: string,
    source: 'ramble' | 'allocation',
  ): Promise<Target> {
    const [experience] = await client.db
      .select({ id: experiences.id })
      .from(experiences)
      .where(eq(experiences.hostId, host))
      .orderBy(experiences.slug)
      .limit(1);
    const experienceId = experience?.id ?? '';
    slot += 1;
    const created = await data.sessions.createSessionTemplate(ops, {
      experienceId,
      weekday: 3,
      startTime: `04:${String(slot * 5).padStart(2, '0')}`,
      durationMinutes: 60,
      allocation: 8,
      source,
    });
    if (!created.ok) throw new Error(`template: ${created.reason}`);
    const generated = await data.sessions.generateSessions(
      ops,
      { templateId: created.template.id, fromDate: from, toDate: to },
      new Date(),
    );
    const session = generated.ok ? generated.created[0] : undefined;
    if (!session) throw new Error('no session generated');
    return {
      hostId: host,
      experienceId,
      templateId: created.template.id,
      sessionId: session.id,
      source,
    };
  }
  const nothing = (host: string): Target => ({
    hostId: host,
    experienceId: randomUUID(),
    templateId: randomUUID(),
    sessionId: randomUUID(),
    source: 'ramble',
  });
  target = {
    hostA: await scheduled(hostIds.hostA, 'ramble'),
    hostB: await scheduled(hostIds.hostB, 'ramble'),
    allocationOnHostA: await scheduled(hostIds.hostA, 'allocation'),
    missing: nothing(gone),
    platform: nothing(gone),
  };
}, 120_000);

const sessionRules = {
  hostA: ['ownerA', ...staff],
  hostB: ['ownerB', ...staff],
  allocationOnHostA: staff,
  missing: staff,
} as const satisfies Partial<Record<Place, readonly Subject[]>>;

const rows: Row[] = [
  // Editorial, legal, settings, finance, privacy: ops or admin.
  ...editorialListRows(() => data.editorial),
  {
    fn: 'saveCollection',
    invoke: (c) => data.editorial.saveCollection(c, collectionInput()),
    allows: platform(...staff),
  },
  {
    fn: 'saveHomeModules',
    invoke: (c) => data.editorial.saveHomeModules(c, []),
    allows: platform(...staff),
  },
  {
    fn: 'savePageCopy',
    invoke: (c) =>
      data.editorial.savePageCopy(c, {
        kind: 'category',
        targetId: categoryId,
        heading: null,
        metaDescription: null,
        status: 'draft',
        intro: null,
        body: null,
      }),
    allows: platform(...staff),
  },
  {
    fn: 'saveHelpArticle',
    invoke: (c) => data.editorial.saveHelpArticle(c, helpInput()),
    allows: platform(...staff),
  },
  {
    fn: 'listLegalVersions',
    invoke: (c) => data.legal.listLegalVersions(c, 'terms'),
    allows: platform(...staff),
  },
  {
    fn: 'createLegalDraft',
    invoke: (c) =>
      data.legal.createLegalDraft(c, {
        doc: 'privacy',
        title: 'Another draft',
        body: doc(),
      }),
    allows: platform(...staff),
  },
  {
    fn: 'editLegalDraft',
    invoke: (c) =>
      data.legal.editLegalDraft(c, legalDraftId, {
        title: 'An edited draft',
        body: doc(),
      }),
    allows: platform(...staff),
  },
  {
    fn: 'publishLegalDocument',
    invoke: (c) => data.legal.publishLegalDocument(c, legalDraftId),
    allows: platform(...staff),
  },
  {
    fn: 'updateSettings',
    invoke: (c) => data.settings.updateSettings(c, { bannerText: 'Matrix' }),
    allows: platform(...staff),
  },
  {
    fn: 'readFinanceExport',
    invoke: (c) => data.ledger.readFinanceExport(c, window),
    allows: platform(...staff),
  },
  {
    fn: 'readMoneyHeld',
    invoke: (c) => data.ledger.readMoneyHeld(c),
    allows: platform(...staff),
  },
  {
    fn: 'readCashBalance',
    invoke: (c) => data.ledger.readCashBalance(c),
    allows: platform(...staff),
  },
  {
    fn: 'recordPrivacyRequest',
    invoke: (c) =>
      data.guests.recordPrivacyRequest(c, {
        guestId: randomUUID(),
        kind: 'access',
      }),
    allows: platform(...staff),
  },
  {
    fn: 'anonymizeGuest',
    invoke: (c) => data.anonymize.anonymizeGuest(c, randomUUID()),
    allows: platform(...staff),
  },
  // Host owner only: another host's owner, ops, and admin are refused.
  {
    fn: 'listHostExperiences',
    invoke: (c, t) => data.catalog.listHostExperiences(c, t.hostId),
    allows: { hostA: ['ownerA'], hostB: ['ownerB'], missing: [] },
  },
  {
    fn: 'readHostStatement',
    invoke: (c, t) => data.ledger.readHostStatement(c, t.hostId, window),
    allows: { hostA: ['ownerA'], hostB: ['ownerB'], missing: [] },
  },
  {
    fn: 'readHostDashboard',
    invoke: (c, t) =>
      data.hostDashboard.readHostDashboard(c, t.hostId, new Date()),
    allows: hostReaders,
  },
  {
    fn: 'readHostWeek',
    invoke: (c, t) =>
      data.sessions.readHostWeek(c, t.hostId, undefined, new Date()),
    allows: hostReaders,
  },
  {
    fn: 'publishWeek',
    invoke: (c, t) =>
      data.sessions.publishWeek(
        c,
        t.hostId,
        isoDateOf(new Date(Date.now() + 8 * msPerDay)),
        new Date(),
      ),
    allows: { hostA: ['ownerA'], hostB: ['ownerB'], missing: [] },
  },
  {
    fn: 'readHostBookings',
    invoke: (c, t) => data.hostGuestLists.readHostBookings(c, t.hostId, ''),
    allows: hostReaders,
  },
  {
    fn: 'readHostGuestList',
    invoke: (c, t) =>
      data.hostGuestLists.readHostGuestList(c, t.hostId, t.sessionId),
    allows: hostReaders,
  },
  // The owner of the host, or staff.
  {
    fn: 'createSessionTemplate',
    invoke: (c, t) =>
      data.sessions.createSessionTemplate(c, {
        experienceId: t.experienceId,
        weekday: 4,
        startTime: '05:00',
        durationMinutes: 60,
        allocation: 8,
        source: t.source,
      }),
    allows: sessionRules,
  },
  {
    fn: 'generateSessions',
    invoke: (c, t) =>
      data.sessions.generateSessions(
        c,
        {
          templateId: t.templateId,
          fromDate: isoDateOf(new Date(Date.now() + msPerDay)),
          toDate: isoDateOf(new Date(Date.now() + 7 * msPerDay)),
        },
        new Date(),
      ),
    allows: sessionRules,
  },
  {
    fn: 'updateSessionAllocation',
    invoke: (c, t) =>
      data.sessions.updateSessionAllocation(c, {
        sessionId: t.sessionId,
        allocation: 8,
        expectedVersion: 1,
      }),
    allows: sessionRules,
  },
  {
    fn: 'updateSessionTime',
    invoke: (c, t) =>
      data.sessions.updateSessionTime(
        c,
        {
          sessionId: t.sessionId,
          startTime: '09:00',
          durationMinutes: 60,
          expectedVersion: 1,
        },
        new Date(),
      ),
    allows: sessionRules,
  },
  {
    fn: 'updateSessionPrice',
    invoke: (c, t) =>
      data.sessions.updateSessionPrice(
        c,
        {
          sessionId: t.sessionId,
          kind: 'adult',
          priceMinor: 100,
        },
        new Date(),
      ),
    allows: sessionRules,
  },
  {
    fn: 'addOneOffSession',
    invoke: (c, t) =>
      data.sessions.addOneOffSession(
        c,
        {
          experienceId: t.experienceId,
          localDate: isoDateOf(new Date(Date.now() + 2 * msPerDay)),
          startTime: '03:00',
          durationMinutes: 60,
          allocation: 2,
        },
        new Date(),
      ),
    // A one-off date is always the host's own capacity, so the owner may add one to an experience
    // that also has an allocation.
    allows: {
      hostA: ['ownerA', ...staff],
      hostB: ['ownerB', ...staff],
      allocationOnHostA: ['ownerA', ...staff],
      missing: staff,
    },
  },
  // Last of the session rows: it cancels the target session the rows above act on.
  {
    fn: 'cancelUnbookedSession',
    invoke: (c, t) =>
      data.sessions.cancelUnbookedSession(
        c,
        { sessionId: t.sessionId, expectedVersion: 1 },
        new Date(),
      ),
    allows: sessionRules,
  },
  {
    fn: 'addPhoto',
    invoke: (c, t) =>
      data.photos.addPhoto(
        c,
        {
          experienceId: t.experienceId,
          description: { decorative: false, altText: 'A potter at the wheel' },
          rights: { basis: 'ramble_owned' },
        },
        upload,
        storage,
      ),
    allows: {
      hostA: ['ownerA', ...staff],
      hostB: ['ownerB', ...staff],
      missing: staff,
    },
  },
  // The ops area: ops alone, and the audit row is written only for ops.
  {
    fn: 'recordOpsAccess',
    invoke: (c) => data.audit.recordOpsAccess(c),
    allows: platform(...opsOnly),
  },
  ...accountBookingsRows(),
  ...hostSetupRows(),
  ...staffRows(),
  ...hostStaffRows(),
  ...opsSessionRows(),
  ...supportQueueRows(),
  ...experienceEditorRows(),
  ...experienceReviewRows(),
  ...opsBookingRows(),
  ...opsBookingActionRows(),
  ...cancelSessionRows(sessionRules, 'ownerA', staff),
  // Seed and persona writes: ops alone. These write the most, so they come last.
  ...seedRows(),
];

async function verdictOf(
  row: Row,
  subject: Subject,
  where: Target,
): Promise<'allowed' | 'forbidden'> {
  try {
    await row.invoke(people[subject], where);
    return 'allowed';
  } catch (error) {
    if (error instanceof ForbiddenError) return 'forbidden';
    // Staff are told a row is missing; that is past the guard.
    if (error instanceof data.photos.ExperienceNotFoundError) return 'allowed';
    throw error;
  }
}

const cells = rows.flatMap((row) =>
  places.flatMap((place) =>
    row.allows[place] === undefined ? [] : [{ row, place }],
  ),
);

describe('the authorization matrix', () => {
  it.each(cells.map(({ row, place }) => [row.fn, place, row, place] as const))(
    '%s on %s admits exactly the subjects it lists',
    async (_fn, _place, row, place) => {
      const allowed = row.allows[place] ?? [];
      const expected = Object.fromEntries(
        subjects.map((subject) => [
          subject,
          allowed.includes(subject) ? 'allowed' : 'forbidden',
        ]),
      );
      const actual: Record<string, string> = {};
      for (const subject of subjects) {
        actual[subject] = await verdictOf(row, subject, target[place]);
      }
      expect(actual).toEqual(expected);
    },
    120_000,
  );
});

describe('host staff', () => {
  it('are admitted by the host read functions and by no other function', () => {
    const admitting = cells
      .filter(({ row, place }) =>
        (row.allows[place] ?? []).some((who) => who.startsWith('staff')),
      )
      .map(({ row }) => row.fn);
    // By name only: readAccountBookings admits every signed-in persona, staff included, because it
    // reads the caller's own bookings and nobody else's. That is ownership, not a host role, and
    // tests/db/account-bookings.db.test.ts proves a host staff reader sees only their own.
    const ownBookingReads = ['readAccountBookings'];
    expect([...new Set(admitting)].sort()).toEqual(
      [...hostReaderFunctions, ...ownBookingReads].sort(),
    );
  });
});

describe('requireRole on its own', () => {
  const otherGuest = randomUUID();
  const own = (subject: Subject) => ({
    ownerId: people[subject].userId ?? '',
  });
  const cases: [string, Subject, Role, () => object, boolean][] = [
    [
      'a guest on a row they own',
      'guest',
      Role.Guest,
      () => own('guest'),
      true,
    ],
    [
      'a guest on a row another guest owns',
      'guest',
      Role.Guest,
      () => ({ ownerId: otherGuest }),
      false,
    ],
    [
      'a guest on a row with no owner named',
      'guest',
      Role.Guest,
      () => ({}),
      false,
    ],
    [
      'nobody signed in on a row with an owner',
      'anonymous',
      Role.Guest,
      () => ({ ownerId: otherGuest }),
      false,
    ],
    [
      'a host owner on their host',
      'ownerA',
      Role.HostOwner,
      () => ({ hostId: target.hostA.hostId }),
      true,
    ],
    [
      'a host owner on the other host',
      'ownerA',
      Role.HostOwner,
      () => ({ hostId: target.hostB.hostId }),
      false,
    ],
    [
      'a host owner with no host named',
      'ownerA',
      Role.HostOwner,
      () => ({}),
      false,
    ],
    [
      'host staff on their host',
      'staffA',
      Role.HostStaff,
      () => ({ hostId: target.hostA.hostId }),
      true,
    ],
    [
      'host staff on the other host',
      'staffA',
      Role.HostStaff,
      () => ({ hostId: target.hostB.hostId }),
      false,
    ],
    [
      'host staff asked for the owner role on their host',
      'staffA',
      Role.HostOwner,
      () => ({ hostId: target.hostA.hostId }),
      false,
    ],
    [
      'a host owner asked for the staff role on their host',
      'ownerA',
      Role.HostStaff,
      () => ({ hostId: target.hostA.hostId }),
      false,
    ],
    [
      'ops asked for ops on a row of no host',
      'ops',
      Role.Ops,
      () => ({}),
      true,
    ],
    ['admin asked for admin', 'admin', Role.Admin, () => ({}), true],
    ['ops asked for admin', 'ops', Role.Admin, () => ({}), false],
    ['admin asked for ops', 'admin', Role.Ops, () => ({}), false],
    [
      'ops asked for the host owner role',
      'ops',
      Role.HostOwner,
      () => ({ hostId: target.hostA.hostId }),
      false,
    ],
    ['the guest persona asked for ops', 'guest', Role.Ops, () => ({}), false],
  ];

  it.each(cases)('%s', (_name, subject, role, resource, allowed) => {
    const call = () => {
      requireRole(people[subject], role, resource());
    };
    if (allowed) expect(call).not.toThrow();
    else expect(call).toThrow(ForbiddenError);
  });
});

describe('the matrix is complete', () => {
  /** Functions that take a Caller and are the guard or its parts, not guarded functions. */
  const guards = new Set([
    'requireRole',
    'requireAnyRole',
    'requireStaff',
    'requireOpsUserId',
    'requireUserId',
    // A pure predicate behind requireRole; guards nothing.
    'holdsRole',
  ]);
  /** The mailbox opens to the ops role or, off production, to the shared secret, so its access rule is not a role row; src/server/ports/email/mailbox.test.ts and tests/db/email-mailbox.db.test.ts cover every combination. */
  const mailboxGate = ['unlockMailbox', 'loadMailbox', 'loadMailboxMessage'];

  const serverRoot = path.resolve(import.meta.dirname, '../../src/server');

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      const isSource =
        entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name);
      return isSource && entry.name !== 'test-caller.ts' ? [full] : [];
    });
  }

  /** Exported functions whose first parameter is a Caller, or the seed's options that carry one. */
  function exportedCallerFunctions(): string[] {
    const found: string[] = [];
    const declaration =
      /export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\(\s*(\w+)\??:\s*(\w+)/g;
    for (const file of sourceFiles(serverRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(declaration)) {
        const [, name, , type] = match;
        if (name && (type === 'Caller' || type === 'SeedOptions')) {
          found.push(name);
        }
      }
    }
    return found;
  }

  it('lists every exported function in src/server that takes a Caller', () => {
    const inMatrix = new Set(rows.map((row) => row.fn));
    const missing = exportedCallerFunctions().filter(
      (name) =>
        !inMatrix.has(name) && !guards.has(name) && !mailboxGate.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('lists no function that is not there', () => {
    const exported = new Set(exportedCallerFunctions());
    expect(rows.map((row) => row.fn).filter((fn) => !exported.has(fn))).toEqual(
      [],
    );
  });

  it('still reads the source: it finds a function it knows is guarded', () => {
    const exported = exportedCallerFunctions();
    expect(exported).toEqual(
      expect.arrayContaining(['addPhoto', 'runSeed', 'requireRole']),
    );
  });
});
