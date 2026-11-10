import { handleAuthRequest } from '@/server/auth/handler';

// Better Auth answers these paths: POST /api/auth/sign-in/magic-link asks for a link, and
// GET /api/auth/magic-link/verify is the address in the email, which sets the session cookie and
// redirects to the `callbackURL` it was given. The sign-in pages (NEW-1) land people on it.
export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
