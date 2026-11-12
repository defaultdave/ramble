// `pnpm db:grant-role --email <address> --role <role> [--host <id>]`. All the work and every
// decision is in src/server/auth/grantRoleCli.ts and src/lib/grantRoleArgs.ts; this file only hands
// them the arguments and the output.
import { runGrantRole } from "@/server/auth/grantRoleCli";

const code = await runGrantRole({
  argv: process.argv.slice(2),
  write: (line) => {
    console.log(line);
  },
});
process.exit(code);
