import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Textarea } from '@/components/Textarea';
import {
  ageRuleLabels,
  experienceFieldProblems,
  experienceLimits,
  labelledOptions,
  numberInputValue,
  priceFieldValue,
  taxTreatmentLabels,
  weatherPolicyLabels,
  type ExperienceChoices,
  type ExperienceContent,
  type ExperienceFormField,
} from '@/lib/experienceEditor';
import styles from './ExperienceEditor.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type ExperienceFormProps = {
  action: FormAction;
  /** Prefilled on edit; the create form starts from the shared defaults. */
  values: ExperienceContent;
  choices: ExperienceChoices;
  /** On edit, the experience being saved. Without it the form creates a draft for the chosen host. */
  experienceId?: string | undefined;
  /** A guide-only entry links out, so its link is required. */
  guideOnly?: boolean;
  /** The fields the last try needed another look at, which the page read from the address. */
  problems?: readonly ExperienceFormField[];
};

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/** One form for a new experience and for saving an existing one: every content field and the two price options. */
export function ExperienceForm({
  action,
  values,
  choices,
  experienceId,
  guideOnly = false,
  problems = [],
}: ExperienceFormProps) {
  const creating = experienceId === undefined;
  const problemText = (field: ExperienceFormField) =>
    problems.includes(field) ? experienceFieldProblems[field] : undefined;
  const errorFor = (field: ExperienceFormField) => {
    const errorText = problemText(field);
    return errorText === undefined ? {} : { errorText };
  };
  return (
    <form action={action} className={styles.form} noValidate>
      {experienceId ? (
        <input type="hidden" name="experienceId" value={experienceId} />
      ) : null}
      <Group legend="The experience">
        {creating ? (
          <Select
            name="hostId"
            label="Host"
            placeholder="Choose a host"
            options={choices.hosts}
            defaultValue=""
            required
            {...errorFor('hostId')}
          />
        ) : null}
        <Input
          name="name"
          label="Name"
          defaultValue={values.name}
          maxLength={experienceLimits.name}
          autoComplete="off"
          required
          {...errorFor('name')}
        />
        <Input
          name="slug"
          label="Address name"
          hint={
            creating
              ? 'Used in the experience address. Left empty, it is made from the name.'
              : 'Used in the experience address. The old address keeps working.'
          }
          defaultValue={values.slug}
          maxLength={experienceLimits.slug}
          autoComplete="off"
          optional={creating}
          required={!creating}
          {...errorFor('slug')}
        />
        <Textarea
          name="description"
          label="Description"
          defaultValue={values.description ?? undefined}
          maxLength={experienceLimits.description}
          optional
          {...errorFor('description')}
        />
        <Input
          name="meetingPoint"
          label="Meeting point"
          defaultValue={values.meetingPoint ?? undefined}
          maxLength={experienceLimits.meetingPoint}
          autoComplete="off"
          optional
          {...errorFor('meetingPoint')}
        />
        <Textarea
          name="included"
          label="What is included"
          defaultValue={values.included ?? undefined}
          maxLength={experienceLimits.included}
          optional
          {...errorFor('included')}
        />
        <Textarea
          name="accessibilityNotes"
          label="Accessibility notes"
          defaultValue={values.accessibilityNotes ?? undefined}
          maxLength={experienceLimits.accessibilityNotes}
          optional
          {...errorFor('accessibilityNotes')}
        />
        <Input
          name="durationMinutes"
          label="Duration in minutes"
          inputMode="numeric"
          defaultValue={numberInputValue(values.durationMinutes)}
          autoComplete="off"
          optional
          {...errorFor('durationMinutes')}
        />
      </Group>
      <Group legend="Where it sits">
        <div className={styles.pair}>
          <Select
            name="categoryId"
            label="Category"
            placeholder="Choose a category"
            options={choices.categories}
            defaultValue={values.categoryId}
            required
            {...errorFor('categoryId')}
          />
          <Select
            name="neighborhoodId"
            label="Neighborhood"
            placeholder="Choose a neighborhood"
            options={choices.neighborhoods}
            defaultValue={values.neighborhoodId}
            required
            {...errorFor('neighborhoodId')}
          />
        </div>
      </Group>
      <Group legend="Prices">
        <div className={styles.pair}>
          <Input
            name="adultPrice"
            label="Adult price (USD)"
            hint="A saved price can be changed but not removed."
            inputMode="decimal"
            defaultValue={priceFieldValue(values.adultPriceMinor)}
            autoComplete="off"
            optional
            {...errorFor('adultPrice')}
          />
          <Input
            name="childPrice"
            label="Child price (USD)"
            inputMode="decimal"
            defaultValue={priceFieldValue(values.childPriceMinor)}
            autoComplete="off"
            optional
            {...errorFor('childPrice')}
          />
        </div>
        <CheckField
          name="childUsesSpace"
          label="A child takes a space in the session."
          defaultChecked={values.childUsesSpace}
          problem={problemText('childUsesSpace')}
        />
      </Group>
      <Group legend="Rules">
        <Select
          name="cancellationTierId"
          label="Cancellation tier"
          hint="The shared tiers. They are read here and not edited."
          placeholder="Choose a tier"
          options={choices.cancellationTiers}
          defaultValue={values.cancellationTierId}
          required
          {...errorFor('cancellationTierId')}
        />
        <Select
          name="ageRule"
          label="Age rule"
          options={labelledOptions(ageRuleLabels)}
          defaultValue={values.ageRule}
          required
          {...errorFor('ageRule')}
        />
        <div className={styles.pair}>
          <Input
            name="minAge"
            label="Minimum age"
            hint="For a minimum age or an age range."
            inputMode="numeric"
            defaultValue={numberInputValue(values.minAge)}
            autoComplete="off"
            optional
            {...errorFor('minAge')}
          />
          <Input
            name="maxAge"
            label="Maximum age"
            hint="For an age range."
            inputMode="numeric"
            defaultValue={numberInputValue(values.maxAge)}
            autoComplete="off"
            optional
            {...errorFor('maxAge')}
          />
        </div>
        <CheckField
          name="outdoor"
          label="This experience is outdoors."
          defaultChecked={values.outdoor}
          problem={problemText('outdoor')}
        />
        <Select
          name="weatherPolicy"
          label="Weather policy"
          hint="Required for an outdoor experience."
          placeholder="No weather policy"
          options={labelledOptions(weatherPolicyLabels)}
          defaultValue={values.weatherPolicy ?? ''}
          optional
          {...errorFor('weatherPolicy')}
        />
        <Input
          name="weatherDecisionHours"
          label="Hours before the start the weather is decided"
          hint="For a policy decided before the start."
          inputMode="numeric"
          defaultValue={numberInputValue(values.weatherDecisionHours)}
          autoComplete="off"
          optional
          {...errorFor('weatherDecisionHours')}
        />
        <Select
          name="taxTreatment"
          label="Tax treatment"
          options={labelledOptions(taxTreatmentLabels)}
          defaultValue={values.taxTreatment}
          required
          {...errorFor('taxTreatment')}
        />
        <CheckField
          name="waiverRequired"
          label="Guests accept a waiver at checkout."
          defaultChecked={values.waiverRequired}
          problem={problemText('waiverRequired')}
        />
        <Select
          name="waiverDocumentId"
          label="Waiver"
          hint="The published version guests accept. Needed when a waiver is required."
          placeholder="No waiver"
          options={choices.waivers}
          defaultValue={values.waiverDocumentId ?? ''}
          optional
          {...errorFor('waiverDocumentId')}
        />
      </Group>
      <Group legend="Links">
        <Input
          name="linkOutUrl"
          type="url"
          label="Link-out address"
          hint={
            guideOnly
              ? 'A guide-only entry links out, so this is required.'
              : 'Where a guide-only entry sends guests.'
          }
          defaultValue={values.linkOutUrl ?? undefined}
          maxLength={experienceLimits.url}
          autoComplete="off"
          optional={!guideOnly}
          required={guideOnly}
          {...errorFor('linkOutUrl')}
        />
        <Input
          name="affiliateUrl"
          type="url"
          label="Affiliate address"
          defaultValue={values.affiliateUrl ?? undefined}
          maxLength={experienceLimits.url}
          autoComplete="off"
          optional
          {...errorFor('affiliateUrl')}
        />
      </Group>
      <Button type="submit" size="lg">
        {creating ? 'Create draft experience' : 'Save experience'}
      </Button>
    </form>
  );
}
