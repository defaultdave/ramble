import { count, eq } from 'drizzle-orm';
import type { SessionTemplateInput } from '@/lib/sessions';
import { Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { sessions } from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';
import { insertSession as insertHeldSession } from './holdFixtures';

type Client = typeof import('@/server/db/client');
type SessionData = typeof import('@/server/db/sessions');

export type TemplateFields = Omit<SessionTemplateInput, 'experienceId'>;

export const earlyNow = new Date('2026-01-01T00:00:00Z');

export const saturdayTenAm: TemplateFields = {
  weekday: 6,
  startTime: '10:00',
  durationMinutes: 120,
  allocation: 8,
  source: 'ramble',
};

export const ops = testCaller({ roles: [Role.Ops] });
export const admin = testCaller({ roles: [Role.Admin] });
export const guest = testCaller();

export function ownerOf(hostId: string): Caller {
  return testCaller({ roles: [Role.HostOwner], hostIds: [hostId] });
}

/** The session-suite helpers, bound to the database and data module a test file loads in its own beforeAll. */
export function sessionsFixtures(
  getClient: () => Client,
  getSessionData: () => SessionData,
) {
  const fixtures = catalogFixtures(() => getClient().db);

  const insertHost = (timeZone?: string) =>
    fixtures.insertHost(timeZone === undefined ? {} : { timeZone });

  async function insertExperience(hostId: string) {
    return fixtures.insertExperience(await fixtures.parents(hostId));
  }

  /** A host with one experience and the host owner who may act on it. */
  async function setup(timeZone?: string) {
    const host = await insertHost(timeZone);
    const experience = await insertExperience(host.id);
    return { host, experience, owner: ownerOf(host.id) };
  }

  async function createTemplate(
    experienceId: string,
    overrides: Partial<TemplateFields> = {},
    caller: Caller = ops,
  ) {
    const result = await getSessionData().createSessionTemplate(caller, {
      experienceId,
      ...saturdayTenAm,
      ...overrides,
    });
    if (!result.ok) throw new Error(`template not created: ${result.reason}`);
    return result.template;
  }

  async function sessionsOf(templateId: string) {
    return getClient()
      .db.select()
      .from(sessions)
      .where(eq(sessions.templateId, templateId))
      .orderBy(sessions.localDate);
  }

  async function countSessions(experienceId: string) {
    const [row] = await getClient()
      .db.select({ total: count() })
      .from(sessions)
      .where(eq(sessions.experienceId, experienceId));
    return row?.total ?? 0;
  }

  /** A Saturday session in June 2026 for eight spaces, unless the overrides say otherwise. */
  const insertSession = (
    experienceId: string,
    overrides: Parameters<typeof insertHeldSession>[2] = {},
  ) =>
    insertHeldSession(getClient().db, experienceId, {
      startsAt: new Date('2026-06-06T14:00:00Z'),
      endsAt: new Date('2026-06-06T16:00:00Z'),
      allocation: 8,
      ...overrides,
    });

  /** A generated one-date session for a template of the given source. */
  async function generated(source: 'ramble' | 'allocation' = 'ramble') {
    const context = await setup();
    const template = await createTemplate(context.experience.id, {
      source,
      allocation: 8,
    });
    await getSessionData().generateSessions(
      ops,
      { templateId: template.id, fromDate: '2026-06-06', toDate: '2026-06-06' },
      earlyNow,
    );
    const [session] = await sessionsOf(template.id);
    if (!session) throw new Error('expected a session');
    return { ...context, session };
  }

  async function stored(sessionId: string) {
    const [row] = await getClient()
      .db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!row) throw new Error('expected a session');
    return row;
  }

  return {
    fixtures,
    insertHost,
    insertExperience,
    setup,
    createTemplate,
    sessionsOf,
    countSessions,
    insertSession,
    generated,
    stored,
  };
}
