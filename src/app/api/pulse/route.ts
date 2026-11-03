import { pulseResponse } from '@/server/pulse';

// Must be a literal for Next to read. 300 seconds is the job lock (`jobLimits.lockSeconds`): the
// drain stops claiming after 60 seconds but finishes the job in hand, and a run still going when
// the lock lapses would be racing the drain that reclaimed its job.
export const maxDuration = 300;

// Route Handlers only answer the methods they export; every other one must get the same 401 as a
// wrong secret, so all of them go through the same function, which refuses anything but POST.
export const POST = pulseResponse;
export const GET = pulseResponse;
export const PUT = pulseResponse;
export const PATCH = pulseResponse;
export const DELETE = pulseResponse;
export const OPTIONS = pulseResponse;
