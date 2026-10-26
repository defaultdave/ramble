# Secret rotation and account hygiene

How to rotate every secret the plan names, what each rotation breaks, and the account and repo settings that only the owner can switch on. Written for Dave. Nothing here is run by an agent.

Most secrets below do not exist yet. They arrive with the unit that needs them; this page says what to do when they do. Where the plan has not fixed a variable name, the entry says so.

## Rules for every rotation

1. Make the new value first, put it where the app reads it, deploy, confirm, and only then revoke the old one. The exception is a leak: revoke first and accept the outage.
2. Secrets live in three places only: Vercel environment variables of type Secret (ADR 0007, Secrets), GitHub Actions secrets for workflows, and GitHub environment secrets for the `production-database` environment. Never in the repo, a chat, or a command line. Paste at the prompt: `gh secret set NAME --repo defaultdave/ramble` (add `--env production-database` for an environment secret).
3. `src/server/env.ts` validates every variable when server code first loads (SET-18, SET-19), but it skips the required database URLs while `next build` runs, so a successful build proves nothing about a rotated credential. Before promoting a deployment, and for a routine rotation before revoking the old value, exercise the affected path: open a page that reads the database, run the migrate check, send a test webhook, and so on.
4. After any rotation, note in your own records the date and why. Do not paste the value.

## If a scanner finds a secret

gitleaks failing a PR, or GitHub push protection blocking a push, means treat the value as compromised, even in a private branch. Rotate it using its section below, then remove it from the branch. Rewriting history is optional once the value is dead.

The same applies to a secret pasted into a chat or an agent session: revoke it, then rotate it. Treat a transcript as readable by others.

## The secrets

### CAPABILITY_TOKEN_SECRET

- **Source:** design doc 4.2.3 (capability-token amendment, accepted 2026-10-19); ADR 0002, Security data rules.
- **What it does:** HMAC key behind every manage, gift, and order link. Whoever holds it can cancel any booking or redeem any gift.
- **Lives in:** Vercel, Secret type, all environments.
- **Rotated by:** Dave.
- **How:** generate 32 random bytes straight into Vercel without displaying or copying them (`openssl rand -base64 32 | tr -d '\n' | vercel env add CAPABILITY_TOKEN_SECRET --sensitive --environment production`, repeated for each environment; the Vercel CLI reads the value from stdin), deploy, then run the re-hash of stored hashes (built in U-015 and U-017), then resend links to upcoming bookings and to delivered, unredeemed gifts. The step-by-step version with a rehearsal is owned by the operations runbooks unit (U-099); follow that page when it exists.
- **What breaks:** every link already emailed stops working until the re-hash and resend finish. Do it at a quiet hour, not during the newsletter send.

### Neon database URLs

