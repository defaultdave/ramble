import 'server-only';
import { render } from 'react-email';
import type { ReactElement } from 'react';
import { RenderedEmailSchema, type RenderedEmail } from '@/lib/email/message';
import {
  subjectFor,
  type EmailRequest,
  type EmailTemplateData,
  type EmailTemplateName,
} from '@/lib/email/templates';
import { DevCheck } from './templates/DevCheck';

type Markup = {
  [Name in EmailTemplateName]: (
    data: EmailTemplateData<Name>,
    helpUrl: string,
  ) => ReactElement;
};

const markup: Markup = {
  'dev-check': (data, helpUrl) => <DevCheck data={data} helpUrl={helpUrl} />,
};

// Generic so each template's markup receives exactly that template's data.
function markupFor<Name extends EmailTemplateName>(
  request: { [N in Name]: { template: N; data: EmailTemplateData<N> } }[Name],
  helpUrl: string,
): ReactElement {
  return markup[request.template](request.data, helpUrl);
}

/**
 * Renders a request to its subject, HTML, and plain-text parts. Throws when a part is empty or
 * over the size limit: an email that cannot be stored or sent is refused, not trimmed.
 */
export async function renderEmail(
  request: EmailRequest,
  appUrl: string,
): Promise<RenderedEmail> {
  const element = markupFor(request, new URL('/help', appUrl).toString());
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return RenderedEmailSchema.parse({
    subject: subjectFor(request),
    html,
    text,
  });
}
