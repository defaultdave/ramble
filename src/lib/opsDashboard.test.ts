import { describe, expect, it } from 'vitest';
import { dashboardTiles, type OpsDashboardCounts } from './opsDashboard';

// Behaviours under test:
// - the tiles come in a fixed order, each linking to its queue, with the filter where the queue has one
// - a count of zero says so in words, one is singular, more than one carries the number
// - a queue with work in it needs attention; a count of zero does not, and neither does a tile that only informs

const none: OpsDashboardCounts = {
  inReview: 0,
  refundFailed: 0,
  openSupport: 0,
  privateRequests: 0,
  sessionsToday: 0,
};

const find = (counts: OpsDashboardCounts, id: keyof OpsDashboardCounts) => {
  const tile = dashboardTiles(counts).find((candidate) => candidate.id === id);
  if (!tile) throw new Error(`no tile ${id}`);
  return tile;
};

describe('dashboardTiles', () => {
  it('lists the tiles in order, each to its queue', () => {
    expect(dashboardTiles(none).map((tile) => [tile.label, tile.href])).toEqual(
      [
        ['Review queue', '/ops/review'],
        ['Refunds that failed', '/ops/bookings?status=refund_failed'],
        ['Support', '/ops/support?status=open'],
        ['Private requests', '/ops/requests'],
        ['Sessions today', '/ops/sessions'],
      ],
    );
  });

  it.each([
    ['inReview', 0, 'Nothing waiting for review'],
    ['inReview', 1, '1 experience waiting for review'],
    ['inReview', 4, '4 experiences waiting for review'],
    ['refundFailed', 0, 'No failed refunds'],
    ['refundFailed', 1, '1 booking with a failed refund'],
    ['refundFailed', 2, '2 bookings with a failed refund'],
    ['openSupport', 0, 'No open requests'],
    ['openSupport', 1, '1 open request'],
    ['openSupport', 12, '12 open requests'],
    ['privateRequests', 0, 'None received yet'],
    ['privateRequests', 1, '1 request received'],
    ['privateRequests', 3, '3 requests received'],
    ['sessionsToday', 0, 'No sessions today'],
    ['sessionsToday', 1, '1 session today'],
    ['sessionsToday', 7, '7 sessions today'],
  ] as const)('%s at %i reads "%s"', (id, count, status) => {
    const tile = find({ ...none, [id]: count }, id);
    expect(tile.count).toBe(count);
    expect(tile.status).toBe(status);
  });

  it.each([
    ['inReview', true],
    ['refundFailed', true],
    ['openSupport', true],
    ['privateRequests', false],
    ['sessionsToday', false],
  ] as const)(
    '%s with a count needs attention: %s; at zero it never does',
    (id, attention) => {
      expect(find({ ...none, [id]: 3 }, id).needsAttention).toBe(attention);
      expect(find(none, id).needsAttention).toBe(false);
    },
  );
});
