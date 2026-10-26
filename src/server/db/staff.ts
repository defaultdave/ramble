import 'server-only';
import { Role, requireRole, type Caller } from '@/server/auth/caller';

/** Editorial content, legal documents, and settings are changed by Ramble ops or admin and nobody else. */
export function requireStaff(caller: Caller): void {
  if (caller.roles.includes(Role.Ops)) return;
  requireRole(caller, Role.Admin, {});
}
