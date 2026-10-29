import { describe, expect, it } from 'vitest';
import {
  cardPriceLabel,
  commissionMinor,
  lines,
  MAX_LINES,
  MAX_QUANTITY,
  MAX_UNIT_PRICE_MINOR,
  PPM,
  taxMinor,
  taxRatePpm,
  type PricedOption,
  type TaxTreatment,
} from './pricing';

const adult: PricedOption = {
  id: 'adult-option',
  kind: 'adult',
  priceMinor: 8500,
  usesSpace: true,
};
const child: PricedOption = {
  id: 'child-option',
  kind: 'child',
  priceMinor: 4500,
  usesSpace: false,
};
const options = [adult, child];
const NYC_RATE_PPM = 88_750;

describe('taxRatePpm', () => {
  it.each([
    ['taxable', NYC_RATE_PPM],
    ['not_taxable', 0],
    ['unknown', 0],
  ] satisfies [TaxTreatment, number][])(
    'gives the rate for %s',
    (treatment, expected) => {
      expect(taxRatePpm(treatment, NYC_RATE_PPM)).toBe(expected);
    },
  );

  it.each([0, 1, PPM])('accepts a configured rate of %i', (rate) => {
    expect(taxRatePpm('taxable', rate)).toBe(rate);
  });

  it.each([-1, PPM + 1, 0.5, 88_750.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a configured rate of %s, even when the experience is not taxable',
    (rate) => {
      expect(() => taxRatePpm('taxable', rate)).toThrow(RangeError);
      expect(() => taxRatePpm('not_taxable', rate)).toThrow(RangeError);
    },
  );

  it('refuses a treatment it does not know instead of charging tax or none', () => {
    expect(() =>
      taxRatePpm('exempt' as unknown as TaxTreatment, NYC_RATE_PPM),
    ).toThrow(RangeError);
  });
});

describe('taxMinor', () => {
  it.each([
    [17000, 88750, 1509],
    [1, 500_000, 1],
    [1, 499_999, 0],
    [100, 0, 0],
    [0, 88750, 0],
    [1_000_000_000, 1_000_000, 1_000_000_000],
  ])('taxes %i at %i ppm to %i', (subtotal, rate, expected) => {
    expect(taxMinor(subtotal, rate)).toBe(expected);
  });
});

describe('commissionMinor', () => {
  it.each([
    [17000, 1500, 2550],
    [1, 5000, 1],
    [1, 4999, 0],
    [3, 1500, 0],
    [10, 1500, 2],
    [17000, 0, 0],
  ])('commission on %i at %i bps is %i', (subtotal, bps, expected) => {
    expect(commissionMinor(subtotal, bps)).toBe(expected);
  });
});

describe('lines', () => {
  it('prices adults on the adult option', () => {
    expect(
      lines([{ priceOptionId: 'adult-option', quantity: 2 }], options, 0),
    ).toEqual({
      lines: [
        {
          priceOptionId: 'adult-option',
          kind: 'adult',
          quantity: 2,
          unitPriceMinor: 8500,
          usesSpace: true,
          lineTotalMinor: 17000,
        },
      ],
      ticketSubtotalMinor: 17000,
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 17000,
    });
  });

  it('prices children on their own option, apart from adults', () => {
    const result = lines(
      [
        { priceOptionId: 'adult-option', quantity: 2 },
        { priceOptionId: 'child-option', quantity: 3 },
      ],
      options,
      0,
    );
    expect(result.lines.map((line) => line.lineTotalMinor)).toEqual([
      17000, 13500,
    ]);
    expect(result.lines[1]).toMatchObject({
      kind: 'child',
      unitPriceMinor: 4500,
      usesSpace: false,
    });
    expect(result.ticketSubtotalMinor).toBe(30500);
    expect(result.totalMinor).toBe(30500);
  });

  it('prices a children-only party', () => {
    expect(
      lines([{ priceOptionId: 'child-option', quantity: 1 }], options, 0)
        .totalMinor,
    ).toBe(4500);
  });

  it('keeps the order of the items, not of the price options', () => {
    const result = lines(
      [
        { priceOptionId: 'child-option', quantity: 1 },
        { priceOptionId: 'adult-option', quantity: 1 },
      ],
      options,
      0,
    );
    expect(result.lines.map((line) => line.kind)).toEqual(['child', 'adult']);
  });

  it('adds tax at the caller rate and totals subtotal plus tax', () => {
    const result = lines(
      [{ priceOptionId: 'adult-option', quantity: 2 }],
      options,
      NYC_RATE_PPM,
    );
    // 17000 * 88750 / 1e6 = 1508.75, rounded half up to 1509
    expect(result.taxRatePpm).toBe(NYC_RATE_PPM);
    expect(result.taxMinor).toBe(1509);
    expect(result.totalMinor).toBe(18509);
  });

  it('prices a free option and a zero-tax order without error', () => {
    const free: PricedOption = { ...child, priceMinor: 0 };
    const result = lines(
      [{ priceOptionId: 'child-option', quantity: 2 }],
      [adult, free],
      NYC_RATE_PPM,
    );
    expect(result.totalMinor).toBe(0);
    expect(result.taxMinor).toBe(0);
  });

  it.each([
    // [name, ticket subtotal, rate ppm, expected tax]: the name gives the exact amount before rounding
    ['0.4 rounds down', 4, 100_000, 0],
    ['0.5 rounds up', 5, 100_000, 1],
    ['1.4 rounds down', 14, 100_000, 1],
    ['1.5 rounds up', 15, 100_000, 2],
    ['2.5 rounds up, not to even', 25, 100_000, 3],
    ['0.5 on a single cent', 1, 500_000, 1],
    ['0.499999 rounds down', 1, 499_999, 0],
    ['100 is exact', 1000, 100_000, 100],
  ])('rounds half up: %s', (_name, subtotal, rate, expected) => {
    const option: PricedOption = { ...adult, priceMinor: subtotal };
    expect(
      lines([{ priceOptionId: option.id, quantity: 1 }], [option], rate)
        .taxMinor,
    ).toBe(expected);
  });

  it('rounds tax once on the subtotal, not on each line', () => {
    // Each line's tax is 0.5 cent and would round up to 1 on its own (2 total); the order owes 1.
    const a: PricedOption = { ...adult, priceMinor: 1 };
    const c: PricedOption = { ...child, priceMinor: 1 };
    const result = lines(
      [
        { priceOptionId: a.id, quantity: 1 },
        { priceOptionId: c.id, quantity: 1 },
      ],
      [a, c],
      500_000,
    );
    expect(result.taxMinor).toBe(1);
    expect(result.totalMinor).toBe(3);
  });

  it('does not change its inputs', () => {
    const items = [{ priceOptionId: 'adult-option', quantity: 2 }];
    const frozenOptions = options.map((option) => Object.freeze({ ...option }));
    Object.freeze(items);
    expect(() => lines(items, frozenOptions, NYC_RATE_PPM)).not.toThrow();
  });

  it('is exact at the largest order the bounds allow', () => {
    const first: PricedOption = { ...adult, priceMinor: MAX_UNIT_PRICE_MINOR };
    const second: PricedOption = { ...child, priceMinor: MAX_UNIT_PRICE_MINOR };
    const result = lines(
      [
        { priceOptionId: first.id, quantity: MAX_QUANTITY },
        { priceOptionId: second.id, quantity: MAX_QUANTITY },
      ],
      [first, second],
      PPM - 1,
    );
    const subtotal = BigInt(2 * MAX_QUANTITY * MAX_UNIT_PRICE_MINOR);
    const scaled = subtotal * BigInt(PPM - 1);
    const expectedTax = (scaled + BigInt(PPM) / 2n) / BigInt(PPM);
    expect(BigInt(result.taxMinor)).toBe(expectedTax);
    expect(Number.isSafeInteger(result.totalMinor)).toBe(true);
    expect(BigInt(result.totalMinor)).toBe(subtotal + expectedTax);
  });

  describe('refuses bad input', () => {
    const oneAdult = [{ priceOptionId: 'adult-option', quantity: 1 }];

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_QUANTITY + 1,
    ])('a quantity of %s', (quantity) => {
      expect(() =>
        lines([{ priceOptionId: 'adult-option', quantity }], options, 0),
      ).toThrow(RangeError);
    });

    it.each([-1, 0.5, Number.NaN, MAX_UNIT_PRICE_MINOR + 1])(
      'a unit price of %s',
      (priceMinor) => {
        expect(() => lines(oneAdult, [{ ...adult, priceMinor }], 0)).toThrow(
          RangeError,
        );
      },
    );

    it.each([-1, 0.5, Number.NaN, PPM + 1])('a tax rate of %s', (rate) => {
      expect(() => lines(oneAdult, options, rate)).toThrow(RangeError);
    });

    it('no lines', () => {
      expect(() => lines([], options, 0)).toThrow(RangeError);
    });

    it('more lines than a booking can have', () => {
      const tooMany = Array.from({ length: MAX_LINES + 1 }, () => ({
        priceOptionId: 'adult-option',
        quantity: 1,
      }));
      expect(() => lines(tooMany, options, 0)).toThrow(RangeError);
    });

    it('more price options than a booking can have', () => {
      const many = Array.from({ length: MAX_LINES + 1 }, (_, index) => ({
        ...adult,
        id: `option-${String(index)}`,
      }));
      expect(() => lines(oneAdult, many, 0)).toThrow(RangeError);
    });

    it('a price option that is not offered', () => {
      expect(() =>
        lines([{ priceOptionId: 'other-experience', quantity: 1 }], options, 0),
      ).toThrow(RangeError);
    });

    it('the same price option on two lines', () => {
      expect(() =>
        lines(
          [
            { priceOptionId: 'adult-option', quantity: 1 },
            { priceOptionId: 'adult-option', quantity: 1 },
          ],
          options,
          0,
        ),
      ).toThrow(RangeError);
    });

    it.each([
      ['a repeated id', [adult, { ...child, id: adult.id }]],
      ['a repeated kind', [adult, { ...child, kind: 'adult' as const }]],
    ])('price options with %s', (_name, bad) => {
      expect(() => lines(oneAdult, bad, 0)).toThrow(RangeError);
    });
  });

  describe('properties', () => {
    // Deterministic generator (mulberry32) so a failure reproduces from its seed.
    function random(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('lines sum to the subtotal, tax is half up on it, and total is subtotal plus tax', () => {
      const next = random(20261026);
      const int = (min: number, max: number) =>
        min + Math.floor(next() * (max - min + 1));
      for (let run = 0; run < 2000; run += 1) {
        const a: PricedOption = {
          ...adult,
          priceMinor: int(0, MAX_UNIT_PRICE_MINOR),
        };
        const c: PricedOption = {
          ...child,
          priceMinor: int(0, MAX_UNIT_PRICE_MINOR),
        };
        const items = [
          { priceOptionId: a.id, quantity: int(1, MAX_QUANTITY) },
          { priceOptionId: c.id, quantity: int(1, MAX_QUANTITY) },
        ];
        const ratePpm = int(0, PPM);
        const result = lines(items, [a, c], ratePpm);

        const lineSum = result.lines.reduce(
          (sum, line) => sum + line.lineTotalMinor,
          0,
        );
        expect(result.ticketSubtotalMinor).toBe(lineSum);

        const scaled = BigInt(lineSum) * BigInt(ratePpm);
        const expectedTax = (scaled * 2n + BigInt(PPM)) / (2n * BigInt(PPM));
        expect(BigInt(result.taxMinor)).toBe(expectedTax);
        expect(result.totalMinor).toBe(lineSum + result.taxMinor);
        expect(result.taxMinor).toBeLessThanOrEqual(lineSum);
      }
    });
  });
});

