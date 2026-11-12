import {
  listRows,
  nextCursorId,
  savedPhotos,
  savedView,
} from '@/components/ExperienceEditor/ExperienceEditor.fixtures';
import type {
  ExperienceEditView,
  ExperienceListRow,
} from '@/lib/experienceEditor';

export { nextCursorId };

export const queueRows: ExperienceListRow[] = listRows.map((row) => ({
  ...row,
  status: 'in_review',
}));

/** An experience in review whose photos are described and decorative, so it can be approved. */
export const reviewView: ExperienceEditView = {
  ...savedView,
  status: 'in_review',
  photos: savedPhotos,
};

/** The same experience with its second photo missing alt text. */
export const needsAltView: ExperienceEditView = {
  ...reviewView,
  photos: savedPhotos.map((photo, index) =>
    index === 1 ? { ...photo, decorative: false, altText: null } : photo,
  ),
};
