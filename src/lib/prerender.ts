/** What Next.js says when work started in a prerender is still running as the prerender ends. */
const prerenderEnded = 'During prerendering,';

/** How far down `cause` to look: a driver wraps the framework's error once or twice. */
const maxCauseDepth = 3;

/**
 * Whether an error is the framework ending a prerender, such as a `fetch()` that rejects when the
 * prerender is complete (design: Next.js handles these itself). A database driver wraps that error
 * in its own, so `unstable_rethrow` does not see it; the message is found down the `cause` chain.
 * Such an error is not a failed read and must pass through a page's catch.
 */
export function isPrerenderEnd(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= maxCauseDepth; depth += 1) {
    if (!(current instanceof Error)) return false;
    if (current.message.includes(prerenderEnded)) return true;
    current = current.cause;
  }
  return false;
}
