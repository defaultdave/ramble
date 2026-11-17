import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { RichTextDoc } from '@/lib/richText/format';
import { RichTextEditor } from './RichTextEditor';

// One story per state of the editor: a document with every kind of block, an empty one, and a refused one.
const full: RichTextDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Before you book' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read the ' },
        {
          type: 'text',
          text: 'cancellation rules',
          marks: [{ type: 'link', attrs: { href: '/help/how-to-cancel' } }],
        },
        { type: 'text', text: ', then ' },
        { type: 'text', text: 'choose a date', marks: [{ type: 'bold' }] },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Arrive early' }],
            },
          ],
        },
      ],
    },
  ],
};

const meta = {
  title: 'Ops/RichTextEditor',
  component: RichTextEditor,
  args: { name: 'body', label: 'Body', initial: full },
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme.
        rules: [
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithContent: Story = {};

export const Empty: Story = {
  args: { initial: { type: 'doc', content: [] } },
};

export const Refused: Story = {
  args: {
    initial: { type: 'doc', content: [] },
    errorText: 'Add some text to the body before publishing.',
  },
};
