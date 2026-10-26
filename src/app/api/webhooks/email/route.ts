import { receiveDeliveryWebhook } from '@/server/ports/email/webhook';

// TODO(U-005): read the clock port. TODO(U-008b): consume a rate-limit key before reading the body.
export async function POST(request: Request) {
  const { status } = await receiveDeliveryWebhook(
    request,
    Math.floor(Date.now() / 1000),
  );
  return new Response(null, { status });
}
