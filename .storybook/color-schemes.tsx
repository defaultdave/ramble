import type { Decorator } from '@storybook/nextjs-vite';
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

const light = declarations(tokensCss.slice(0, tokensCss.indexOf('@media')));
const darkBlock = tokensCss.slice(
  tokensCss.indexOf('prefers-color-scheme: dark'),
  tokensCss.indexOf('min-width: 768px'),
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

export const withColorSchemes: Decorator = (Story) => (
  <>
    <style>{scopedCss}</style>
    <div className="scheme-row">
      <div data-scheme="light">
        <Story />
      </div>
      <div data-scheme="dark">
        <Story />
      </div>
    </div>
  </>
);
