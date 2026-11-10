import { ButtonLink } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';
import { ConfirmSignIn, SignInProblem } from '@/components/SignIn';
import { ConfirmSignInSchema, safeNextPath, signInHref } from '@/lib/signIn';
import { firstQueryValue } from '@/lib/text';

export const confirmTitle = 'Finish signing in';

/**
 * Reads the link's token and destination from the address and shows the button. It never touches
 * Better Auth: opening this page uses nothing up. A token that cannot be a link's gets the same
 * answer a lapsed one does.
 */
export async function ConfirmContent({
  searchParams,
}: Pick<PageProps<'/sign-in/confirm'>, 'searchParams'>) {
  const query = await searchParams;
  const next = safeNextPath(firstQueryValue(query.next));
  const token = ConfirmSignInSchema.safeParse({
    token: firstQueryValue(query.token) ?? '',
  });
  if (!token.success) {
    return (
      <PageHeading title={confirmTitle}>
        <SignInProblem problem="link_invalid" />
        <div>
          <ButtonLink href={signInHref(next)} variant="secondary">
            Ask for a new link
          </ButtonLink>
        </div>
      </PageHeading>
    );
  }
  return (
    <PageHeading title={confirmTitle}>
      <ConfirmSignIn token={token.data.token} next={next} />
    </PageHeading>
  );
}
