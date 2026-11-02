import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const src = path.join(root, 'src');

const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveImport(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(src, specifier.slice(2));
  else if (specifier.startsWith('.'))
    base = path.resolve(path.dirname(from), specifier);
  else return null;
  const hit = ['', ...extensions].map((suffix) => base + suffix).find(isFile);
  return hit && /\.tsx?$/.test(hit) ? hit : null;
}

/**
 * A `'use server'` module is the seam between the browser and the server: a client component that imports
 * it is given a reference to call, and the module's own imports run on the server only. Its imports are
 * not followed, so server work an action does (the fake payment's job drain reaches the server Sentry SDK)
 * is not mistaken for a script the browser loads.
 */
export function hasServerActionDirective(text: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*)*['"]use server['"]/.test(text);
}

export function hasClientDirective(text: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*)*['"]use client['"]/.test(text);
}

/** The specifiers a module loads at run time. A type-only import is erased by the compiler, so it is left out. */
export function importsOf(text: string): string[] {
  const runtime = text.replace(
    /\b(?:import|export)\s+type\b[^;'"]*?from\s*['"][^'"]+['"]/g,
    '',
  );
  return [...runtime.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Every module the roots can load, and the specifiers that reached them. */
export function importClosure(roots: readonly string[]) {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    if (hasServerActionDirective(text)) continue;
    for (const specifier of importsOf(text)) {
      specifiers.add(specifier);
      const next = resolveImport(specifier, file);
      if (next) queue.push(next);
    }
  }
  return { files: [...seen], specifiers: [...specifiers] };
}
