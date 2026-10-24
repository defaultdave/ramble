import type { Decorator } from '@storybook/nextjs-vite';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import tokensCss from '../src/styles/tokens.css?raw';

// tokens.css switches to dark with a media query, which a story cannot toggle.
// Re-scope its color and elevation declarations to a data attribute so both
// schemes render on one page, whatever the OS prefers.
function declarations(block: string): string {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^--(color|elevation)-/.test(line))
    .join('\n');
}

function indexOfOrThrow(marker: string): number {
  const index = tokensCss.indexOf(marker);
  if (index === -1) {
    throw new Error(
      `color-schemes: "${marker}" not found in tokens.css; the token build layout changed, update the slicing here.`,
    );
  }
  return index;
}

const light = declarations(tokensCss.slice(0, indexOfOrThrow('@media')));
const darkBlock = tokensCss.slice(
  indexOfOrThrow('prefers-color-scheme: dark'),
  indexOfOrThrow('min-width: 768px'),
);
const dark = `${light}\n${declarations(darkBlock)}`;

const scopedCss = `
[data-scheme='light'] { ${light} color-scheme: light; }
[data-scheme='dark'] { ${dark} color-scheme: dark; }
[data-scheme] {
  padding: var(--space-4);
  background: var(--color-bg-canvas);
  color: var(--color-text-primary);
  font-family: var(--font-family-body);
}
.scheme-row { display: grid; gap: 0; grid-template-columns: 1fr; }
@media (min-width: 768px) { .scheme-row { grid-template-columns: 1fr 1fr; } }
`;

type Scheme = 'light' | 'dark';

// An overlay renders in a portal under <body>, outside any wrapper div, so a
// story that opens one sets the scheme on <body> and shows one scheme at a time.
function SingleScheme({
  scheme,
  children,
}: {
  scheme: Scheme;
  children: ReactNode;
}) {
  useEffect(() => {
    document.body.dataset.scheme = scheme;
    return () => {
      delete document.body.dataset.scheme;
    };
  }, [scheme]);
  return <div data-scheme={scheme}>{children}</div>;
}

export const withColorSchemes: Decorator = (Story, context) => {
  const only = context.parameters.colorScheme as Scheme | undefined;
  return (
    <>
      <style>{scopedCss}</style>
      {only ? (
        <SingleScheme scheme={only}>
          <Story />
        </SingleScheme>
      ) : (
        <div className="scheme-row">
          <div data-scheme="light">
            <Story />
          </div>
          <div data-scheme="dark">
            <Story />
          </div>
        </div>
      )}
    </>
  );
};
