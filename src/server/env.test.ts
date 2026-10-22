import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadEnv() {
  vi.resetModules();
  return (await import('./env')).env;
}

describe('environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads valid values', async () => {
    vi.stubEnv('APP_URL', 'https://ramble.example');

    const env = await loadEnv();

    expect(env.APP_URL).toBe('https://ramble.example');
  });

  it('falls back to the local origin when APP_URL is unset', async () => {
    vi.stubEnv('APP_URL', undefined);

    const env = await loadEnv();

    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it.each([
    ['APP_URL', 'not a url'],
    ['NODE_ENV', 'staging'],
  ])('fails at import when %s is %j', async (name, value) => {
    vi.stubEnv(name, value);

    await expect(loadEnv()).rejects.toThrow(
      new RegExp(`Invalid environment variables[\\s\\S]*${name}`),
    );
  });
});
