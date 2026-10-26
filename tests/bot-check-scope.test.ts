import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const checkoutGroup = path.resolve(
  import.meta.dirname,
  '../src/app/(checkout)',
);

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('bot check scope', () => {
  it('keeps BotID out of every checkout route file (ADR 0007)', () => {
    const files = sourceFiles(checkoutGroup);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      /botid|rate-limit\/bot-check/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
