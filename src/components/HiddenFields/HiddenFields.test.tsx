import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HiddenFields } from '.';

// Behaviours under test, one per decision, branch or risk:
// - each pair becomes one hidden input with that name and value, in order
// - a repeated name keeps every value, so a list filter survives
// - no pairs renders no inputs

const inputsOf = (fields: HiddenFieldsProps['fields']) => {
  const { container } = render(
    <form>
      <HiddenFields fields={fields} />
    </form>,
  );
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
  ).map((input) => [input.name, input.value]);
};

type HiddenFieldsProps = Parameters<typeof HiddenFields>[0];

describe('HiddenFields', () => {
  it.each([
    [[['guests', '2']], [['guests', '2']]],
    [
      [
        ['category', 'food'],
        ['category', 'music'],
      ],
      [
        ['category', 'food'],
        ['category', 'music'],
      ],
    ],
    [[], []],
  ] as const)('renders %j as hidden inputs', (fields, expected) => {
    expect(inputsOf(fields)).toEqual(expected);
  });
});
