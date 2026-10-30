import { paymentWebhookResponse } from '@/server/paymentWebhook';

export function POST(request: Request) {
  return paymentWebhookResponse(request);
}
