import { pulseResponse } from '@/server/pulse';

// Route Handlers only answer the methods they export; every other one must get the same 401 as a
// wrong secret, so all of them go through the same function, which refuses anything but POST.
export const POST = pulseResponse;
export const GET = pulseResponse;
export const PUT = pulseResponse;
export const PATCH = pulseResponse;
export const DELETE = pulseResponse;
export const OPTIONS = pulseResponse;
