import 'server-only';
import { render } from 'react-email';
import type { ReactElement } from 'react';
import { RenderedEmailSchema, type RenderedEmail } from '@/lib/email/message';
import {
  attachmentsFor,
  subjectFor,
  type EmailRequest,
  type EmailTemplateData,
  type EmailTemplateName,
} from '@/lib/email/templates';
import { BookingCancellation } from './templates/BookingCancellation';
import { BookingRefund } from './templates/BookingRefund';
import { DevCheck } from './templates/DevCheck';
import { GuestConfirmation } from './templates/GuestConfirmation';
import { HostBookingNotice } from './templates/HostBookingNotice';
import { PaidAfterLapse } from './templates/PaidAfterLapse';

type Markup = {
  [Name in EmailTemplateName]: (
    data: EmailTemplateData<Name>,
    helpUrl: string,
  ) => ReactElement;
};

const markup: Markup = {
  'dev-check': (data, helpUrl) => <DevCheck data={data} helpUrl={helpUrl} />,
  'guest-confirmation': (data, helpUrl) => (
    <GuestConfirmation data={data} helpUrl={helpUrl} />
  ),
  'host-booking-notice': (data, helpUrl) => (
    <HostBookingNotice data={data} helpUrl={helpUrl} />
  ),
  'booking-cancellation': (data, helpUrl) => (
    <BookingCancellation data={data} helpUrl={helpUrl} />
  ),
  'booking-refund': (data, helpUrl) => (
    <BookingRefund data={data} helpUrl={helpUrl} />
  ),
  'paid-after-lapse': (data, helpUrl) => (
    <PaidAfterLapse data={data} helpUrl={helpUrl} />
  ),
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
    attachments: attachmentsFor(request),
  });
}
