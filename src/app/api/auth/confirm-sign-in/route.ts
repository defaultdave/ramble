import { handleConfirmSignIn } from '@/server/auth/forms';

// The confirm page's form posts here. Only POST is exported, so a prefetched GET gets a 405 and
// uses nothing.
export const POST = handleConfirmSignIn;
