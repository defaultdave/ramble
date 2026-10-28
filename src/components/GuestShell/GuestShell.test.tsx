import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GuestShell } from './GuestShell';
import { SiteBanner } from './SiteBanner';
import { SiteMenu } from './SiteMenu';

// Behaviours under test, one per decision, branch or risk:
// - the notice shows its text in a labelled region
// - the menu is closed until opened, opens and closes from its button, and lists its links
// - the shell puts the skip link first, then the notice, the header, the one main landmark, and the footer
// - the shell shows no notice when it is given none
// - the shell's header links search, picks, and gifts to pages, and its footer links only pages that exist

describe('SiteBanner', () => {
  it('shows the notice text in a labelled region', () => {
    render(<SiteBanner text="Closed Monday for weather" />);
    expect(
      within(screen.getByRole('region', { name: 'Site notice' })).getByText(
        'Closed Monday for weather',
      ),
    ).toBeInTheDocument();
  });
});

describe('SiteMenu', () => {
  const links = [
    { label: 'Things to do', href: '/new-york/browse' },
    { label: 'Gift guide', href: '/gifts' },
  ];

  it('is closed until it is opened, and its button is named Menu', () => {
    const { container } = render(<SiteMenu links={links} />);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(
      screen.getByText('Menu', { selector: 'summary span' }),
    ).toBeInTheDocument();
  });

  it('opens and closes from its button', async () => {
    const { container } = render(<SiteMenu links={links} />);
    const details = container.querySelector('details');
    const button = screen.getByText('Menu', { selector: 'summary span' });

    await userEvent.click(button);
    expect(details).toHaveAttribute('open');

    await userEvent.click(button);
    expect(details).not.toHaveAttribute('open');
  });

  it('lists its links', () => {
    render(<SiteMenu links={links} />);
    const nav = screen.getByRole('navigation', {
      name: 'Main menu',
      hidden: true,
    });
    expect(
      within(nav)
        .getAllByRole('link', { hidden: true })
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Things to do', '/new-york/browse'],
      ['Gift guide', '/gifts'],
    ]);
  });
});

describe('GuestShell', () => {
  it('orders the skip link, the notice, the header, the page, and the footer', () => {
    const { container } = render(
      <GuestShell banner={<SiteBanner text="Closed Monday" />}>
        <p>The page</p>
      </GuestShell>,
    );
    const landmarks = [
      ...container.querySelectorAll(
        'a[href="#main"], section, header, main, footer',
      ),
    ].map((element) => element.tagName.toLowerCase());
    expect(landmarks).toEqual(['a', 'section', 'header', 'main', 'footer']);
  });

  it('has one main landmark holding the page, and the skip link points at it', () => {
    render(
      <GuestShell>
        <p>The page</p>
      </GuestShell>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getByText('The page')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main');
  });

  it('shows no notice when it is given none', () => {
    render(
      <GuestShell>
        <p>The page</p>
      </GuestShell>,
    );
    expect(
      screen.queryByRole('region', { name: 'Site notice' }),
    ).not.toBeInTheDocument();
  });

  it('links its header to browse, the first Picks module, and the gift guide', () => {
    render(
      <GuestShell>
        <p>The page</p>
      </GuestShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/new-york/browse', '/#picks', '/gifts']);
    expect(screen.getByRole('link', { name: /Search/ })).toHaveAttribute(
      'href',
      '/new-york/browse',
    );
  });

  it('gives each footer link a distinct address', () => {
    render(
      <GuestShell>
        <p>The page</p>
      </GuestShell>,
    );
    const hrefs = within(screen.getByRole('navigation', { name: 'Footer' }))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
