import { randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  hosts,
  jobs,
  messages,
  orderItems,
  orders,
  priceOptions,
  sessions,
} from '@/server/db/schema';
import { server } from '../msw/server';
import { setEnv } from '../email/testEnv';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise: vi.fn() } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk. Orders A and B are fixture orders on one session.
// access
// - order A's email carries the token whose hash is order A's and not order B's, and that token opens order A only;
//   B's email does the same for B
// - after the token version is bumped, the next email carries the rebuilt token, and it opens the order
// - neither the message log nor the order row nor the job row stores the raw token in live mode, where the provider
//   gets the link and no body is kept; in sink mode the token is only in the dev mailbox's two body columns
// - the job payload holds the order id and nothing else
// sending
// - the guest confirmation goes to the order's contact address with the manage link and a calendar file
// - the host notice goes to the host's notification address and holds no manage link
// - a retry after the provider refused sends the same link, and the provider ends with one accepted message
// - running a handler again after it succeeded sends nothing more (one message per order)
// - a cancelled order sends nothing; an order that is not a confirmed booking is refused with nothing logged
// - an order with no manage hash, or whose hash is for another version, sends no link (refused, nothing logged)
// - a host with no notification address is refused with nothing logged
// - an order that does not exist is refused
// the job
// - a guest-confirmation job enqueued with an order id is drained to a sent message; a payload with an extra field
//   or a bad id is refused at enqueue
// database
// - the hosts table refuses a notification address that is not a lower-case address or is over 254 characters

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let handlers: typeof import('@/server/jobs/bookingEmails');
let tokens: typeof import('@/server/tokens');
let enqueueModule: typeof import('@/server/jobs/enqueue');
let drainModule: typeof import('@/server/jobs/drain');
let clockModule: typeof import('@/server/ports/clock');
let parents: Awaited<ReturnType<typeof createOrderParents>>;
let sessionId: string;
let childOptionId: string;

const hostEmail = 'bookings@harborlight.example';
const live = {
  EMAIL_MODE: 'live',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM: 'Ramble <hello@ramble.example>',
  EMAIL_REPLY_TO: 'support@ramble.example',
  EMAIL_WEBHOOK_SECRET: `whsec_${Buffer.from('x'.repeat(32)).toString('base64')}`,
};

function setMode(overrides: Record<string, unknown> = {}) {
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
    ...overrides,
  });
}

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setMode();
  client = await import('@/server/db/client');
  handlers = await import('@/server/jobs/bookingEmails');
  tokens = await import('@/server/tokens');
  enqueueModule = await import('@/server/jobs/enqueue');
  drainModule = await import('@/server/jobs/drain');
  clockModule = await import('@/server/ports/clock');
  parents = await createOrderParents(client.db, 'booking-emails');
  const [session] = await client.db
    .insert(sessions)
    .values({
      experienceId: parents.experienceId,
      startsAt: new Date('2026-11-07T21:00:00Z'),
      endsAt: new Date('2026-11-07T23:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 20,
      source: 'ramble',
    })
    .returning();
  const [child] = await client.db
    .insert(priceOptions)
    .values({
      experienceId: parents.experienceId,
      kind: 'child',
      priceMinor: 4500,
    })
    .returning();
  if (!session || !child) throw new Error('missing fixtures');
  sessionId = session.id;
  childOptionId = child.id;
  await client.db
    .update(hosts)
    .set({ notificationEmail: hostEmail })
    .where(eq(hosts.id, parents.hostId));
  server.listen({ onUnhandledFrame: 'bypass' });
});

afterAll(async () => {
  server.close();
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  setMode();
  await client.db.execute(sql`DELETE FROM messages`);
  await client.db.execute(sql`DELETE FROM jobs`);
});

afterEach(() => {
  server.resetHandlers();
});

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

type OrderOptions = {
  status?: 'confirmed' | 'cancelled' | 'pending_payment';
  hash?: 'current' | null | 'other-version';
  contactEmail?: string;
  version?: number;
};

