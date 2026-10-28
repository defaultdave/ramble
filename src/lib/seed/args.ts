import { maxSeedValue } from './ids';

/** The most experiences the generator makes in one run. It bounds the rows, sessions, and time a run takes. */
export const maxScaleExperiences = 1000;
export const defaultScaleExperiences = 400;
export const defaultScaleSeed = 1;

export type ScaleOptions = { experiences: number; seed: number };

export type SeedArgs =
  | { ok: true; scale: ScaleOptions | undefined }
  | { ok: false; message: string };

const usage =
  'Usage: seed [--scale[=N]] [--scale-seed=N]. N experiences is 1 to ' +
  String(maxScaleExperiences) +
  '; the seed is 0 to ' +
  String(maxSeedValue) +
  '.';

const wholeNumber = /^\d{1,10}$/;

/** Reads the command line. Anything it does not know is refused, so a typo never runs the wrong seed. */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  let experiences: number | undefined;
  let seed = defaultScaleSeed;
  let seedGiven = false;
  for (const arg of argv) {
    if (arg === '--scale') {
      experiences = defaultScaleExperiences;
      continue;
    }
    const [name, value] = splitOption(arg);
    if (name === '--scale' && value !== undefined) {
      const count = readNumber(value);
      if (count === undefined || count < 1 || count > maxScaleExperiences) {
        return { ok: false, message: usage };
      }
      experiences = count;
    } else if (name === '--scale-seed' && value !== undefined) {
      const given = readNumber(value);
      if (given === undefined || given > maxSeedValue) {
        return { ok: false, message: usage };
      }
      seed = given;
      seedGiven = true;
    } else {
      return { ok: false, message: usage };
    }
  }
  if (seedGiven && experiences === undefined) {
    return { ok: false, message: `--scale-seed needs --scale. ${usage}` };
  }
  return {
    ok: true,
    scale: experiences === undefined ? undefined : { experiences, seed },
  };
}

function splitOption(arg: string): [string, string | undefined] {
  const at = arg.indexOf('=');
  return at < 0 ? [arg, undefined] : [arg.slice(0, at), arg.slice(at + 1)];
}

function readNumber(value: string): number | undefined {
  return wholeNumber.test(value) ? Number(value) : undefined;
}
