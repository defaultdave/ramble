import type { CuratedFixtures } from '../types';
import { collections, homeModules, pageCopy } from './editorial';
import { experiences, hosts } from './experiences';
import { legal } from './legal';
import { categories, neighborhoods } from './taxonomy';

export const curated: CuratedFixtures = {
  categories,
  neighborhoods,
  hosts,
  experiences,
  legal,
  collections,
  homeModules,
  pageCopy,
};
