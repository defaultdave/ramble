import { PageHeading } from '@/components/PageHeading';
import { SignInForm, SignInProblem } from '@/components/SignIn';
import { safeNextPath, signInProblemFor } from '@/lib/signIn';
import { firstQueryValue } from '@/lib/text';
import { requestSignInLink } from '@/server/actions/signIn';

export const signInTitle = 'Sign in';

/** Reads `next` and `error` from the address: where to land, and why a link failed. */
export async function SignInContent({
  searchParams,
}: Pick<PageProps<'/sign-in'>, 'searchParams'>) {
  const query = await searchParams;
  const problem = signInProblemFor(firstQueryValue(query.error));
  return (
    <PageHeading title={signInTitle}>
      {problem ? <SignInProblem problem={problem} /> : null}
      <SignInForm
        action={requestSignInLink}
        next={safeNextPath(firstQueryValue(query.next))}
      />
    </PageHeading>
  );
}