/** A booking for two adults and a child (A) or one adult (B), with the manage hash the confirm step writes. */
async function insertOrder(
  party: 'A' | 'B',
  {
    status = 'confirmed',
    hash = 'current',
    contactEmail,
    version = 1,
  }: OrderOptions = {},
) {
  const id = randomUUID();
  const holdId = randomUUID();
  const a = party === 'A';
  const subtotal = a ? 21500 : 8500;
  const taxRatePpm = a ? 88750 : 0;
  const tax = a ? 1908 : 0;
  const manageTokenHash =
    hash === null
      ? null
      : tokens.hashToken(
          tokens.capabilityToken(
            'manage',
            id,
            hash === 'current' ? version : version + 1,
          ),
        );
  const [row] = await client.db
    .insert(orders)
    .values({
      id,
      reference: reference(),
      kind: 'booking',
      status,
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId,
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: contactEmail ?? `${a ? 'pat' : 'sam'}@example.com`,
      leadGuestName: a ? 'Pat Rivera' : 'Sam Okoye',
      termsDocumentId: randomUUID(),
      ticketSubtotalMinor: subtotal,
      taxTreatment: a ? 'taxable' : 'not_taxable',
      taxRatePpm,
      taxMinor: tax,
      totalMinor: subtotal + tax,
      amountDueMinor: subtotal + tax,
      commissionRateBps: 1500,
      commissionMinor: a ? 3225 : 1275,
      cancellationTierId: parents.tierId,
      freeCancelUntil: new Date('2026-11-06T21:00:00Z'),
      manageTokenHash,
      manageTokenVersion: version,
      confirmedAt: status === 'pending_payment' ? null : sql`clock_timestamp()`,
      cancelledAt: status === 'cancelled' ? sql`clock_timestamp()` : null,
      cancelledBy: status === 'cancelled' ? 'guest' : null,
    })
    .returning();
  if (!row) throw new Error('insert returned no order');
  await client.db.insert(orderItems).values(
    a
      ? [
          {
            orderId: id,
            priceOptionId: parents.priceOptionId,
            label: 'Adult',
            quantity: 2,
            unitPriceMinor: 8500,
            usesSpace: true,
            lineTotalMinor: 17000,
          },
          {
            orderId: id,
            priceOptionId: childOptionId,
            label: 'Child',
            quantity: 1,
            unitPriceMinor: 4500,
            usesSpace: true,
            lineTotalMinor: 4500,
          },
        ]
      : [
          {
            orderId: id,
            priceOptionId: parents.priceOptionId,
            label: 'Adult',
            quantity: 1,
            unitPriceMinor: 8500,
            usesSpace: true,
            lineTotalMinor: 8500,
          },
        ],
  );
  return row;
}

/** Runs a handler the way the drain does: inside a transaction, with the job's payload. */
function run(
  handler: (typeof handlers)['sendGuestConfirmation'],
  orderId: string,
) {
  return client.db.transaction((tx) =>
    handler({ tx, payload: { orderId }, jobId: randomUUID() }),
  );
}

async function messageRows() {
  return client.db.select().from(messages);
}

const tokenIn = (body: string): string => {
  const match = /\/manage\/([A-Za-z0-9_-]{43})/.exec(body);
  if (!match?.[1]) throw new Error('no manage link in the body');
  return match[1];
};

async function mailboxBody(recipient: string) {
  const [row] = (await messageRows()).filter(
    (message) => message.recipient === recipient,
  );
  if (!row?.html || !row.textBody) throw new Error('no dev mailbox body');
  return { html: row.html, text: row.textBody, row };
}

function resendAccepts() {
  const calls: { body: string }[] = [];
  server.use(
    http.post('https://api.resend.com/emails', async ({ request }) => {
      calls.push({ body: await request.text() });
      return HttpResponse.json({ id: `re_${randomUUID()}` });
    }),
  );
  return calls;
}

async function everythingStored() {
  const [m, o, j] = await Promise.all([
    client.db.select().from(messages),
    client.db.select().from(orders),
    client.db.select().from(jobs),
  ]);
  return JSON.stringify([m, o, j]);
}

