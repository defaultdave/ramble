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

const localHostHeader = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Starts a stand-in for Neon's HTTP endpoint (`POST /sql`) in front of a plain Postgres, because the
 * Neon driver speaks HTTP and CI and local Docker run ordinary Postgres. It runs whatever SQL it is
 * sent, so it listens on loopback only and refuses a request a browser sent (an `Origin` header) or
 * one addressed to another host name (DNS rebinding).
 */
export async function startNeonHttpShim(url: string, port = 0) {
  const pool = new Pool({ connectionString: url, max: 2 });
  const server = createServer((request, response) => {
    if (
      request.headers.origin !== undefined ||
      !localHostHeader.test(request.headers.host ?? '')
    ) {
      response.statusCode = 403;
      response.end();
      return;
    }
    answer(pool, request, response).catch((error: unknown) => {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(address.port)}/sql`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
      await pool.end();
    },
  };
}

/** The shim on a free port, with the Neon driver pointed at it for the whole process. */
export async function serveNeonHttp(url: string) {
  const { endpoint, stop } = await startNeonHttpShim(url);
  neonConfig.fetchEndpoint = endpoint;
  return stop;
}
