import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { maxProviderMessageIdLength } from '@/lib/email/message';
import { secureEqual } from '@/server/secureEqual';
import type { EmailAdapter } from './types';
import { parseWebhookBody } from './wire';

const FakeEventSchema = z.object({
  messageId: z.string().min(1).max(maxProviderMessageIdLength),
  event: z.enum(['delivered', 'hard_bounce', 'complaint']),
});

/**
 * Sends nothing: the wrapper keeps the rendered message in the log, and that row is the dev mailbox.
 * Its webhook takes `Authorization: Bearer <secret>` and `{ messageId, event }`, so the bounce and
 * suppression path can be driven by hand in development.
 */
export function createFakeAdapter(
  webhookSecret: string | undefined,
): EmailAdapter {
  return {
    name: 'fake',
    send: () => Promise.resolve({ providerMessageId: `fake-${randomUUID()}` }),
    verifyWebhook: ({ headers }) => {
      const presented = /^Bearer (.+)$/.exec(
        headers.get('authorization') ?? '',
      );
      return (
        webhookSecret !== undefined &&
        presented?.[1] !== undefined &&
        secureEqual(presented[1], webhookSecret)
      );
    },
    parseWebhook: (rawBody) => {
      const { messageId, event } = parseWebhookBody(
        'fake',
        FakeEventSchema,
        rawBody,
      );
      return { providerMessageId: messageId, kind: event };
    },
  };
}
