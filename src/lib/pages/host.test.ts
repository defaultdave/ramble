import { describe, expect, it } from 'vitest';
import { id } from '../../../tests/support/fixtures/experience';
import type { CancellationTier } from '../catalog';
import type { CardExperience } from '../experienceCards';
import { hostHead, hostPageView, type HostPageData } from './host';

// Behaviours under test, one per decision, branch or risk:
// - the head is the host's name with the first paragraph of the about text; a missing host is the not-found title
// - the name gives the avatar its initial, and the about text keeps its paragraphs
// - the experiences come as the browse list's cards, in the order the read gave them
// - a host with nothing live gets the list's empty state and no cancellation section
// - experiences whose tiers read the same share one cancellation statement
// - experiences with different tiers each get their own line
// - an experience that cannot be a card (no price that takes a space) is left out of the terms as well

const host = {
  id: id(2),
  slug: 'hudson-paddle-club',
  name: 'élan Paddle Club',
  description: 'Six guides.\n\n  All trained in water rescue.  ',
};

const tier = (
  hours: number,
  key = `tier-${String(hours)}`,
): CancellationTier => ({
  id: id(10 + hours),
  key,
  name: key,
  fullRefundHoursBefore: hours,
  isDefault: false,
});

const card = (
  n: number,
  overrides: Partial<CardExperience> = {},
): CardExperience => ({
  id: id(n),
  slug: `kayak-${String(n)}`,
  name: `Kayak ${String(n)}`,
  status: 'live',
  neighborhoodName: 'Tribeca',
  durationMinutes: 120,
  linkOutUrl: null,
  priceOptions: [{ priceMinor: 6500, usesSpace: true }],
  image: null,
  ...overrides,
});

const data = (
  experiences: CardExperience[],
  tiers: CancellationTier[],
): HostPageData => ({
  host,
  experiences,
  tiers: experiences.map(({ id: experienceId }, index) => ({
    experienceId,
    tier: tiers[index] ?? tier(24),
  })),
});

describe('hostHead', () => {
  it('is the name, described by the first paragraph of the about text', () => {
    expect(hostHead(host)).toEqual({
      title: 'élan Paddle Club',
      description: 'Six guides.',
    });
  });

  it.each([null, ''])('has no description for an about text of %j', (about) => {
    expect(hostHead({ ...host, description: about }).description).toBeNull();
  });

  it('is the not-found title for no host', () => {
    expect(hostHead(null)).toEqual({
      title: 'Host not found',
      description: null,
    });
  });
});

describe('hostPageView', () => {
  it('gives the name, its initial, and the about text by paragraph', () => {
    const view = hostPageView(data([card(1)], [tier(24)]));

    expect(view).toMatchObject({
      name: 'élan Paddle Club',
      initial: 'É',
      about: ['Six guides.', 'All trained in water rescue.'],
    });
  });

  it('lists the experiences as the browse cards, in the order given', () => {
    const view = hostPageView(data([card(2), card(1)], [tier(24), tier(24)]));

    expect(view.results).toMatchObject({
      state: 'results',
      cards: [
        { id: id(2), title: 'Kayak 2', href: `/experiences/kayak-2-${id(2)}` },
        { id: id(1), title: 'Kayak 1', href: `/experiences/kayak-1-${id(1)}` },
      ],
      showMore: null,
    });
  });

  it('shows the empty state, and no cancellation section, when nothing is live', () => {
    const view = hostPageView(data([], []));

    expect(view.results).toMatchObject({ state: 'empty', filtered: false });
    expect(view.cancellation).toBeNull();
  });

  it('says the terms once when every experience reads the same', () => {
    const view = hostPageView(
      data([card(1), card(2)], [tier(24, 'a'), tier(24, 'b')]),
    );

    expect(view.cancellation).toEqual({
      kind: 'shared',
      text: expect.stringContaining('up to 24 hours before start') as string,
    });
  });

  it('gives each experience its own line when the terms differ', () => {
    const view = hostPageView(data([card(1), card(2)], [tier(24), tier(48)]));

    expect(view.cancellation).toEqual({
      kind: 'varies',
      rows: [
        {
          id: id(1),
          title: 'Kayak 1',
          text: 'Free cancellation up to 24 hours before',
        },
        {
          id: id(2),
          title: 'Kayak 2',
          text: 'Free cancellation up to 2 days before',
        },
      ],
    });
  });

  it('leaves an experience that is no card out of the terms too', () => {
    const view = hostPageView(
      data([card(1), card(2, { priceOptions: [] })], [tier(24), tier(48)]),
    );

    expect(view.cancellation).toMatchObject({ kind: 'shared' });
    expect(view.results).toMatchObject({ state: 'results' });
  });
});
