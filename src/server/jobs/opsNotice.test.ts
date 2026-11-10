import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsNoticeData } from '@/lib/email/opsNotice';
import { jobLimits } from '@/lib/jobs';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  getEmailConfig: vi.fn(),
}));

vi.mock('@/server/ports/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/server/ports/email/config', () => ({
  getEmailConfig: mocks.getEmailConfig,
}));

import { sendOpsNotice } from './opsNotice';
import { jobRegistry } from './registry';

// Behaviours under test, one per decision or risk:
// - the notice goes to the support address, with the payload as the template data
// - the idempotency key is the job id, so a retry or a second run delivers one message
// - a failed send rejects, so the job is retried
// - the kind is registered with the default attempts and a payload schema that refuses a payload the template would refuse

const payload: OpsNoticeData = {
  subject: 'Contact form: A booking',
  fields: [{ label: 'Name', value: 'Pat' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getEmailConfig.mockReturnValue({ replyTo: 'support@ramble.invalid' });
  mocks.sendEmail.mockResolvedValue({});
});

describe('sendOpsNotice', () => {
  it('sends the payload to the support address, keyed on the job', async () => {
    await sendOpsNotice({ payload, jobId: 'job-1' });

    expect(mocks.sendEmail).toHaveBeenCalledWith({
      template: 'ops-notice',
      to: 'support@ramble.invalid',
      data: payload,
      idempotencyKey: 'ops-notice:job-1',
    });
  });

  it('rejects when the send fails, so the job is tried again', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('provider down'));

    await expect(sendOpsNotice({ payload, jobId: 'job-1' })).rejects.toThrow(
      'provider down',
    );
  });
});

describe('the ops-notice job kind', () => {
  it('is registered with the default attempts', () => {
    expect(jobRegistry['ops-notice'].maxAttempts).toBe(
      jobLimits.defaultMaxAttempts,
    );
  });

  it.each([
    ['no fields', { subject: 's', fields: [] }],
    ['no subject', { fields: [{ label: 'a', value: 'b' }] }],
  ])('refuses a payload with %s', (_label, bad) => {
    expect(jobRegistry['ops-notice'].payload.safeParse(bad).success).toBe(
      false,
    );
  });
});
