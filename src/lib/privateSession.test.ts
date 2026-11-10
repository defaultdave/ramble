import { describe, expect, it } from 'vitest';
import {
  privateRequestNotice,
  privateRequestSchema,
  privateSessionFieldErrors,
  privateSessionFieldMessages,
  privateSessionLimits,
  readPrivateSessionValues,
} from './privateSession';
import { opsNoticeLimits, OpsNoticeDataSchema } from './email/opsNotice';

// Behaviours under test, one per decision, branch or risk:
// - a valid request parses: text trimmed, the address folded, the budget in cents, an empty message as null
// - the date must be a real calendar date, and today or later in the venue's day
// - the group size is a whole number from 1 to the limit
// - the budget is whole dollars, typed with or without $ and commas, kept as integer cents, within its range
// - blank or over-long name, a bad address, and an over-long message are refused
// - a refusal is reported once per form field, in the form's words; the schema's budgetMinor key reads as the budget field
// - reading the form takes text fields only; a file or a missing field reads as empty
// - the ops notice labels every answer, leaves out an absent message, and fits what the notice accepts even for a long experience name

const today = '2026-11-10';
const schema = privateRequestSchema(today);

const valid = {
  date: '2026-12-01',
  groupSize: '12',
  budget: '1200',
  name: 'Pat Smith',
  email: 'pat@example.com',
  message: 'A birthday.',
};
const parse = (over: Record<string, string> = {}) =>
  schema.safeParse({ ...valid, budgetMinor: valid.budget, ...over });

describe('privateRequestSchema', () => {
  it('parses a valid request into the stored shape', () => {
    expect(
      schema.parse({
        ...valid,
        budgetMinor: ' $1,200 ',
        groupSize: ' 12 ',
        name: ' Pat Smith ',
        email: ' Pat@Example.COM ',
        message: '\nA birthday.\n',
      }),
    ).toEqual({
      date: '2026-12-01',
      groupSize: 12,
      budgetMinor: 120_000,
      name: 'Pat Smith',
      email: 'pat@example.com',
      message: 'A birthday.',
    });
  });

  it('reads an empty message as none', () => {
    expect(parse({ message: '  ' }).data?.message).toBeNull();
  });

  it.each([
    ['today', today],
    ['a later day', '2027-01-31'],
  ])('takes %s as the date', (_label, date) => {
    expect(parse({ date }).success).toBe(true);
  });

  it.each([
    ['yesterday', '2026-11-09'],
    ['a day that does not exist', '2026-02-30'],
    ['text that is not a date', 'soon'],
    ['a date with no leading zeros', '2026-12-1'],
    ['nothing', ''],
  ])('refuses %s as the date', (_label, date) => {
    expect(parse({ date }).success).toBe(false);
  });

  it.each([
    ['one person', '1', true],
    ['the largest group', String(privateSessionLimits.maxGroupSize), true],
    ['none', '0', false],
    ['over the limit', String(privateSessionLimits.maxGroupSize + 1), false],
    ['a fraction', '2.5', false],
    ['a negative', '-3', false],
    ['text', 'many', false],
    ['nothing', '', false],
  ])('group size: %s', (_label, groupSize, ok) => {
    expect(parse({ groupSize }).success).toBe(ok);
  });

  it.each([
    ['whole dollars', '500', 50_000],
    ['a dollar sign and a comma', '$2,500', 250_000],
    ['the smallest budget', '1', 100],
    [
      'the largest budget',
      String(privateSessionLimits.maxBudgetDollars),
      privateSessionLimits.maxBudgetDollars * 100,
    ],
  ])('budget: reads %s as cents', (_label, budget, minor) => {
    expect(parse({ budget, budgetMinor: budget }).data?.budgetMinor).toBe(
      minor,
    );
  });

  it.each([
    ['cents', '12.50'],
    ['zero', '0'],
    ['over the limit', String(privateSessionLimits.maxBudgetDollars + 1)],
    ['text', 'flexible'],
    ['a negative', '-5'],
    ['nothing', ''],
  ])('budget: refuses %s', (_label, budget) => {
    expect(parse({ budgetMinor: budget }).success).toBe(false);
  });

  it.each([
    ['a blank name', { name: '   ' }],
    [
      'a name over the limit',
      { name: 'x'.repeat(privateSessionLimits.nameMaxChars + 1) },
    ],
    ['an address with no domain', { email: 'pat' }],
    [
      'a message over the limit',
      { message: 'x'.repeat(privateSessionLimits.messageMaxChars + 1) },
    ],
  ])('refuses %s', (_label, over) => {
    expect(parse(over).success).toBe(false);
  });
});

