import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeHero } from '@/components/HomeModules/HomeHero';
import { RichText } from '@/components/RichText';
import { homeCopy } from '@/lib/pages/home';
import { paragraphs } from '@/lib/richText/paragraphs';
import { HomeSkeleton } from './HomeSkeleton';
import styles from './HomeStates.module.css';

// next/link, reached through the Button barrel, reads process.env when it loads, and a browser has no process.
vi.hoisted(() => {
  Object.assign(globalThis, { process: { env: {} } });
});

// Behaviours under test, one per decision, branch or risk. The loading state must hold the space
// the loaded hero takes, so the page does not move when the data arrives:
// - the search box is as tall as the loaded one, and so is each field and the button in it
// - a line of the headline and a line of the copy are as tall as the loaded ones
// - the loaded copy is set in body-l and text-secondary, as in Figma, whatever order the stylesheets load in
// - the eyebrow is as tall as the loaded one
// This runs on the fixture hero, in a real browser and with no database, and compares sizes that
// do not depend on the words or the font. How many lines the words take is not compared here: it
// follows the editorial copy, and the seeded page is measured against the skeleton by hand.

const widths = [320, 390, 768, 1024, 1280, 1440];
// A pixel of slack for sub-pixel line boxes.
const slack = 1;

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode) {
  flushSync(() => {
    root.render(node);
  });
}

const heightOf = (element: Element) => element.getBoundingClientRect().height;
const expectSame = (actual: number, expected: number | null) => {
  expect(Math.abs(actual - (expected ?? NaN))).toBeLessThanOrEqual(slack);
};
// A CSS module's class can read as undefined to the type checker; an empty name makes the selector throw.
const dot = (name: string | undefined) => `.${name ?? ''}`;
const pixels = (value: string) => Number.parseFloat(value);
const resolvedColor = (token: string) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
};

function heroSizes() {
  const form = container.querySelector(
    `${dot(styles.search)}, form[aria-label="Find something to do"]`,
  );
  if (!form) throw new Error('No search box');
  const headingLines = container.querySelector(dot(styles.headingLines));
  const bodyLines = container.querySelector(dot(styles.bodyLines));
  const heading = container.querySelector('h1:not([class*="visuallyHidden"])');
  const body = heading?.nextElementSibling?.firstElementChild;
  const eyebrow = container.querySelector(
    `${dot(styles.eyebrowBar)}, [class*="eyebrow"]`,
  );
  if (!eyebrow) throw new Error('No eyebrow');
  const lineOf = (loaded: Element | null | undefined) =>
    loaded ? pixels(getComputedStyle(loaded).lineHeight) : null;
  const paragraph = body?.querySelector('p') ?? null;
  return {
    search: heightOf(form),
    parts: [...form.children].map(heightOf),
    headingLine: headingLines
      ? pixels(getComputedStyle(headingLines).gridAutoRows)
      : lineOf(heading),
    bodyLine: bodyLines
      ? pixels(getComputedStyle(bodyLines).gridAutoRows)
      : lineOf(body),
    eyebrow: heightOf(eyebrow),
    bodySize: paragraph ? pixels(getComputedStyle(paragraph).fontSize) : null,
    bodyColor: paragraph ? getComputedStyle(paragraph).color : null,
  };
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

describe('HomeSkeleton against the loaded hero', () => {
  it.each(widths)('takes the same space at %ipx', async (width) => {
    await page.viewport(width, 900);

    mount(<HomeSkeleton />);
    const loading = heroSizes();

    // The page draws the copy with the rich-text renderer, whose root sets its own text size.
    mount(
      <HomeHero
        eyebrow={homeCopy.heroEyebrow}
        heading={homeCopy.heroHeading}
        body={<RichText content={paragraphs(homeCopy.heroBody)} />}
        neighborhoods={[{ slug: 'dumbo', name: 'DUMBO' }]}
        today="2026-11-02"
      />,
    );
    const loaded = heroSizes();

    expectSame(loading.search, loaded.search);
    expect(loading.parts).toHaveLength(loaded.parts.length);
    loading.parts.forEach((part, index) => {
      expectSame(part, loaded.parts[index] ?? null);
    });
    expectSame(loading.headingLine ?? NaN, loaded.headingLine);
    expectSame(loading.bodyLine ?? NaN, loaded.bodyLine);
    expectSame(loading.eyebrow, loaded.eyebrow);
    expectSame(
      loaded.bodySize ?? NaN,
      pixels(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--font-size-body-l',
        ),
      ),
    );
    expect(loaded.bodyColor).toBe(resolvedColor('--color-text-secondary'));
  });
});