describe('cardPriceLabel', () => {
  it.each([
    ['no option', [], null],
    ['one price', [{ priceMinor: 8500, usesSpace: true }], '$85'],
    [
      'prices that are the same',
      [
        { priceMinor: 8500, usesSpace: true },
        { priceMinor: 8500, usesSpace: true },
      ],
      '$85',
    ],
    [
      'prices that differ, lowest first',
      [
        { priceMinor: 6500, usesSpace: true },
        { priceMinor: 8500, usesSpace: true },
      ],
      'From $65',
    ],
    [
      'prices that differ, lowest last',
      [
        { priceMinor: 8500, usesSpace: true },
        { priceMinor: 1250, usesSpace: true },
      ],
      'From $12.50',
    ],
    [
      'a free option that takes a space',
      [
        { priceMinor: 0, usesSpace: true },
        { priceMinor: 500, usesSpace: true },
      ],
      'From $0',
    ],
    [
      'a free accompanying adult beside a paid child',
      [
        { priceMinor: 0, usesSpace: false },
        { priceMinor: 4500, usesSpace: true },
      ],
      '$45',
    ],
    [
      'a cheaper option that takes no space beside two that do',
      [
        { priceMinor: 500, usesSpace: false },
        { priceMinor: 4500, usesSpace: true },
        { priceMinor: 6500, usesSpace: true },
      ],
      'From $45',
    ],
    [
      'only options that take no space',
      [
        { priceMinor: 0, usesSpace: false },
        { priceMinor: 900, usesSpace: false },
      ],
      null,
    ],
  ])('%s', (_name, options, label) => {
    expect(cardPriceLabel(options)).toBe(label);
  });
});
