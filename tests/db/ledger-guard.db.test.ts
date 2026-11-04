import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  cashRow,
  client,
  code,
  countRows,
  fresh,
  insert,
  nextProviderId,
  occurred,
  openLedgerDatabase,
  parents,
} from './ledgerFixtures';

// Behaviours under test, one per decision, branch or risk.
// The append-only guard:
// - UPDATE, DELETE, and TRUNCATE are refused for the owner, and the rows stay
// - ledger_writer exists, cannot log in, has INSERT and SELECT only, can insert, and is refused update, delete, and truncate

openLedgerDatabase();

const restricted = code('23001');
const noPrivilege = code('42501');

describe('the append-only guard', () => {
  async function seeded() {
    const providerId = nextProviderId();
    await insert(cashRow({ provider_object_id: providerId }));
    return providerId;
  }

  it('refuses an update, even by the table owner, and the row stays as it was', async () => {
    const providerId = await seeded();
    await expect(
      client.db.execute(
        sql`UPDATE ledger_entries SET amount_minor = 1 WHERE provider_object_id = ${providerId}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(
      await countRows(
        sql`provider_object_id = ${providerId} AND amount_minor = 11050`,
      ),
    ).toBe(1);
  });

  it('refuses a delete, even by the table owner, and the row stays', async () => {
    const providerId = await seeded();
    await expect(
      client.db.execute(
        sql`DELETE FROM ledger_entries WHERE provider_object_id = ${providerId}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(await countRows(sql`provider_object_id = ${providerId}`)).toBe(1);
  });

  it('refuses a truncate, with or without cascade', async () => {
    await seeded();
    const before = await countRows();
    await expect(
      client.db.execute(sql`TRUNCATE ledger_entries`),
    ).rejects.toMatchObject(restricted);
    await expect(
      client.db.execute(sql`TRUNCATE ledger_entries CASCADE`),
    ).rejects.toMatchObject(restricted);
    expect(await countRows()).toBe(before);
  });

  it('has a ledger_writer role that cannot log in and holds INSERT and SELECT only', async () => {
    const { rows: roles } = await client.db.execute<{ rolcanlogin: boolean }>(
      sql`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'ledger_writer'`,
    );
    expect(roles).toEqual([{ rolcanlogin: false }]);
    const { rows: grants } = await client.db.execute<{
      privilege_type: string;
    }>(
      sql`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'ledger_writer' AND table_schema = ${fresh.schema} AND table_name = 'ledger_entries' ORDER BY privilege_type`,
    );
    expect(grants.map((grant) => grant.privilege_type)).toEqual([
      'INSERT',
      'SELECT',
    ]);
  });

  it('lets ledger_writer insert and read, and refuses it update, delete, and truncate', async () => {
    await client.db.execute(
      sql.raw(`GRANT USAGE ON SCHEMA ${fresh.schema} TO ledger_writer`),
    );
    const asWriter = async (statement: ReturnType<typeof sql>) =>
      client.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE ledger_writer`);
        await tx.execute(statement);
      });
    await asWriter(sql`SELECT count(*) FROM ledger_entries`);
    const providerId = nextProviderId();
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ledger_writer`);
      await tx.execute(
        sql`INSERT INTO ledger_entries (occurred_at, entry_type, debit_account, credit_account, amount_minor, host_id, provider_object_id, simulated) VALUES (${occurred}, 'charge_host_share', 'platform_cash', 'host_payable', 5, ${parents.hostId}, ${providerId}, true)`,
      );
    });
    expect(await countRows(sql`provider_object_id = ${providerId}`)).toBe(1);
    await expect(
      asWriter(sql`UPDATE ledger_entries SET amount_minor = 1`),
    ).rejects.toMatchObject(noPrivilege);
    await expect(
      asWriter(sql`DELETE FROM ledger_entries`),
    ).rejects.toMatchObject(noPrivilege);
    await expect(asWriter(sql`TRUNCATE ledger_entries`)).rejects.toMatchObject(
      noPrivilege,
    );
  });
});
