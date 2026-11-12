import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ExperiencePhotoList } from '@/components/ExperienceEditor';
import { Select } from '@/components/Select';
import { StatusBadge } from '@/components/StatusBadge';
import {
  experiencePath,
  experienceStatusLabels,
  experienceStatusTones,
  type ExperienceEditView,
} from '@/lib/experienceEditor';
import {
  altNeededText,
  photosNeedingAlt,
  reviewListingFacts,
  rejectionReasonOptions,
} from '@/lib/experienceReview';
import styles from './ExperienceReview.module.css';

export type ExperienceReviewViewProps = {
  view: ExperienceEditView;
  approve: (formData: FormData) => void | Promise<void>;
  reject: (formData: FormData) => void | Promise<void>;
};

/**
 * One experience put forward for review: what it says, its photos with the alt text check, and the
 * two decisions as plain forms. An experience that is not in review shows where it stands and no
 * decision. The approval is always offered: the server refuses it and names the photos, and the
 * page names them ahead of time.
 */
export function ExperienceReviewView({
  view,
  approve,
  reject,
}: ExperienceReviewViewProps) {
  const needAlt = photosNeedingAlt(view.photos);
  return (
    <div className={styles.stack}>
      <div className={styles.summary}>
        <StatusBadge
          tone={experienceStatusTones[view.status]}
          label={experienceStatusLabels[view.status]}
        />
        <p className={styles.muted}>Host: {view.hostName}</p>
        <Link className={styles.cellLink} href={experiencePath(view.id)}>
          Open in the editor
        </Link>
      </div>
      <section className={styles.section} aria-labelledby="review-listing">
        <h2 className={styles.heading} id="review-listing">
          Listing
        </h2>
        {reviewListingFacts(view.content).map((fact) => (
          <p key={fact} className={styles.text}>
            {fact}
          </p>
        ))}
      </section>
      <section className={styles.section} aria-labelledby="review-photos">
        <h2 className={styles.heading} id="review-photos">
          Photos
        </h2>
        <ExperiencePhotoList photos={view.photos} />
        {needAlt.length > 0 ? (
          <Alert
            tone="warning"
            title="Approval will be refused until these photos have alt text."
            body={altNeededText(needAlt)}
          />
        ) : null}
      </section>
      {view.status === 'in_review' ? (
        <section className={styles.section} aria-labelledby="review-decide">
          <h2 className={styles.heading} id="review-decide">
            Decision
          </h2>
          <form action={approve} className={styles.section}>
            <input type="hidden" name="experienceId" value={view.id} />
            <Button type="submit">Approve and make live</Button>
          </form>
          <form action={reject} className={styles.section}>
            <input type="hidden" name="experienceId" value={view.id} />
            <Select
              name="reason"
              label="Reason for sending it back"
              placeholder="Choose a reason"
              options={rejectionReasonOptions}
              required
            />
            <Button type="submit" variant="secondary">
              Send back to draft
            </Button>
          </form>
        </section>
      ) : (
        <Alert tone="info" title="This experience is not waiting for review." />
      )}
    </div>
  );
}
