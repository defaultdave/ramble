import { reviewCopy } from '@/lib/copy/review';
import type { ReviewModerationRow } from '@/lib/reviewModeration';

export const visibleRow: ReviewModerationRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceName: 'Pottery wheel night',
  ratingText: '4 out of 5',
  body: 'A lovely evening.\nWe made two bowls.',
  firstName: 'Pat',
  status: 'visible',
  writtenLabel: 'Mon, Nov 9, 10:30 AM EST',
};

export const hiddenRow: ReviewModerationRow = {
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceName: 'Sunrise kayak paddle',
  ratingText: '1 out of 5',
  body: 'Buy cheap watches at example.test.',
  firstName: reviewCopy.display.anonymousGuest,
  status: 'hidden',
  writtenLabel: 'Sun, Nov 8, 9:00 AM EST',
};
