import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  HostExperiences,
  hostExperiencesTitle,
} from '@/components/HostExperiences';
import { hostExperiencesPath } from '@/lib/hostExperiences';
import { signInHref } from '@/lib/signIn';
import { loadHostExperiences } from '@/server/hostExperiences';

export const metadata: Metadata = { title: hostExperiencesTitle };

/** The same gate as the dashboard: sign in first, and anyone who owns no host sees the area's not-found page. */
export default async function HostExperiencesPage() {
  const result = await loadHostExperiences();
  if (result.status === 'signed_out') redirect(signInHref(hostExperiencesPath));
  if (result.status === 'refused') notFound();
  return <HostExperiences view={result.view} />;
}
