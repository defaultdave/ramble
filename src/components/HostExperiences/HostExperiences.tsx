import Link from 'next/link';
import { PageHeading } from '@/components/PageHeading';
import { StatusBadge } from '@/components/StatusBadge';
import { hostDashboardPath } from '@/lib/hostDashboard';
import type {
  HostExperienceRowView,
  HostExperiencesView,
} from '@/lib/hostExperiences';
import styles from './HostExperiences.module.css';

export const hostExperiencesTitle = 'Your experiences';

function ExperienceCard({ row }: { row: HostExperienceRowView }) {
  return (
    <li className={styles.card}>
      <h2 className={styles.name}>{row.name}</h2>
      <StatusBadge tone={row.statusTone} label={row.statusLabel} />
      <dl className={styles.facts}>
        <dt>Prices</dt>
        <dd>{row.prices.length === 0 ? 'None set' : row.prices.join(' · ')}</dd>
        <dt>Cancellation</dt>
        <dd>{row.cancellation}</dd>
        <dt>Waiver</dt>
        <dd>{row.waiver}</dd>
      </dl>
    </li>
  );
}

/** The host's own experiences in every status, read only: Ramble changes them, so the page says who to ask. */
export function HostExperiences({ view }: { view: HostExperiencesView }) {
  return (
    <>
      <PageHeading title={hostExperiencesTitle}>
        <p>
          <Link href={hostDashboardPath}>Back to the dashboard</Link>
        </p>
        <p>To change an experience, contact Ramble.</p>
      </PageHeading>
      <div className={styles.body}>
        {view.rows.length === 0 ? (
          <p className={styles.empty}>No experiences yet.</p>
        ) : (
          <ul className={styles.list}>
            {view.rows.map((row) => (
              <ExperienceCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