describe('who a confirmation link opens', () => {
  it("carries order A's token and not order B's, and the token opens A only", async () => {
    const a = await insertOrder('A');
    const b = await insertOrder('B');

    await run(handlers.sendGuestConfirmation, a.id);
    await run(handlers.sendGuestConfirmation, b.id);

    const tokenA = tokenIn((await mailboxBody('pat@example.com')).html);
    const tokenB = tokenIn((await mailboxBody('sam@example.com')).html);
    expect(tokens.hashToken(tokenA)).toBe(a.manageTokenHash);
    expect(tokens.hashToken(tokenA)).not.toBe(b.manageTokenHash);
    expect(tokens.hashToken(tokenB)).toBe(b.manageTokenHash);
    expect(tokens.hashToken(tokenB)).not.toBe(a.manageTokenHash);
    await expect(tokens.resolveToken('manage', tokenA)).resolves.toEqual({
      id: a.id,
      version: 1,
    });
    await expect(tokens.resolveToken('manage', tokenB)).resolves.toEqual({
      id: b.id,
      version: 1,
    });
    const { text } = await mailboxBody('pat@example.com');
    expect(text).not.toContain(tokenB);
  });

  it('carries the rebuilt token after the version is bumped, and that token opens the order', async () => {
    const order = await insertOrder('A', { version: 2 });
    const old = tokens.capabilityToken('manage', order.id, 1);

    await run(handlers.sendGuestConfirmation, order.id);

    const sent = tokenIn((await mailboxBody('pat@example.com')).html);
    expect(sent).toBe(tokens.capabilityToken('manage', order.id, 2));
    expect(sent).not.toBe(old);
    await expect(tokens.resolveToken('manage', sent)).resolves.toEqual({
      id: order.id,
      version: 2,
    });
    await expect(tokens.resolveToken('manage', old)).resolves.toBeNull();
  });
});

describe('where the raw token is stored', () => {
  it('is nowhere in the database when a provider carries the message', async () => {
    setMode(live);
    const calls = resendAccepts();
    const order = await insertOrder('A');

    await run(handlers.sendGuestConfirmation, order.id);

    expect(calls).toHaveLength(1);
    const sent = tokenIn(calls[0]?.body ?? '');
    expect(sent).toBe(tokens.capabilityToken('manage', order.id, 1));
    const [row] = await messageRows();
    expect(row).toMatchObject({ adapter: 'resend', status: 'sent' });
    expect(row?.html).toBeNull();
    expect(row?.textBody).toBeNull();
    expect(await everythingStored()).not.toContain(sent);
  });

  it("is only in the dev mailbox's two body columns in sink mode", async () => {
    const order = await insertOrder('A');

    await run(handlers.sendGuestConfirmation, order.id);

    const sent = tokens.capabilityToken('manage', order.id, 1);
    const [row] = await messageRows();
    const { html, textBody, ...rest } = row ?? {};
    expect(html).toContain(sent);
    expect(textBody).toContain(sent);
    expect(JSON.stringify(rest)).not.toContain(sent);
    const stored = await client.db.select().from(orders);
    expect(JSON.stringify(stored)).not.toContain(sent);
  });

  it('is not in the job row, whose payload is the order id alone', async () => {
    const order = await insertOrder('A');
    await client.db.transaction((tx) =>
      enqueueModule.enqueue(tx, {
        kind: 'guest-confirmation',
        payload: { orderId: order.id },
        dedupeKey: `guest-confirmation:${order.id}`,
      }),
    );
    await drainModule.drainJobs(clockModule.systemClock);

    const jobRows = await client.db.select().from(jobs);
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.payload).toEqual({ orderId: order.id });
    expect(jobRows[0]?.status).toBe('succeeded');
    expect(JSON.stringify(jobRows)).not.toContain(
      tokens.capabilityToken('manage', order.id, 1),
    );
  });
});

