import 'server-only';

/**
 * Reads a request or response body as text, stopping at `maxBytes`. Past the limit the stream is
 * cancelled and `exceeded` is true, so a hostile or broken peer cannot make the server hold more.
 */
export async function readBodyText(
  source: { body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<{ text: string; exceeded: boolean }> {
  if (!source.body) return { text: '', exceeded: false };

  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { text, exceeded: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), exceeded: false };
}
