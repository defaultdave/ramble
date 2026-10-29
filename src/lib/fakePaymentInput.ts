import { z } from 'zod';
import {
  declineCodes,
  fakeWallets,
  type FakeConfirmPlan,
  type FakeConfirmResult,
} from '@/lib/fakePayment';

const maxIdLength = 255;

/**
 * What the fake card form may ask the gateway to record. Each outcome carries only the fields
 * that belong to it, so a decline without a reason, or a success with one, never parses.
 */
const PlanSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('succeeded'),
    method: z.enum(['card', ...fakeWallets]),
  }),
  z.object({
    outcome: z.literal('declined'),
    failureCode: z.enum(declineCodes),
  }),
  z.object({ outcome: z.literal('requires_action') }),
]) satisfies z.ZodType<FakeConfirmPlan>;

export const FakeConfirmInputSchema = z.object({
  paymentId: z.string().min(1).max(maxIdLength),
  clientSecret: z.string().min(1).max(maxIdLength),
  plan: PlanSchema,
});
export type FakeConfirmInput = z.output<typeof FakeConfirmInputSchema>;

/** What the gateway answers once it has recorded the plan. */
export function fakeConfirmResult(plan: FakeConfirmPlan): FakeConfirmResult {
  switch (plan.outcome) {
    case 'succeeded':
      return { status: 'succeeded' };
    case 'declined':
      return { status: 'declined', failureCode: plan.failureCode };
    case 'requires_action':
      return { status: 'requires_action' };
  }
}
