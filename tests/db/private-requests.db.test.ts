import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import {
  privateSessionLimits,
  type PrivateSessionFormState,
} from '@/lib/privateSession';
import { rateLimitPolicies } from '@/lib/rateLimits';
import { experiences, jobs, privateRequests } from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';
import {
  createFreshDatabase,
  expectConstraint,
  type FreshDatabase,
} from './harness';

// The private_requests table, its write, and the requestPrivateSession action against a real database. Behaviours under test:
// - a request is stored as sent, with a generated id and a creation time; a missing message stays null
// - the database refuses what the form refuses: a group or budget outside its range, a blank or long name or message, a bad address, a creation time before year 1000
// - a request needs an experience that exists, and the experience cannot be deleted while it has requests
// - a valid submit writes the request and queues one ops-notice job that names the experience and the request
// - the longest form the schema accepts still queues, so the notice never refuses what the form let through
// - a draft experience takes no request: nothing is written, and the guest is told it failed
// - a refused guard (honeypot) answers sent and writes neither a request nor a job
// - a form that fails validation writes nothing, including an optional message far over the limit, which is refused rather than dropped
// - a failed notice enqueue rolls the request back: no request without its notice
// - the sixth submit from one address within the window is rate limited and writes nothing

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

// The real enqueue, spied on so one test can make it fail inside the request's transaction.
vi.mock('@/server/jobs/enqueue', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/jobs/enqueue')>();
  return { ...original, enqueue: vi.fn(original.enqueue) };
});

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let action: typeof import('@/server/actions/privateSession');
let guard: typeof import('@/server/formGuard');
let fixtures: ReturnType<typeof catalogFixtures>;
let publishedId: string;
let draftId: string;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  action = await import('@/server/actions/privateSession');
  guard = await import('@/server/formGuard');
  fixtures = catalogFixtures(() => client.db);
  const parents = await fixtures.parents();
  publishedId = (
    await fixtures.insertExperience(parents, {
      name: 'Pasta night',
      status: 'live',
    })
  ).id;
  draftId = (await fixtures.insertExperience(parents, { status: 'draft' })).id;
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM private_requests`);
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM rate_limits`);
});

const row = (over: Partial<typeof privateRequests.$inferInsert> = {}) => ({
  experienceId: publishedId,
  requestedDate: '2099-01-15',
  groupSize: 12,
  budgetMinor: 120_000,
  name: 'Pat Smith',
  email: 'pat@example.com',
  message: 'A birthday.',
  ...over,
});

const fields = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const all: Record<string, string> = {
    experienceId: publishedId,
    date: '2099-01-15',
    groupSize: '12',
    budget: '1200',
    name: 'Pat Smith',
    email: 'pat@example.com',
    message: 'A birthday.\nThe whole team.',
    // Issued ten seconds ago, so the minimum fill time has passed.
    [FORM_TOKEN_FIELD]: guard.issueFormGuardToken(
      new Date(Date.now() - 10_000),
    ),
    [HONEYPOT_FIELD]: '',
    ...over,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
};

const idle: PrivateSessionFormState = { status: 'idle' };
const submit = (over: Record<string, string> = {}) =>
  action.requestPrivateSession(idle, fields(over));
const requests = () => client.db.select().from(privateRequests);
const noticeJobs = () =>
  client.db.select().from(jobs).where(eq(jobs.kind, 'ops-notice'));

