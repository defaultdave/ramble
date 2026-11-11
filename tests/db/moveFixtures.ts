import { eq, sql } from 'drizzle-orm';
import {
  auditOf,
  seatsSoldOf,
  seedCancellable,
  type CancelWorld,
} from './cancelFixtures';
import { insertSession } from './holdFixtures';
import { getParents } from './refundFixtures';
import {
  client,
  clearJobs,
  jobsOfKind,
  orderOf,
  refundsOf,
  schema,
} from './refundFixtures';

type CancelSeed = NonNullable<Parameters<typeof seedCancellable>[0]>;

export type MoveWorld = CancelWorld & {
  experienceId: string;
  /** The booking's tier, in hours: a date this far ahead is the earliest one that could still be cancelled for free. */
  tierHours: number;
};

/**
 * A confirmed booking on a live experience, ready to move: the experience is made live (the seed
 * leaves it a draft), and `tierHours` is read from the order's own tier so a test can put a date
 * a minute either side of the deadline.
 */
export async function seedMovable(seed: CancelSeed = {}): Promise<MoveWorld> {
  await clearJobs();
  const world = await seedCancellable(seed);
  const order = await orderOf(world);
  await client.db
    .update(schema.experiences)
    .set({ status: 'live' })
    .where(eq(schema.experiences.id, order.experienceId));
  const [tier] = await client.db
    .select({ hours: schema.cancellationTiers.fullRefundHoursBefore })
    .from(schema.cancellationTiers)
    .where(eq(schema.cancellationTiers.id, order.cancellationTierId));
  if (!tier) throw new Error('no tier');
  return { ...world, experienceId: order.experienceId, tierHours: tier.hours };
}

type SessionOver = {
  /** Minutes from the database's now. */
  startsInMinutes?: number;
  allocation?: number;
  seatsSold?: number;
  status?: 'scheduled' | 'cancelled' | 'completed';
  experienceId?: string;
  /** A chosen id, to put the date on a wanted side of another id. */
  id?: string;
};

/** Another date of the booking's experience (or of the one named), with the room the test asks for. */
export async function addDate(
  world: Pick<MoveWorld, 'experienceId' | 'tierHours'>,
  over: SessionOver = {},
): Promise<string> {
  const minutes = over.startsInMinutes ?? (world.tierHours + 48) * 60;
  const session = await insertSession(
    client.db,
    over.experienceId ?? world.experienceId,
    {
      startsAt: sql`now() + make_interval(mins => ${minutes})`,
      endsAt: sql`now() + make_interval(mins => ${minutes + 120})`,
      ...(over.id === undefined ? {} : { id: over.id }),
      allocation: over.allocation ?? 10,
      seatsSold: over.seatsSold ?? 0,
      ...(over.status === undefined ? {} : { status: over.status }),
      ...(over.status === 'cancelled' ? { cancelReason: 'host' as const } : {}),
    },
  );
  return session.id;
}

/** A second experience of the same host, for a date that is not the booking's experience. */
export async function otherExperience(): Promise<string> {
  const [source] = await client.db
    .select()
    .from(schema.experiences)
    .where(eq(schema.experiences.id, getParents().experienceId));
  if (!source) throw new Error('no experience');
  const [made] = await client.db
    .insert(schema.experiences)
    .values({
      ...source,
      id: crypto.randomUUID(),
      slug: `other-${crypto.randomUUID()}`,
      status: 'live',
    })
    .returning({ id: schema.experiences.id });
  if (!made) throw new Error('no other experience');
  return made.id;
}

export async function sessionOf(sessionId: string) {
  const [row] = await client.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  if (!row) throw new Error('no session');
  return row;
}

export async function holdOf(holdId: string) {
  const [row] = await client.db
    .select()
    .from(schema.holds)
    .where(eq(schema.holds.id, holdId));
  if (!row) throw new Error('no hold');
  return row;
}

/** Everything a move writes or reads back, so a refusal can be shown to have written nothing. */
export async function moveSnapshot(world: MoveWorld, dateIds: string[]) {
  const order = await orderOf(world);
  const hold = await holdOf(world.holdId);
  return {
    order,
    holdSessionId: hold.sessionId,
    seatsSold: {
      own: await seatsSoldOf(world),
      dates: await Promise.all(
        dateIds.map(async (id) => (await sessionOf(id)).seatsSold),
      ),
    },
    audit: (await auditOf(world)).length,
    refunds: (await refundsOf(world)).length,
    jobs: (await jobsOfKind('guest-move-confirmation')).filter(
      (job) => (job.payload as { orderId: string }).orderId === world.orderId,
    ).length,
  };
}

/**
 * Puts the booking and its session on an experience of their own, so a test that lists the
 * experience's dates sees only the ones it made (every booking of a file shares one experience).
 */
export async function isolateExperience(world: MoveWorld): Promise<MoveWorld> {
  const experienceId = await otherExperience();
  await client.db
    .update(schema.sessions)
    .set({ experienceId })
    .where(eq(schema.sessions.id, world.sessionId));
  await client.db
    .update(schema.orders)
    .set({ experienceId })
    .where(eq(schema.orders.id, world.orderId));
  return { ...world, experienceId };
}
