/** Runs once when the server starts, so a bad environment fails at boot, not on the first request. */
export async function register() {
  await import('@/server/env');
}
