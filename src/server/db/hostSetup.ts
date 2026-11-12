import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  hostCreatedEntry,
  hostFormEntry,
  hostListEntry,
  hostViewEntry,
} from '@/lib/hostAudit';
import {
  buildHostDetail,
  buildHostListRows,
  agreementRefusal,
  isSlugTakenError,
  changedHostFields,
  hostSaveOutcome,
  hostAgreementDoc,
  hostsPageSize,
  type HostCreateInput,
  type HostDetail,
  type HostInput,
  type HostListRow,
} from '@/lib/hostSetup';
import { splitPage } from '@/lib/pagination';
import { Role, type Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import { saveHostFields } from './hostFields';
import { byNameThenId, pastNameCursor } from './keysetPage';
import {
  getCurrentLegalDocument,
  readHostAcceptances,
  recordHostAcceptanceIn,
} from './legal';
import { authUsers, hosts, roleGrants } from './schema';
import { ensureAuthUserIn, readRoleHolder } from './staffRoles';

// Everything here is for the ops role: each function checks it, and each read records its audit
// row before it returns anything.

/** The most owner rows one read returns; a host has a handful. */
const ownerReadLimit = 500;

class AgreementRefusal extends Error {
  constructor(readonly outcome: 'stale' | 'no_current_document') {
    super('The host agreement could not be accepted');
    this.name = 'AgreementRefusal';
  }
}

export type CreateHostResult =
  | { status: 'created'; hostId: string; ownerUserId: string }
  | { status: 'agreement_refused'; reason: 'stale' | 'no_current_document' }
  | { status: 'slug_taken' };

/**
 * Makes the host, its owner account (found by address, or made with the address marked
 * verified: Better Auth's first-sign-in step for an unverified account writes a row this schema's
 * CHECK refuses, and the person who gets the link is the only one it can reach), the owner's role grant, and, when ticked, the acceptance, all in one
 * transaction with their audit rows. An agreement that cannot be accepted refuses the whole
 * setup and writes nothing.
 */
export async function createHost(
  caller: Caller,
  input: HostCreateInput,
): Promise<CreateHostResult> {
  const userId = requireOpsUserId(caller);
  try {
    return await db.transaction(async (tx) => {
      const [host] = await tx
        .insert(hosts)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description,
          timeZone: input.timeZone,
          notificationEmail: input.notificationEmail,
        })
        .returning({ id: hosts.id });
      if (!host) throw new Error('The host write returned no row');

      const ownerId = await ensureAuthUserIn(tx, input.ownerEmail);
      await tx
        .insert(roleGrants)
        .values({ userId: ownerId, role: 'host_owner', hostId: host.id })
        .onConflictDoNothing();
      await writeAudit(tx, hostCreatedEntry(userId, host.id, ownerId));

      if (input.acceptedLegalDocumentId !== null) {
        const outcome = await recordHostAcceptanceIn(
          tx,
          caller,
          host.id,
          input.acceptedLegalDocumentId,
        );
        const refusal = agreementRefusal(outcome);
        if (refusal !== null) throw new AgreementRefusal(refusal);
      }
      return {
        status: 'created' as const,
        hostId: host.id,
        ownerUserId: ownerId,
      };
    });
  } catch (error) {
    if (error instanceof AgreementRefusal) {
      return { status: 'agreement_refused', reason: error.outcome };
    }
    if (isSlugTakenError(error)) return { status: 'slug_taken' };
    throw error;
  }
}

export type UpdateHostResult =
  { status: 'updated' | 'unchanged' | 'slug_taken' } | { status: 'not_found' };

/** Saves the host's editable fields. Nothing differing writes nothing, audit row included. */
export async function updateHost(
  caller: Caller,
  hostId: string,
  input: HostInput,
): Promise<UpdateHostResult> {
  requireOpsUserId(caller);
  try {
    return await db.transaction(async (tx) => {
      const changed = await saveHostFields(
        tx,
        caller,
        Role.Ops,
        hostId,
        input,
        (current) => changedHostFields(current, input),
      );
      if (changed === null) return { status: 'not_found' } as const;
      return { status: hostSaveOutcome(changed) } as const;
    });
  } catch (error) {
    if (isSlugTakenError(error)) return { status: 'slug_taken' };
    throw error;
  }
}

export type HostsPage = { rows: HostListRow[]; nextCursor: string | null };

/** One page of hosts by name, with owners and agreement state. Audited before it returns. */
export async function readHostsForOps(
  caller: Caller,
  cursor: string | null,
): Promise<HostsPage> {
  const userId = requireOpsUserId(caller);
  const fetched = await dbRead
    .select({
      id: hosts.id,
      name: hosts.name,
      slug: hosts.slug,
      timeZone: hosts.timeZone,
    })
    .from(hosts)
    .where(pastNameCursor(hosts, cursor))
    .orderBy(...byNameThenId(hosts))
    .limit(hostsPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, hostsPageSize);
  const ids = items.map((host) => host.id);

  const [owners, acceptances, agreement] = await Promise.all([
    readOwnerRows(ids),
    readHostAcceptances(caller, ids),
    getCurrentLegalDocument(hostAgreementDoc),
  ]);
  const rows = buildHostListRows({
    hosts: items,
    owners,
    acceptances,
    currentAgreementId: agreement?.id ?? null,
  });
  await recordAudit(hostListEntry(userId));
  return { rows, nextCursor };
}

async function readOwnerRows(hostIds: readonly string[]) {
  if (hostIds.length === 0) return [];
  return dbRead
    .select({
      hostId: roleGrants.hostId,
      userId: authUsers.id,
      email: authUsers.email,
    })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(
      and(
        eq(roleGrants.role, 'host_owner'),
        inArray(roleGrants.hostId, [...hostIds]),
      ),
    )
    .orderBy(asc(roleGrants.createdAt), asc(roleGrants.id))
    .limit(ownerReadLimit);
}

/** One host with its owners and agreement record, or null for an id that is no host. A view that finds a host is audited before it returns. */
export async function readHostForOps(
  caller: Caller,
  hostId: string,
): Promise<HostDetail | null> {
  const userId = requireOpsUserId(caller);
  const [host] = await dbRead.select().from(hosts).where(eq(hosts.id, hostId));
  if (!host) return null;
  const [owners, acceptances, agreement] = await Promise.all([
    readOwnerRows([hostId]),
    readHostAcceptances(caller, [hostId]),
    getCurrentLegalDocument(hostAgreementDoc),
  ]);
  const detail = buildHostDetail({ host, owners, acceptances, agreement });
  await recordAudit(hostViewEntry(userId, hostId));
  return detail;
}

/** The ops view of the new-host form: the agreement the box would accept. Audited before it returns. */
export async function readNewHostForm(caller: Caller) {
  const userId = requireOpsUserId(caller);
  const agreement = await getCurrentLegalDocument(hostAgreementDoc);
  await recordAudit(hostFormEntry(userId));
  return agreement === null
    ? null
    : { id: agreement.id, version: agreement.version, title: agreement.title };
}

/** The name and address a sign-in link for this owner of this host goes to, or null when the person does not own the host. */
export async function readHostInviteTarget(
  caller: Caller,
  hostId: string,
  ownerUserId: string,
): Promise<{ hostName: string; email: string } | null> {
  const holder = await readRoleHolder(caller, ownerUserId, {
    role: 'host_owner',
    hostId,
  });
  if (holder === null || holder.hostName === null) return null;
  return { hostName: holder.hostName, email: holder.email };
}
