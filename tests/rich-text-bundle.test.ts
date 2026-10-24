import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
// The static renderer's own comments say "Prosemirror", so match package names and the
// editor's entry points, not the word.
const EDITOR_CODE =
  /prosemirror-|@tiptap\/(core|pm|react|starter-kit|extension)|\bEditorView\b/;

async function bundle(entry: string) {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@': path.join(root, 'src'),
        'server-only': path.join(root, 'tests/stubs/server-only.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(root, entry), formats: ['es'] },
      rolldownOptions: { external: [/^react($|\/)/] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) =>
    'output' in item ? item.output : [],
  );
  return outputs
    .map((output) => ('code' in output ? output.code : ''))
    .join('\n');
}

describe('rich text and the guest bundle', () => {
  it('bundles the renderer with the static renderer and no editor code', async () => {
    const code = await bundle('src/components/RichText/RichText.tsx');
    expect(code).toContain('TiptapStaticRenderer');
    expect(code).not.toMatch(EDITOR_CODE);
  });

  it('bundles the format and sanitizer with no Tiptap code at all', async () => {
    const code = await bundle('src/lib/richText/sanitize.ts');
    expect(code).toContain('sanitizeRichText');
    expect(code).not.toMatch(/tiptap|prosemirror|zod/i);
  });

  it('keeps the renderer server-only, so a client module cannot import it', () => {
    const source = readFileSync(
      path.join(root, 'src/components/RichText/RichText.tsx'),
      'utf8',
    );
    expect(source).toMatch(/^import 'server-only';$/m);
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});
