# Seed runbook

How to fill a Ramble database with demo data, what it writes, and what it refuses to do.

## Run it

```
docker compose -p ramble up -d --wait     # local Postgres
pnpm db:migrate                           # the seed needs the migrated schema
SEED_TARGET=local pnpm db:seed            # the curated coverage set
SEED_TARGET=local pnpm db:seed --scale    # plus the 400-experience scale fixture
SEED_TARGET=staging pnpm db:seed --scale=400 --scale-seed=7
```

`pnpm db:seed` runs `scripts/seed.ts` under Bun (Bun stays the runtime for `scripts/`), with a preload that stands in for `server-only` and `next/cache`, which only work inside Next.js. It needs `DATABASE_URL` and `DATABASE_URL_UNPOOLED` set, like the app.

It ends by reading the database back and running every probe of the coverage matrix. A gap exits with code 1 and names the probe.

## What it refuses

The seed fails closed. It runs only when all of these hold, and it checks them before it opens a connection:

- `SEED_TARGET` is set to `local`, `staging`, `load-test`, or `production-demo`. An unset value refuses.
- `NODE_ENV` is not `production`, for every target. The seed never runs inside the deployed app.
- `VERCEL_ENV` is not `production`, unless `SEED_TARGET=production-demo` (see below).
- The database host and name do not read as production (a whole word `prod` or `production`), unless `SEED_TARGET=production-demo`.
- With `SEED_TARGET=local`, the database is on this machine.
- `DATABASE_URL` is readable and has no `host`, `hostaddr`, `dbname`, or `database` query parameter and no percent escape in the host or database name, for every target.
- With `SEED_TARGET=production-demo`, `--scale` is not given.

A refusal prints the reason and never the connection string.

## Seeding the production demo

`SEED_TARGET=production-demo` is the one explicit way to seed the production database, for the Prototype demo site. It loads the curated set only (`--scale` is refused), and it is idempotent: a rerun changes nothing, and a legal document that already has a published version is left alone.

Run `db-migrate-production` first (the GitHub Actions workflow; the seed needs the migrated schema). Then, from the repo root on your laptop, with the Vercel CLI linked to the Ramble project (`vercel link`):

```
vercel env pull .env.production-demo.local --environment=production --yes
pull() { grep "^$1=" .env.production-demo.local | cut -d= -f2- | tr -d '"'; }
SEED_TARGET=production-demo DATABASE_URL="$(pull DATABASE_URL)" DATABASE_URL_UNPOOLED="$(pull DATABASE_URL_UNPOOLED)" pnpm db:seed
rm .env.production-demo.local
```

`.env*` is gitignored (only `.env.example` is tracked), so the pulled file is never committed. The seed gets only the two database URLs from it; nothing else in the file is passed on. If `vercel env pull` leaves either value empty, the seed refuses with `DATABASE_URL is not set`. Delete the file even when the seed fails. A successful run prints `Seeding the production-demo database on <host>` and ends with the coverage line.

The seed still refuses `NODE_ENV=production`, an unreadable `DATABASE_URL`, and one with a `host`, `hostaddr`, `dbname`, or `database` query parameter or a percent escape in the host or database name. Pages cached by the running deployment serve the old data until they expire (see Caches), so redeploy production after seeding.

## What it writes

| Group | How it is written |
|---|---|
| Legal documents (terms, privacy, host agreement, the kayak waiver) | `createLegalDraft`, then `publishLegalDocument`, as ops. The insert guard refuses a row inserted as published |
| Collections (Picks, gift guide), the home page, category and neighborhood copy | `saveCollection`, `saveHomeModules`, `savePageCopy`, as ops |
| Session templates and sessions, eight weeks ahead | `createSessionTemplate`, `generateSessions`, as ops |
| Categories, neighborhoods, hosts, experiences, price options | Written to the schema directly: the data layer has no write contract for them yet. The Zod schemas the app reads with validate every fixture first, and the database CHECKs backstop them |
| Seats sold on the few sessions that must be nearly full or sold out | Written to the schema directly: seats sold otherwise move only with orders, which do not exist yet. A session that has sold more than the plan is never lowered |

It writes no photo rows yet (U-021b seeds the photo pool), never touches the settings row (so the tax rate the settings migration seeds stays as it is), and writes no help articles.

## Rerunning

Every seeded row has a fixed id (made from its slug) or a unique key, so a rerun with the same options changes nothing: no row is added, no legal version is added, no id, publication time, or created-at changes. A legal document that already has a published version is left alone, so text an owner revised is not overwritten. A draft left by a stopped run is published, not duplicated.

Things a rerun does not do:

- It does not update a session template that exists. A changed slot in a fixture adds a template beside the old one.
- A different `--scale-seed` on a used database adds the new seed's templates beside the old ones, and rewrites experiences that share an index. For a clean fixture, seed a fresh database.
- Run on a later day, it marks that day's first nearly-full and sold-out sessions as well; the earlier ones stay.
- It does not clear anything. Re-seed from a fresh database to start over.

## Caches

The data layer invalidates cache tags after a save, but those calls are no-ops in the script. Pages cached by a running deployment keep serving until they expire or the deployment restarts. Seed a database before the deployment that reads it starts, or redeploy afterwards.

## The coverage matrix

`docs/seed/coverage-matrix.md` maps every screen and state in the Figma file to the probes that check the data behind it. It is generated from `src/lib/seed/coverage.ts`; change a probe, run `pnpm test -u src/lib/seed/coverage.test.ts`, and commit the document. The States page has ten states (S1 to S10), and all ten are in the matrix.

## The scale fixture

`--scale[=N]` makes N experiences (1 to 1000, default 400) from about 0.375 hosts per experience (150 hosts for 400), over the curated categories and neighborhoods, with prices, ages, weather, tax, cancellation tiers, and statuses mixed. `--scale-seed=N` (0 to 4294967295) picks the stream: the same options always give the same fixtures. Kids' classes run on weekends only, so the zero-results state (S2) stays true beside it. The count bounds the rows, sessions, and time of a run; 400 experiences write about 5,000 sessions.
