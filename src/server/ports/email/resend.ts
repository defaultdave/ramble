import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  isFreshTimestamp,
  isPermanentBounce,
  maxProviderMessageIdLength,
  type DeliveryEventKind,
} from '@/lib/email/message';
import { secureEqual } from '@/server/secureEqual';
import type { EmailAdapter } from './types';
import { parseSendResponse, parseWebhookBody, postJson } from './wire';

const endpoint = 'https://api.resend.com/emails';
const maxSignatureHeaderLength = 1000;
const timestampToleranceSeconds = 300;

const SendResponseSchema = z.object({
  id: z.string().min(1).max(maxProviderMessageIdLength),
});

const EventTypeSchema = z.object({ type: z.string() });

const EventSchema = z.object({
  data: z.object({
    email_id: z.string().min(1).max(maxProviderMessageIdLength),
    bounce: z.object({ type: z.string() }).optional(),
  }),
});

const eventKinds: Record<string, DeliveryEventKind | undefined> = {
  'email.delivered': 'delivered',
  'email.bounced': 'hard_bounce',
  'email.complained': 'complaint',
};

/**
 * Written against Resend's documented HTTP API (POST /emails, Idempotency-Key header) and its
 * webhooks, which are signed with Svix: HMAC-SHA256 over `id.timestamp.body` under the `whsec_` secret.
 */
export function createResendAdapter(options: {
  apiKey: string;
  webhookSecret: string;
}): EmailAdapter {
  const signingKey = Buffer.from(
    options.webhookSecret.replace(/^whsec_/, ''),
    'base64',
  );

  return {
    name: 'resend',
    send: async (email) => {
      const body = await postJson({
        adapter: 'resend',
        url: endpoint,
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'idempotency-key': email.idempotencyKey,
        },
        body: {
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          reply_to: email.replyTo,
        },
      });
      const { id } = parseSendResponse('resend', SendResponseSchema, body);
      return { providerMessageId: id };
    },
    verifyWebhook: ({ headers, rawBody, nowSeconds }) => {
      const id = headers.get('svix-id');
      const timestamp = headers.get('svix-timestamp');
      const signatures = headers.get('svix-signature');
      if (!id || !timestamp || !signatures) return false;
      if (signatures.length > maxSignatureHeaderLength) return false;
      if (!/^\d{1,12}$/.test(timestamp)) return false;
      if (
        !isFreshTimestamp(
          Number(timestamp),
          nowSeconds,
          timestampToleranceSeconds,
        )
      )
        return false;

      const expected = createHmac('sha256', signingKey)
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest('base64');
      return signatures.split(' ').some((entry) => {
        const [version, signature] = entry.split(',');
        return (
          version === 'v1' &&
          signature !== undefined &&
          secureEqual(signature, expected)
        );
      });
    },
    parseWebhook: (rawBody) => {
      const { type } = parseWebhookBody('resend', EventTypeSchema, rawBody);
      const kind = eventKinds[type];
      if (!kind) return null;
      const { data } = parseWebhookBody('resend', EventSchema, rawBody);
      // Only a permanent bounce closes the address; a transient one may still be delivered.
      if (
        kind === 'hard_bounce' &&
        !isPermanentBounce('resend', data.bounce?.type)
      ) {
        return null;
      }
      return { providerMessageId: data.email_id, kind };
    },
  };
}
