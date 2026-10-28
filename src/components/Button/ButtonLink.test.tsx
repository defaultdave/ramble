import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from './ButtonLink';

describe('ButtonLink', () => {
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
});
