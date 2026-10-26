import { deliveryWebhookResponse } from '@/server/ports/email/webhook';

// TODO(U-005): read the clock port.
export function POST(request: Request) {
  return deliveryWebhookResponse(request, Math.floor(Date.now() / 1000));
}
