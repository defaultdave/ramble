import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingChoices } from '@/components/BookingChoices';
import { BookingPanel } from '@/components/BookingPanel';
import { BookingSlots, ExperiencePage } from '@/components/ExperiencePage';
import { sunsetKayak } from '@/components/ExperiencePage/ExperiencePage.fixtures';
import { holdNote } from '@/lib/booking';
import { bookingReducer, choicesView, initialState } from '@/lib/bookingDraft';
import { kayakOffer, optionId } from '@/lib/bookingDraft.fixtures';

// next/link, reached through the Button barrel, reads process.env when it loads, and a browser has no process.
vi.hoisted(() => {
  Object.assign(globalThis, { process: { env: {} } });
});

// Behaviours under test, one per risk, in a real browser on the experience page with a date, a time,
// and a party chosen, once the page is scrolled so the panel is stuck:
// - the panel is no taller than the window less its sticky offsets, and Continue is inside the window
// - the choices scroll in their own area and the footer stays under them
// - in a window too short for a pinned footer, the whole panel scrolls as one instead
// - a control focused by keyboard in the choices is scrolled clear of the footer
// - the panel hugs its content when it fits: no space opens between the choices and the footer

let container: HTMLDivElement;
let root: Root;

const selected = bookingReducer(
  kayakOffer,
  bookingReducer(kayakOffer, initialState(kayakOffer), {
    type: 'chooseDate',
    date: '2026-10-24',
  }),
  { type: 'chooseSession', sessionId: optionId(103) },
);
const view = choicesView(kayakOffer, selected);

function mountPage() {
  const { summary } = view;
  if (!summary) throw new Error('No total for the chosen party');
  flushSync(() => {
    root.render(
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
                total={{
                  label: summary.label,
                  amountMinor: summary.totalMinor,
                }}
                onContinue={vi.fn()}
              >
                <BookingChoices
                  view={view}
                  similarHref={kayakOffer.similarHref}
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
  });
}

async function stuckPanel(width: number, height: number) {
  await page.viewport(width, height);
  mountPage();
  window.scrollTo(0, 900);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const panel = document.querySelector<HTMLElement>(
    'section[aria-label="Book this experience"]',
  );
  const choices = panel?.querySelector<HTMLElement>('[class*="choices"]');
  const footer = panel?.querySelector<HTMLElement>('[class*="footer"]');
  const next = [...(panel?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent.startsWith('Continue'),
  );
  if (!panel || !choices || !footer || !next) {
    throw new Error('The panel did not render');
  }
  return { panel, choices, footer, next };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
});

// The sticky offset above the panel, and the same room below it.
const offset = 24;

describe('the stuck booking panel', () => {
  it.each([
    [1440, 827],
    [1280, 720],
    [1024, 600],
  ])(
    'fits the window and keeps Continue in view at %ix%i',
    async (width, height) => {
      const { panel, next } = await stuckPanel(width, height);
      expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(
        height - 2 * offset + 0.5,
      );
      expect(next.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
    },
  );

  it('scrolls the choices above a footer that stays put', async () => {
    const { choices, footer, next } = await stuckPanel(1280, 600);
    const before = footer.getBoundingClientRect().top;
    expect(choices.scrollHeight).toBeGreaterThan(choices.clientHeight);
    choices.scrollTop = choices.scrollHeight;
    expect(footer.getBoundingClientRect().top).toBe(before);
    expect(footer).toContainElement(next);
    expect(choices.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      footer.getBoundingClientRect().top + 0.5,
    );
  });

  it('scrolls the whole panel as one in a window too short for a pinned footer', async () => {
    const { panel, choices } = await stuckPanel(1024, 500);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(
      500 - 2 * offset + 0.5,
    );
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    expect(choices.scrollHeight).toBeLessThanOrEqual(choices.clientHeight + 1);
  });

  it('scrolls a control focused by keyboard clear of the footer', async () => {
    const { choices, footer } = await stuckPanel(1280, 600);
    const controls = [...choices.querySelectorAll<HTMLElement>('button')];
    const last = controls.at(-1);
    last?.focus();
    expect(document.activeElement).toBe(last);
    const box = last?.getBoundingClientRect();
    expect(box?.bottom).toBeLessThanOrEqual(
      footer.getBoundingClientRect().top + 0.5,
    );
  });

  it('hugs its content when everything fits', async () => {
    const { panel, choices, footer } = await stuckPanel(1440, 1400);
    const last = choices.lastElementChild;
    if (!last) throw new Error('No choices');
    expect(panel.getBoundingClientRect().height).toBeLessThan(
      1400 - 2 * offset,
    );
    expect(
      footer.getBoundingClientRect().top - last.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(24);
  });
});
