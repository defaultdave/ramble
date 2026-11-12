import { describe, expect, it } from 'vitest';
import { hostSettingsResult } from './hostSettings';
import {
  changedHostSettings,
  hostLimits,
  hostPageNotice,
  parseHostSettingsForm,
  type HostSettingsInput,
} from './hostSetup';

// Behaviours under test, one per decision, branch, or risk:
// - the form reads the three settings with the ops form's own parsing: text trimmed, the address lower-cased, a blank about text or address null
// - nothing but the three settings is read: a posted slug, time zone, owner or host id changes nothing and refuses nothing
// - every refused field is named, in form order, and nothing else: a blank or long name, a long about text, a bad address
// - a field longer than the raw limit is refused unread
// - the changed settings are exactly the ones that differ, in form order
// - a request is signed out, refused (no host, or a host that is gone), or shows the settings
// - the save notices are the ops host form's

const formOf = (fields: Record<string, unknown>) => (name: string) =>
  fields[name];

const filled = {
  name: '  Spoke & Saddle ',
  description: ' Two cycling teachers. ',
  notificationEmail: ' Bookings@Example.com ',
};

describe('parseHostSettingsForm', () => {
  it('reads a filled form, trimming and lower-casing the address', () => {
    expect(parseHostSettingsForm(formOf(filled))).toEqual({
      ok: true,
      value: {
        name: 'Spoke & Saddle',
        description: 'Two cycling teachers.',
        notificationEmail: 'bookings@example.com',
      },
    });
  });

  it('turns a blank about text and a blank address into null', () => {
    expect(
      parseHostSettingsForm(
        formOf({ name: 'Quill', description: '  ', notificationEmail: '' }),
      ),
    ).toEqual({
      ok: true,
      value: { name: 'Quill', description: null, notificationEmail: null },
    });
  });

  it('ignores the fields only ops may change, and a posted host id', () => {
    const result = parseHostSettingsForm(
      formOf({
        ...filled,
        slug: 'not a slug!',
        timeZone: 'Nowhere/Land',
        ownerEmail: 'nope',
        hostId: 'another-host',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value)).toEqual([
      'name',
      'description',
      'notificationEmail',
    ]);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ['a blank name', { ...filled, name: ' ' }, ['name']],
    [
      'a name over the limit',
      { ...filled, name: 'a'.repeat(hostLimits.name + 1) },
      ['name'],
    ],
    [
      'an about text over the limit',
      { ...filled, description: 'a'.repeat(hostLimits.description + 1) },
      ['description'],
    ],
    [
      'a bad address',
      { ...filled, notificationEmail: 'not-an-address' },
      ['notificationEmail'],
    ],
    [
      'everything at once, in form order',
      { name: '', description: 'a'.repeat(3000), notificationEmail: 'x' },
      ['name', 'description', 'notificationEmail'],
    ],
  ])('names the field for %s', (_case, fields, expected) => {
    expect(parseHostSettingsForm(formOf(fields))).toEqual({
      ok: false,
      fields: expected,
    });
  });

  it('refuses a field longer than the raw limit unread', () => {
    expect(
      parseHostSettingsForm(
        formOf({
          ...filled,
          description: ` ${'a'.repeat(hostLimits.rawField)}`,
        }),
      ),
    ).toEqual({ ok: false, fields: ['description'] });
  });
});

describe('changedHostSettings', () => {
  const before: HostSettingsInput = {
    name: 'Spoke',
    description: null,
    notificationEmail: 'a@example.com',
  };

  it.each<[string, Partial<HostSettingsInput>, string[]]>([
    ['nothing differing', {}, []],
    ['a new name', { name: 'Saddle' }, ['name']],
    ['an about text added', { description: 'Hello' }, ['description']],
    ['the address removed', { notificationEmail: null }, ['notificationEmail']],
    [
      'all three, in form order',
      { name: 'x', description: 'y', notificationEmail: null },
      ['name', 'description', 'notificationEmail'],
    ],
  ])('%s', (_case, change, expected) => {
    expect(changedHostSettings(before, { ...before, ...change })).toEqual(
      expected,
    );
  });
});

describe('hostSettingsResult', () => {
  const values: HostSettingsInput = {
    name: 'Spoke',
    description: null,
    notificationEmail: null,
  };

  it.each([
    [
      'nobody signed in',
      { kind: 'signed_out' } as const,
      values,
      { status: 'signed_out' },
    ],
    [
      'a signed-in person who owns no host',
      { kind: 'not_a_host_owner' } as const,
      values,
      { status: 'refused' },
    ],
    [
      'an owner whose host is gone',
      { kind: 'owner', hostId: 'h1' } as const,
      null,
      { status: 'refused' },
    ],
    [
      'an owner of a host',
      { kind: 'owner', hostId: 'h1' } as const,
      values,
      { status: 'ok', values },
    ],
  ])('%s', (_case, access, read, expected) => {
    expect(hostSettingsResult(access, read)).toEqual(expected);
  });
});

describe('the save notices', () => {
  it.each([
    ['updated', 'success'],
    ['unchanged', 'info'],
    ['invalid', 'danger'],
  ])('%s is shown as %s', (code, tone) => {
    expect(hostPageNotice(code)?.tone).toBe(tone);
  });
});
