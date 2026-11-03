import type { TestPhotoPlan } from './testPhotos';

export const labelColumns = 18;

// A 5 by 7 bitmap font for the labels, one 5-bit row per line. Anything not listed draws as blank.
const glyphs: Record<string, readonly number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 8, 0, 0, 0, 0],
};

const glyphWidth = 5;
const glyphHeight = 7;
const bands = 12;

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return [r, g, b].map((channel) => Math.round((channel + m) * 255)) as [
    number,
    number,
    number,
  ];
}

/** The text scale that fits `labelColumns` characters in 80% of the width. */
export function labelScale(width: number): number {
  return Math.max(
    1,
    Math.floor((width * 0.8) / ((glyphWidth + 1) * labelColumns)),
  );
}

/**
 * The photo as raw RGB, row by row. A diagonal gradient in twelve flat bands (so it compresses to a
 * small file at any size), under a dark panel carrying the label in white.
 */
export function renderTestPhoto(
  spec: Pick<TestPhotoPlan, 'width' | 'height' | 'hue' | 'label'>,
): Uint8Array {
  const { width, height, label } = spec;
  const out = new Uint8Array(width * height * 3);
  const from = hslToRgb(spec.hue, 0.65, 0.45);
  const to = hslToRgb(spec.hue + 50, 0.7, 0.62);
  const span = width + height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.floor(((x + y) / span) * bands) / (bands - 1);
      const at = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        out[at + c] = Math.round(
          (from[c] ?? 0) + ((to[c] ?? 0) - (from[c] ?? 0)) * Math.min(1, band),
        );
      }
    }
  }
  const scale = labelScale(width);
  const lineHeight = (glyphHeight + 2) * scale;
  const panelWidth = Math.floor(width * 0.88);
  const panelHeight = label.length * lineHeight + scale * 2;
  const left = Math.floor((width - panelWidth) / 2);
  const top = Math.max(0, Math.floor((height - panelHeight) / 2));
  const panelRows = label.length === 0 ? 0 : panelHeight;
  for (let y = top; y < Math.min(height, top + panelRows); y++) {
    for (let x = left; x < left + panelWidth; x++) {
      const at = (y * width + x) * 3;
      for (let c = 0; c < 3; c++)
        out[at + c] = Math.round((out[at + c] ?? 0) * 0.25);
    }
  }
  label.forEach((line, row) => {
    const textWidth = line.length * (glyphWidth + 1) * scale;
    const originX = Math.max(left, Math.floor((width - textWidth) / 2));
    const originY = top + scale + row * lineHeight;
    line.split('').forEach((char, index) => {
      const rows = glyphs[char];
      if (!rows) return;
      rows.forEach((bits, dy) => {
        for (let dx = 0; dx < glyphWidth; dx++) {
          if (!(bits & (1 << (glyphWidth - 1 - dx)))) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = originX + (index * (glyphWidth + 1) + dx) * scale + sx;
              const py = originY + dy * scale + sy;
              if (px >= width || py >= height) continue;
              const at = (py * width + px) * 3;
              out[at] = 255;
              out[at + 1] = 255;
              out[at + 2] = 255;
            }
          }
        }
      });
    });
  });
  return out;
}
