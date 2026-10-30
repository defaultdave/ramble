import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from './ButtonLink';

describe('ButtonLink', () => {
  it('is a plain download anchor, not a routed link, when it names a file', () => {
    render(
      <ButtonLink href="data:text/calendar,x" download="booking.ics">
        Download
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('download', 'booking.ics');
    expect(link).toHaveAttribute('href', 'data:text/calendar,x');
  });

  it('is a link to its address, named by its label', () => {
    render(<ButtonLink href="/new-york/browse">Clear all filters</ButtonLink>);
    expect(
      screen.getByRole('link', { name: 'Clear all filters' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('takes the ghost look at medium size unless told otherwise', () => {
    render(<ButtonLink href="/a">Ghost</ButtonLink>);
    expect(screen.getByRole('link').className).toMatch(/ghost/);
    expect(screen.getByRole('link').className).toMatch(/md/);
  });

  it.each(['primary', 'secondary'] as const)(
    'takes the %s variant',
    (variant) => {
      render(
        <ButtonLink href="/a" variant={variant}>
          Go
        </ButtonLink>,
      );
      expect(screen.getByRole('link').className).toMatch(new RegExp(variant));
    },
  );

  it('draws an icon before its label, hidden from a screen reader', () => {
    render(
      <ButtonLink href="/a" iconStart={<svg data-testid="icon" />}>
        Go
      </ButtonLink>,
    );
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Go' })).toBeInTheDocument();
  });

  it('opens an external address in a new tab and says so', () => {
    render(
      <ButtonLink href="https://maps.example/?q=a" external>
        Open in Maps
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: /Open in Maps/ });
    expect(link).toHaveTextContent('Open in Maps (opens in a new tab)');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens an internal address in the same tab, with nothing added to its name', () => {
    render(<ButtonLink href="/a">Go</ButtonLink>);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });
});
