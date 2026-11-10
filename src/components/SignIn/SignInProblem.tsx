import { Alert } from '@/components/Alert';
import type { SignInProblem as Problem } from '@/lib/signIn';
import styles from './SignIn.module.css';

const copy = {
  link_invalid: {
    tone: 'warning',
    title: 'This sign-in link has expired or was already used',
    body: 'A link works once and lasts 5 minutes. Ask for a new one below.',
  },
  failed: {
    tone: 'danger',
    title: 'We could not sign you in',
    body: 'Something went wrong on our side. Ask for a new link, or try again in a moment.',
  },
} as const;

/** What went wrong with a link, shown above the form that asks for another. */
export function SignInProblem({ problem }: { problem: Problem }) {
  const { tone, title, body } = copy[problem];
  return (
    <div className={styles.notice}>
      <Alert tone={tone} title={title} body={body} />
    </div>
  );
}
