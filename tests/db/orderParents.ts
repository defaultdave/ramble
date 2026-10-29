import { eq } from 'drizzle-orm';
import {
  categories,
  cancellationTiers,
  experiences,
  guests,
  hosts,
  legalDocuments,
  neighborhoods,
  priceOptions,
} from '@/server/db/schema';
import { insertSession } from './holdFixtures';

type Client = typeof import('@/server/db/client');

/**
 * The rows an order points at, made once per test file: a host, an experience with one price option,
 * a session, a guest, the default tier, and a terms document (a draft: a foreign key needs only the row).
 */
export async function createOrderParents(db: Client['db'], tag: string) {
  const [host] = await db
    .insert(hosts)
    .values({ slug: `host-${tag}`, name: 'Host', timeZone: 'America/New_York' })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({ slug: `category-${tag}`, name: 'Category' })
    .returning();
  const [neighborhood] = await db
    .insert(neighborhoods)
    .values({ slug: `neighborhood-${tag}`, name: 'Neighborhood' })
    .returning();
  const [tier] = await db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  const [guest] = await db
    .insert(guests)
    .values({ email: `${tag}@example.com` })
    .returning();
  if (!host || !category || !neighborhood || !tier || !guest) {
    throw new Error('missing parents');
  }
  const [experience] = await db
    .insert(experiences)
    .values({
      hostId: host.id,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
      slug: `experience-${tag}`,
      name: 'Experience',
    })
    .returning();
  if (!experience) throw new Error('missing experience');
  const [option] = await db
    .insert(priceOptions)
    .values({ experienceId: experience.id, kind: 'adult', priceMinor: 8500 })
    .returning();
  if (!option) throw new Error('missing price option');
  const session = await insertSession(db, experience.id);
  const [terms] = await db
    .insert(legalDocuments)
    .values({
      doc: 'terms',
      version: 1,
      title: 'Terms',
      body: { type: 'doc', content: [] },
    })
    .returning();
  if (!terms) throw new Error('missing terms document');
  return {
    hostId: host.id,
    experienceId: experience.id,
    tierId: tier.id,
    guestId: guest.id,
    priceOptionId: option.id,
    sessionId: session.id,
    termsDocumentId: terms.id,
  };
}
