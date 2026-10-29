import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import StyleDictionary from 'style-dictionary';
import { z } from 'zod';

const SOURCE_PATH = fileURLToPath(
  new URL('../../tokens/figma-variables.json', import.meta.url),
);
const OUTPUT_PATH = fileURLToPath(
  new URL('../../src/styles/tokens.css', import.meta.url),
);

export const DESKTOP_MIN_WIDTH = 768;

const primitive = z.object({ name: z.string(), value: z.string() });
const scalar = z.object({ name: z.string(), value: z.number() });
const colorVariable = z.object({
  name: z.string(),
  light: z.string(),
  dark: z.string(),
});
const typeVariable = z.object({
  name: z.string(),
  mobile: z.union([z.string(), z.number()]),
  desktop: z.union([z.string(), z.number()]),
});
const effectStyle = z.object({
  name: z.string(),
  shadow: z.object({
    x: z.number(),
    y: z.number(),
    blur: z.number(),
    spread: z.number(),
    color: z.string(),
  }),
});

const sourceSchema = z.object({
  collections: z.object({
    Primitives: z.object({ variables: z.array(primitive) }),
    Color: z.object({ variables: z.array(colorVariable) }),
    Space: z.object({ variables: z.array(scalar) }),
    Radius: z.object({ variables: z.array(scalar) }),
    Type: z.object({ variables: z.array(typeVariable) }),
  }),
  effectStyles: z.array(effectStyle),
});

export type TokenSource = z.infer<typeof sourceSchema>;

type Mode = 'base' | 'dark' | 'desktop';

interface TokenNode {
  [key: string]: TokenNode | string;
}

const FONT_STACKS: Record<string, string> = {
  Fraunces: 'var(--font-face-fraunces), Georgia, serif',
  Inter: 'var(--font-face-inter), system-ui, sans-serif',
};

export function cssName(figmaName: string): string {
  return `--${figmaName.replaceAll('/', '-')}`;
}

function toPath(figmaName: string): string[] {
  return figmaName.split('/');
}

function setToken(root: TokenNode, figmaName: string, value: string) {
  const path = toPath(figmaName);
  const leaf = path.pop();
  if (leaf === undefined) return;
  let node = root;
  for (const key of path) {
    const next = node[key];
    if (typeof next === 'string') {
      throw new Error(`Token path collides with a value: ${figmaName}`);
    }
    node = next ?? (node[key] = {});
  }
  node[leaf] = { $value: value } as unknown as TokenNode;
}

function reference(figmaName: string): string {
  return `{${toPath(figmaName).join('.')}}`;
}

function typeValue(name: string, raw: string | number): string {
  if (name.startsWith('font/family/')) {
    const stack = FONT_STACKS[String(raw)];
    if (stack === undefined) {
      throw new Error(`No font stack for family ${String(raw)}`);
    }
    return stack;
  }
  if (name.startsWith('font/weight/')) return String(raw);
  return `${String(raw)}px`;
}

const LINE_HEIGHT_PREFIX = 'font/line-height/';
const LINE_HEIGHT_DECIMALS = 4;

/**
 * A line height is emitted as a ratio of its font size so the line box scales
 * with text-only zoom. Each `font/line-height/<style>` pairs with the
 * `font/size/<style>` of the same name, in the same mode.
 */
export function lineHeightRatio(
  lineHeightPx: number,
  fontSizePx: number,
): string {
  if (!(lineHeightPx > 0) || !(fontSizePx > 0)) {
    throw new Error(
      `Line height ${String(lineHeightPx)} and font size ${String(fontSizePx)} must both be positive`,
    );
  }
  return String(
    Number((lineHeightPx / fontSizePx).toFixed(LINE_HEIGHT_DECIMALS)),
  );
}

function pairedFontSize(
  variables: TokenSource['collections']['Type']['variables'],
  lineHeightName: string,
  mode: Mode,
): number {
  const sizeName = `font/size/${lineHeightName.slice(LINE_HEIGHT_PREFIX.length)}`;
  const size = variables.find((v) => v.name === sizeName);
  const raw = mode === 'desktop' ? size?.desktop : size?.mobile;
  if (typeof raw !== 'number') {
    throw new Error(`${lineHeightName} has no numeric ${sizeName} to pair with`);
  }
  return raw;
}

