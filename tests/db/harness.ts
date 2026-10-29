import { randomBytes } from 'node:crypto';
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { expect } from 'vitest';

export type FreshDatabase = {
  /** Connection string whose sessions resolve unqualified names in the file's own schema. */
  url: string;
  schema: string;
  dispose: () => Promise<void>;
};

const migrationsFolder = path.resolve(
  import.meta.dirname,
  '../../src/server/db/migrations',
);

/**
 * drizzle-kit writes `"public".` before every enum type and foreign key target, which would send
 * a test file's objects to the shared schema. Copies the migrations with that prefix pointed at the
 * file's own schema.
 */
async function copyMigrationsInto(schema: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'ramble-migrations-'));
  await cp(migrationsFolder, folder, { recursive: true });
  for (const file of await readdir(folder)) {
    if (!file.endsWith('.sql')) continue;
    const target = path.join(folder, file);
    const sql = await readFile(target, 'utf8');
    await writeFile(target, sql.replaceAll('"public".', `"${schema}".`));
  }
  return folder;
}

/**
 * Creates a schema private to the calling test file, applies every committed migration into it,
 * and returns a URL that points at it, so test files run in parallel without sharing rows.
 */
export async function createFreshDatabase(
  adminUrl: string,
): Promise<FreshDatabase> {
  const { hostname } = new URL(adminUrl);
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(hostname)) {
    throw new Error(
      `Refusing to run database tests against ${hostname}: they create and drop schemas. Use the docker-compose database.`,
    );
  }
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);

  const url = new URL(adminUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);

  const migrations = await copyMigrationsInto(schema);
  const migrator = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    await migrate(drizzle(migrator), {
      migrationsFolder: migrations,
      migrationsSchema: schema,
    });
  } finally {
    await migrator.end();
    await rm(migrations, { recursive: true, force: true });
  }

  return {
    url: url.toString(),
    schema,
    dispose: async () => {
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString());
    });
    request.on('error', reject);
  });
}

async function answer(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const { query, params } = JSON.parse(await readBody(request)) as {
    query: string;
    params: unknown[];
  };
  const result = await pool.query({
    text: query,
    values: params,
    rowMode: 'array',
    // The client asked for raw text output (Neon-Raw-Text-Output), so skip type parsing.
    types: {
      getTypeParser: () => (value: string) => value,
    },
  });
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      command: result.command,
      rowCount: result.rowCount,
      rows: result.rows,
      fields: result.fields.map((field) => ({
        name: field.name,
        dataTypeID: field.dataTypeID,
      })),
    }),
  );
}

/**
 * Stands in for Neon's HTTP endpoint (`POST /sql`) in front of a plain Postgres, because the Neon
 * driver speaks HTTP and CI and local Docker run ordinary Postgres. Point `url` at the fresh schema.
 */
export async function serveNeonHttp(url: string) {
  const pool = new Pool({ connectionString: url, max: 2 });
  const server = createServer((request, response) => {
    answer(pool, request, response).catch((error: unknown) => {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  neonConfig.fetchEndpoint = `http://127.0.0.1:${String(port)}/sql`;
  return async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
    await pool.end();
  };
}

export const aFewMoments = () =>
  new Promise((resolve) => setTimeout(resolve, 300));

/**
 * Runs `holder` in a transaction that stays open, starts `challenger` on another connection,
 * checks the challenger is still waiting, then commits the holder and returns what the challenger
 * answered. A challenger that does not wait was not serialized by the lock. `openTransaction` is
 * the client's `db.transaction`, so the helper does not import the lazy client.
 */
export async function raceAgainstOpenTransaction<Tx, T>(
  openTransaction: (body: (tx: Tx) => Promise<void>) => Promise<unknown>,
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holderDone = openTransaction(async (tx) => {
    await holder(tx);
    held();
    await gate;
  });
  await holding;

  let settled = false;
  const answer = challenger().finally(() => {
    settled = true;
  });
  answer.catch(() => undefined);
  await aFewMoments();
  const waited = !settled;
  release();
  await holderDone;
  expect(waited, 'the challenger waited for the holder').toBe(true);
  return answer;
}
