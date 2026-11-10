import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccessibilityStatement } from './AccessibilityStatement';

// Behaviours under test:
// - one h1, the standard it aims for, and its known gaps, each under its own heading
// - the feedback path is a link to the contact page

describe('AccessibilityStatement', () => {
  it('has one h1 and names the standard and the known gaps', () => {
    render(<AccessibilityStatement />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/WCAG\) 2\.2, level\s+AA/)).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Known gaps' }),
    ).toBeVisible();
  });

  it('links to the contact page to report a barrier', () => {
    render(<AccessibilityStatement />);

    expect(
      screen.getByRole('link', { name: 'Contact us about accessibility' }),
    ).toHaveAttribute('href', '/contact');
  });
});
