import { Suspense } from 'react';
import { HomeSkeleton } from '@/components/HomeStates';
import { HomeContent } from './HomeContent';

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
