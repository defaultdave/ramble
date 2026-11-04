import 'server-only';

/** A setting only some adapters need, so the environment schema leaves it optional and the adapter that does fails here. */
export function requireEnv(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
