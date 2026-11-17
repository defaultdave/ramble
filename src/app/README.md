# Page maps

Each route tree under `src/app` has a README beside its code that maps how its pages are built: every component from the layouts down, marked as rendered on the server, a cached read, streamed behind a Suspense boundary, or a client island, with the server actions and reads each part uses and how its caches are cleared.

A PR that changes a page's tree (a component, a Suspense or client boundary, a cache tag, an action) updates that tree's README in the same PR. Each README names the commit it was last read from.

There is no `src/app/layout.tsx`. Each route group's own layout draws `<html>`.

| Tree | Routes | Map |
| --- | --- | --- |
| Guest area | `/`, `/help`, `/legal`, `/contact`, `/accessibility`, `/picks`, `/guide`, `/hosts`, `/gifts`, private sessions, not-found pages | [`(guest)/README.md`](<(guest)/README.md>) |
| Browse | `/new-york/browse`, `/new-york/neighborhoods/[neighborhood]`, `/new-york/things-to-do/[category]` | [`(guest)/new-york/README.md`](<(guest)/new-york/README.md>) |
| Experience page | `/experiences/[slugAndId]` | [`(guest)/experiences/[slugAndId]/README.md`](<(guest)/experiences/[slugAndId]/README.md>) |
| Sign-in and account | `/sign-in`, `/sign-in/confirm`, `/account` | [`(guest)/sign-in/README.md`](<(guest)/sign-in/README.md>) |
| Checkout | `/checkout/[holdId]` | [`(checkout)/checkout/README.md`](<(checkout)/checkout/README.md>) |
| Confirmation, manage and review | `/orders/[reference]`, `/manage/[token]`, `/review/[reference]/[token]` | [`(checkout)/(site)/README.md`](<(checkout)/(site)/README.md>) |
| Host area | `/host/*` | [`(host)/README.md`](<(host)/README.md>) |
| Ops area | `/ops/*` | [`(ops)/README.md`](<(ops)/README.md>) |

Rendered views of the same maps: https://defaultdave.github.io/ramble-pm/maps/
