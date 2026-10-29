import type { PhotoView } from '@/lib/photoViews';

const hues = [28, 200, 140, 340, 48, 260];

/**
 * A photo drawn as an SVG data URL, so a story or a test shows a real image with nothing fetched
 * and no remote host configured. Each number gets its own colour and its own label.
 */
export function samplePhoto(
  n: number,
  overrides: Partial<PhotoView> = {},
): PhotoView {
  const hue = hues[n % hues.length] ?? 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 70% 72%)"/><stop offset="1" stop-color="hsl(${String(hue + 30)} 60% 38%)"/></linearGradient></defs><rect width="1600" height="1200" fill="url(#g)"/><text x="800" y="640" font-family="sans-serif" font-size="120" text-anchor="middle" fill="white">Photo ${String(n + 1)}</text></svg>`;
  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: 1600,
    height: 1200,
    alt: `Photo ${String(n + 1)}`,
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD',
    ...overrides,
  };
}

export function samplePhotos(count: number): PhotoView[] {
  return Array.from({ length: count }, (_, n) => samplePhoto(n));
}
