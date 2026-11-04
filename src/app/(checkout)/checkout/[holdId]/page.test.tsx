import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutRoute from './page';

// Behaviours under test, one per decision, branch or risk:
// - a successful read renders the page and logs nothing
// - the framework ending a prerender inside a driver error is rethrown and not logged
// - a real read failure logs only the kind and renders the retry view
// - a malformed id, a browser with no device, and a missing hold render the not-found notice as JSX, not a thrown notFound
// - a malformed id and a browser with no device are refused before anything is read
// - arriving from a re-hold asks the page to focus its heading

const server = vi.hoisted(() => ({
  device: vi.fn(),
  view: vi.fn(),
  settings: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/device', () => ({ readDevice: server.device }));
vi.mock('@/server/db/checkoutView', () => ({ readCheckoutView: server.view }));
vi.mock('@/server/siteSettings', () => ({
  getCachedGuestSettings: server.settings,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('@/server/actions/checkout', () => ({ startPayment: vi.fn() }));
vi.mock('@/server/actions/fakePayment', () => ({
  confirmFakePayment: vi.fn(),
}));
vi.mock('@/server/actions/rehold', () => ({ reholdSpaces: vi.fn() }));

const holdId = '0b8f6c4e-2d1a-4f33-9a77-5d1e3c9b7a10';
const props = (id: string, search: Record<string, string> = {}) => ({
  params: Promise.resolve({ holdId: id }),
  searchParams: Promise.resolve(search),
});
const view = { holdId } as never;

function propsOf(element: unknown): Record<string, unknown> {
  return (element as { props: Record<string, unknown> }).props;
}

beforeEach(() => {
  vi.clearAllMocks();
  server.device.mockResolvedValue({ deviceKey: 'k' });
  server.view.mockResolvedValue({ status: 'ok', view });
  server.settings.mockResolvedValue({ checkoutMaintenance: false });
});

describe('the checkout route', () => {
  it('renders the page for a readable hold and logs nothing', async () => {
    const element = await CheckoutRoute(props(holdId));

    expect(propsOf(element)).toMatchObject({
      view,
      maintenance: false,
      focusTitle: false,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('asks the page to focus its heading when the guest holds again', async () => {
    const element = await CheckoutRoute(props(holdId, { rehold: '1' }));
    expect(propsOf(element)).toMatchObject({ focusTitle: true });
  });

  it('rethrows the end of a prerender, wrapped by the driver, and logs nothing', async () => {
    const ended = new Error('Failed query: select 1', {
      cause: new Error(
        'During prerendering, fetch() rejects when the prerender is complete.',
      ),
    });
    server.view.mockRejectedValue(ended);

    await expect(CheckoutRoute(props(holdId))).rejects.toBe(ended);
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('logs only the kind of a failed read, and renders the retry view', async () => {
    server.view.mockRejectedValue(
      Object.assign(new Error('Failed query: select ... params: secret'), {}),
    );

    const element = await CheckoutRoute(props(holdId));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The checkout page could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(element)).toContain('We couldn');
  });

  it.each([
    ['a malformed id', 'not-a-uuid', null],
    ['a browser with no device', holdId, 'no-device'],
    ['a hold that is missing', holdId, 'no-hold'],
  ])('renders the not-found notice for %s', async (_name, id, cause) => {
    if (cause === 'no-device') server.device.mockResolvedValue(null);
    if (cause === 'no-hold') server.view.mockResolvedValue(null);

    const element = await CheckoutRoute(props(id));

    // Returned, not thrown, so the first flush carries the heading and the stylesheet.
    render(element);
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: "We can't find that page",
      }),
    ).toBeInTheDocument();
  });

  it('reads nothing for a malformed id or a browser with no device', async () => {
    await CheckoutRoute(props('not-a-uuid'));
    expect(server.device).not.toHaveBeenCalled();

    server.device.mockResolvedValue(null);
    await CheckoutRoute(props(holdId));
    expect(server.view).not.toHaveBeenCalled();
  });
});
