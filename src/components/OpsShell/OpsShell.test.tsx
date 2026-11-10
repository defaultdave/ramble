import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { opsLandingLinks, opsNavLinks } from '@/lib/opsNav';
import { OpsAccessDenied, OpsLanding, OpsNav } from './OpsShell';

// Behaviours under test:
// - the nav is a labelled landmark with one link per area, each to its address
// - the landing names the page and links every area it is given
// - the refusal says the area is for the team and offers sign-in that returns to the ops page

describe('OpsNav', () => {
  it('links every area from its landmark', () => {
    render(<OpsNav links={opsNavLinks} />);
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual(opsNavLinks.map((link) => [link.label, link.href]));
  });
});

describe('OpsLanding', () => {
  it('has the page heading and a link to each area', () => {
    render(<OpsLanding areas={opsLandingLinks()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operations' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mailbox' })).toHaveAttribute(
      'href',
      '/ops/mailbox',
    );
  });
});

describe('OpsAccessDenied', () => {
  it('offers sign-in that comes back to the page that was asked for', () => {
    render(<OpsAccessDenied next="/ops/mailbox" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operations' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fops%2Fmailbox',
    );
  });
});
