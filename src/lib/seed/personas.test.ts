import { describe, expect, it } from 'vitest';
import { emailAddressPattern } from '@/lib/email/address';
import { isValidGrantScope } from '@/lib/roleGrants';
import { curated } from './fixtures';
import { personaHostSlugs, personaKeys, personas } from './personas';

// Behaviours under test, one per decision, branch or risk:
// - there are seven personas: one guest, an owner and a staff member on each of two hosts, ops, admin
// - every address is distinct, valid, lower case, and on the reserved .test domain
// - every grant fits its role: a host role names a host, ops and admin name none
// - the two hosts are different curated hosts, and each host role is held on the right one

describe('the persona cast', () => {
  it('has seven people', () => {
    expect(personaKeys).toEqual([
      'guest',
      'ownerA',
      'staffA',
      'ownerB',
      'staffB',
      'ops',
      'admin',
    ]);
  });

  it('gives each a distinct valid address on the reserved .test domain', () => {
    const emails = personaKeys.map((key) => personas[key].email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) {
      expect(email).toMatch(new RegExp(emailAddressPattern));
      expect(email).toMatch(/@ramble\.test$/);
    }
  });

  it('gives only grants whose host fits the role', () => {
    for (const key of personaKeys) {
      for (const grant of personas[key].grants) {
        expect(isValidGrantScope(grant)).toBe(true);
      }
    }
  });

  it('acts for two different curated hosts', () => {
    const slugs = curated.hosts.map((host) => host.slug);
    expect(personaHostSlugs.a).not.toBe(personaHostSlugs.b);
    expect(slugs).toContain(personaHostSlugs.a);
    expect(slugs).toContain(personaHostSlugs.b);
    expect(personas.ownerA.grants[0]?.hostId).not.toBe(
      personas.ownerB.grants[0]?.hostId,
    );
    expect(personas.ownerA.grants[0]?.hostId).toBe(
      personas.staffA.grants[0]?.hostId,
    );
  });
});
