import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingChoices } from '@/components/BookingChoices';
import { BookingPanel } from '@/components/BookingPanel';
import { BookingSlots, ExperiencePage } from '@/components/ExperiencePage';
import { sunsetKayak } from '@/components/ExperiencePage/ExperiencePage.fixtures';
import { holdNote } from '@/lib/booking';
import {
  bookingReducer,
  choicesView,
  initialState,
  type BookingAction,
} from '@/lib/bookingDraft';
import { kidsOffer, optionId } from '@/lib/bookingDraft.fixtures';
import { registerMount } from '../../../tests/support/mount';

// next/link, reached through the Button barrel, reads process.env when it loads, and a browser has no process.
vi.hoisted(() => {
  Object.assign(globalThis, { process: { env: {} } });
});

// Behaviours under test, one per risk, in a real browser on the experience page. The panel is as tall as
// its content, never scrolls inside, and sticks at both ends:
// - scrolling down from the top-stuck position reaches Continue within the panel's overflow, then holds
// - scrolling back up reaches the calendar within the panel's overflow, then holds
// - the panel growing as choices appear does not move it
// - a panel that fits the window is plain sticky at the top
// - nothing in the panel scrolls
// - a control focused by keyboard, at either end, is brought into the window

const { mount } = registerMount();

const chooseDate: BookingAction = { type: 'chooseDate', date: '2026-10-24' };
const chooseTime: BookingAction = {
  type: 'chooseSession',
  sessionId: optionId(103),
};
const viewAfter = (actions: BookingAction[]) =>
  choicesView(
    kidsOffer,
    actions.reduce(
      (state, action) => bookingReducer(kidsOffer, state, action),
      initialState(kidsOffer),
    ),
  );

function mountPage(actions: BookingAction[]) {
  const view = viewAfter(actions);
  const { summary } = view;
  mount(
    <ExperiencePage
      view={sunsetKayak}
      dates={null}
      booking={
        <BookingSlots
          bar={null}
          panel={
            <BookingPanel
              priceMinor={6500}
              holdNote={holdNote}
              {...(summary
                ? {
                    total: {
                      label: summary.label,
                      amountMinor: summary.totalMinor,
                    },
                  }
                : {})}
              onContinue={vi.fn()}
            >
              <BookingChoices
                view={view}
                similarHref={kidsOffer.similarHref}
                onDate={vi.fn()}
                onSession={vi.fn()}
                onAdults={vi.fn()}
                onChildren={vi.fn()}
                onAlternative={vi.fn()}
              />
            </BookingPanel>
          }
        />
      }
    />,
  );
}

// A scroll frame is a rAF, and the panel moves in the one after the scroll.
const frames = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

async function scrollTo(y: number) {
  window.scrollTo(0, y);
  await frames();
}
async function scrollBy(dy: number) {
  window.scrollBy(0, dy);
  await frames();
}

function panelParts() {
  const panel = document.querySelector<HTMLElement>(
    'section[aria-label="Book this experience"]',
  );
  const next = [...(panel?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent.startsWith('Continue'),
  );
  const calendar = panel?.querySelector<HTMLElement>('[role="grid"]');
  if (!panel || !next || !calendar) {
    throw new Error('The panel did not render');
  }
  return { panel, next, calendar };
}
const top = (element: Element) => element.getBoundingClientRect().top;
const bottom = (element: Element) => element.getBoundingClientRect().bottom;

// The room above the panel, and the same below it.
const offset = 24;
const overflowOf = (panel: HTMLElement) =>
  Math.max(
    0,
    panel.getBoundingClientRect().height - (innerHeight - 2 * offset),
  );

/** Scrolls far down the page, then back up until the panel sits at the top offset. */
async function stickAtTop() {
  await scrollTo(
    Math.min(1500, document.documentElement.scrollHeight - innerHeight),
  );
  const { panel } = panelParts();
  while (top(panel) < offset - 0.5 && window.scrollY > 0) {
    await scrollBy(-10);
  }
}

beforeEach(() => {});

afterEach(() => {
  window.scrollTo(0, 0);
});

describe.each([
  [1440, 827],
  [1280, 720],
  [1024, 500],
])('the booking panel in a %ix%i window', (width, height) => {
  async function setup() {
    await page.viewport(width, height);
    mountPage([chooseDate, chooseTime]);
    await frames();
    await stickAtTop();
    return panelParts();
  }

  it('reaches Continue within the panel overflow, and holds with its bottom above the window bottom', async () => {
    const { panel, next } = await setup();
    const overflow = overflowOf(panel);
    expect(overflow).toBeGreaterThan(0);
    const from = window.scrollY;
    while (bottom(next) > innerHeight && window.scrollY < from + overflow) {
      await scrollBy(10);
    }
    expect(bottom(next)).toBeLessThanOrEqual(innerHeight);
    expect(window.scrollY - from).toBeLessThanOrEqual(overflow);
    await scrollBy(overflow);
    expect(bottom(panel)).toBeCloseTo(innerHeight - offset, 0);
    expect(bottom(next)).toBeLessThanOrEqual(innerHeight - offset);
  });

  it('reaches the calendar again within the panel overflow when scrolling back up', async () => {
    const { panel, calendar } = await setup();
    const overflow = overflowOf(panel);
    await scrollBy(overflow + 200);
    expect(bottom(panel)).toBeCloseTo(innerHeight - offset, 0);
    const from = window.scrollY;
    while (top(calendar) < 0 && window.scrollY > from - overflow - 10) {
      await scrollBy(-10);
    }
    expect(top(calendar)).toBeGreaterThanOrEqual(0);
    expect(from - window.scrollY).toBeLessThanOrEqual(overflow);
    await scrollBy(-overflow);
    expect(top(panel)).toBeCloseTo(offset, 0);
  });

  it('brings a control focused by keyboard into the window, at either end', async () => {
    const { panel, next } = await setup();
    next.focus();
    await frames();
    expect(bottom(next)).toBeLessThanOrEqual(innerHeight);
    expect(top(next)).toBeGreaterThanOrEqual(0);
    // The calendar's previous-month button is disabled in the first month, so the first one to take focus is later.
    const first = [...panel.querySelectorAll('button')].find(
      (button) => !button.disabled && button.ariaDisabled !== 'true',
    );
    first?.focus();
    await frames();
    expect(document.activeElement).toBe(first);
    expect(top(first as HTMLElement)).toBeGreaterThanOrEqual(0);
  });

  it('has nothing inside it that scrolls', async () => {
    const { panel } = await setup();
    for (const element of [panel, ...panel.querySelectorAll('*')]) {
      expect(['auto', 'scroll']).not.toContain(
        getComputedStyle(element).overflowY,
      );
    }
  });
});

describe('the booking panel as it changes', () => {
  it('does not move when choices appear and it grows', async () => {
    await page.viewport(1280, 720);
    mountPage([chooseDate]);
    await frames();
    await scrollTo(1200);
    await scrollBy(-40);
    const { panel } = panelParts();
    const before = top(panel);
    mountPage([chooseDate, chooseTime]);
    await frames();
    expect(top(panelParts().panel)).toBeCloseTo(before, 0);
  });

  it('is plain sticky at the top when it fits the window', async () => {
    await page.viewport(1440, 1400);
    mountPage([chooseDate, chooseTime]);
    await frames();
    const { panel } = panelParts();
    expect(overflowOf(panel)).toBe(0);
    for (const y of [900, 1100, 1000, 800]) {
      await scrollTo(y);
      expect(top(panel)).toBeCloseTo(offset, 0);
    }
  });
});
