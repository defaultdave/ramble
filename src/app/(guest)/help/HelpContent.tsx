import { HelpIndex } from '@/components/HelpCenter';
import { PageError } from '@/components/PageError';
import { buildHelpIndex, helpTitle, parseHelpQuery } from '@/lib/pages/help';
import { helpPath } from '@/lib/paths';
import { getHelpIndex, searchHelp } from '@/server/help';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

export async function HelpContent({
  searchParams,
}: Pick<PageProps<'/help'>, 'searchParams'>) {
  const query = parseHelpQuery((await searchParams).q);
  let articles;
  try {
    articles = query === null ? await getHelpIndex() : await searchHelp(query);
  } catch (error) {
    rethrowOrLog('The help articles could not be read', error);
    // Try again is a GET form, which drops a query string from its action, so it reloads the index.
    return (
      <PageError
        title={helpTitle}
        alertTitle="We couldn't load the help articles"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={helpPath}
      />
    );
  }
  return <HelpIndex view={buildHelpIndex(query, articles)} />;
}
