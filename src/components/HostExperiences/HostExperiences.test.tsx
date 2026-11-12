import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostExperiences } from './HostExperiences';
import { none, several } from './HostExperiences.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page has one h1 and a way back to the dashboard, and says changes go through Ramble
// - each experience is a list item with its name, status in words, prices, cancellation terms and waiver
// - an experience with no prices says so
// - a host with no experiences says so, with no empty list
// - the page offers no form or edit control: it is read only

describe('HostExperiences', () => {
  it('has one heading, a link back, and says who changes an experience', () => {
    render(<HostExperiences view={several} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your experiences' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the dashboard' }),
    ).toHaveAttribute('href', '/host');
    expect(screen.getByText(/contact Ramble/)).toBeVisible();
  });

  it('lists each experience with its facts', () => {
    render(<HostExperiences view={several} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const first = items[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(
      within(first).getByRole('heading', { level: 2, name: 'Sunset kayak' }),
    ).toBeVisible();
    expect(first).toHaveTextContent('Live');
    expect(first).toHaveTextContent('Adult $65 · Child $32.50');
    expect(first).toHaveTextContent(
      'Flexible: Free cancellation up to 24 hours before',
    );
    expect(first).toHaveTextContent('Guests accept a waiver');
    expect(items[1]).toHaveTextContent('In review');
  });

  it('says so when an experience has no prices', () => {
    render(<HostExperiences view={several} />);
    expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('None set');
  });

  it('says so when the host has no experiences', () => {
    render(<HostExperiences view={none} />);
    expect(screen.getByText('No experiences yet.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('is read only', () => {
    render(<HostExperiences view={several} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
