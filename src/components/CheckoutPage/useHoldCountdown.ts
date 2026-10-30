'use client';

import { useEffect, useState } from 'react';
import { holdSecondsRemaining } from '@/lib/holdTimer';

const tickMs = 1000;

/**
 * The time the hold is judged against, kept ticking. The first value is the server's clock, so the
 * server render and the hydrating browser agree; once mounted, the browser's own clock carries on
 * from the server's, so a guest whose clock is wrong still sees the right time left. The tick stops
 * when the hold has run out, and `onEnd` is called once as it does.
 */
export function useHoldCountdown(
  expiresAt: string,
  serverNow: string,
  onEnd: () => void,
): { now: Date; expires: Date } {
  const expires = new Date(expiresAt);
  const [now, setNow] = useState(() => new Date(serverNow));
  const lapsed = holdSecondsRemaining(now, expires) === 0;

  useEffect(() => {
    if (lapsed) return;
    const offset = new Date(serverNow).getTime() - Date.now();
    const timer = setInterval(() => {
      setNow(new Date(Date.now() + offset));
    }, tickMs);
    return () => {
      clearInterval(timer);
    };
  }, [lapsed, serverNow]);

  useEffect(() => {
    if (lapsed) onEnd();
    // `onEnd` is the page's dispatch, which does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapsed]);

  return { now, expires };
}
