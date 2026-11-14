import { commonCopy } from './common';

/** Shared by the four group layouts: a page title reads "Title | Ramble", and a page with none reads "Ramble". */
export const siteMetadata = {
  title: {
    default: commonCopy.brand,
    template: `%s | ${commonCopy.brand}`,
  },
  description: 'A marketplace for things worth doing.',
} as const;
