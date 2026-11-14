import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { HiddenFields } from '@/components/HiddenFields';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { StatusBadge } from '@/components/StatusBadge';
import { clockUnits, opsDevPath, type OpsJobRow } from '@/lib/opsDev';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './OpsDev.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type OpsDevActions = {
  runJob: FormAction;
  drain: FormAction;
  pulse: FormAction;
  setClock: FormAction;
};

export type OpsDevConsoleProps = {
  rows: readonly OpsJobRow[];
  query: TableQuery;
  /** The test time now in words, or null when runs use the real time. */
  testTimeLabel: string | null;
  /** Whether this deployment lets a run use a test time at all (`DEMO_CLOCK`). */
  demoClockOn: boolean;
  actions: OpsDevActions;
};

const unitOptions = clockUnits.map((unit) => ({ value: unit, label: unit }));

/** The jobs and the three things a tester does to them on a deployment nothing runs by itself: run one, drain the queue, pulse. Every control is a plain form, so it works with no script. */
export function OpsDevConsole({
  rows,
  query,
  testTimeLabel,
  demoClockOn,
  actions,
}: OpsDevConsoleProps) {
  const columns: DataTableColumn<OpsJobRow>[] = [
    { id: 'kind', header: 'Job', rowHeader: true, cell: (row) => row.kind },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge tone={row.tone} label={row.statusLabel} />,
    },
    { id: 'attempts', header: 'Attempts', cell: (row) => row.attemptsLabel },
    { id: 'runAfter', header: 'Due', cell: (row) => row.runAfterLabel },
    {
      id: 'lastError',
      header: 'Last error',
      cell: (row) => row.lastError ?? 'None',
    },
    {
      id: 'run',
      header: 'Run',
      cell: (row) =>
        row.runnable ? (
          <form action={actions.runJob}>
            <HiddenFields fields={[['jobId', row.id]]} />
            <Button type="submit" variant="secondary">
              Run {row.kind}
            </Button>
          </form>
        ) : null,
    },
  ];

  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="run-heading">
        <h2 id="run-heading" className={styles.heading}>
          Run jobs
        </h2>
        <p className={styles.muted}>
          Nothing runs the pulse on this site by itself. Queued emails,
          reminders and refunds wait until someone runs them here.
        </p>
        <div className={styles.buttons}>
          <form action={actions.drain}>
            <Button type="submit">Drain the queue</Button>
          </form>
          <form action={actions.pulse}>
            <Button type="submit" variant="secondary">
              Trigger the pulse
            </Button>
          </form>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="clock-heading">
        <h2 id="clock-heading" className={styles.heading}>
          Test clock
        </h2>
        <p className={styles.muted} role="status">
          {testTimeLabel === null
            ? 'Runs use the real time.'
            : `Runs use ${testTimeLabel}.`}
        </p>
        {demoClockOn ? (
          <>
            <form action={actions.setClock} className={styles.form}>
              <HiddenFields fields={[['intent', 'set']]} />
              <Input
                name="at"
                label="Set the time (UTC)"
                type="datetime-local"
                required
              />
              <Button type="submit" variant="secondary">
                Set the clock
              </Button>
            </form>
            <form action={actions.setClock} className={styles.form}>
              <HiddenFields fields={[['intent', 'advance']]} />
              <div className={styles.amount}>
                <Input
                  name="amount"
                  label="Move on by"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={1}
                  required
                />
                <Select
                  name="unit"
                  label="Unit"
                  options={unitOptions}
                  defaultValue="days"
                />
              </div>
              <Button type="submit" variant="secondary">
                Move the clock on
              </Button>
            </form>
          </>
        ) : (
          <p className={styles.muted}>
            The demo clock is switched off on this deployment, so a test time
            cannot be set.
          </p>
        )}
        <form action={actions.setClock}>
          <HiddenFields fields={[['intent', 'reset']]} />
          <Button type="submit" variant="ghost">
            Back to the real time
          </Button>
        </form>
      </section>

      <DataTable
        caption="Latest jobs"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={opsDevPath}
        query={query}
        sort={{ column: 'created', direction: 'desc' }}
        cursor={null}
        nextCursor={null}
        empty={{
          title: 'No jobs yet',
          body: 'Jobs appear here as bookings, refunds and reminders queue them.',
        }}
      />
    </div>
  );
}
