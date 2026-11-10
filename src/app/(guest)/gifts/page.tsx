import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import { giftGuideFallbackTitle } from '@/lib/pages/picks';
import { GiftGuideContent } from './GiftGuideContent';

// The head is fixed: whether the page exists at all is a per-request switch, which the head cannot wait for.
export const metadata: Metadata = { title: giftGuideFallbackTitle };

export default function GiftGuidePage() {
  return (
    <Suspense fallback={<BrowseSkeleton filters={false} />}>
      <GiftGuideContent />
    </Suspense>
  );
}
