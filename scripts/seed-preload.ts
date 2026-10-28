// Preloaded by `pnpm db:seed` (bun --preload). The data layer imports two things that only work
// inside Next.js: `server-only`, which throws anywhere else, and `next/cache`, whose `updateTag`
// throws outside a Server Action. The seed runs outside Next.js, so both are replaced here. Nothing
// is cached in this process, so the no-op invalidation loses nothing; a running deployment keeps
// serving its cached pages until they expire or it is redeployed (docs/runbooks/seed.md).
import { plugin } from "bun";

plugin({
  name: "seed-outside-next",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
    build.module("next/cache", () => ({
      exports: {
        updateTag() {},
        revalidateTag() {},
      },
      loader: "object",
    }));
  },
});
