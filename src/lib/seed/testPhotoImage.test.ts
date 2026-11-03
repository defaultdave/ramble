import { describe, expect, it } from 'vitest';
import { labelScale, renderTestPhoto } from './testPhotoImage';

// Behaviours under test:
// - the pixels are the same on every call, differ by hue and by label, and show the label in white
// - the gradient is flat bands, and no label line leaves the image at the smallest and largest sources

describe('renderTestPhoto', () => {
  const spec = {
    width: 320,
    height: 200,
    hue: 200,
    label: ['KAYAK', 'PHOTO 1/3 1600PX'],
  };

  it('returns three bytes per pixel, the same on every call', () => {
    const first = renderTestPhoto(spec);
    expect(first).toHaveLength(spec.width * spec.height * 3);
    expect(renderTestPhoto(spec)).toEqual(first);
  });

  it('differs by hue and by label', () => {
    expect(renderTestPhoto({ ...spec, hue: 20 })).not.toEqual(
      renderTestPhoto(spec),
    );
    expect(renderTestPhoto({ ...spec, label: ['OTHER'] })).not.toEqual(
      renderTestPhoto(spec),
    );
  });

  it('draws white label pixels only when there is a label', () => {
    const white = (pixels: Uint8Array) =>
      pixels.filter((value, index) => index % 3 === 0 && value === 255).length;
    expect(white(renderTestPhoto(spec))).toBeGreaterThan(0);
    expect(white(renderTestPhoto({ ...spec, label: [] }))).toBe(0);
  });

  it('flattens the gradient into at most twelve bands per channel', () => {
    const pixels = renderTestPhoto({ ...spec, label: [] });
    const reds = new Set<number>();
    for (let index = 0; index < pixels.length; index += 3) {
      reds.add(pixels[index] ?? 0);
    }
    expect(reds.size).toBeLessThanOrEqual(12);
    expect(reds.size).toBeGreaterThan(3);
  });

  it('keeps every label line inside the image at the smallest and largest sources', () => {
    for (const [width, height] of [
      [1067, 1600],
      [2400, 1600],
    ] as const) {
      const long = [
        'A'.repeat(18),
        'B'.repeat(18),
        'C'.repeat(18),
        'PHOTO 5/5 2400PX',
      ];
      expect(() =>
        renderTestPhoto({ width, height, hue: 0, label: long }),
      ).not.toThrow();
      expect(labelScale(width) * 6 * 18).toBeLessThanOrEqual(width);
    }
  });
});
