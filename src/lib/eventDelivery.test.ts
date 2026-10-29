import { describe, expect, it } from 'vitest';
import {
  maxDelayMs,
  maxEvents,
  maxRepeats,
  planDeliveries,
} from './eventDelivery';

const events = ['requires_action', 'failed', 'succeeded'];

describe('planDeliveries', () => {
  it('delivers every event once, in the order sent, with no repeats and no delay', () => {
    expect(planDeliveries(events, { seed: 1 })).toEqual([
      { event: 'requires_action', attempt: 0, delayMs: 0, sentIndex: 0 },
      { event: 'failed', attempt: 0, delayMs: 0, sentIndex: 1 },
      { event: 'succeeded', attempt: 0, delayMs: 0, sentIndex: 2 },
    ]);
  });

  it('follows each event with its repeats when nothing is late', () => {
    const plan = planDeliveries(events, { seed: 1, repeats: 2 });
    expect(plan.map((step) => `${step.event}#${String(step.attempt)}`)).toEqual(
      [
        'requires_action#0',
        'requires_action#1',
        'requires_action#2',
        'failed#0',
        'failed#1',
        'failed#2',
        'succeeded#0',
        'succeeded#1',
        'succeeded#2',
      ],
    );
  });

  it('plans the same deliveries for the same seed and different ones for another', () => {
    const options = { repeats: 2, maxDelayMs: 600_000 };
    const first = planDeliveries(events, { seed: 7, ...options });
    expect(planDeliveries(events, { seed: 7, ...options })).toEqual(first);
    expect(planDeliveries(events, { seed: 8, ...options })).not.toEqual(first);
  });

  it('sends the events out of order for some seed once they can be late', () => {
    const reordered = Array.from({ length: 20 }, (_, seed) => seed).some(
      (seed) => {
        const order = planDeliveries(events, { seed, maxDelayMs: 600_000 }).map(
          (step) => step.sentIndex,
        );
        return order.join() !== '0,1,2';
      },
    );
    expect(reordered).toBe(true);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'keeps arrival order, the delay cap, and repeats after the delivery they repeat (seed %i)',
    (seed) => {
      const plan = planDeliveries(events, {
        seed,
        repeats: 3,
        maxDelayMs: 300_000,
      });
      expect(plan).toHaveLength(events.length * 4);
      const delays = plan.map((step) => step.delayMs);
      expect(delays).toEqual([...delays].sort((a, b) => a - b));
      expect(Math.max(...delays)).toBeLessThanOrEqual(300_000);
      for (const sentIndex of [0, 1, 2]) {
        const attempts = plan.filter((step) => step.sentIndex === sentIndex);
        expect(attempts.map((step) => step.attempt)).toEqual([0, 1, 2, 3]);
      }
    },
  );

  it('plans nothing for no events', () => {
    expect(planDeliveries([], { seed: 1, repeats: 5 })).toEqual([]);
  });

  it.each([
    ['a fractional seed', { seed: 1.5 }],
    ['a negative seed', { seed: -1 }],
    ['a seed past 32 bits', { seed: 2 ** 32 }],
    ['negative repeats', { seed: 1, repeats: -1 }],
    ['fractional repeats', { seed: 1, repeats: 0.5 }],
    ['repeats over the cap', { seed: 1, repeats: maxRepeats + 1 }],
    ['a negative delay', { seed: 1, maxDelayMs: -1 }],
    ['a delay over the cap', { seed: 1, maxDelayMs: maxDelayMs + 1 }],
    ['a delay that is not a number', { seed: 1, maxDelayMs: Number.NaN }],
  ])('refuses %s', (_name, options) => {
    expect(() => planDeliveries(events, options)).toThrow(RangeError);
  });

  it('accepts the caps themselves', () => {
    expect(() =>
      planDeliveries(events, {
        seed: 1,
        repeats: maxRepeats,
        maxDelayMs,
      }),
    ).not.toThrow();
  });

  it('refuses more events than the cap and accepts exactly the cap', () => {
    const many = Array.from({ length: maxEvents + 1 }, (_, index) => index);
    expect(() => planDeliveries(many, { seed: 1 })).toThrow(RangeError);
    expect(planDeliveries(many.slice(1), { seed: 1 })).toHaveLength(maxEvents);
  });
});
