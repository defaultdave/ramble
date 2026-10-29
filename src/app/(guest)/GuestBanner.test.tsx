import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestBanner } from './GuestBanner';

// Behaviours under test, one per decision, branch or risk:
// - a failed read renders nothing and logs only the digest and kind, never the message, query, or values
// - a framework control-flow error is rethrown and not logged
// - a failed read without a digest logs its kind alone
// - blank or missing banner text renders nothing
// - set banner text renders the text as the site notice

const server = vi.hoisted(() => ({ settings: vi.fn(), logError: vi.fn() }));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/server/siteSettings', () => ({
  getCachedGuestSettings: server.settings,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GuestBanner', () => {
  it('renders nothing for a failed read and logs only its digest and kind', async () => {
    server.settings.mockRejectedValue(
      Object.assign(
        new Error('Failed query: select ... params: secret-value'),
        { digest: '7654321' },
      ),
    );

    const { container } = render(await GuestBanner());

    expect(container).toBeEmptyDOMElement();
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The site banner could not be read',
      { digest: '7654321', kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
  });

  it('logs the kind alone for a failed read that carries no digest', async () => {
    server.settings.mockRejectedValue(new RangeError('secret-value'));

    const { container } = render(await GuestBanner());

    expect(container).toBeEmptyDOMElement();
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The site banner could not be read',
      { digest: undefined, kind: 'RangeError' },
    );
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.settings.mockImplementation(() => {
      notFound();
    });

    await expect(GuestBanner()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });

  it.each([
    ['blank text', '   '],
    ['no text', null],
  ])('renders nothing for %s', async (_name, bannerText) => {
    server.settings.mockResolvedValue({ bannerText });

    const { container } = render(await GuestBanner());

    expect(container).toBeEmptyDOMElement();
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('renders the text that is set', async () => {
    server.settings.mockResolvedValue({
      bannerText: 'Kayak trips are closed for the storm',
    });

    render(await GuestBanner());

    expect(
      screen.getByRole('region', { name: 'Site notice' }),
    ).toHaveTextContent('Kayak trips are closed for the storm');
  });
});
