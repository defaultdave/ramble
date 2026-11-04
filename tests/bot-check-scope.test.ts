import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles } from './support/importGraph';

const checkoutGroup = path.resolve(
  import.meta.dirname,
  '../src/app/(checkout)',
);

describe('bot check scope', () => {
  it('keeps BotID out of every checkout route file (ADR 0007)', () => {
    const files = listFiles(checkoutGroup).filter((file) =>
      /\.(ts|tsx)$/.test(file),
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      /botid|rate-limit\/bot-check/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
