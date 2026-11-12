# Granting a role from the command line

The first ops account in a database that has not been seeded is made here. After that, ops staff
invite each other from `/ops/staff`.

```sh
pnpm db:grant-role --email you@example.com --role ops
pnpm db:grant-role --email you@example.com --role admin
pnpm db:grant-role --email owner@example.com --role host_owner --host <host id>
```

- It reads `DATABASE_URL`, so check which database that is before you run it.
- It makes the account if the address has none, and gives the role once. A role already held says
  so and changes nothing. Each grant writes a `role.granted` audit row with the system as the actor.
- Ops and admin take no `--host`; the host roles require one.
- It sends no email. The person signs in with a link from `/sign-in`, or an ops user sends one from
  `/ops/staff`.
- Admin is granted and removed only here. The staff page cannot make or remove an admin.
- The ops area admits the ops role only, so the first account needs `--role ops`.
