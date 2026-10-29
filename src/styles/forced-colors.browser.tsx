import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { commands, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chip } from '@/components/Chip/Chip';
import { DatePicker } from '@/components/DatePicker/DatePicker';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setForcedColors: (active: boolean) => Promise<void>;
  }
}

// System colours resolve to real colours only inside a computed style, so read them from a probe.
function systemColor(name: 'CanvasText' | 'Highlight') {
  const probe = document.createElement('span');
  probe.style.color = name;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

// Roles: CanvasText marks focus, Highlight marks the selected state.
function expectFocusRing(element: Element) {
  const style = getComputedStyle(element);
  expect(style.outlineStyle).toBe('solid');
  expect(parseFloat(style.outlineWidth)).toBe(2);
  expect(parseFloat(style.outlineOffset)).toBe(2);
  expect(style.outlineColor).toBe(systemColor('CanvasText'));
}

function expectSelectedBorder(element: Element) {
  const style = getComputedStyle(element);
  expect(style.borderTopStyle).toBe('solid');
  expect(parseFloat(style.borderTopWidth)).toBe(3);
  expect(style.borderTopColor).toBe(systemColor('Highlight'));
}

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode) {
  flushSync(() => {
    root.render(node);
  });
}

async function tabTo(find: () => Element | null) {
  for (let presses = 0; presses < 20; presses += 1) {
    await userEvent.tab();
    const element = find();
    if (element && element === document.activeElement) return element;
  }
  throw new Error('Tab never reached the element');
}

beforeEach(async () => {
  await commands.setForcedColors(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  root.unmount();
  container.remove();
  await commands.setForcedColors(false);
});

describe('a selected control that is also focused, in forced-colors mode', () => {
  it('a selected chip shows a Highlight border', () => {
    mount(<Chip label="Outdoor" selected onToggle={() => undefined} />);
    const chip = container.querySelector('button');
    if (!chip) throw new Error('The chip did not render');
    expectSelectedBorder(chip);
  });

  it('a focused selected chip keeps its Highlight border and gains a separate CanvasText outline', async () => {
    mount(<Chip label="Outdoor" selected onToggle={() => undefined} />);
    const chip = await tabTo(() => container.querySelector('button'));
    expect(chip.matches(':focus-visible')).toBe(true);
    expectSelectedBorder(chip);
    expectFocusRing(chip);
  });

  it('a focused selected day keeps its Highlight border and gains a separate CanvasText outline', async () => {
    mount(
      <DatePicker
        label="Choose a date"
        value="2026-10-24"
        today="2026-10-18"
        availableDates={['2026-10-22', '2026-10-24']}
        onChange={() => undefined}
      />,
    );
    const day = await tabTo(() =>
      container.querySelector('[data-selected][data-focus-visible]'),
    );
    expectSelectedBorder(day);
    expectFocusRing(day);
  });
});
