import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Textarea } from '@/components/Textarea';
import { reviewCopy } from '@/lib/copy/review';
import { browsePath, helpPath } from '@/lib/paths';
import {
  reviewLimits,
  type ReviewFormField,
  type ReviewScreen,
  type ReviewSummary,
} from '@/lib/reviews';
import styles from './ReviewForm.module.css';

/** `submitReviewForm`: posts the link's reference and token with the rating and the words, then sends the booker back to the page. */
export type ReviewFormAction = (formData: FormData) => Promise<void>;

export type ReviewFormProps = {
  screen: ReviewScreen;
  /** The session being reviewed; null when the link opened nothing. */
  summary: ReviewSummary | null;
  /** The link's own reference and token, posted back with the form. */
  reference: string;
  token: string;
  action: ReviewFormAction;
};

function Frame({
  summary,
  children,
}: {
  summary: ReviewSummary | null;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>{reviewCopy.eyebrow}</p>
        <h1 className={styles.heading}>
          {summary === null ? reviewCopy.heading : summary.experienceName}
        </h1>
        {summary === null ? null : (
          <p className={styles.meta}>
            {reviewCopy.form.hostLine(summary.hostName, summary.dayLabel)}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function StateNotice({
  tone,
  title,
  body,
  showExplore,
}: {
  tone: 'info' | 'success' | 'warning';
  title: string;
  body: string;
  showExplore: boolean;
}) {
  return (
    <>
      <Alert tone={tone} title={title} body={body} />
      <div className={styles.links}>
        {showExplore ? (
          <ButtonLink href={browsePath} variant="primary">
            {reviewCopy.links.explore}
          </ButtonLink>
        ) : null}
        <ButtonLink href={helpPath} variant="secondary">
          {reviewCopy.links.help}
        </ButtonLink>
      </div>
    </>
  );
}

function problemFor(
  problems: readonly ReviewFormField[],
  field: ReviewFormField,
): string | undefined {
  return problems.includes(field) ? reviewCopy.problems[field] : undefined;
}

/**
 * The review page. A server component that works with scripting off: the form posts the server
 * action, which redirects back here with the answer in the address, and the page reads the answer
 * from the booking. The rating is native radios and the words are a native textarea.
 */
export function ReviewForm({
  screen,
  summary,
  reference,
  token,
  action,
}: ReviewFormProps) {
  const states = reviewCopy.states;
  switch (screen.kind) {
    case 'invalid':
      return (
        <Frame summary={null}>
          <StateNotice
            tone="warning"
            title={states.invalid.title}
            body={states.invalid.body}
            showExplore
          />
        </Frame>
      );
    case 'too_many_tries':
      return (
        <Frame summary={null}>
          <Alert
            tone="warning"
            title={states.tooManyTries.title}
            body={states.tooManyTries.body(screen.retryAfterSeconds)}
          />
        </Frame>
      );
    case 'expired':
      return (
        <Frame summary={summary}>
          <StateNotice
            tone="info"
            title={states.expired.title}
            body={states.expired.body}
            showExplore
          />
        </Frame>
      );
    case 'already_reviewed':
      return (
        <Frame summary={summary}>
          <StateNotice
            tone="info"
            title={states.alreadyReviewed.title}
            body={states.alreadyReviewed.body}
            showExplore
          />
        </Frame>
      );
    case 'success':
      return (
        <Frame summary={summary}>
          <StateNotice
            tone="success"
            title={states.success.title}
            body={states.success.body}
            showExplore
          />
        </Frame>
      );
    case 'form': {
      const ratingProblem = problemFor(screen.problems, 'rating');
      const bodyProblem = problemFor(screen.problems, 'body');
      return (
        <Frame summary={summary}>
          {screen.problems.length > 0 ? (
            <Alert tone="danger" title={reviewCopy.problems.summary} />
          ) : null}
          <form action={action} className={styles.form}>
            <fieldset className={styles.rating}>
              <legend className={styles.legend}>
                {reviewCopy.form.ratingLegend}
              </legend>
              <div className={styles.options}>
                {reviewCopy.form.ratingOptions.map((option) => (
                  <label key={option.value} className={styles.option}>
                    <input
                      type="radio"
                      name="rating"
                      value={option.value}
                      required
                      className={styles.radio}
                    />
                    <span className={styles.optionNumber}>{option.label}</span>
                    <span className={styles.optionText}>
                      {option.description}
                    </span>
                  </label>
                ))}
              </div>
              {ratingProblem === undefined ? null : (
                <p role="alert" className={styles.problem}>
                  {ratingProblem}
                </p>
              )}
            </fieldset>
            <Textarea
              name="body"
              label={reviewCopy.form.bodyLabel}
              hint={reviewCopy.form.bodyHint(reviewLimits.bodyMaxChars)}
              {...(bodyProblem === undefined ? {} : { errorText: bodyProblem })}
              required
              maxLength={reviewLimits.bodyMaxChars}
              rows={6}
            />
            <p className={styles.fine}>{reviewCopy.form.note}</p>
            <input type="hidden" name="reference" value={reference} />
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="primary">
              {reviewCopy.form.submit}
            </Button>
          </form>
        </Frame>
      );
    }
    default:
      return screen satisfies never;
  }
}
