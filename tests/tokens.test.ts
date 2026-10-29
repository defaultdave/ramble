import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildTokensCss,
  cssName,
  lineHeightRatio,
  readTokenSource,
} from '../scripts/tokens/build';

const COMMITTED_CSS = new URL('../src/styles/tokens.css', import.meta.url);

const CONTRACT_EXAMPLES = [
  ['color/bg/canvas', '--color-bg-canvas'],
  ['space/4', '--space-4'],
  ['font/size/heading-l', '--font-size-heading-l'],
  ['palette/ink/50', '--palette-ink-50'],
  ['color/action/primary/bg-hover', '--color-action-primary-bg-hover'],
] as const;

function declaredProperties(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/^\s*(--[^:\s]+):/gm)].map((match) => match[1] ?? ''),
  );
}

async function expectedProperties(): Promise<Set<string>> {
  const { collections, effectStyles } = await readTokenSource();
  const figmaNames = [
    ...collections.Primitives.variables,
    ...collections.Color.variables,
    ...collections.Space.variables,
    ...collections.Radius.variables,
    ...collections.Type.variables,
    ...effectStyles,
  ].map((entry) => entry.name.replace('elevation/', 'elevation-'));
  return new Set(figmaNames.map(cssName));
}

describe('token naming contract', () => {
  it.each(CONTRACT_EXAMPLES)('%s becomes %s', (figmaName, property) => {
    expect(cssName(figmaName)).toBe(property);
  });

  it('emits exactly the custom properties the Figma variable names imply', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    expect(declaredProperties(css)).toEqual(await expectedProperties());
  });

  it('only declares lowercase kebab-case names', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    for (const property of declaredProperties(css)) {
      expect(property).toMatch(/^--[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('matches what the build produces from the committed source', async () => {
    const committed = await readFile(COMMITTED_CSS, 'utf8');
    expect(committed).toBe(await buildTokensCss(await readTokenSource()));
  });
});

describe('token modes', () => {
  it('puts Dark colors under prefers-color-scheme and Desktop type at 768px', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--color-bg-canvas: var\(--palette-ink-900\)/,
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{\s*:root \{[^}]*--font-size-display-l: 64px/,
    );
  });

  it('keeps Mobile type and Light color as the default block', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    const base = css.slice(0, css.indexOf('@media'));
    expect(base).toContain('--font-size-display-l: 40px');
    expect(base).toContain('--color-bg-canvas: var(--palette-ink-50)');
  });

  it('repeats only the Type variables whose Desktop value differs', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    const desktop = css.slice(css.indexOf('@media (min-width'));
    expect(desktop).not.toContain('--font-size-body-m');
    expect(desktop).toContain('--font-line-height-heading-l: 1.1875');
  });

  it('derives elevation from the shadow color token', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    expect(css).toContain(
      '--elevation-2: 0px 4px 12px 0px var(--color-shadow)',
    );
  });
});

describe('line height tokens', () => {
  it.each([
    [44, 40, '1.1'],
    [24, 16, '1.5'],
    [20, 14, '1.4286'],
    [28, 18, '1.5556'],
    [68, 64, '1.0625'],
  ])('%ipx over %ipx is the ratio %s', (lineHeight, fontSize, ratio) => {
    expect(lineHeightRatio(lineHeight, fontSize)).toBe(ratio);
  });

  it.each([
    [0, 16],
    [24, 0],
    [-1, 16],
    [Number.NaN, 16],
  ])('refuses %f over %f', (lineHeight, fontSize) => {
    expect(() => lineHeightRatio(lineHeight, fontSize)).toThrow();
  });

  it('emits every line height as a unitless ratio in both blocks', async () => {
    const css = await readFile(COMMITTED_CSS, 'utf8');
    const declarations = [
      ...css.matchAll(/(--font-line-height-[a-z-]+): ([^;]+);/g),
    ];
    expect(declarations.length).toBeGreaterThanOrEqual(10);
    for (const [, , value] of declarations) {
      expect(value).toMatch(/^\d+(\.\d+)?$/);
    }
  });
});
