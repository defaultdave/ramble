import 'server-only';
import { getAuth } from './auth';

export type SessionRecord = {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

/** The session the request's cookie names, or null. Better Auth rejects a session past its deadline and deletes it. */
export async function readSession(
  headers: Headers,
): Promise<SessionRecord | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const { id, userId, createdAt, expiresAt } = result.session;
  return { id, userId, createdAt, expiresAt };
}
