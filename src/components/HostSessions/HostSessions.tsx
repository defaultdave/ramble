import { ButtonLink } from '@/components/Button';
import { AccountControl } from '@/components/Header/AccountControl';
import { PageHeading } from '@/components/PageHeading';
import type { HostWeekRowView, HostWeekView } from '@/lib/hostSessions';
import {
  AddOneOffForm,
  EditSessionForms,
  PublishWeekForm,
  type HostSessionActions,
} from './HostSessionForms';
import styles from './HostSessions.module.css';

export const hostSessionsTitle = 'Sessions';

function SessionRow({
  row,
  actions,
}: {
  row: HostWeekRowView;
  actions: HostSessionActions | null;
}) {
  return (
    <li className={styles.row}>
      <p className={styles.primary}>{row.experienceName}</p>
      <p className={styles.secondary}>
        {row.timeLabel} · {row.statusLabel}
      </p>
      <p className={styles.secondary}>
        {row.soldLabel}
        {row.priceLabel ? ` · ${row.priceLabel}` : ''}
      </p>
      {row.editable && actions ? (
        <EditSessionForms row={row} actions={actions} />
      ) : null}
    </li>
  );
}

/**
 * The host's week: sessions by day with what may change on each, publishing the week from the weekly
 * slots, and one-off dates. With no `actions` (read-only staff) it shows the days and nothing to change.
 */
export function HostSessions({
  view,
  actions,
}: {
  view: HostWeekView;
  actions: HostSessionActions | null;
}) {
  return (
    <>
      <PageHeading title={hostSessionsTitle}>
        <p>{view.hostName}</p>
        <AccountControl signedIn />
      </PageHeading>
      <div className={styles.sections}>
        <nav aria-label="Week" className={styles.weekNav}>
          <p className={styles.week}>{view.weekLabel}</p>
          {view.prevHref ? (
            <ButtonLink href={view.prevHref} variant="secondary">
              Previous week
            </ButtonLink>
          ) : null}
          {view.thisWeekHref ? (
            <ButtonLink href={view.thisWeekHref} variant="secondary">
              This week
            </ButtonLink>
          ) : null}
          {view.nextHref ? (
            <ButtonLink href={view.nextHref} variant="secondary">
              Next week
            </ButtonLink>
          ) : null}
        </nav>
        <p className={styles.secondary}>Times are in {view.timeZone}.</p>
        {actions ? (
          <section>
            <h2 className={styles.heading}>Publish this week</h2>
            <p className={styles.secondary}>
              Sessions from your weekly slots are bookable as soon as they
              exist. Publishing adds any that are missing this week and leaves
              edited or cancelled ones as they are.
            </p>
            <PublishWeekForm
              weekStart={view.weekStart}
              action={actions.publishWeek}
            />
          </section>
        ) : null}
        <section>
          <h2 className={styles.heading}>Sessions</h2>
          {view.days.length === 0 ? (
            <p className={styles.empty}>No sessions this week.</p>
          ) : (
            view.days.map((day) => (
              <div key={day.date}>
                <h3 className={styles.day}>{day.label}</h3>
                <ul className={styles.list}>
                  {day.sessions.map((row) => (
                    <SessionRow key={row.id} row={row} actions={actions} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        {actions ? (
          <section>
            <h2 className={styles.heading}>Add a one-off session</h2>
            {view.experiences.length === 0 ? (
              <p className={styles.empty}>You have no experiences yet.</p>
            ) : (
              <AddOneOffForm view={view} action={actions.addOneOff} />
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
