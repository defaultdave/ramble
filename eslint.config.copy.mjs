// Interface text lives in src/lib/copy/ (the text dictionary). These rules keep new literals out of
// components and pages, and keep client islands from pulling more of the dictionary than they render.

// Folders whose copy has moved into the dictionary. Each one turns the rules below from warnings
// into errors. Empty until a phase migrates a folder, e.g. 'src/components/BookingChoices'.
const copyErrorFolders = [];

// The warnings are what the unmigrated code would report, and CI runs `eslint --max-warnings 0`,
// so they stay off in `pnpm lint` and show in `pnpm lint:copy`, which sets COPY_LINT.
const copyWarningLevel = process.env.COPY_LINT ? 'warn' : 'off';

const literalAttributeMessage =
  'Interface text lives in src/lib/copy/, not in a literal attribute.';
const literalAttributeSelector = (attributes) =>
  `JSXAttribute[name.name=/^(${attributes.join('|')})$/]:matches([value.type='Literal'], [value.expression.type='Literal'])`;

const copyAttributes = ['aria-label', 'title', 'placeholder', 'alt'];

const copyRules = (level) => ({
  'react/jsx-no-literals': [
    level,
    {
      noStrings: true,
      // Attributes are checked by the selector below, which names only the four that hold copy.
      ignoreProps: true,
      allowedStrings: ['·', ',', '/', '(', ')'],
    },
  ],
  'no-restricted-syntax': [
    level,
    {
      selector: literalAttributeSelector(copyAttributes),
      message: literalAttributeMessage,
    },
  ],
});

const copyScope = {
  files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
  ignores: ['**/*.test.tsx', '**/*.stories.tsx'],
};

const areaFileOf = (source) => {
  const match = /(?:^|\/)lib\/copy(?:\/(.*))?$/.exec(source);
  return match ? (match[1] ?? '') : null;
};

// Shared by every area: `format` holds helpers and no sentences, `common` is small.
const sharedCopyFiles = new Set(['common', 'format']);
// Read on the server only: metadata, and the email templates.
const serverOnlyCopy = /^(meta|email(\/|$))/;

/** @type {import('eslint').Rule.RuleModule} */
const clientCopyImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      index:
        'A client file imports the dictionary file it renders from, not the folder index.',
      serverOnly: 'Metadata and email copy are read on the server only.',
      second:
        'A client file imports one area file from src/lib/copy/ (plus common and format). Take the rest from the server parent as props.',
    },
  },
  create(context) {
    let isClient = false;
    let areaFiles = 0;

    const check = (node) => {
      if (!isClient || !node.source || typeof node.source.value !== 'string') {
        return;
      }
      if (node.importKind === 'type' || node.exportKind === 'type') return;
      const file = areaFileOf(node.source.value);
      if (file === null) return;
      if (file === '' || file === 'index') {
        context.report({ node, messageId: 'index' });
      } else if (serverOnlyCopy.test(file)) {
        context.report({ node, messageId: 'serverOnly' });
      } else if (!sharedCopyFiles.has(file) && ++areaFiles > 1) {
        context.report({ node, messageId: 'second' });
      }
    };

    return {
      Program(program) {
        isClient = program.body.some(
          (statement) =>
            statement.type === 'ExpressionStatement' &&
            statement.directive === 'use client',
        );
      },
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export const copyConfigs = [
  {
    name: 'ramble/copy/warnings',
    ...copyScope,
    rules: copyRules(copyWarningLevel),
  },
  ...(copyErrorFolders.length === 0
    ? []
    : [
        {
          name: 'ramble/copy/migrated-folders',
          files: copyErrorFolders.map((folder) => `${folder}/**/*.tsx`),
          ignores: copyScope.ignores,
          rules: copyRules('error'),
        },
      ]),
  {
    name: 'ramble/copy/client-imports',
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'ramble-copy': { rules: { 'client-copy-imports': clientCopyImports } },
    },
    rules: { 'ramble-copy/client-copy-imports': 'error' },
  },
];
