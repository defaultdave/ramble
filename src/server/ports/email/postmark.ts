import 'server-only';
import { z } from 'zod';
import { maxProviderMessageIdLength } from '@/lib/email/message';
import { secureEqual } from '@/server/secureEqual';
import { EmailProviderError } from './errors';
import type { EmailAdapter } from './types';
import { parseSendResponse, parseWebhookBody, postJson } from './wire';

const endpoint = 'https://api.postmarkapp.com/email';

const SendResponseSchema = z.object({
  MessageID: z.string().min(1).max(maxProviderMessageIdLength),
  ErrorCode: z.number(),
  Message: z.string().optional(),
});

const RecordTypeSchema = z.object({ RecordType: z.string() });

const EventSchema = z.object({
  MessageID: z.string().min(1).max(maxProviderMessageIdLength),
  Type: z.string().optional(),
});

/**
 * The spare provider, written against Postmark's documented HTTP API (POST /email, server token
 * header). Postmark has no idempotency header, so a retry after an ambiguous failure can deliver
 * twice; Resend is the default for that reason. Its webhooks carry no signature: they authenticate
 * with the HTTP basic-auth password configured on the webhook URL.
 */
export function createPostmarkAdapter(options: {
  serverToken: string;
  webhookSecret: string;
}): EmailAdapter {
  return {
    name: 'postmark',
    send: async (email) => {
      const body = await postJson({
        adapter: 'postmark',
        url: endpoint,
        headers: { 'x-postmark-server-token': options.serverToken },
        body: {
          From: email.from,
          To: email.to,
          ReplyTo: email.replyTo,
          Subject: email.subject,
          HtmlBody: email.html,
          TextBody: email.text,
          MessageStream: 'outbound',
        },
      });
      const parsed = parseSendResponse('postmark', SendResponseSchema, body);
      if (parsed.ErrorCode !== 0) {
        throw new EmailProviderError(
          'postmark',
          `error ${String(parsed.ErrorCode)}`,
          { retryable: false },
        );
      }
      return { providerMessageId: parsed.MessageID };
    },
    verifyWebhook: ({ headers }) => {
      const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(
        headers.get('authorization') ?? '',
      );
      if (!basic?.[1]) return false;
      const credentials = Buffer.from(basic[1], 'base64').toString('utf8');
      const password = credentials.slice(credentials.indexOf(':') + 1);
      return secureEqual(password, options.webhookSecret);
    },
    parseWebhook: (rawBody) => {
      const { RecordType } = parseWebhookBody(
        'postmark',
        RecordTypeSchema,
        rawBody,
      );
      switch (RecordType) {
        case 'Delivery':
          return {
            providerMessageId: parseWebhookBody(
              'postmark',
              EventSchema,
              rawBody,
            ).MessageID,
            kind: 'delivered',
          };
        case 'SpamComplaint':
          return {
            providerMessageId: parseWebhookBody(
              'postmark',
              EventSchema,
              rawBody,
            ).MessageID,
            kind: 'complaint',
          };
        case 'Bounce': {
          const event = parseWebhookBody('postmark', EventSchema, rawBody);
          return event.Type === 'HardBounce' || event.Type === 'BadEmailAddress'
            ? { providerMessageId: event.MessageID, kind: 'hard_bounce' }
            : null;
        }
        default:
          return null;
      }
    },
  };
}
