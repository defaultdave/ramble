import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { blocks } from '@/lib/seed/richText';
import { HelpArticleView } from './HelpArticleView';
import { HelpIndex } from './HelpIndex';

const articles = [
  {
    id: '1',
    slug: 'how-to-cancel-a-booking',
    title: 'How do I cancel a booking?',
    summary:
      'Use the link in your confirmation email, and read the dates first.',
  },
  {
    id: '2',
    slug: 'where-to-meet-my-host',
    title: 'Where do I meet my host?',
    summary: null,
  },
];

// One story per state of the help center: every article, a search with matches, a search with none, and an article.
const meta = {
  title: 'Help/HelpCenter',
  component: HelpIndex,
  args: { view: { kind: 'articles', articles } },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof HelpIndex>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };

export const IndexMobile: Story = { globals: mobile };
export const Results: Story = {
  args: {
    view: { kind: 'results', query: 'cancel', articles: articles.slice(0, 1) },
  },
  globals: mobile,
};
export const NoResults: Story = {
  args: { view: { kind: 'none', query: 'zzz' } },
  globals: mobile,
};
export const Article: Story = {
  render: () => (
    <HelpArticleView
      article={{
        title: 'How do I cancel a booking?',
        summary: 'Use the link in your confirmation email.',
        body: blocks('Open the link and choose Cancel.', {
          heading: 'What you get back',
        }),
      }}
    />
  ),
  globals: mobile,
};
