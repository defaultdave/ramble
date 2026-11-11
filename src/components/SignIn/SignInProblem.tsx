import { Alert } from '@/components/Alert';
import { signInProblemCopy, type SignInProblem as Problem } from '@/lib/signIn';
import styles from './SignIn.module.css';

/** What went wrong with a link, shown above the form that asks for another. */
export function SignInProblem({ problem }: { problem: Problem }) {
  const { tone, title, body } = signInProblemCopy(problem);
  return (
    <div className={styles.notice}>
      <Alert tone={tone} title={title} body={body} />
    </div>
  );
}
