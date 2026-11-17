import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpsDashboard } from './OpsDashboard';
import { auditRows, busyTiles, quietTiles } from './OpsDashboard.fixtures';

// Behaviours under test:
// - each tile links to its queue and says its count in words
// - a queue with work in it carries the needs-attention badge, and one with none, or one that only informs, does not
// - the recent audit rows list each action with who and when, and link to the audit log
// - with no audit rows the section says so and still links to the log

const glance = () => screen.getByRole('region', { name: 'At a glance' });

describe('OpsDashboard counts', () => {
  it('links each tile to its queue with its count in words', () => {
    render(<OpsDashboard tiles={busyTiles} recentAudit={[]} />);
    const items = within(glance()).getAllByRole('listitem');
    expect(
      items.map((item) => [
        within(item).getByRole('link').textContent,
        within(item).getByRole('link').getAttribute('href'),
        item.textContent,
      ]),
    ).toEqual([
      [
        'Review queue',
        '/ops/review',
        expect.stringContaining('3 experiences waiting for review'),
      ],
      [
        'Refunds that failed',
        '/ops/bookings?status=refund_failed',
        expect.stringContaining('1 booking with a failed refund'),
      ],
      [
        'Support',
        '/ops/support?status=open',
        expect.stringContaining('12 open requests'),
      ],
      [
        'Private requests',
        '/ops/requests',
        expect.stringContaining('7 requests received'),
      ],
      [
        'Sessions today',
        '/ops/sessions',
        expect.stringContaining('5 sessions today'),
      ],
    ]);
  });

  it('marks the three queues with work and not the two that inform', () => {
    render(<OpsDashboard tiles={busyTiles} recentAudit={[]} />);
    const marked = within(glance())
      .getAllByRole('listitem')
      .filter((item) => within(item).queryByText('Needs attention'))
      .map((item) => within(item).getByRole('link').textContent);
    expect(marked).toEqual(['Review queue', 'Refunds that failed', 'Support']);
  });

  it('says zero in words and marks nothing when every queue is empty', () => {
    render(<OpsDashboard tiles={quietTiles} recentAudit={[]} />);
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    for (const text of [
      'Nothing waiting for review',
      'No failed refunds',
      'No open requests',
      'None received yet',
      'No sessions today',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});

describe('OpsDashboard recent activity', () => {
  it('lists each action with who and when, and links to the audit log', () => {
    render(<OpsDashboard tiles={busyTiles} recentAudit={auditRows} />);
    const recent = screen.getByRole('region', { name: 'Recent activity' });
    expect(
      within(recent)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'ops.accessedops 5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10, 2026-11-17 14:02 UTC',
      'support.resolvedops 5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10, 2026-11-17 13:40 UTC',
    ]);
    expect(
      within(recent).getByRole('link', { name: 'Open the audit log' }),
    ).toHaveAttribute('href', '/ops/audit');
  });

  it('says nothing is recorded, and still links to the log, for an empty log', () => {
    render(<OpsDashboard tiles={busyTiles} recentAudit={[]} />);
    const recent = screen.getByRole('region', { name: 'Recent activity' });
    expect(
      within(recent).getByText('Nothing has been recorded yet.'),
    ).toBeInTheDocument();
    expect(within(recent).queryByRole('listitem')).not.toBeInTheDocument();
    expect(
      within(recent).getByRole('link', { name: 'Open the audit log' }),
    ).toBeInTheDocument();
  });
});
