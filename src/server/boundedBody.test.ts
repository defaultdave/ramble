import { describe, expect, it } from 'vitest';
import { readBodyText } from './boundedBody';

// Behaviours under test, one per branch:
// - no body reads as empty text
// - a body at the limit is read whole, and one byte over is cut off and flagged
// - a body split across chunks is reassembled, including a character cut between chunks
// - the stream is cancelled once the limit is passed

function streamOf(...chunks: Uint8Array[]) {
  let cancelled = false;
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      // Chunks are handed out on demand, so the stream is still open when the reader gives up.
      pull(controller) {
        const chunk = chunks[next];
        next += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, wasCancelled: () => cancelled };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('readBodyText', () => {
  it('reads no body as empty', async () => {
    expect(await readBodyText({ body: null }, 10)).toEqual({
      text: '',
      exceeded: false,
    });
  });

  it('reads a body of exactly the limit whole', async () => {
    const { body } = streamOf(bytes('abcde'));

    expect(await readBodyText({ body }, 5)).toEqual({
      text: 'abcde',
      exceeded: false,
    });
  });

  it('cuts off a body one byte over and cancels the stream', async () => {
    const { body, wasCancelled } = streamOf(bytes('abc'), bytes('def'));

    const result = await readBodyText({ body }, 5);

    expect(result).toEqual({ text: 'abc', exceeded: true });
    expect(wasCancelled()).toBe(true);
  });

  it('reassembles chunks, including a character split between two', async () => {
    const euro = bytes('€');
    const { body } = streamOf(
      bytes('a'),
      euro.slice(0, 1),
      euro.slice(1),
      bytes('b'),
    );

    expect(await readBodyText({ body }, 100)).toEqual({
      text: 'a€b',
      exceeded: false,
    });
  });
});
