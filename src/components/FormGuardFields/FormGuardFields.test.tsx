import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import { FormGuardFields } from './FormGuardFields';

function renderFields() {
  const { container } = render(
    <form>
      <FormGuardFields token="1793534400000.sig" />
    </form>,
  );
  const form = container.querySelector('form');
  if (!form) throw new Error('form did not render');
  return form;
}

describe('FormGuardFields', () => {
  it('submits the token and an empty trap field', () => {
    const data = new FormData(renderFields());

    expect(data.get(FORM_TOKEN_FIELD)).toBe('1793534400000.sig');
    expect(data.get(HONEYPOT_FIELD)).toBe('');
  });

  it('keeps the trap out of the layout, the tab order, and autofill', () => {
    const trap = renderFields().querySelector(
      `input[name="${HONEYPOT_FIELD}"]`,
    );

    expect(trap).not.toBeVisible();
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
  });
});
