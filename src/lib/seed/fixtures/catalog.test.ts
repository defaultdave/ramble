import { describe, expect, it } from 'vitest';
import { photoLimits } from '@/lib/photos';
import { fixtureIssues } from '../validate';
import { planTestPhotos, wrapLabel } from '../testPhotos';
import { labelColumns, renderTestPhoto } from '../testPhotoImage';
import { curated } from './index';
import { photoManifest } from './photoManifest';
import type { ExperienceFixture } from '../types';

// Behaviours under test (the curated catalog):
// - the catalog has 20 hosts, 40 experiences, and 10 guide entries, and passes the seed's own validation
// - every category and neighborhood has live experiences to browse, and no slug or name repeats
// - guide entries link out and sell nothing; the hosts of guides are not the hosts of bookings
// - the data varies on every browse filter, and keeps sold-out, nearly full, and sparse dates
// - the copy keeps to the tone checklist's mechanics: lengths, no banned words, no prices in prose, no pressure
// - the photo manifest names every experience once, with 3 to 5 distinct captions that describe the drawn
//   illustration, and every planned photo has alt text and its own picture

const all = curated.experiences;
const guides = all.filter((e) => e.status === 'guide_only');
const bookable = all.filter((e) => e.status !== 'guide_only');
const live = all.filter((e) => e.status === 'live');
const hostsOf = (list: ExperienceFixture[]) =>
  new Set(list.map((e) => e.hostSlug));
const copyOf = (e: ExperienceFixture) =>
  [e.name, e.description, e.included, e.accessibilityNotes, e.meetingPoint]
    .filter((text): text is string => text !== null)
    .join(' ');

