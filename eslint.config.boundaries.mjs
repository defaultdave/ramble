const root = import.meta.dirname;

const vendorSdkPatterns = [
  'drizzle-orm',
  'drizzle-orm/*',
  '@neondatabase/*',
  'better-auth',
  'better-auth/*',
  'stripe',
  'resend',
  '@vercel/blob',
  '@sentry/*',
  'botid',
  'botid/*',
  'web-vitals',
  'web-vitals/*',
];

const vendorWrapperFiles = [
  'src/server/db/**',
  'src/server/auth/**',
  'src/server/ports/**',
  'src/server/analytics/**',
  'src/server/monitoring/**',
];

const vendorMessage =
  'Vendor SDKs are imported only inside their wrapper folder (src/server/db, auth, ports/<port>, analytics, monitoring).';

const libPackagePatterns = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'next',
  'next/*',
  'server-only',
];

const boundaryMessage = (text) => ({ message: text });

export const boundaryConfigs = [
  {
    name: 'ramble/boundaries/layers',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          basePath: root,
          zones: [
            {
              target: './src/lib',
              from: ['./src/server', './src/components', './src/app'],
              ...boundaryMessage(
                'src/lib imports only src/lib and pure libraries.',
              ),
            },
            {
              target: './src/components',
              from: './src/app',
              ...boundaryMessage('Components never import from src/app.'),
            },
            {
              target: './src/components',
              from: './src/server',
              except: ['./actions'],
              ...boundaryMessage(
                'Components may import only src/server/actions (or types).',
              ),
            },
            {
              target: './src/server',
              from: ['./src/app', './src/components'],
              ...boundaryMessage(
                'The data layer never imports app or components.',
              ),
            },
          ],
        },
      ],
    },
  },
  {
    name: 'ramble/boundaries/vendor-sdks',
    files: ['src/**/*.{ts,tsx}'],
    ignores: vendorWrapperFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: vendorSdkPatterns, message: vendorMessage }] },
      ],
    },
  },
  {
    name: 'ramble/boundaries/lib-packages',
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: vendorSdkPatterns, message: vendorMessage },
            {
              group: libPackagePatterns,
              message:
                'src/lib holds plain functions: no React, Next.js, or server-only.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'ramble/boundaries/clock',
    files: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Read time from the clock port, or take `now` as an argument.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Read time from the clock port, or take `now` as an argument.',
        },
      ],
    },
  },
  {
    name: 'ramble/boundaries/clock-port',
    files: ['src/server/ports/clock/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

// eslint-plugin-import's no-restricted-paths cannot allow type-only imports, so the rule is
// wrapped to drop reports on them.

function isTypeOnly(sourceNode) {
  const declaration = sourceNode?.parent;
  if (!declaration) return false;
  if (declaration.type === 'ImportDeclaration') {
    if (declaration.importKind === 'type') return true;
    const { specifiers } = declaration;
    return (
      specifiers.length > 0 &&
      specifiers.every(
        (s) => s.type === 'ImportSpecifier' && s.importKind === 'type',
      )
    );
  }
  return (
    (declaration.type === 'ExportNamedDeclaration' ||
      declaration.type === 'ExportAllDeclaration') &&
    declaration.exportKind === 'type'
  );
}

function allowTypeImports(rule) {
  return {
    ...rule,
    create(context) {
      const filtered = Object.create(context, {
        report: {
          value(descriptor) {
            if (descriptor.node && isTypeOnly(descriptor.node)) return;
            context.report(descriptor);
          },
        },
      });
      return rule.create(filtered);
    },
  };
}

/**
 * Takes the flat configs that register the `import` plugin (eslint-config-next) and swaps
 * `import/no-restricted-paths` for the type-import-tolerant wrapper, keeping one plugin object.
 */
export function withTypeImportsAllowed(configs) {
  let patched;
  return configs.map((config) => {
    const plugin = config.plugins?.import;
    if (!plugin) return config;
    patched ??= {
      ...plugin,
      rules: {
        ...plugin.rules,
        'no-restricted-paths': allowTypeImports(
          plugin.rules['no-restricted-paths'],
        ),
      },
    };
    return { ...config, plugins: { ...config.plugins, import: patched } };
  });
}