interface ModeTokens {
  tree: TokenNode;
  emitted: Set<string>;
}

function collectTokens(source: TokenSource, mode: Mode): ModeTokens {
  const tree: TokenNode = {};
  const emitted = new Set<string>();
  const { collections, effectStyles } = source;
  const base = mode === 'base';

  const add = (name: string, value: string, emit: boolean) => {
    setToken(tree, name, value);
    if (emit) emitted.add(name);
  };

  for (const v of collections.Primitives.variables) {
    add(v.name, v.value, base);
  }
  for (const v of collections.Color.variables) {
    const target = mode === 'dark' ? v.dark : v.light;
    add(v.name, reference(target), base || mode === 'dark');
  }
  for (const v of [
    ...collections.Space.variables,
    ...collections.Radius.variables,
  ]) {
    add(v.name, `${String(v.value)}px`, base);
  }
  for (const v of collections.Type.variables) {
    if (v.name.startsWith(LINE_HEIGHT_PREFIX)) {
      const ratioIn = (m: Mode) =>
        lineHeightRatio(
          Number(m === 'desktop' ? v.desktop : v.mobile),
          pairedFontSize(collections.Type.variables, v.name, m),
        );
      add(
        v.name,
        ratioIn(mode),
        base || (mode === 'desktop' && ratioIn('desktop') !== ratioIn('base')),
      );
      continue;
    }
    const raw = mode === 'desktop' ? v.desktop : v.mobile;
    add(
      v.name,
      typeValue(v.name, raw),
      base || (mode === 'desktop' && v.desktop !== v.mobile),
    );
  }
  for (const s of effectStyles) {
    const { x, y, blur, spread, color } = s.shadow;
    const value = `${String(x)}px ${String(y)}px ${String(blur)}px ${String(spread)}px ${reference(color)}`;
    add(s.name.replace('elevation/', 'elevation-'), value, base);
  }
  return { tree, emitted };
}

async function emitBlock(
  source: TokenSource,
  mode: Mode,
  selector: string[],
): Promise<string> {
  const { tree, emitted } = collectTokens(source, mode);
  const dictionary = new StyleDictionary({
    tokens: tree,
    log: { verbosity: 'silent' },
    platforms: {
      css: {
        transforms: ['ramble/name'],
        files: [
          {
            destination: 'unused.css',
            format: 'css/variables',
            filter: (token) => emitted.has(token.path.join('/')),
            options: {
              selector,
              outputReferences: true,
              showFileHeader: false,
            },
          },
        ],
      },
    },
  });
  const [file] = await dictionary.formatPlatform('css');
  if (typeof file?.output !== 'string') {
    throw new Error(`Style Dictionary produced no CSS for the ${mode} block`);
  }
  return file.output;
}

StyleDictionary.registerTransform({
  name: 'ramble/name',
  type: 'name',
  transform: (token) => token.path.join('-'),
});

export async function buildTokensCss(source: TokenSource): Promise<string> {
  const blocks = [
    await emitBlock(source, 'base', [':root']),
    await emitBlock(source, 'dark', [
      '@media (prefers-color-scheme: dark)',
      ':root',
    ]),
    await emitBlock(source, 'desktop', [
      `@media (min-width: ${String(DESKTOP_MIN_WIDTH)}px)`,
      ':root',
    ]),
  ];
  const css = `/* Generated by scripts/tokens/build.ts from tokens/figma-variables.json. Do not edit. */\n${blocks.join('\n')}`;
  const config = await resolveConfig(OUTPUT_PATH);
  return format(css, { ...config, parser: 'css' });
}

export async function readTokenSource(): Promise<TokenSource> {
  const raw: unknown = JSON.parse(await readFile(SOURCE_PATH, 'utf8'));
  return sourceSchema.parse(raw);
}

if (import.meta.main) {
  const css = await buildTokensCss(await readTokenSource());
  await writeFile(OUTPUT_PATH, css);
}
