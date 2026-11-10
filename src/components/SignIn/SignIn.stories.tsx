import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { PageHeading } from '@/components/PageHeading';
import type { SignInFormState } from '@/lib/signIn';
import { ConfirmSignIn } from './ConfirmSignIn';
import { SignInForm } from './SignInForm';
import { SignInProblem } from './SignInProblem';

// One story per state of the sign-in pages: the empty form, each refusal, pending, the check-your-email notice, each link problem, and the confirm page.
const meta = {
  title: 'Account/SignIn',
  component: SignInForm,
  args: {
    next: '/',
    action: () =>
      Promise.resolve<SignInFormState>({
        status: 'sent',
        email: 'sam@example.com',
      }),
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme.
        rules: [
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'landmark-unique', enabled: false },
          // PageHeading is a header, and a story shows it outside the page's main landmark.
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <PageHeading title="Sign in">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof SignInForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
const email = 'sam@example.com';
const initial = (initialState: SignInFormState) => ({
  initialState,
});

export const EmptyMobile: Story = { globals: mobile };
export const EmptyDesktop: Story = { globals: desktop };
export const InvalidAddress: Story = {
  args: initial({ status: 'invalid', email: 'sam' }),
  globals: mobile,
};
export const RateLimited: Story = {
  args: initial({ status: 'rate_limited', email, retryAfterMinutes: 42 }),
  globals: mobile,
};
export const Failed: Story = {
  args: initial({ status: 'failed', email }),
  globals: mobile,
};
export const CheckYourEmail: Story = {
  args: { ...initial({ status: 'sent', email }), next: '/account' },
  globals: mobile,
};
export const CheckYourEmailDesktop: Story = {
  args: initial({ status: 'sent', email }),
  globals: desktop,
};

/** The button shows pending while the request is out. */
export const Pending: Story = {
  args: {
    action: () => new Promise<SignInFormState>(() => undefined),
  },
  globals: mobile,
  parameters: { ...meta.parameters, colorScheme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email'), email);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Email me a link' }),
    );
    await expect(
      canvas.getByRole('button', { name: 'Email me a link' }),
    ).toHaveAttribute('aria-busy', 'true');
  },
};

export const ExpiredOrUsedLink: StoryObj = {
  render: () => (
    <PageHeading title="Sign in">
      <SignInProblem problem="link_invalid" />
      <SignInForm next="/" action={() => Promise.resolve({ status: 'idle' })} />
    </PageHeading>
  ),
  decorators: [],
  globals: mobile,
};

export const LinkFailed: StoryObj = {
  render: () => (
    <PageHeading title="Sign in">
      <SignInProblem problem="failed" />
      <SignInForm next="/" action={() => Promise.resolve({ status: 'idle' })} />
    </PageHeading>
  ),
  decorators: [],
  globals: mobile,
};

export const ConfirmMobile: StoryObj = {
  render: () => (
    <PageHeading title="Finish signing in">
      <ConfirmSignIn token="AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf" next="/" />
    </PageHeading>
  ),
  decorators: [],
  globals: mobile,
};

export const ConfirmDesktop: StoryObj = {
  ...ConfirmMobile,
  globals: desktop,
};