describe('the private_requests table', () => {
  it('stores a request as sent, with an id and a creation time', async () => {
    const [stored] = await client.db
      .insert(privateRequests)
      .values(row())
      .returning();

    expect(stored).toMatchObject(row());
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('keeps a missing message as null', async () => {
    const [stored] = await client.db
      .insert(privateRequests)
      .values(row({ message: null }))
      .returning();

    expect(stored?.message).toBeNull();
  });

  it.each([
    ['no people', { groupSize: 0 }, 'private_requests_group_size_in_range'],
    [
      'a group over the limit',
      { groupSize: privateSessionLimits.maxGroupSize + 1 },
      'private_requests_group_size_in_range',
    ],
    [
      'a budget under a dollar',
      { budgetMinor: 99 },
      'private_requests_budget_in_range',
    ],
    [
      'a budget over the limit',
      { budgetMinor: privateSessionLimits.maxBudgetDollars * 100 + 1 },
      'private_requests_budget_in_range',
    ],
    ['a blank name', { name: '   ' }, 'private_requests_name_shape'],
    [
      'a name over the limit',
      { name: 'x'.repeat(privateSessionLimits.nameMaxChars + 1) },
      'private_requests_name_shape',
    ],
    ['a blank message', { message: '  ' }, 'private_requests_message_shape'],
    [
      'a message over the limit',
      { message: 'x'.repeat(privateSessionLimits.messageMaxChars + 1) },
      'private_requests_message_shape',
    ],
    [
      'an upper-case address',
      { email: 'Pat@Example.com' },
      'private_requests_email_shape',
    ],
    [
      'an address with no domain',
      { email: 'pat' },
      'private_requests_email_shape',
    ],
  ])('refuses %s', async (_label, over, constraint) => {
    await expectConstraint(
      client.db.insert(privateRequests).values(row(over)),
      constraint,
    );
  });

  it('refuses a creation time before year 1000', async () => {
    await expectConstraint(
      client.db
        .insert(privateRequests)
        .values(row({ createdAt: new Date('0999-12-31T00:00:00Z') })),
      'private_requests_created_at_in_range',
    );
  });

  it('refuses an experience that does not exist', async () => {
    await expectConstraint(
      client.db
        .insert(privateRequests)
        .values(row({ experienceId: '00000000-0000-4000-8000-000000000000' })),
      'private_requests_experience_id_experiences_id_fk',
    );
  });

  it('keeps an experience that has requests from being deleted', async () => {
    await client.db.insert(privateRequests).values(row());

    await expectConstraint(
      client.db.delete(experiences).where(eq(experiences.id, publishedId)),
      'private_requests_experience_id_experiences_id_fk',
    );
  });
});

describe('submitting the private session form', () => {
  it('writes the request and queues one ops notice that names the experience and the request', async () => {
    await expect(submit()).resolves.toEqual({ status: 'sent' });

    const [stored] = await requests();
    expect(stored).toMatchObject({
      experienceId: publishedId,
      requestedDate: '2099-01-15',
      groupSize: 12,
      budgetMinor: 120_000,
      name: 'Pat Smith',
      email: 'pat@example.com',
      message: 'A birthday.\nThe whole team.',
    });
    const queued = await noticeJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: 'pending',
      dedupeKey: `private-request:${stored?.id ?? ''}`,
      payload: {
        subject: 'Private session request: Pasta night',
        fields: expect.arrayContaining([
          { label: 'Budget', value: '$1,200.00' },
          { label: 'Request ID', value: stored?.id },
        ]) as unknown,
      },
    });
  });

  it('queues the longest form the schema accepts', async () => {
    await expect(
      submit({
        name: 'n'.repeat(privateSessionLimits.nameMaxChars),
        message: 'm'.repeat(privateSessionLimits.messageMaxChars),
      }),
    ).resolves.toEqual({ status: 'sent' });

    expect(await requests()).toHaveLength(1);
    expect(await noticeJobs()).toHaveLength(1);
  });

  it('answers failed and writes nothing for an experience a guest cannot see', async () => {
    await expect(submit({ experienceId: draftId })).resolves.toMatchObject({
      status: 'failed',
    });

    expect(await requests()).toHaveLength(0);
    expect(await noticeJobs()).toHaveLength(0);
  });

  it('writes no request when queuing its notice fails', async () => {
    const queue = await import('@/server/jobs/enqueue');
    vi.mocked(queue.enqueue).mockRejectedValueOnce(new Error('queue down'));

    await expect(submit()).resolves.toMatchObject({ status: 'failed' });

    expect(await requests()).toHaveLength(0);
    expect(await noticeJobs()).toHaveLength(0);
  });

  it('answers invalid, not sent, for a message far over the limit', async () => {
    await expect(
      submit({ message: 'x'.repeat(privateSessionLimits.messageMaxChars * 3) }),
    ).resolves.toMatchObject({
      status: 'invalid',
      errors: { message: expect.any(String) as string },
    });

    expect(await requests()).toHaveLength(0);
  });

  it('answers sent and writes nothing when the honeypot is filled', async () => {
    await expect(submit({ [HONEYPOT_FIELD]: 'spam' })).resolves.toEqual({
      status: 'sent',
    });

    expect(await requests()).toHaveLength(0);
    expect(await noticeJobs()).toHaveLength(0);
  });

  it('answers invalid and writes nothing for a past date', async () => {
    await expect(submit({ date: '2020-01-01' })).resolves.toMatchObject({
      status: 'invalid',
      errors: { date: expect.any(String) as string },
    });

    expect(await requests()).toHaveLength(0);
  });

  it('refuses the submit past the limit and writes nothing for it', async () => {
    const { limit } = rateLimitPolicies.forms;
    for (let n = 0; n < limit; n += 1) {
      await expect(submit()).resolves.toEqual({ status: 'sent' });
    }

    await expect(submit()).resolves.toMatchObject({ status: 'rate_limited' });

    expect(await requests()).toHaveLength(limit);
    expect(await noticeJobs()).toHaveLength(limit);
  });
});
