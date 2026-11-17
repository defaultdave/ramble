import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import { opsDashboardCopy } from '@/lib/copy/opsDashboard';
import type { DashboardTile } from '@/lib/opsDashboard';
import { auditPath, type AuditViewRow } from '@/lib/staffAdmin';
import styles from './OpsDashboard.module.css';

export type OpsDashboardProps = {
  tiles: readonly DashboardTile[];
  recentAudit: readonly AuditViewRow[];
};

/** The ops landing's counts, each linking to its queue, and the latest audit rows. */
export function OpsDashboard({ tiles, recentAudit }: OpsDashboardProps) {
  return (
    <>
      <section aria-labelledby="ops-glance" className={styles.section}>
        <h2 id="ops-glance" className={styles.heading}>
          {opsDashboardCopy.heading}
        </h2>
        <ul className={styles.tiles}>
          {tiles.map((tile) => (
            <li key={tile.id} className={styles.tile}>
              <Link href={tile.href} className={styles.link}>
                {tile.label}
              </Link>
              <span className={styles.status}>{tile.status}</span>
              {tile.needsAttention ? (
                <StatusBadge
                  tone="warning"
                  label={opsDashboardCopy.needsAttention}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ops-recent" className={styles.section}>
        <h2 id="ops-recent" className={styles.heading}>
          {opsDashboardCopy.audit.heading}
        </h2>
        {recentAudit.length === 0 ? (
          <p className={styles.empty}>{opsDashboardCopy.audit.empty}</p>
        ) : (
          <ul className={styles.audit}>
            {recentAudit.map((row) => (
              <li key={row.id} className={styles.auditRow}>
                <span className={styles.action}>{row.action}</span>
                <span className={styles.detail}>
                  {opsDashboardCopy.audit.actorAndTime(row.actor, row.time)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href={auditPath} className={styles.link}>
          {opsDashboardCopy.audit.link}
        </Link>
      </section>
    </>
  );
}
