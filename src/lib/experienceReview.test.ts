import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  experienceApprovedEntry,
  experienceRejectedEntry,
} from './experienceAudit';
import {
  decisionStatuses,
  parseRejectDecision,
  rejectionReasonOptions,
  reviewListingFacts,
  photoNumberFields,
  photosNeedingAlt,
  rejectionReasons,
  reviewNoticeCodes,
  reviewNoticeText,
  reviewRefusal,
} from './experienceReview';
import { experienceStatuses } from './catalog';

// Behaviours under test, one per decision, branch or risk:
// - an approval goes to live and a rejection back to draft
// - a photo needs alt text unless it is decorative; blank or missing text counts as none; each is named by its place counted from 1
// - only an experience in review is decided, whichever way
// - an approval with a photo lacking alt text is refused naming the photos; a rejection is not held up by them
// - an approval with no photos, or only described or decorative ones, goes ahead
// - the reject form's reason is one of the fixed list, or null
// - the notice for each code says something, and a refused approval's notice names the photos from the address
// - the audit rows hold ids, codes and flags the audit log accepts, and the rejection carries its reason's code

const described = { decorative: false, altText: 'A bowl on the wheel' };
const decorative = { decorative: true, altText: null };
const bare = { decorative: false, altText: null };
const blank = { decorative: false, altText: '   ' };
const id = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';

describe('decisionStatuses', () => {
  it('sends an approval live and a rejection back to draft', () => {
    expect(decisionStatuses).toEqual({ approve: 'live', reject: 'draft' });
  });
});

describe('photosNeedingAlt', () => {
  it.each([
    [[], []],
    [[described, decorative], []],
    [[described, bare], [2]],
    [
      [blank, described, bare, decorative],
      [1, 3],
    ],
    [[{ decorative: true, altText: 'Ignored' }], []],
  ])('names %j as %j', (photos, expected) => {
    expect(photosNeedingAlt(photos)).toEqual(expected);
  });
});

describe('reviewRefusal', () => {
  const approve = { kind: 'approve' } as const;
  const reject = { kind: 'reject', reason: 'photos' } as const;

  it.each(experienceStatuses.filter((status) => status !== 'in_review'))(
    'refuses either decision on an experience that is %s',
    (status) => {
      for (const decision of [approve, reject]) {
        expect(reviewRefusal(status, decision, [described], false)).toEqual({
          status: 'not_in_review',
        });
      }
    },
  );

  it.each([
    ['no photos', []],
    ['described and decorative photos', [described, decorative]],
  ])('lets an approval go ahead with %s', (_name, photos) => {
    expect(reviewRefusal('in_review', approve, photos, false)).toBeNull();
  });

  it('refuses an approval naming the photos with no alt text', () => {
    expect(
      reviewRefusal('in_review', approve, [bare, described, blank], false),
    ).toEqual({ status: 'alt_missing', photoNumbers: [1, 3] });
  });

  it('does not hold a rejection up for the photos', () => {
    expect(reviewRefusal('in_review', reject, [bare], false)).toBeNull();
  });

  it('refuses an approval while the host is suspended, before the photos, and still allows a rejection', () => {
    expect(reviewRefusal('in_review', approve, [bare], true)).toEqual({
      status: 'host_suspended',
    });
    expect(reviewRefusal('in_review', reject, [bare], true)).toBeNull();
  });

  it('finds an experience not in review before it finds the host suspended', () => {
    expect(reviewRefusal('draft', approve, [], true)).toEqual({
      status: 'not_in_review',
    });
  });
});

describe('parseRejectDecision', () => {
  it.each(rejectionReasons.map((reason) => [reason]))(
    'reads %s as a rejection with that reason',
    (reason) => {
      expect(parseRejectDecision(() => reason)).toEqual({
        kind: 'reject',
        reason,
      });
    },
  );

  it.each([[undefined], [''], ['   '], ['spam'], [5], [['photos']]])(
    'reads %j as no decision, because a rejection says why',
    (posted) => {
      expect(parseRejectDecision(() => posted)).toBeNull();
    },
  );

  it('offers every reason as a choice, in order', () => {
    expect(rejectionReasonOptions.map((option) => option.value)).toEqual(
      rejectionReasons,
    );
  });
});

describe('reviewListingFacts', () => {
  const empty = {
    description: null,
    meetingPoint: null,
    included: null,
    accessibilityNotes: null,
    adultPriceMinor: null,
    childPriceMinor: null,
  };

  it('leaves out every field the host left empty', () => {
    expect(reviewListingFacts(empty)).toEqual([]);
  });

  it('words each field it has, in reading order, with prices as the site shows them', () => {
    expect(
      reviewListingFacts({
        description: 'Throw a bowl.',
        meetingPoint: 'The blue door',
        included: 'Clay',
        accessibilityNotes: 'Step-free',
        adultPriceMinor: 8500,
        childPriceMinor: 4050,
      }),
    ).toEqual([
      'Throw a bowl.',
      'Meet at: The blue door',
      'Included: Clay',
      'Access: Step-free',
      'Adult price: $85',
      'Child price: $40.50',
    ]);
  });

  it('keeps a free price of zero, which is a price', () => {
    expect(reviewListingFacts({ ...empty, adultPriceMinor: 0 })).toEqual([
      'Adult price: $0',
    ]);
  });
});

describe('reviewNoticeText', () => {
  it('has nothing to say for no code', () => {
    expect(reviewNoticeText(null, [])).toBeNull();
  });

  it.each(reviewNoticeCodes)('has a notice for %s', (code) => {
    expect(reviewNoticeText(code, [])?.title).toMatch(/\S/);
  });

  it('names the photos a refused approval is about', () => {
    expect(reviewNoticeText('alt_missing', ['2', '4'])?.title).toBe(
      'Approval refused. Add alt text, or mark as decorative, for photo 2 and photo 4.',
    );
  });

  it('keeps the general notice when the address names no photo', () => {
    expect(reviewNoticeText('alt_missing', [])?.title).toBe(
      'Approval refused. Some photos need alt text.',
    );
  });
});

describe('photoNumberFields', () => {
  it('lists every place a gallery can hold, counted from 1', () => {
    expect(photoNumberFields[0]).toBe('1');
    expect(photoNumberFields).toHaveLength(20);
  });
});

describe('the audit rows', () => {
  it('records an approval as the ops user moving the experience to live', () => {
    expect(parseAuditEntry(experienceApprovedEntry(id, id))).toMatchObject({
      actorKind: 'user',
      actorId: id,
      action: 'experience.approved',
      subjectKind: 'experience',
      details: { from_status: 'in_review', to_status: 'live' },
    });
  });

  it.each(rejectionReasons.map((reason) => [reason]))(
    'records a rejection with the code %s',
    (reason) => {
      expect(
        parseAuditEntry(experienceRejectedEntry(id, id, reason)),
      ).toMatchObject({
        action: 'experience.rejected',
        details: { to_status: 'draft', reason },
      });
    },
  );
});
