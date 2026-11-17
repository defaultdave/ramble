import type { NoticeText } from '../opsForm';

type Notices = { notices: Record<string, NoticeText>; [key: string]: unknown };

// The ops editorial sections for the home page modules and the Ramble Picks collections.

export const opsEditorialSectionsCopy = {
  nav: {
    home: {
      label: 'Home page',
      summary:
        'Reorder the home page modules, switch them on or off, and edit their words.',
    },
    collections: {
      label: 'Collections',
      summary:
        'Write Ramble Picks, choose their experiences, and publish them.',
    },
  },
  home: {
    title: 'Home page',
    editTitle: 'Edit module',
    back: 'Back to the home page modules',
    intro:
      'Guests see the enabled modules in this order. A module with nothing to show is left out of the page.',
    listLabel: 'Home page modules',
    failed: 'The home page modules could not be loaded.',
    empty: {
      title: 'No modules yet',
      body: 'The home page shows nothing until modules are added.',
    },
    managedElsewhere: 'Managed with the gift guide.',
    states: { on: 'On', off: 'Off' },
    actions: {
      up: 'Move up',
      down: 'Move down',
      enable: 'Turn on',
      disable: 'Turn off',
      edit: 'Edit',
      save: 'Save module',
    },
    fields: {
      heading: 'Heading',
      headingHint: 'Leave it blank to use the standard heading.',
      body: 'Text',
      collection: 'Ramble Pick',
      collectionPlaceholder: 'Choose a Pick',
      draftSuffix: ' (draft)',
      enabled: 'Show this module on the home page',
    },
    noHeading: 'Standard heading',
    noCollection: 'No Pick chosen',
    kinds: {
      hero_search: 'Hero and search',
      category_rail: 'Category rail',
      picks: 'Ramble Picks',
      gift_guide: 'Gift guide',
      this_week: 'On this week',
      reassurance: 'Reassurance',
    },
    problems: {
      heading: (max: number) =>
        `Keep the heading to ${String(max)} characters.`,
      body: 'Check the text and each link.',
      collectionId: 'Choose a Ramble Pick from the list.',
    },
    notices: {
      moved: {
        tone: 'success',
        title: 'Moved. The home page shows the new order.',
      },
      enabled: {
        tone: 'success',
        title: 'Turned on. Guests can see it when it has something to show.',
      },
      disabled: { tone: 'info', title: 'Turned off. Guests no longer see it.' },
      saved: { tone: 'success', title: 'Saved.' },
      stale: {
        tone: 'warning',
        title:
          'The modules changed since this page loaded. Nothing was saved; check the list and try again.',
      },
      managed_elsewhere: {
        tone: 'warning',
        title: 'The gift guide module is not edited here.',
      },
      unknown_collection: {
        tone: 'warning',
        title: 'That Pick could not be found. Choose another.',
      },
      collection_kind_mismatch: {
        tone: 'warning',
        title: 'Choose a Ramble Pick for this module.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
  collections: {
    title: 'Collections',
    newTitle: 'New collection',
    editTitle: 'Edit collection',
    back: 'Back to the collections',
    newLink: 'New collection',
    newIntro: 'It starts as a draft. Add its experiences once it is saved.',
    caption: 'Ramble Picks',
    failed: 'The collections could not be loaded.',
    columns: {
      title: 'Title',
      slug: 'Address',
      entries: 'Experiences',
      status: 'Status',
      updated: 'Updated',
    },
    empty: {
      title: 'No collections yet',
      body: 'Write the first Pick: a draft stays hidden until you publish it.',
    },
    fields: {
      title: 'Title',
      slug: 'Address',
      slugHint:
        'The last part of the page address. Leave it blank to keep the current one, or to make it from the title for a new collection.',
      summary: 'Summary',
      intro: 'Introduction',
    },
    problems: {
      title: (max: number) => `Add a title of up to ${String(max)} characters.`,
      slug: 'Use lower-case words joined by hyphens, such as weekend-workshops.',
      summary: (max: number) =>
        `Keep the summary to ${String(max)} characters.`,
      intro: 'Check the introduction and each link.',
    },
    items: {
      heading: 'Experiences',
      empty: 'No experiences yet. Add one below.',
      listLabel: 'Experiences in this collection',
      none: 'This collection has no experiences to add: every experience is already listed.',
      add: {
        experience: 'Experience',
        experiencePlaceholder: 'Choose an experience',
        note: 'Note',
        noteHint: 'Optional. A line about why it is in this Pick.',
        submit: 'Add experience',
      },
      actions: { up: 'Move up', down: 'Move down', remove: 'Remove' },
      statusSuffix: (status: string) => ` (${status})`,
      unknownName: 'An experience that is no longer listed',
      problems: {
        note: (max: number) => `Keep the note to ${String(max)} characters.`,
        experienceId: 'Choose an experience from the list.',
      },
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
      slug_taken: {
        tone: 'warning',
        title: 'Another collection already uses that address. Choose another.',
      },
      not_found: {
        tone: 'warning',
        title: 'That collection could not be found.',
      },
      no_entries: {
        tone: 'warning',
        title: 'Add at least one experience before publishing.',
      },
      unknown_experience: {
        tone: 'warning',
        title: 'One of the experiences could not be found. Check the list.',
      },
      entry_added: { tone: 'success', title: 'Added to the collection.' },
      entry_removed: { tone: 'info', title: 'Removed from the collection.' },
      entry_moved: { tone: 'success', title: 'Moved.' },
      entry_stale: {
        tone: 'warning',
        title:
          'The list changed since this page loaded. Nothing was saved; check the list and try again.',
      },
      entry_listed: {
        tone: 'warning',
        title: 'That experience is already in the collection.',
      },
      list_full: {
        tone: 'warning',
        title:
          'The collection is full. Remove an experience before adding another.',
      },
      invalid: { tone: 'danger', title: 'Some details need another look.' },
    },
  },
} as const satisfies {
  nav: unknown;
  home: Notices;
  collections: Notices;
};
