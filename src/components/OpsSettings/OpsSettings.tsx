import Link from 'next/link';
import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { experiencesPath } from '@/lib/experienceEditor';
import { errorProps, type FormAction } from '@/lib/opsForm';
import {
  settingsFieldProblems,
  type CancellationTierRow,
  type PausedExperienceSummary,
  type SettingsFormField,
  type SettingsFormValues,
} from '@/lib/opsSettings';
import { settingsBounds } from '@/lib/settings';
import styles from './OpsSettings.module.css';

export type OpsSettingsProps = {
  values: SettingsFormValues;
  action: FormAction;
  /** The fields the last try needed another look at, which the page read from the address. */
  problems: readonly SettingsFormField[];
  paused: PausedExperienceSummary;
  tiers: readonly CancellationTierRow[];
};

/** The settings form, the experiences paused one by one, and the cancellation tiers, which are read and never edited here. A plain form that works without script. */
export function OpsSettings({
  values,
  action,
  problems,
  paused,
  tiers,
}: OpsSettingsProps) {
  const errorFor = (field: SettingsFormField) =>
    errorProps(problems, settingsFieldProblems, field);
  return (
    <div className={styles.stack}>
      <form action={action} className={styles.form} noValidate>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Banner</legend>
          <Input
            name="bannerText"
            label="Banner text"
            hint={`Shown at the top of every guest page. Up to ${String(settingsBounds.bannerChars)} characters. Leave blank for no banner.`}
            defaultValue={values.bannerText}
            maxLength={settingsBounds.bannerChars}
            autoComplete="off"
            optional
            {...errorFor('bannerText')}
          />
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Switches</legend>
          <CheckField
            name="bookingsPaused"
            label="Pause bookings on every experience"
            defaultChecked={values.bookingsPaused}
          />
          <CheckField
            name="checkoutMaintenance"
            label="Mark checkout as under maintenance"
            defaultChecked={values.checkoutMaintenance}
          />
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Holds and payment</legend>
          <Input
            name="holdMinutes"
            label="Hold length (minutes)"
            hint={`How long a guest keeps their seats while they check out. ${String(settingsBounds.holdMinutes.min)} to ${String(settingsBounds.holdMinutes.max)}.`}
            defaultValue={values.holdMinutes}
            inputMode="numeric"
            autoComplete="off"
            required
            {...errorFor('holdMinutes')}
          />
          <Input
            name="paymentGraceMinutes"
            label="Payment grace (minutes)"
            hint={`How long a payment already in progress may outlive its hold. ${String(settingsBounds.paymentGraceMinutes.min)} to ${String(settingsBounds.paymentGraceMinutes.max)}.`}
            defaultValue={values.paymentGraceMinutes}
            inputMode="numeric"
            autoComplete="off"
            required
            {...errorFor('paymentGraceMinutes')}
          />
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Tax</legend>
          <Input
            name="taxRatePercent"
            label="Tax rate (percent)"
            hint="Applied to the ticket subtotal of taxable experiences. Up to 25, with up to four decimals, like 8.875."
            defaultValue={values.taxRatePercent}
            inputMode="decimal"
            autoComplete="off"
            required
            {...errorFor('taxRatePercent')}
          />
        </fieldset>
        <Button type="submit" size="lg">
          Save settings
        </Button>
      </form>
      <section className={styles.section} aria-labelledby="paused-heading">
        <h2 className={styles.heading} id="paused-heading">
          Paused experiences
        </h2>
        {paused.rows.length === 0 ? (
          <p className={styles.muted}>No experience is paused.</p>
        ) : (
          <ul className={styles.list}>
            {paused.rows.map((row) => (
              <li key={row.id} className={styles.item}>
                <Link href={row.href} className={styles.link}>
                  {row.name}
                  <span className={styles.muted}>{row.hostName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.muted}>
          {paused.moreHref === null ? null : (
            <>
              <Link href={paused.moreHref}>See every paused experience</Link>
              {'. '}
            </>
          )}
          Pause or unpause one experience from its own page in{' '}
          <Link href={experiencesPath}>Experiences</Link>.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="tiers-heading">
        <h2 className={styles.heading} id="tiers-heading">
          Cancellation tiers
        </h2>
        <p className={styles.muted}>
          Each experience uses one of these. They are shown here for reference
          and are not edited on this page.
        </p>
        <ul className={styles.list}>
          {tiers.map((tier) => (
            <li key={tier.id} className={styles.item}>
              <strong>{tier.name}</strong>
              <span>
                {tier.terms}
                {tier.isDefault ? ' (default)' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
