// Where a demo-data reset may run. It empties tables, so it is stricter than the seed: a production
// deployment is refused, and so is the database the seed may fill for the production demo.

export type ResetTargetInput = {
  vercelEnv: string | undefined;
  seedTarget: string | undefined;
};

/** Why a reset must not run here, or null when it may. */
export function resetRefusal(input: ResetTargetInput): string | null {
  if (input.vercelEnv === 'production') {
    return 'The demo data is never reset on a production deployment.';
  }
  if (input.seedTarget === 'production-demo') {
    return 'The demo data is never reset on the production-demo database.';
  }
  return null;
}

/** The phrase a person types to confirm a reset, in the console and on the command line. */
export const resetConfirmPhrase = 'RESET';

export function isResetConfirmed(typed: string | undefined): boolean {
  return typed?.trim() === resetConfirmPhrase;
}
