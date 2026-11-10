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
import { rateLimitPolicies } from '@/lib/rateLimits';
import {
  supportLimits,
  supportTopicLabels,
  supportTopics,
  type SupportFormState,
} from '@/lib/support';
import { jobs, supportRequests } from '@/server/db/schema';
import {
  createFreshDatabase,
  expectConstraint,
  type FreshDatabase,
} from './harness';

// The support_requests table and the contact action against a real database. Behaviours under test:
// - a request is stored as sent, with a generated id and a creation time, and holds no more than the form collects
// - the database refuses what the form refuses: a blank or long name or message, an address the send path would refuse, a topic outside the list
// - a valid submit writes the request and queues one ops-notice job whose payload holds the labelled fields and names the request
// - the longest form the schema accepts still queues, so the notice never refuses what the form let through
// - a refused guard (honeypot) answers sent and writes neither a request nor a job
// - the sixth submit from one address within the window is rate limited and writes nothing

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let action: typeof import('@/server/actions/contact');
let guard: typeof import('@/server/formGuard');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  action = await import('@/server/actions/contact');
  guard = await import('@/server/formGuard');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM support_requests`);
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM rate_limits`);
});

const row = (over: Partial<typeof supportRequests.$inferInsert> = {}) => ({
  name: 'Pat Smith',
  email: 'pat@example.com',
  topic: 'booking' as const,
  message: 'Where do we meet?',
  ...over,
});

const fields = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const all: Record<string, string> = {
    name: 'Pat Smith',
    email: 'pat@example.com',
    topic: 'refund',
    message: 'I was charged twice.\nPlease check.',
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

const idle: SupportFormState = { status: 'idle' };
const submit = (over: Record<string, string> = {}) =>
  action.submitSupportRequest(idle, fields(over));
const requests = () => client.db.select().from(supportRequests);
const noticeJobs = () =>
  client.db.select().from(jobs).where(eq(jobs.kind, 'ops-notice'));

describe('the support_requests table', () => {
  it('stores a request as sent, with an id and a creation time', async () => {
    const [stored] = await client.db
      .insert(supportRequests)
      .values(row())
      .returning();

    expect(stored).toMatchObject(row());
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it.each([
    ['a blank name', { name: '   ' }, 'support_requests_name_shape'],
    [
      'a name over the limit',
      { name: 'x'.repeat(supportLimits.nameMaxChars + 1) },
      'support_requests_name_shape',
    ],
    ['a blank message', { message: '  ' }, 'support_requests_message_shape'],
    [
      'a message over the limit',
      { message: 'x'.repeat(supportLimits.messageMaxChars + 1) },
      'support_requests_message_shape',
    ],
    [
      'an upper-case address',
      { email: 'Pat@Example.com' },
      'support_requests_email_shape',
    ],
    [
      'an address with no domain',
      { email: 'pat' },
      'support_requests_email_shape',
    ],
  ])('refuses %s', async (_label, over, constraint) => {
    await expectConstraint(
      client.db.insert(supportRequests).values(row(over)),
      constraint,
    );
  });

  it('refuses a creation time before year 1000', async () => {
    await expectConstraint(
      client.db.execute(
        sql`INSERT INTO support_requests (name, email, topic, message, created_at) VALUES ('a', 'a@b.co', 'other', 'm', '0999-12-31T00:00:00Z')`,
      ),
      'support_requests_created_at_in_range',
    );
  });

  it('refuses a topic outside the list', async () => {
    await expect(
      client.db.execute(
        sql`INSERT INTO support_requests (name, email, topic, message) VALUES ('a', 'a@b.co', 'complaint', 'm')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
  });

  it('accepts every topic the form offers', async () => {
    for (const topic of supportTopics) {
      await client.db.insert(supportRequests).values(row({ topic }));
    }

    expect(await requests()).toHaveLength(supportTopics.length);
  });
});

describe('submitting the contact form', () => {
  it('writes the request and queues one ops notice that names it', async () => {
    await expect(submit()).resolves.toEqual({ status: 'sent' });

    const [stored] = await requests();
    expect(stored).toMatchObject({
      name: 'Pat Smith',
      email: 'pat@example.com',
      topic: 'refund',
      message: 'I was charged twice.\nPlease check.',
    });
    const queued = await noticeJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: 'pending',
      dedupeKey: `support-request:${stored?.id ?? ''}`,
      payload: {
        subject: `Contact form: ${supportTopicLabels.refund}`,
        fields: expect.arrayContaining([
          { label: 'Email', value: 'pat@example.com' },
          { label: 'Request ID', value: stored?.id },
        ]) as unknown,
      },
    });
  });

  it('queues the longest form the schema accepts', async () => {
    await expect(
      submit({
        name: 'n'.repeat(supportLimits.nameMaxChars),
        message: 'm'.repeat(supportLimits.messageMaxChars),
      }),
    ).resolves.toEqual({ status: 'sent' });

    expect(await requests()).toHaveLength(1);
    expect(await noticeJobs()).toHaveLength(1);
  });

  it('answers sent and writes nothing when the honeypot is filled', async () => {
    await expect(submit({ [HONEYPOT_FIELD]: 'spam' })).resolves.toEqual({
      status: 'sent',
    });

    expect(await requests()).toHaveLength(0);
    expect(await noticeJobs()).toHaveLength(0);
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
