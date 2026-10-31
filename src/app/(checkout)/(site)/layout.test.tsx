import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SiteLayout from './layout';

// Behaviours under test, one per decision, branch or risk. Each asserts what the guest frame renders and the
// old stand-in frame did not, so putting the stand-in back fails them:
// - the header carries the home link, the main navigation, and the search link
// - the footer carries its navigation of page groups
// - the page sits in the one main landmark, reached by the skip link

function renderPage() {
  render(
    <SiteLayout>
      <h1>Booking RMB-A3K7MN</h1>
    </SiteLayout>,
  );
}

describe('the checkout group site layout', () => {
  it('puts the home link, main navigation, and search link in the header', () => {
    renderPage();
    const header = screen.getByRole('banner');

    expect(
      within(header).getByRole('link', { name: 'Ramble home' }),
    ).toHaveAttribute('href', '/');
    expect(
      within(
        within(header).getByRole('navigation', { name: 'Main' }),
      ).getByRole('link', { name: 'Things to do' }),
    ).toHaveAttribute('href', '/new-york/browse');
    expect(
      within(header).getByRole('link', { name: /^Search:/ }),
    ).toHaveAttribute('href', '/new-york/browse?guests=2');
  });

  it('puts the footer navigation in the footer', () => {
    renderPage();
    const footer = screen.getByRole('contentinfo');

    expect(
      within(
        within(footer).getByRole('navigation', { name: 'Footer' }),
      ).getByRole('link', { name: 'Terms' }),
    ).toBeInTheDocument();
  });

  it('holds the page in the one main landmark that the skip link reaches', () => {
    renderPage();

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Booking RMB-A3K7MN' }),
    );
  });
});
