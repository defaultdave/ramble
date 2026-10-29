import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type VercelConfig = {
  buildCommand?: string;
  git?: { deploymentEnabled?: Record<string, boolean> };
};

const config = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../vercel.json'), 'utf8'),
) as VercelConfig;
const rules = Object.entries(config.git?.deploymentEnabled ?? {});

const offPatterns = ['main', 'unit/*', 'pm/*', 'sync/*', 'promote/*'];
const mustDeploy = ['integration', 'production'];

// Vercel documents minimatch globs; in them `*` does not cross a slash.
function matches(pattern: string, branch: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`).test(branch);
}

// Vercel: a branch deploys when no rule matches it or when any matching rule is true.
function deploys(branch: string): boolean {
  const matching = rules.filter(([pattern]) => matches(pattern, branch));
  return matching.length === 0 || matching.some(([, enabled]) => enabled);
}

describe('vercel.json deployment creation', () => {
  it('keeps the build command', () => {
    expect(config.buildCommand).toBe('sh scripts/vercel-build.sh');
  });

  it.each(offPatterns)('turns automatic deployments off for %s', (pattern) => {
    expect(config.git?.deploymentEnabled?.[pattern]).toBe(false);
  });

  it('disables exactly the listed patterns', () => {
    expect(rules.map(([pattern]) => pattern).sort()).toEqual(
      [...offPatterns].sort(),
    );
  });

  it.each(mustDeploy)('still deploys %s', (branch) => {
    expect(config.git?.deploymentEnabled?.[branch]).not.toBe(false);
    expect(deploys(branch)).toBe(true);
  });

  it.each(['unit/U-001-deploy-config', 'pm/status', 'sync/main', 'promote/x'])(
    'does not deploy %s',
    (branch) => {
      expect(deploys(branch)).toBe(false);
    },
  );

  it('still deploys a branch no rule names', () => {
    expect(deploys('feature/anything')).toBe(true);
  });
});
