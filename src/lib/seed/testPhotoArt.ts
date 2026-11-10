// The flat illustrations behind the generated test photos: one motif per category, drawn from
// arithmetic in the brand's palette (docs/design/design-system-plan.md), so each experience gets a
// picture that looks like Ramble and no third-party art is involved. A motif is a few flat shapes;
// the slug picks the palette and nudges the layout, and the position in the set varies it again, so
// no two pictures of the catalog are the same.

export type Rgb = readonly [number, number, number];

export type Palette = {
  name: string;
  ground: Rgb;
  /** The shade the ground falls to along its diagonal. */
  ground2: Rgb;
  ink: Rgb;
  accent: Rgb;
  pop: Rgb;
};

export const palettes: readonly [Palette, ...Palette[]] = [
  {
    name: 'cream and tomato',
    ground: [246, 239, 224],
    ground2: [236, 224, 200],
    ink: [58, 40, 34],
    accent: [222, 84, 58],
    pop: [243, 182, 50],
  },
  {
    name: 'butter and cobalt',
    ground: [250, 226, 128],
    ground2: [244, 208, 96],
    ink: [27, 38, 69],
    accent: [47, 84, 200],
    pop: [240, 150, 180],
  },
  {
    name: 'stone and green',
    ground: [226, 220, 206],
    ground2: [208, 200, 182],
    ink: [30, 58, 48],
    accent: [47, 93, 80],
    pop: [240, 160, 110],
  },
  {
    name: 'navy and marigold',
    ground: [27, 38, 69],
    ground2: [20, 28, 54],
    ink: [246, 239, 224],
    accent: [243, 182, 50],
    pop: [240, 150, 180],
  },
  {
    name: 'pink and navy',
    ground: [244, 196, 208],
    ground2: [234, 176, 192],
    ink: [27, 38, 69],
    accent: [222, 84, 58],
    pop: [250, 226, 128],
  },
];

export const motifs = [
  'vessel',
  'pot',
  'street',
  'glass',
  'cup',
  'sun-water',
  'rings',
  'blocks',
] as const;
export type Motif = (typeof motifs)[number];

export const categoryMotifs: Readonly<Record<string, Motif>> = {
  'ceramics-and-crafts': 'vessel',
  cooking: 'pot',
  'walking-tours': 'street',
  'wine-and-cocktails': 'glass',
  'food-and-coffee': 'cup',
  outdoors: 'sun-water',
  wellness: 'rings',
  kids: 'blocks',
};

export type PhotoArt = {
  motif: Motif;
  palette: Palette;
  /** From the slug: shifts the layout a little. */
  seed: number;
  /** 0 to 2, from the position in the set. */
  variant: number;
};

/** The art of one photo, or undefined for a category with no motif. */
export function artFor(
  categorySlug: string | undefined,
  seed: number,
  position: number,
): PhotoArt | undefined {
  const motif = categorySlug ? categoryMotifs[categorySlug] : undefined;
  if (!motif) return undefined;
  return {
    motif,
    palette: palettes[seed % palettes.length] ?? palettes[0],
    seed,
    variant: position % 3,
  };
}

/** Which colour of the palette a point of the motif takes. Coordinates are in units of the motif radius, y down. */
type Slot = 'ink' | 'accent' | 'pop';

