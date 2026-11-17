import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDriverError } from '../../../../../tests/support/driverError';
import { id } from '../../../../../tests/support/fixtures/experience';
import { HostContent } from './HostContent';

// Behaviours under test, one per decision, branch or risk:
// - an unknown host is a not-found
// - a host renders one h1 with their name, the about text, the experiences as links, and the cancellation terms, in that order
// - a host with no live experiences shows the empty state and no cancellation section
// - a host with no about text has no About section
// - terms that differ are listed per experience
// - a failed read logs only the digest and kind and renders the error state, which retries at the page's own address
// - a framework control-flow error is rethrown and not logged

const server = vi.hoisted(() => ({ page: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/hostPage', () => ({ getHostPage: server.page }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));

const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;
const driverError = makeDriverError('secret-id', { withCause: true });

const tier = (hours: number) => ({
  id: id(20 + hours),
  key: `t${String(hours)}`,
  name: 'Tier',
  fullRefundHoursBefore: hours,
  isDefault: false,
});
const experience = (n: number) => ({
  id: id(n),
  slug: `kayak-${String(n)}`,
  name: `Kayak ${String(n)}`,
  status: 'live' as const,
  neighborhoodName: 'Tribeca',
  durationMinutes: 120,
  linkOutUrl: null,
  priceOptions: [{ priceMinor: 6500, usesSpace: true }],
  image: null,
});
const page = (
  hours: number[] = [24],
  description: string | null = 'Six guides.',
) => ({
  host: {
    id: id(2),
    slug: 'hudson-paddle-club',
    name: 'Hudson Paddle Club',
    description,
  },
  experiences: hours.map((_, index) => experience(index + 1)),
  tiers: hours.map((h, index) => ({
    experienceId: id(index + 1),
    tier: tier(h),
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue(page());
});

describe('the host content', () => {
  it('is a not-found for a host nobody has', async () => {
    server.page.mockResolvedValue(null);

    await expect(HostContent({ slug: 'nobody' })).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('renders the name, the about text, the experiences, and the terms under their headings', async () => {
    render(await HostContent({ slug: 'hudson-paddle-club' }));

    expect(server.page).toHaveBeenCalledExactlyOnceWith('hudson-paddle-club');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Hudson Paddle Club',
    );
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['About', 'Experiences', 'Kayak 1', 'Cancellation']);
    expect(screen.getByRole('region', { name: 'About' })).toHaveTextContent(
      'Six guides.',
    );
    expect(
      within(screen.getByRole('region', { name: 'Experiences' })).getByRole(
        'link',
        { name: /Kayak 1/ },
      ),
    ).toHaveAttribute('href', `/experiences/kayak-1-${id(1)}`);
    expect(
      screen.getByRole('region', { name: 'Cancellation' }),
    ).toHaveTextContent('Free cancellation up to 24 hours before start.');
  });

  it('shows the empty state, and no cancellation section, for a host with nothing live', async () => {
    server.page.mockResolvedValue({ ...page([]), experiences: [], tiers: [] });

    render(await HostContent({ slug: 'hudson-paddle-club' }));

    expect(
      screen.getByRole('heading', { name: 'Nothing here yet' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Cancellation' }),
    ).not.toBeInTheDocument();
  });

  it('has no About section for a host with no about text', async () => {
    server.page.mockResolvedValue(page([24], null));

    render(await HostContent({ slug: 'hudson-paddle-club' }));

    expect(
      screen.queryByRole('region', { name: 'About' }),
    ).not.toBeInTheDocument();
  });

  it('lists the terms per experience when they differ', async () => {
    server.page.mockResolvedValue(page([24, 48]));

    render(await HostContent({ slug: 'hudson-paddle-club' }));

    const items = within(
      screen.getByRole('region', { name: 'Cancellation' }),
    ).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Kayak 1: Free cancellation up to 24 hours before',
      'Kayak 2: Free cancellation up to 2 days before',
    ]);
  });

  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.page.mockRejectedValue(driverError);

    render(await HostContent({ slug: 'hudson-paddle-club' }));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The host page could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this host",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/hosts/hudson-paddle-club');
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.page.mockImplementation(() => {
      notFound();
    });

    await expect(
      HostContent({ slug: 'hudson-paddle-club' }),
    ).rejects.toMatchObject({
      digest: notFoundDigest,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });
});