- **Source:** ADR 0002, Data operations (pooled host for the app, direct host for migrations and dumps); ADR 0007 (a Neon branch per preview).
- **Lives in:** the Neon-managed integration injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED` into Vercel (Production and Development; Preview per branch, created on a redeploy). Do not hand-edit those. Two copies are yours: the `DATABASE_URL` and `DATABASE_URL_UNPOOLED` pair set for the `integration` Preview branch (it points at the `staging` Neon branch), and the `DATABASE_URL_UNPOOLED` secret in the GitHub `production-database` environment, which `db-migrate-production.yml` reads.
- **Rotated by:** Dave.
- **How:** in the Neon console reset the password of the app role. Then, in Neon (Integrations, Manage), check that the integration pushed the new URLs to Vercel; if it did not, reconnect the project. Update the three copies by hand (the `integration` Preview pair in Vercel, the `production-database` environment secret, and `NIGHTLY_DATABASE_URL`): the `integration` Preview pair in Vercel (copy the pooled and direct strings from the `staging` branch) and the `production-database` environment secret (`gh secret set DATABASE_URL_UNPOOLED --repo defaultdave/ramble --env production-database`). Redeploy production, then redeploy a preview and confirm its Vercel check goes green.
- **What breaks:** the moment the password resets, running connections fail, every existing preview branch's URLs are stale until redeployed, and the nightly race tests fail until `NIGHTLY_DATABASE_URL` is updated. Do it at a quiet hour.
- **Other Neon credentials:** `NEON_API_KEY` is a GitHub Actions secret read by `neon-preview-branch.yml`; it can create and delete branches on the project. Rotate it by creating a new key in the Neon console (account Settings, API keys), running `gh secret set NEON_API_KEY --repo defaultdave/ramble`, re-running a preview workflow, then revoking the old key. `NEON_PROJECT_ID` is a GitHub Actions variable, not a secret; it needs no rotation and must not be stored with the secrets.
- **`NIGHTLY_DATABASE_URL`:** a GitHub Actions secret that `nightly-smoke.yml` reads as `DATABASE_URL` for the overnight race tests (merge-desk runbook C4). It holds a copy of a Neon connection string, so it goes stale when the role password resets. Confirm which Neon branch it points at when you next set it, and record that here.
- **Not built yet:** an hourly `pg_dump` workflow. Add its entry here when it lands.

### Stripe keys (real job only)

- **Source:** ADR 0003: the demo runs on the fake gateway only. There is no Stripe account, sandbox, or key in the demo, so nothing here needs rotating today.
- **Real job:** a live key is a serious secret and the webhook signing secret goes with it (webhook route verifies the signature on the raw body, design doc 4.2.3). Variable names are not fixed in the plan; record them here when the payments unit picks them. Keep them in Vercel, Secret type, server-only, and out of agent sessions. Rotate on staff changes and after any suspected leak.
- **How (real job):** in the Stripe dashboard roll the secret key, choosing an expiry for the old key if offered; update Vercel; deploy. For the webhook, roll the endpoint's signing secret with the overlap Stripe offers, update Vercel, deploy, then let the old secret expire.
- **What breaks (real job):** payments fail from the moment the old key dies. Webhooks fail signature checks if only one side changed. The intake verifies the signature before it inserts into `provider_events`, so a rejected delivery is not stored and no internal retry recovers it, and the daily reconciliation only compares balances. After the secrets match, check Stripe's event log and resend every delivery that failed.

### Cron and pulse trigger secret

- **Source:** ADR 0007 (one demo pulse every 30 minutes from a scheduled GitHub Actions workflow; protected manual trigger; `/api/pulse` is "signed or secret", design doc route table).
- **Variable name:** not fixed in the plan.
- **Lives in:** Vercel (checked by the route) and GitHub Actions (sent by the workflow).
- **Rotated by:** Dave.
- **How:** make a new random value, set it in both places, deploy. Do the Vercel side first and the GitHub side second, within a few minutes.
- **What breaks:** pulses are rejected in the gap between the two updates. The next 30-minute pulse catches up; use the manual trigger if you cannot wait.

### Dev mailbox secret and email webhook secret

- **Source:** units.yaml U-006 (dev mailbox page and `/api/webhooks/email` refuse unauthenticated requests; shared secret checked on the server; webhook checks its signature or secret); U-073 later moves the mailbox behind the ops role.
- **Variable names:** `DEV_MAILBOX_SECRET` and `EMAIL_WEBHOOK_SECRET`, each at least 32 characters, both read in `src/server/env.ts`.
- **`DEV_MAILBOX_SECRET`:** opens `/ops/mailbox`, which shows every captured email with its links. It is off in `live` mode and while unset. Generate it with `openssl rand -hex 32`, straight into Vercel (Secret type). Rotating it signs every open mailbox session out, because the session cookie is derived from the secret. Wrong guesses are counted per source address and slowed after 10 in 10 minutes; a correct secret is never refused, so its length is the real protection.
- **`EMAIL_WEBHOOK_SECRET`:** what the provider's delivery webhook proves itself with. With Resend it is the `whsec_` signing secret shown on the webhook in the Resend dashboard, so you copy it from there into Vercel rather than generating it. With Postmark it is the password you put in the webhook URL's basic-auth credentials in Postmark's webhook settings (generate it yourself). With the fake adapter it is the Bearer token for hand-sent events.
- **Lives in:** Vercel, Secret type, and for the webhook secret also the email vendor's dashboard.
- **Rotated by:** Dave.
- **How:** put the new value in Vercel and deploy; for the webhook secret change it in the vendor dashboard at the same moment, then send a test event.
- **What breaks:** the mailbox asks you to unlock again with the new secret. Delivery webhooks return 401 until both sides match; a provider retries, and a refused bounce or complaint that is never retried leaves that address unsuppressed, so check the vendor's event log after the change.

### Resend API key and Postmark server token (real job only)

- **Source:** design doc ports table (EmailPort: fake with dev mailbox in the demo, Resend in the real job, Postmark as the spare); ADR 0007 Tier B.
- **Variable names:** `RESEND_API_KEY` (when `EMAIL_PROVIDER=resend`) and `POSTMARK_SERVER_TOKEN` (when `EMAIL_PROVIDER=postmark`). The app refuses to start with a real provider and no key.
- **Lives in:** Vercel, Secret type.
- **Rotated by:** the account owner (Dave in the demo, the client later).
- **How:** create a second key (Resend) or a new server token (Postmark) in the vendor dashboard, update Vercel, deploy, send a test email, then delete the old one.
- **What breaks:** email sends fail between revoking and deploying; a failed send is logged and retried by its caller under the same idempotency key. The demo does not use either.

### Cloudflare R2 credentials

- **Source:** ADR 0002 (hourly `pg_dump` to R2; nightly audit-log export to locked storage on the R2 free tier).
- **Lives in:** GitHub Actions secrets (dump workflow) and Vercel (audit export job), when those units land.
- **Rotated by:** Dave.
- **How:** create a new R2 API token with the same bucket scope, update both places, run the dump once by hand, then delete the old token.
- **What breaks:** dumps and audit exports fail until updated. PRD-75's one-hour loss limit is measured from the last successful recoverable backup, not from the start of the outage: if the 09:00 dump succeeds and rotation blocks the 10:00 one, a region loss at 10:30 loses 90 minutes. Run a fresh dump by hand as soon as the new token works, and confirm it landed in the bucket.

### Monitoring tokens: Sentry, Better Stack, Axiom

- **Source:** ADR 0007, Measurement and monitoring and the amendment's monitoring stack (each behind a wrapper).
- **Variable names:** not fixed in the plan.
- **Lives in:** Vercel, Secret type; Better Stack heartbeat URLs also live in the pulse workflow (GitHub Actions) if the pulse reports to them.
- **Rotated by:** Dave.
- **How:** create a new token or DSN in the vendor, update Vercel (and GitHub where used), deploy, revoke the old one. A Sentry DSN is not a strong secret but rotate it if it is abused.
- **What breaks:** errors, logs, or heartbeats go missing until updated. A missing heartbeat raises an alert, which is a false alarm if you caused it; pause the monitor first.

### Better Auth secret

- **Source:** inferred, not named in the plan. Design doc section on people and access says auth runs on Better Auth over Postgres with passkeys for ops and admin (ADR 0002). Better Auth signs sessions with a server secret. Confirm the variable name when U-004b lands and fix this entry.
- **Lives in:** Vercel, Secret type.
- **Rotated by:** Dave.
- **How:** new value, deploy.
- **What breaks:** every signed-in session ends, ops and admin sign in again with their passkeys. Passkeys themselves are not affected.

### GitHub App private key (merge desk)

- **Source:** `docs/plan/merge-desk-runbook.md`, steps A2 and A4 (the key file is outside the repo at `~/.config/ramble-agents/app-key.pem`; App ID, Client ID, and installation ID in `app.conf`).
- **Lives in:** your laptop only. It is not a repo secret and not in Vercel.
- **Rotated by:** Dave.
- **How:** on the App page, Generate a private key, move the new `.pem` over `app-key.pem` with mode 600 as in A2 (delete the copy the browser left in Downloads), confirm `scripts/merge-desk/app-token.ts` still mints a token, update `RAMBLE_APP_KEY` in `app.conf` only if you changed the path, and delete the old key on the App page only after a token mints.
- **What breaks:** agents cannot push, open PRs, or post checks while the key is wrong. Humans can still merge with bypass.

## Checklist for Dave

These are account and repo settings. No agent can or should do them.

### MFA on vendor accounts (ADR 0007, "MFA on every vendor account")

Turn on two-factor authentication, with a passkey or an authenticator app rather than SMS, and store recovery codes in your password manager. Tick each when the account exists and is done.

- [ ] GitHub (`defaultdave`)
- [ ] Vercel
- [ ] Neon
- [ ] Figma (the Ramble wireframes and library)
- [ ] Claude (Anthropic): the credential behind every agent session, so the highest value of these
- [ ] Stripe (real job only; the demo has no account, ADR 0003)
- [ ] Cloudflare (for R2)
- [ ] Sentry
- [ ] Better Stack
- [ ] Axiom
- [ ] Resend (real job only)
- [ ] The email account that receives every vendor's recovery mail
- [ ] The domain registrar, when a domain is bought (none for the demo, ADR 0007 D3)

### Repository settings (the repo is public, so these are free)

The scanner workflows and `dependabot.yml` named below arrive in the U-102 scanner PR (Dave pushes it; `.github/` is protected). The settings apply either way.

Under Settings, Advanced Security (or Code security), for `defaultdave/ramble`:

- [ ] Secret scanning: on
- [ ] Push protection: on
- [ ] Dependabot alerts: on
- [ ] Dependabot security updates: on (the version updates come from `.github/dependabot.yml`)
- [ ] Code scanning: leave default setup off. The advanced workflow `.github/workflows/codeql.yml` replaces it; both on at once fails the upload.
- [ ] Private vulnerability reporting: on, so a reporter has somewhere to go besides a public issue.

### After the first run

- [ ] Open the Actions tab and confirm `gitleaks`, `osv-scanner`, and `codeql` ran on the merge to `main` and are green. If `osv-scanner` or `codeql` cannot upload results, the Security settings above are the usual reason.
- [ ] Decide whether `gitleaks`, `analyze (javascript-typescript)`, and the OSV check become required checks on the `main` and `integration` rulesets. Rulesets are yours to change (merge-desk runbook C3 shows the command).
- [ ] Do a one-time dry run with a fake secret on a throwaway branch to see gitleaks and push protection fire. Use a published example key, never a real one.

## When this page changes

Add the secret here in the same PR that adds the variable to `src/server/env.ts`. Review should reject a new secret that is missing from this page.
