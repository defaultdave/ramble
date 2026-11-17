import type { NoticeText } from '../opsForm';

type Notices = { notices: Record<string, NoticeText>; [key: string]: unknown };

// The ops editorial sections for page copy, guide entries, legal documents, and the categories and
// neighborhoods themselves.

export const opsEditorialContentCopy = {
  loading: 'Loading…',
  nav: {
    pages: {
      label: 'Page copy',
      summary:
        'Write the words on each category and neighborhood page, then publish them.',
    },
    guides: {
      label: 'Guide entries',
      summary: 'Set where each guide-only entry sends guests.',
    },
    legal: {
      label: 'Legal documents',
      summary:
        'Draft the next version of the terms, privacy policy, agreements and waivers.',
    },
    taxonomy: {
      label: 'Categories and neighborhoods',
      summary: 'Add, rename, reorder and retire them.',
    },
  },
  kindLabels: {
    category: 'Category',
    neighborhood: 'Neighborhood',
  },
  pages: {
    title: 'Page copy',
    editTitle: 'Edit page copy',
    back: 'Back to the page copy',
    intro:
      'Each category and neighborhood page can carry a heading, a description for search results, and text. A page with no published copy shows its standard words.',
    failed: 'The pages could not be loaded.',
    captions: {
      category: 'Category pages',
      neighborhood: 'Neighborhood pages',
    },
    columns: {
      name: 'Name',
      slug: 'Address',
      copy: 'Copy',
      updated: 'Updated',
    },
    states: { none: 'No copy yet', retired: 'Retired' },
    empty: {
      title: 'Nothing to write yet',
      body: 'Add a category or a neighborhood first.',
    },
    fields: {
      heading: 'Heading',
      headingHint: 'Leave it blank to use the standard heading.',
      metaDescription: 'Description for search results',
      metaDescriptionHint: 'One or two sentences. Optional.',
      intro: 'Introduction',
      body: 'Text',
    },
    problems: {
      heading: (max: number) =>
        `Keep the heading to ${String(max)} characters.`,
      metaDescription: (max: number) =>
        `Keep the description to ${String(max)} characters.`,
      intro: 'Check the introduction and each link.',
      body: 'Check the text and each link.',
    },
    notices: {
      saved: { tone: 'success', title: 'Saved.' },
      published: {
        tone: 'success',
        title: 'Published. Guests can read it now.',
      },
      unpublished: {
        tone: 'info',
        title: 'Taken down. Guests no longer see it, and the draft is kept.',
      },
      not_found: {
        tone: 'warning',
        title: 'That page could not be found.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
  guides: {
    title: 'Guide entries',
    editTitle: 'Guide entry',
    back: 'Back to the guide entries',
    intro:
      'A guide-only entry is not bookable on Ramble. It sends guests to the host, through the link-out address or, where there is one, the affiliate address.',
    caption: 'Guide-only entries',
    failed: 'The guide entries could not be loaded.',
    columns: { name: 'Entry', host: 'Host', category: 'Category' },
    empty: {
      title: 'No guide entries',
      body: 'An experience set to guide-only in its details appears here.',
    },
    fields: {
      linkOutUrl: 'Link-out address',
      linkOutUrlHint:
        'Where guests go to book with the host. A guide entry cannot be saved without one.',
      affiliateUrl: 'Affiliate address',
      affiliateUrlHint:
        'Optional. When there is one, guests are sent here and the link is marked as sponsored.',
      save: 'Save links',
    },
    editExperience: 'Edit all details of this experience',
    notices: {
      updated: { tone: 'success', title: 'Links saved.' },
      unchanged: {
        tone: 'info',
        title: 'Nothing was different, so nothing was saved.',
      },
      not_a_guide: {
        tone: 'warning',
        title:
          'That entry is not guide-only any more. Edit it with the other experiences.',
      },
      not_found: { tone: 'warning', title: 'That entry could not be found.' },
      reference_missing: {
        tone: 'warning',
        title:
          'Its category or neighborhood is no longer there. Edit it with the other experiences.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
  legal: {
    title: 'Legal documents',
    editTitle: 'Edit draft',
    editHeading: (document: string, version: number) =>
      `${document}, version ${String(version)}`,
    back: 'Back to the versions',
    backToDocuments: 'Back to the documents',
    intro:
      'Each document has numbered versions. A new version starts as a draft you can keep editing. Publishing makes it the current version for new acceptances, and a published version is final.',
    failed: 'The legal documents could not be loaded.',
    listLabel: 'Legal documents',
    kinds: {
      marketplace_terms: 'Marketplace terms',
      privacy_policy: 'Privacy policy',
      host_agreement: 'Host agreement',
      waiver: 'Waiver',
    },
    states: {
      none: 'No version yet.',
      notPublished: 'Nothing published yet.',
      published: (version: number) => `Version ${String(version)} is live.`,
      draftWaiting: (version: number) =>
        `Draft version ${String(version)} is waiting.`,
    },
    versions: {
      caption: 'Versions',
      columns: {
        version: 'Version',
        title: 'Title',
        status: 'Status',
        published: 'Published',
      },
      empty: {
        title: 'No versions yet',
        body: 'Write the first one below. It stays a draft until you publish it.',
      },
      versionLabel: (version: number) => `Version ${String(version)}`,
      editLabel: (version: number) => `Edit draft ${String(version)}`,
    },
    newDraft: {
      heading: 'Start the next version',
      hint: 'It starts from the newest version, so change only what is new.',
      submit: 'Start draft',
    },
    fields: { title: 'Title', body: 'Text' },
    actions: { save: 'Save draft', publish: 'Publish' },
    publishHint: 'Publishing is final: a published version cannot be edited.',
    problems: {
      title: (max: number) => `Add a title of up to ${String(max)} characters.`,
      body: 'Check the text and each link.',
    },
    notices: {
      drafted: {
        tone: 'success',
        title: 'Draft started. Open it below to edit.',
      },
      saved: { tone: 'success', title: 'Saved.' },
      published: {
        tone: 'success',
        title: 'Published. It is the current version now.',
      },
      not_a_draft: {
        tone: 'warning',
        title: 'That version is not a draft, so it cannot be changed.',
      },
      superseded: {
        tone: 'warning',
        title:
          'A newer version is already published. Start a new draft from it instead.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
  taxonomy: {
    title: 'Categories and neighborhoods',
    renameTitle: 'Rename',
    back: 'Back to the lists',
    intro:
      'Guests see these in the order below. Retiring one stops new experiences from using it; experiences that already use it keep it.',
    failed: 'The lists could not be loaded.',
    sections: { category: 'Categories', neighborhood: 'Neighborhoods' },
    listLabels: {
      category: 'Categories in order',
      neighborhood: 'Neighborhoods in order',
    },
    empty: { title: 'None yet', body: 'Add the first one below.' },
    states: { active: 'In use', retired: 'Retired' },
    actions: {
      up: 'Move up',
      down: 'Move down',
      retire: 'Retire',
      restore: 'Bring back',
      rename: 'Rename',
    },
    lastActive: 'The last one that is not retired cannot be retired.',
    reasons: { first: 'Already first.', last: 'Already last.' },
    add: {
      heading: {
        category: 'Add a category',
        neighborhood: 'Add a neighborhood',
      },
      name: 'Name',
      slug: 'Address',
      slugHint:
        'The last part of the page address, in lower-case words joined by hyphens. Leave it blank to make it from the name. It cannot be changed later.',
      submit: 'Add',
    },
    rename: {
      name: 'New name',
      hint: 'The address stays as it is.',
      submit: 'Save name',
    },
    problems: {
      name: (max: number) => `Enter a name of up to ${String(max)} characters.`,
      slug: 'Use lower-case words joined by hyphens, such as park-slope.',
    },
    notices: {
      added: { tone: 'success', title: 'Added at the end of the list.' },
      renamed: { tone: 'success', title: 'Renamed.' },
      moved: { tone: 'success', title: 'Moved.' },
      retired: {
        tone: 'info',
        title: 'Retired. Experiences that use it keep it; new ones cannot.',
      },
      restored: { tone: 'success', title: 'Brought back.' },
      unchanged: {
        tone: 'info',
        title: 'Nothing was different, so nothing was saved.',
      },
      stale: {
        tone: 'warning',
        title:
          'The list changed since this page loaded. Nothing was saved; check the list and try again.',
      },
      last_active: {
        tone: 'warning',
        title:
          'That is the last one that is not retired. An experience needs one to choose, so keep it.',
      },
      slug_taken: {
        tone: 'warning',
        title: 'Another one already uses that address. Choose another.',
      },
      name_taken: {
        tone: 'warning',
        title: 'Another one already has that name. Choose another.',
      },
      list_full: {
        tone: 'warning',
        title: 'The list is full. Retire one before adding another.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
} as const satisfies {
  loading: string;
  nav: unknown;
  kindLabels: unknown;
  pages: Notices;
  guides: Notices;
  legal: Notices;
  taxonomy: Notices;
};