const inBox = (
  x: number,
  y: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function steam(
  x: number,
  y: number,
  x0: number,
  y0: number,
  y1: number,
  phase: number,
): boolean {
  return (
    y >= y0 &&
    y <= y1 &&
    Math.abs(x - (x0 + 0.09 * Math.sin(y * 9 + phase))) < 0.04
  );
}

function slotAt(motif: Motif, x: number, y: number, v: number): Slot | null {
  switch (motif) {
    case 'vessel': {
      if (inBox(x, y, -0.3, 0.3, 0.55, 0.7)) return 'ink';
      if (inBox(x, y, -0.8, 0.8, -0.28, -0.2)) return 'ink';
      if (y > -0.2 && inCircle(x, y, 0, -0.2, 0.8)) {
        return v === 1 && Math.floor((y + 1) * 6) % 2 === 0 ? 'pop' : 'accent';
      }
      return null;
    }
    case 'pot': {
      if (inBox(x, y, -0.8, 0.8, -0.1, 0)) return 'ink';
      if (inBox(x, y, -0.7, 0.7, 0, 0.7)) return v === 2 ? 'pop' : 'accent';
      for (let k = -1; k <= 1; k++) {
        if (steam(x, y, k * 0.35, -0.95, -0.2, k + v)) return 'pop';
      }
      return null;
    }
    case 'street': {
      const column = Math.floor((x + 1.2) / 0.3);
      if (column < 0 || column > 7) return null;
      const height = 0.45 + (0.5 * ((column * 7 + v * 3) % 5)) / 4;
      if (y > 0.7 || y < 0.7 - height * 1.6) return null;
      if (Math.floor(x * 10) % 3 === 0 && Math.floor(y * 10) % 3 === 0)
        return 'pop';
      return column % 2 === 0 ? 'ink' : 'accent';
    }
    case 'glass': {
      if (inBox(x, y, -0.3, 0.3, 0.85, 0.92)) return 'ink';
      if (inBox(x, y, -0.04, 0.04, 0.3, 0.85)) return 'ink';
      if (inCircle(x, y, 0, -0.25, 0.55)) {
        if (y > -0.2) return 'accent';
        return v === 2 ? 'pop' : null;
      }
      if (inCircle(x, y, 0.55 + 0.1 * v, -0.85, 0.12)) return 'pop';
      return null;
    }
    case 'cup': {
      if (inBox(x, y, -0.8, 0.8, 0.62, 0.7)) return 'ink';
      const ring = Math.hypot(x - 0.62, y - 0.25);
      if (ring < 0.3 && ring > 0.17) return 'ink';
      if (inBox(x, y, -0.55, 0.45, -0.1, 0.62)) return 'accent';
      if (steam(x, y, -0.15, -0.9, -0.2, v)) return 'pop';
      if (steam(x, y, 0.15, -0.8, -0.2, v + 2)) return 'pop';
      return null;
    }
    case 'sun-water': {
      if (inCircle(x, y, -0.3 + 0.3 * v, -0.2, 0.5)) return 'pop';
      if (y > 0.25) {
        const wave = Math.sin(x * 6 + v) * 0.05;
        return Math.floor((y - 0.25 + wave) * 6) % 2 === 0 ? 'accent' : 'ink';
      }
      return null;
    }
    case 'rings': {
      const d = Math.hypot(x, y - 0.05);
      if (d >= 1) return null;
      return (
        (['pop', 'accent', 'ink', 'accent', 'pop'] as const)[
          (Math.floor(d * 5) + v) % 5
        ] ?? null
      );
    }
    case 'blocks': {
      const colors: Slot[] =
        v === 0
          ? ['accent', 'pop', 'ink']
          : v === 1
            ? ['pop', 'ink', 'accent']
            : ['ink', 'accent', 'pop'];
      if (inBox(x, y, -0.8, -0.2, 0.1, 0.7)) return colors[0] ?? null;
      if (inBox(x, y, -0.1, 0.5, 0.1, 0.7)) return colors[1] ?? null;
      if (inBox(x, y, -0.5, 0.1, -0.5, 0.1)) return colors[2] ?? null;
      if (inCircle(x, y, 0.75, 0.5, 0.2)) return colors[0] ?? null;
      return null;
    }
  }
}

/** The colour at a point of the motif, or undefined where the ground shows through. */
export function artColorAt(
  art: PhotoArt,
  x: number,
  y: number,
): Rgb | undefined {
  const shift = ((art.seed >>> 4) % 7) * 0.04 - 0.12;
  const flip = art.seed % 2 === 0 ? 1 : -1;
  const found = slotAt(art.motif, (x - shift) * flip, y, art.variant);
  return found ? art.palette[found] : undefined;
}