describe('the guest confirmation', () => {
  it('goes to the contact address with the booking, the link, and a calendar file', async () => {
    setMode(live);
    const calls = resendAccepts();
    const order = await insertOrder('A', { contactEmail: 'pat@example.com' });

    await run(handlers.sendGuestConfirmation, order.id);

    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      to: string[];
      subject: string;
      html: string;
      attachments: {
        filename: string;
        content: string;
        content_type: string;
      }[];
    };
    expect(body.to).toEqual(['pat@example.com']);
    expect(body.subject).toBe(`You're booked: Experience`);
    expect(body.html).toContain('Saturday, November 7, 2026');
    expect(body.html).toContain('4:00 PM EST');
    expect(body.html).toContain('3 guests');
    expect(body.html).toContain('$234.08');
    expect(body.html).toContain('href="https://ramble.example/help"');
    expect(body.attachments).toHaveLength(1);
    const ics = Buffer.from(
      body.attachments[0]?.content ?? '',
      'base64',
    ).toString('utf8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain(`UID:${order.id}@ramble.example`);
    expect(ics).toContain('DTSTART:20261107T210000Z');
  });

  it('sends one message however many times the handler runs', async () => {
    setMode(live);
    const calls = resendAccepts();
    const order = await insertOrder('A');

    await run(handlers.sendGuestConfirmation, order.id);
    await run(handlers.sendGuestConfirmation, order.id);
    await run(handlers.sendGuestConfirmation, order.id);

    expect(calls).toHaveLength(1);
    expect(await messageRows()).toHaveLength(1);
  });

  it('sends the same link on a retry after the provider refused', async () => {
    setMode(live);
    const bodies: string[] = [];
    let attempts = 0;
    server.use(
      http.post('https://api.resend.com/emails', async ({ request }) => {
        attempts += 1;
        bodies.push(await request.text());
        return attempts === 1
          ? HttpResponse.json({ message: 'busy' }, { status: 503 })
          : HttpResponse.json({ id: 're_ok' });
      }),
    );
    const order = await insertOrder('A');

    await expect(
      run(handlers.sendGuestConfirmation, order.id),
    ).rejects.toThrow();
    await run(handlers.sendGuestConfirmation, order.id);

    expect(bodies).toHaveLength(2);
    expect(tokenIn(bodies[0] ?? '')).toBe(tokenIn(bodies[1] ?? ''));
    const rows = await messageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sent');
  });

  it('sends nothing for a cancelled order', async () => {
    const order = await insertOrder('A', { status: 'cancelled' });

    await run(handlers.sendGuestConfirmation, order.id);

    expect(await messageRows()).toHaveLength(0);
  });

  it('refuses an order that is not a confirmed booking, and logs nothing', async () => {
    const order = await insertOrder('A', {
      status: 'pending_payment',
      hash: null,
    });

    await expect(run(handlers.sendGuestConfirmation, order.id)).rejects.toThrow(
      'the order is not a confirmed booking',
    );
    expect(await messageRows()).toHaveLength(0);
  });

  it.each([
    ['no manage hash', null],
    ['a hash for another version', 'other-version'],
  ] as const)(
    'refuses to send a link for an order with %s',
    async (_label, hash) => {
      const order = await insertOrder('A', { hash });

      await expect(
        run(handlers.sendGuestConfirmation, order.id),
      ).rejects.toThrow('no live manage link');
      expect(await messageRows()).toHaveLength(0);
    },
  );

  it('refuses an order that does not exist', async () => {
    await expect(
      run(handlers.sendGuestConfirmation, randomUUID()),
    ).rejects.toThrow('there is no such booking');
  });
});

