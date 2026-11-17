import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { HomeModuleForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  editableModule,
  homeModuleFieldNames,
  homeModulePath,
  homeNoticeCodes,
  homeNotices,
  homePath,
  pickOptions,
} from '@/lib/editorialHome';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveHomeModuleAction } from '@/server/actions/editorial';
import {
  listCollectionsForEditing,
  listHomeModulesForEditing,
} from '@/server/db/editorial';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialSectionsCopy.home;

export const metadata: Metadata = { title: copy.editTitle };

export default async function EditHomeModulePage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/home/[position]'>) {
  const [{ position }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={homeModulePath(position)} />;
  }

  const [modules, collections] = await Promise.all([
    listHomeModulesForEditing(caller),
    listCollectionsForEditing(caller),
  ]);
  const target = editableModule(modules, position);
  if (target === null) notFound();

  return (
    <PageHeading title={copy.kinds[target.kind]}>
      <p>
        <Link href={homePath}>{copy.back}</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          homeNotices,
          parseNotice(query.notice, homeNoticeCodes),
        )}
      />
      <HomeModuleForm
        module={target}
        position={Number(position)}
        picks={pickOptions(collections)}
        problems={parseProblemFields(query.fields, homeModuleFieldNames)}
        save={saveHomeModuleAction}
      />
    </PageHeading>
  );
}
