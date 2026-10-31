import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SiteLayout from './layout';

// Behaviours under test, one per decision, branch or risk:
// - a page in the group sits inside the guest frame: skip link, header, one main landmark holding the page, and footer
// - the frame carries no site notice, which needs a settings read this group does not make

describe('the checkout group site layout', () => {
  it('frames the page with the guest skip link, header, main, and footer', () => {
    render(
      <SiteLayout>
        <h1>Booking RMB-A3K7MN</h1>
      </SiteLayout>,
    );

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Booking RMB-A3K7MN' }),
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('shows no site notice', () => {
    render(
      <SiteLayout>
        <p>page</p>
      </SiteLayout>,
    );

    expect(
      screen.queryByRole('region', { name: 'Site notice' }),
    ).not.toBeInTheDocument();
  });
});