describe('the host booking notice', () => {
  it("goes to the host's address and holds no manage link", async () => {
    const order = await insertOrder('A');

    await run(handlers.sendHostBookingNotice, order.id);

    const { html, text, row } = await mailboxBody(hostEmail);
    expect(row.template).toBe('host-booking-notice');
    expect(text).toContain('Pat Rivera booked 3 guests');
    expect(html).not.toContain('/manage/');
    expect(row.subject).toBe(
      'New booking: Experience, Saturday, November 7, 2026',
    );
  });

  it('sends one message however many times the handler runs', async () => {
    const order = await insertOrder('A');

    await run(handlers.sendHostBookingNotice, order.id);
    await run(handlers.sendHostBookingNotice, order.id);

    expect(await messageRows()).toHaveLength(1);
  });

  it('sends nothing for a cancelled order', async () => {
    const order = await insertOrder('A', { status: 'cancelled' });

    await run(handlers.sendHostBookingNotice, order.id);

    expect(await messageRows()).toHaveLength(0);
  });

  it('is refused, with nothing logged, for a host with no notification address', async () => {
    await client.db
      .update(hosts)
      .set({ notificationEmail: null })
      .where(eq(hosts.id, parents.hostId));
    try {
      const order = await insertOrder('A');

      await expect(
        run(handlers.sendHostBookingNotice, order.id),
      ).rejects.toThrow('the host has no notification address');
      expect(await messageRows()).toHaveLength(0);
    } finally {
      await client.db
        .update(hosts)
        .set({ notificationEmail: hostEmail })
        .where(eq(hosts.id, parents.hostId));
    }
  });
});

describe('the jobs', () => {
  it('drains a guest-confirmation job and a host-booking-notice job to sent messages', async () => {
    const order = await insertOrder('A');
    await client.db.transaction(async (tx) => {
      for (const kind of ['guest-confirmation', 'host-booking-notice']) {
        await enqueueModule.enqueue(tx, {
          kind,
          payload: { orderId: order.id },
          dedupeKey: `${kind}:${order.id}`,
        });
      }
    });

    const report = await drainModule.drainJobs(clockModule.systemClock);

    expect(report).toMatchObject({ claimed: 2, succeeded: 2 });
    expect(
      (await messageRows()).map((message) => message.template).sort(),
    ).toEqual(['guest-confirmation', 'host-booking-notice']);
  });

  it.each([
    ['an extra field', { orderId: randomUUID(), to: 'x@example.com' }],
    ['no id', {}],
    ['an id that is not a uuid', { orderId: 'RMB-ABC123' }],
    ['an id as a number', { orderId: 7 }],
  ])('refuses a payload with %s at enqueue', async (_label, payload) => {
    for (const kind of ['guest-confirmation', 'host-booking-notice']) {
      await expect(
        client.db.transaction((tx) =>
          enqueueModule.enqueue(tx, { kind, payload }),
        ),
      ).rejects.toThrow();
    }
    expect(await client.db.select().from(jobs)).toHaveLength(0);
  });

  it('lower-cases the order id it is given', async () => {
    const order = await insertOrder('A');

    await client.db.transaction((tx) =>
      enqueueModule.enqueue(tx, {
        kind: 'guest-confirmation',
        payload: { orderId: order.id.toUpperCase() },
      }),
    );

    const [job] = await client.db.select().from(jobs);
    expect(job?.payload).toEqual({ orderId: order.id });
  });
});

describe('the hosts table', () => {
  it.each([
    ['not an address', 'not-an-email'],
    ['upper case', 'Ops@Harbor.example'],
    ['two addresses', 'a@example.com,b@example.com'],
    ['over 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('refuses a notification address that is %s', async (_label, address) => {
    await expect(
      client.db.insert(hosts).values({
        slug: `bad-${randomUUID()}`,
        name: 'Bad',
        timeZone: 'America/New_York',
        notificationEmail: address,
      }),
    ).rejects.toThrow();
  });

  it('accepts a host with none, and one with an address', async () => {
    await expect(
      client.db.insert(hosts).values([
        {
          slug: `none-${randomUUID()}`,
          name: 'None',
          timeZone: 'America/New_York',
        },
        {
          slug: `some-${randomUUID()}`,
          name: 'Some',
          timeZone: 'America/New_York',
          notificationEmail: 'ops@harbor.example',
        },
      ]),
    ).resolves.toBeDefined();
  });
});
