import 'server-only';
import { logger } from './logger';

const heartbeatTimeoutMs = 5000;

export type HeartbeatResult = 'sent' | 'skipped' | 'failed';

/**
 * One GET to the Better Stack heartbeat URL, with a 5-second timeout. With no URL it does
 * nothing. A failure is logged and returned, never thrown: a monitor that is down must not fail
 * the work it watches. The URL carries a token, so it and the error message stay out of the log.
 */
export async function sendHeartbeat(
  url: string | undefined,
): Promise<HeartbeatResult> {
  if (!url) return 'skipped';
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(heartbeatTimeoutMs),
    });
    if (!response.ok) {
      logger.warn('heartbeat refused', { status: response.status });
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    logger.warn('heartbeat failed', {
      errorName: error instanceof Error ? error.name : 'NonError',
    });
    return 'failed';
  }
}
