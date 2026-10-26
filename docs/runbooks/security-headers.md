# Security headers and CSP

How every response is hardened, and what to do when a page needs something the policy refuses. The decisions are in ADR 0007 (security at the edge) and `stack-decisions.md` (SEC-10); the evidence is the [Cache Components spike](../adr/research/u-008a-u-009-cache-components-spike.md).

## Two tiers

| Routes | Header | Why |
|---|---|---|
| Fully dynamic trees: `/checkout`, `/gift`, `/gifts/checkout`, `/manage`, `/orders`, `/host`, `/ops` | `Content-Security-Policy` with a per-request nonce and `'strict-dynamic'` | Their root layouts set `export const instant = false`, so every script tag renders per request and carries the nonce |
| Everything else (cached and partially prerendered) | `Content-Security-Policy-Report-Only`, no nonce, `'unsafe-inline'` scripts | The prerendered shell's inline bootstrap scripts have no nonce; a nonce there would make the route dynamic |

Both tiers live in `src/lib/securityHeaders.ts`. `src/proxy.ts` picks one by path and, on the enforced tier, also puts the policy on the *request* so Next.js can read the nonce and stamp its scripts. `tests/security-headers.test.ts` fails when a page's tier disagrees with its layout's `instant` setting.

`instant = false` only permits a route to render per request; a tree that reads nothing from the request is still prerendered, without a nonce. So each dynamic group's root layout renders `<RenderPerRequest />` (`src/app/renderPerRequest.tsx`), a sibling of the page that awaits `connection()`. Routes without params build as `ƒ`; routes with params build as `◐` with an empty shell and emit every script at request time, which is what matters.

**Not-found status in these trees.** A `notFound()` thrown before the request is read is captured at build as a static 404 shell whose scripts have no nonce, so the catch-all pages call `notFoundPerRequest()` instead. The page then renders with the nonce, but the status is 200: a render resumed from the route's empty shell cannot change it. Real pages in these trees that decide "not found" after a database read behave the same way. The guest group's catch-all keeps its static 404. `e2e/routes.ts` records the expected status per group. Because of this, a rate limit, a token-guess alert, or a monitor must key on the outcome in code (the `notFound()` call, the failed token lookup), never on the response status.

**Every path under a dynamic prefix needs a page in that group.** A path that no page in the group serves falls through to the guest catch-all, which is prerendered: its shell has no nonce and the enforcing header blocks every script. So each prefix has a bare page (`/checkout`, `/manage`, ...) and a `[...unknown]` catch-all beside each `[param]` segment, all calling `notFoundPerRequest()`. The drift guard resolves `prefix`, `prefix/a`, and `prefix/a/b/c` against `src/app` the way Next.js does and fails when any lands outside a per-request group.

**What carries no policy.** A request with `Purpose: prefetch` or `next-router-prefetch` gets no policy and no nonce: the proxy only strips any client-sent `Content-Security-Policy` header from it (Next.js would otherwise take a nonce from that header) and passes it through. A document fetched with that header is served without CSP; Next.js answers such a request with `Cache-Control: no-store`, so nothing stores it as a page. Redirects (308 for a trailing slash, 307 from a page) carry none of the headers either: neither `next.config.ts` headers nor the proxy's run on a response Next.js emits before rendering.

The static set (HSTS, `nosniff`, referrer policy, `X-Frame-Options`, a permissions policy, COOP, CORP) is applied by `next.config.ts` to every path, static assets included.

## When a page needs a new origin

1. Add the origin to the one directive that needs it in `src/lib/securityHeaders.ts`, on the tier that needs it. Checkout stays first-party: no third-party tags there (ADR 0003, ADR 0007).
2. Update `src/lib/securityHeaders.test.ts`.
3. Run `pnpm e2e`: the security spec fails on any `securitypolicyviolation` event, on either tier.

An inline `<script>` on a dynamic route must carry the nonce. Read it with `(await headers()).get('content-security-policy')` inside that route group only, never in shared code.

## Where violations show

The report-only tier has no report endpoint yet, so violations appear only in the browser console (`[Report Only]` in Chromium). Open a cached page with devtools after touching anything that loads a script, style, image, or font.

## security.txt

`public/.well-known/security.txt` follows RFC 9116. Its `Expires` must stay in the future: the unit test fails once it has passed, which is the prompt to review the contact and renew the date for at most another year.
