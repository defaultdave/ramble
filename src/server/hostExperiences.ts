import 'server-only';
import {
  hostExperiencesResult,
  type HostExperiencesResult,
} from '@/lib/hostExperiences';
import { listHostExperiences } from '@/server/db/catalog';
import { loadForHostArea } from './hostArea';

/** The experiences of the host the request's caller owns, in every status. */
export function loadHostExperiences(): Promise<HostExperiencesResult> {
  return loadForHostArea(listHostExperiences, hostExperiencesResult);
}