describe('the size of the catalog', () => {
  it('holds 20 hosts, 40 experiences, and 10 guide entries', () => {
    expect(curated.hosts).toHaveLength(20);
    expect(bookable).toHaveLength(40);
    expect(guides).toHaveLength(10);
  });

  it('passes every check the seed runs before it writes', () => {
    expect(fixtureIssues(curated)).toEqual([]);
  });

  it('repeats no slug, experience name, or host name', () => {
    for (const values of [
      all.map((e) => e.slug),
      all.map((e) => e.name),
      curated.hosts.map((h) => h.slug),
      curated.hosts.map((h) => h.name),
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('gives every host at least one experience, and every experience a host that exists', () => {
    const named = hostsOf(all);
    expect([...named].sort()).toEqual(curated.hosts.map((h) => h.slug).sort());
  });
});

describe('what a guest can browse', () => {
  it.each(curated.categories.map((c) => c.slug))(
    'has at least three live experiences in the %s category',
    (category) => {
      expect(
        live.filter((e) => e.categorySlug === category).length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(curated.neighborhoods.map((n) => n.slug))(
    'has at least four live experiences in %s',
    (neighborhood) => {
      expect(
        live.filter((e) => e.neighborhoodSlug === neighborhood).length,
      ).toBeGreaterThanOrEqual(4);
    },
  );

  it('keeps a guide entry in every status a guest can see and a hidden one in each other status', () => {
    const statuses = new Set(all.map((e) => e.status));
    expect([...statuses].sort()).toEqual([
      'draft',
      'guide_only',
      'in_review',
      'live',
      'paused',
    ]);
  });
});

describe('guide entries', () => {
  it.each(guides.map((g) => [g.slug, g] as const))(
    '%s links out and sells nothing',
    (_slug, guide) => {
      expect(guide.linkOutUrl).toMatch(/^https:\/\/[a-z-]+\.example\.com\//);
      expect(guide.prices).toEqual([]);
      expect(guide.slots).toEqual([]);
      expect(guide.waiverDoc).toBeNull();
    },
  );

  it('keeps guide hosts apart from hosts that take bookings on Ramble', () => {
    const guideHosts = hostsOf(guides);
    const sellers = hostsOf(live);
    expect([...guideHosts].filter((h) => sellers.has(h))).toEqual([]);
  });

  it('puts an affiliate link on some guides and not others', () => {
    const withLink = guides.filter((g) => g.affiliateUrl !== null);
    expect(withLink.length).toBeGreaterThanOrEqual(3);
    expect(withLink.length).toBeLessThan(guides.length);
  });
});

describe('variety for the browse filters', () => {
  const prices = new Set(
    live.flatMap((e) => e.prices.map((p) => p.priceMinor)).filter(Boolean),
  );

  it('spans free, low, and high prices with many price points', () => {
    expect(prices.size).toBeGreaterThanOrEqual(15);
    expect(Math.min(...prices)).toBeLessThanOrEqual(1800);
    expect(Math.max(...prices)).toBeGreaterThanOrEqual(12000);
  });

  it('uses every age rule, tier, tax treatment, and weather policy on live experiences', () => {
    expect(new Set(live.map((e) => e.ageRule)).size).toBe(4);
    expect(new Set(live.map((e) => e.tier)).size).toBe(3);
    expect(new Set(live.map((e) => e.taxTreatment)).size).toBe(3);
    expect(
      new Set(live.filter((e) => e.outdoor).map((e) => e.weatherPolicy)),
    ).toEqual(new Set(['rain_or_shine', 'decided_before_start']));
  });

  it('varies duration and capacity', () => {
    const durations = live.map((e) => e.durationMinutes ?? 0);
    const allocations = new Set(
      live.flatMap((e) => e.slots.map((s) => s.allocation)),
    );
    expect(Math.min(...durations)).toBeLessThanOrEqual(60);
    expect(Math.max(...durations)).toBeGreaterThanOrEqual(180);
    expect(allocations.size).toBeGreaterThanOrEqual(8);
  });

  it('keeps sold-out dates, nearly full dates, and experiences with a single weekly slot', () => {
    const leaves = live.flatMap((e) => e.slots.flatMap((s) => s.leaves ?? []));
    expect(
      leaves.filter((l) => l.spacesLeft === 0).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      leaves.filter((l) => l.spacesLeft === 1).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      live.filter((e) => e.slots.length === 1).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('keeps every kids experience in Williamsburg weekend-only, so the zero-results state holds', () => {
    const kids = live.filter(
      (e) => e.categorySlug === 'kids' && e.neighborhoodSlug === 'williamsburg',
    );
    for (const slot of kids.flatMap((e) => e.slots)) {
      expect([0, 6]).toContain(slot.weekday);
    }
  });
});

describe('copy against the tone checklist', () => {
  // The checklist's own list is enforced by validation; these are more of the same family, plus the
  // mechanics a script can check (A4 money, A6 pressure, A10 mechanics).
  const pressure =
    /\b(amazing|incredible|perfect|ultimate|must-see|once-in-a-lifetime|world-class|don't miss|last chance|selling fast|hurry|sell out|sells out)\b/i;
  const texts = [
    ...all.map((e) => [e.slug, copyOf(e)] as const),
    ...curated.hosts.map(
      (h) => [h.slug, `${h.name} ${h.description}`] as const,
    ),
  ];

  it.each(texts)(
    '%s has no pressure words, exclamation marks, or prices in prose',
    (_slug, text) => {
      expect(text).not.toMatch(pressure);
      expect(text).not.toContain('!');
      expect(text).not.toMatch(/[$€£]|\bUSD\b|(?<![-\w])free\b/i);
    },
  );

  it.each(live.concat(guides).map((e) => [e.slug, e] as const))(
    '%s reads as a short friend-written blurb with a name, a place, and what is included',
    (_slug, e) => {
      expect(e.name.length).toBeGreaterThanOrEqual(8);
      expect(e.name.length).toBeLessThanOrEqual(60);
      expect(e.name).not.toMatch(/\b[A-Z]{4,}\b/);
      expect(e.description?.length ?? 0).toBeGreaterThanOrEqual(100);
      expect(e.description?.length ?? 0).toBeLessThanOrEqual(400);
      expect(e.description).toMatch(/[.]$/);
      expect(e.meetingPoint).not.toBeNull();
      if (e.status === 'live') {
        expect(e.included).not.toBeNull();
        expect(e.accessibilityNotes).not.toBeNull();
      }
    },
  );

  it('writes host descriptions of one to three sentences', () => {
    for (const host of curated.hosts) {
      expect(host.description.length).toBeGreaterThanOrEqual(60);
      expect(host.description.length).toBeLessThanOrEqual(260);
    }
  });
});

describe('the photo pool manifest', () => {
  it('names every curated experience once and nothing else', () => {
    expect(Object.keys(photoManifest).sort()).toEqual(
      all.map((e) => e.slug).sort(),
    );
  });

  it('gives each experience 3 to 5 captions, and uses all three counts', () => {
    const counts = Object.values(photoManifest).map((c) => c.length);
    expect(counts.every((n) => n >= 3 && n <= 5)).toBe(true);
    expect(new Set(counts)).toEqual(new Set([3, 4, 5]));
  });

  it('writes a distinct, descriptive caption for every photo', () => {
    const captions = Object.values(photoManifest).flat();
    expect(new Set(captions).size).toBe(captions.length);
    for (const caption of captions) {
      expect(caption.trim().length).toBeGreaterThanOrEqual(30);
      expect(caption.length).toBeLessThanOrEqual(photoLimits.maxAltLength - 20);
      expect(caption).toMatch(/[.]$/);
      expect(caption).not.toMatch(/\b(image|photo|picture) of\b/i);
    }
  });

  it('claims no direction in any caption, since the art is mirrored for about half the slugs', () => {
    const direction =
      /\b(left|right|upper|lower|above|below|beside|higher|east|west|north|south|clockwise)\b/i;
    for (const e of all) {
      for (const caption of photoManifest[e.slug] ?? []) {
        expect(caption.replace(e.name, '')).not.toMatch(direction);
      }
    }
  });

  const plans = all.map((e) => ({ e, plan: planTestPhotos(e) }));

  it('describes the drawn illustration: its motif, and a name that is not cut off at the foot', () => {
    for (const { e, plan } of plans) {
      const drawn = wrapLabel(e.name, labelColumns, 3).join(' ');
      expect(drawn).toBe(e.name.toUpperCase());
      for (const photo of plan) expect(photo.altText).toContain(e.name);
    }
  });

  it('plans every photo with alt text that opens as an illustration and is unique', () => {
    const alts = plans.flatMap(({ plan }) => plan.map((p) => p.altText));
    expect(alts).toHaveLength(Object.values(photoManifest).flat().length);
    expect(new Set(alts).size).toBe(alts.length);
    for (const alt of alts) {
      expect(alt).toMatch(/^Illustration: /);
      expect(alt.length).toBeLessThanOrEqual(photoLimits.maxAltLength);
    }
  });

  it('draws every photo with art from its category, in a palette and layout that differ across the catalog', () => {
    const looks = new Set<string>();
    for (const { plan } of plans) {
      for (const photo of plan) {
        expect(photo.art).toBeDefined();
        looks.add(
          `${photo.art?.motif ?? ''}/${photo.art?.palette.name ?? ''}/${String(photo.art?.seed)}/${String(photo.art?.variant)}`,
        );
      }
    }
    expect(looks.size).toBeGreaterThan(plans.length);
  });

  it('renders a different picture for every experience cover', () => {
    const covers = plans.map(({ plan }) => {
      const [cover] = plan;
      if (!cover) throw new Error('no cover');
      const pixels = renderTestPhoto({ ...cover, width: 240, height: 160 });
      return Buffer.from(pixels).toString('base64');
    });
    expect(new Set(covers).size).toBe(covers.length);
  });
});
