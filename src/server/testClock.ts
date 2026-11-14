import 'server-only';
import { cookies } from 'next/headers';
import {
  devClockCookieMaxAgeSeconds,
  devClockCookieName,
  opsDevPath,
  parseStoredClock,
} from '@/lib/opsDev';
import { env } from '@/server/env';

// The test time lives in the tester's own cookie: the server has no memory between requests on a
// serverless host, and a cookie needs no table. It reaches only the console's runs, which pass it
// to the drain the way the pulse route passes its `asOf`.

/** The test time the tester has set, or undefined for the real one. */
export async function readTestClock(): Promise<Date | undefined> {
  const stored = (await cookies()).get(devClockCookieName)?.value;
  return parseStoredClock(stored) ?? undefined;
}

/** Keeps `at` as the test time, or forgets it when `at` is null. */
export async function writeTestClock(at: Date | null): Promise<void> {
  const jar = await cookies();
  if (at === null) {
    jar.delete({ name: devClockCookieName, path: opsDevPath });
    return;
  }
  jar.set(devClockCookieName, at.toISOString(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: opsDevPath,
    maxAge: devClockCookieMaxAgeSeconds,
  });
}
