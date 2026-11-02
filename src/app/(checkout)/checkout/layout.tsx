import type { ReactNode } from 'react';
import { CheckoutFrame } from '@/components/CheckoutPage/CheckoutFrame';

/** Above `error.tsx` in this folder, so the frame is server-rendered and the client error module needs none of its imports. */
export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return <CheckoutFrame>{children}</CheckoutFrame>;
}
