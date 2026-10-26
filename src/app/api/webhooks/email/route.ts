import { receiveDeliveryWebhook } from '@/server/ports/email/webhook';

// TODO(U-005): read the clock port.
export async function POST(request: Request) {
  const result = await receiveDeliveryWebhook(
    request,
    Math.floor(Date.now() / 1000),
  );
  return new Response(null, {
    status: result.status,
    ...(result.status === 429
      ? { headers: { 'retry-after': String(result.retryAfterSeconds) } }
      : {}),
  });
}
