import type { CuratedFixtures } from '../types';
import { catalogHosts } from './catalogHosts';
import { guideExperiences } from './catalogGuides';
import { makerExperiences } from './catalogMakers';
import { outdoorExperiences } from './catalogOutdoors';
import { collections, homeModules, pageCopy } from './editorial';
import { experiences, hosts } from './experiences';
import { helpArticles } from './help';
import { legal } from './legal';
import { categories, neighborhoods } from './taxonomy';

// The coverage set first, then the curated catalog around it.
export const curated: CuratedFixtures = {
  categories,
  neighborhoods,
  hosts: [...hosts, ...catalogHosts],
  experiences: [
    ...experiences,
    ...makerExperiences,
    ...outdoorExperiences,
    ...guideExperiences,
  ],
  legal,
  collections,
  homeModules,
  pageCopy,
  helpArticles,
};