describe('privateSessionFieldErrors', () => {
  it('reports each refused field once, in the form words, under the form field name', () => {
    const result = parse({
      date: 'soon',
      budgetMinor: 'lots',
      email: 'nope',
      name: ' ',
    });
    if (result.success) throw new Error('expected a refusal');

    expect(privateSessionFieldErrors(result.error)).toEqual({
      date: privateSessionFieldMessages.date,
      budget: privateSessionFieldMessages.budget,
      email: privateSessionFieldMessages.email,
      name: privateSessionFieldMessages.name,
    });
  });
});

describe('readPrivateSessionValues', () => {
  it('reads text, and reads a file or a missing field as empty', () => {
    const file = new File(['x'], 'x.txt');
    expect(
      readPrivateSessionValues((field) =>
        field === 'name' ? 'Pat' : field === 'email' ? file : undefined,
      ),
    ).toEqual({
      date: '',
      groupSize: '',
      budget: '',
      name: 'Pat',
      email: '',
      message: '',
    });
  });
});

describe('an over-long message end to end', () => {
  it('is read whole enough to be refused, never emptied into a valid request', () => {
    const typed = 'x'.repeat(privateSessionLimits.messageMaxChars * 5);
    const values = readPrivateSessionValues((field) =>
      field === 'message' ? typed : valid[field],
    );

    expect(values.message).not.toBe('');
    const result = parse({ message: values.message });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(privateSessionFieldErrors(result.error)).toEqual({
        message: privateSessionFieldMessages.message,
      });
    }
  });
});

describe('privateRequestNotice', () => {
  const request = schema.parse({ ...valid, budgetMinor: valid.budget });
  const stored = {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    experienceName: 'Pasta night',
  };

  it('labels every answer and names the request', () => {
    expect(privateRequestNotice(request, stored)).toEqual({
      subject: 'Private session request: Pasta night',
      fields: [
        { label: 'Experience', value: 'Pasta night' },
        { label: 'Name', value: 'Pat Smith' },
        { label: 'Email', value: 'pat@example.com' },
        { label: 'Date', value: '2026-12-01' },
        { label: 'Group size', value: '12' },
        { label: 'Budget', value: '$1,200.00' },
        { label: 'Message', value: 'A birthday.' },
        { label: 'Request ID', value: stored.id },
        { label: 'Received', value: '2026-11-10T12:00:00.000Z' },
      ],
    });
  });

  it('leaves the message out when there is none', () => {
    const labels = privateRequestNotice(
      { ...request, message: null },
      stored,
    ).fields.map(({ label }) => label);

    expect(labels).not.toContain('Message');
  });

  it('stays within what the notice accepts for the longest request and a long experience name', () => {
    const longest = schema.parse({
      ...valid,
      budgetMinor: valid.budget,
      name: 'n'.repeat(privateSessionLimits.nameMaxChars),
      message: 'm'.repeat(privateSessionLimits.messageMaxChars),
    });

    const notice = privateRequestNotice(longest, {
      ...stored,
      experienceName: 'e\ne'.repeat(300),
    });

    expect(notice.subject.length).toBeLessThanOrEqual(
      opsNoticeLimits.subjectMaxChars,
    );
    expect(notice.subject).not.toContain('\n');
    expect(OpsNoticeDataSchema.safeParse(notice).success).toBe(true);
  });
});
