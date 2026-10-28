import 'server-only';
import { Role, type Caller } from '@/server/auth/caller';

/** The caller the seed command acts as. Ops may write everything the seed touches. */
export const seedCaller: Caller = {
  userId: null,
  roles: [Role.Ops],
  hostIds: [],
};
