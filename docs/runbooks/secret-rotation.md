# Secret rotation and account hygiene

How to rotate every secret the plan names, what each rotation breaks, and the account and repo settings that only the owner can switch on. Written for Dave. Nothing here is run by an agent.

Most secrets below do not exist yet. They arrive with the unit that needs them; this page says what to do when they do. Where the plan has not fixed a variable name, the entry says so.

## Rules for every rotation

1. Make the new value first, put it where the app reads it, deploy, confirm, and only then revoke the old one. The exception is a leak: revoke first and accept the outage.
2. Secrets live in two places only: Vercel environment variables of type Secret (ADR 0007, Secrets), and GitHub Actions secrets for workflows. Never in the repo, a chat, or a command line. Paste at the prompt: `gh secret set NAME --repo defaultdave/ramble`.
3. `src/server/env.ts` validates every variable at start-up (SET-18, SET-19). A missing or malformed value fails the deploy, not a customer.
4. After any rotation, note in your own records the date and why. Do not paste the value.

## If a scanner finds a secret

gitleaks failing a PR, or GitHub push protection blocking a push, means treat the value as compromised, even in a private branch. Rotate it using its section below, then remove it from the branch. Rewriting history is optional once the value is dead.

## The secrets

### CAPABILITY_TOKEN_SECRET

- **Source:** design doc 4.2.3 (capability-token amendment, accepted 2026-10-19); ADR 0002, Security data rules.
- **What it does:** HMAC key behind every manage, gift, and order link. Whoever holds it can cancel any booking or redeem any gift.
- **Lives in:** Vercel, Secret type, all environments.
- **Rotated by:** Dave.
- **How:** generate 32 random bytes (`openssl rand -base64 32`), set it in Vercel, deploy, then run the re-hash of stored hashes (built in U-015 and U-017), then resend links to upcoming bookings and to delivered, unredeemed gifts. The step-by-step version with a rehearsal is owned by the operations runbooks unit (U-099); follow that page when it exists.
- **What breaks:** every link already emailed stops working until the re-hash and resend finish. Do it at a quiet hour, not during the newsletter send.

### Neon database URLs

- **Source:** ADR 0002, Data operations (pooled host for the app, direct host for migrations and dumps).
- **Lives in:** Vercel (pooled and direct URLs), GitHub Actions (the hourly `pg_dump` workflow, and `NIGHTLY_DATABASE_URL` for the overnight race tests, merge-desk runbook C4).
- **Rotated by:** Dave.
- **How:** in the Neon console reset the password of the app role (and of the nightly branch's role). Update the Vercel variables and each GitHub secret that holds a URL, redeploy, and re-run the dump workflow once by hand.
- **What breaks:** the moment the password resets, running connections and the dump and nightly workflows fail until their copies are updated. Update all copies within minutes.

### Stripe sandbox keys and webhook signing secret

- **Source:** ADR 0003, Recommendation items 8 and 10 and "Demo on a Stripe sandbox" (Dave creates the Stripe account and sandbox; secrets server-only; webhook route verifies the signature on the raw body, design doc 4.2.3 webhook intake).
- **Variable names:** not fixed in the plan. Record them here when the payments unit picks them.
- **Lives in:** Vercel, Secret type. Sandbox keys only in the demo; no live key exists (ADR 0003, status line).
- **Rotated by:** Dave.
- **How:** in the Stripe dashboard (sandbox) roll the secret key, choosing an expiry for the old key if offered; update Vercel; deploy. For the webhook, roll the endpoint's signing secret with the overlap Stripe offers, update Vercel, deploy, then let the old secret expire.
- **What breaks:** payments fail from the moment the old key dies. Webhooks fail signature checks if only one side changed; the `provider_events` retry and the daily reconciliation (design doc) pick up what was missed.
- **Real job:** a live key is a different, more serious secret. Rotate on staff changes and after any suspected leak, and keep it out of agent sessions.

### Cron and pulse trigger secret

- **Source:** ADR 0007 (one demo pulse every 30 minutes from a scheduled GitHub Actions workflow; protected manual trigger; `/api/pulse` is "signed or secret", design doc route table).
- **Variable name:** not fixed in the plan.
- **Lives in:** Vercel (checked by the route) and GitHub Actions (sent by the workflow).
- **Rotated by:** Dave.
- **How:** make a new random value, set it in both places, deploy. Do the Vercel side first and the GitHub side second, within a few minutes.
- **What breaks:** pulses are rejected in the gap between the two updates. The next 30-minute pulse catches up; use the manual trigger if you cannot wait.

### Dev mailbox shared secret and email webhook secret

- **Source:** units.yaml U-006 (dev mailbox page and `/api/webhooks/email` refuse unauthenticated requests; shared secret checked on the server; webhook checks its signature or secret); U-073 later moves the mailbox behind the ops role.
- **Variable names:** not fixed in the plan.
- **Lives in:** Vercel, Secret type. The webhook secret also lives in the email vendor's dashboard.
- **Rotated by:** Dave.
- **How:** new value in Vercel, deploy; for the webhook, change it in the vendor dashboard at the same time.
- **What breaks:** the mailbox page locks you out until you use the new secret; delivery webhooks fail until both sides match.

### Resend API key (real job only)

- **Source:** design doc ports table (EmailPort: fake with dev mailbox in the demo, Resend in the real job); ADR 0007 Tier B.
- **Lives in:** Vercel, Secret type.
- **Rotated by:** the account owner (Dave in the demo, the client later).
- **How:** create a second API key in the Resend dashboard, update Vercel, deploy, delete the old key.
- **What breaks:** email sends fail between revoking and deploying. The demo does not use it.

### Cloudflare R2 credentials

- **Source:** ADR 0002 (hourly `pg_dump` to R2; nightly audit-log export to locked storage on the R2 free tier).
- **Lives in:** GitHub Actions secrets (dump workflow) and Vercel (audit export job), when those units land.
- **Rotated by:** Dave.
- **How:** create a new R2 API token with the same bucket scope, update both places, run the dump once by hand, then delete the old token.
- **What breaks:** dumps and audit exports fail until updated. A missed hour is within the PRD-75 one-hour loss limit, so do not let it run past an hour.

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
- **How:** on the App page, Generate a private key, move the new `.pem` over `app-key.pem` with mode 600 as in A2, confirm `scripts/merge-desk/app-token.ts` still mints a token, then delete the old key on the App page.
- **What breaks:** agents cannot push, open PRs, or post checks while the key is wrong. Humans can still merge with bypass.

## Checklist for Dave

These are account and repo settings. No agent can or should do them.

### MFA on vendor accounts (ADR 0007, "MFA on every vendor account")

Turn on two-factor authentication, with a passkey or an authenticator app rather than SMS, and store recovery codes in your password manager. Tick each when the account exists and is done.

- [ ] GitHub (`defaultdave`)
- [ ] Vercel
- [ ] Neon
- [ ] Stripe (when you create the sandbox account, ADR 0003)
- [ ] Cloudflare (for R2)
- [ ] Sentry
- [ ] Better Stack
- [ ] Axiom
- [ ] Resend (real job only)
- [ ] The email account that receives every vendor's recovery mail
- [ ] The domain registrar, when a domain is bought (none for the demo, ADR 0007 D3)

### Repository settings (the repo is public, so these are free)

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
