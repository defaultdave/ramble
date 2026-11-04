import 'server-only';

/**
 * What every port's refusal shares: a code the caller branches on, and the underlying failure kept
 * as `cause`. A port subclasses it with its own code union and name.
 */
export class PortError<Code extends string> extends Error {
  readonly code: Code;

  constructor(name: string, code: Code, message?: string, cause?: unknown) {
    super(message ?? code, cause === undefined ? undefined : { cause });
    this.name = name;
    this.code = code;
  }
}
