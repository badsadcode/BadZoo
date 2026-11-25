/**
 * Species presets: each is a patch over the base recipe (a medium dog). Seeds add small,
 * believable individual variation on top, so two "dog, seed 1/2" are siblings, not clones.
 */
import { Rng } from './rng';
import { AnimalRecipe, BASE, mergeRecipe } from './recipe';

type Patch = Parameters<typeof mergeRecipe>[1];

export const SPECIES: Record<string, { label: string; emoji: string; patch: Patch }> = {
  dog: { label: 'Dog', emoji: '🐕', patch: {} },
  wolf: {
    label: 'Wolf', emoji: '🐺',
    patch: {
      name: 'Grey',
      body: { length: 0.58, chestDepth: 0.3, chestWidth: 0.12, rumpWidth: 0.1, waist: 0.68 },
      legs: { front: 0.43, hind: 0.46, thickness: 0.052 },
      neck: { length: 0.2, thickness: 0.085, angle: 35 },
      head: { size: 0.085, muzzleLength: 0.12, muzzleWidth: 0.042, muzzleDepth: 0.045, muzzleTaper: 0.7, pitch: 14, cheeks: 1.25 },
      eyes: { size: 0.013, angle: 30, color: '#c9a13a' },
      ears: { length: 0.1, width: 0.07, tip: 0.65, spread: 28, tilt: 12 },
      tail: { length: 0.42, thickness: 0.035, brush: 1.6, lift: -70, curl: 10 },
      coat: { base: '#8f877b', belly: '#ddd6c8', countershade: 0.4, pattern: 'saddle', patternColor: '#4d463f', patternAmount: 0.35, muzzle: '', earTip: '', tailTip: '#2d2925' },
    },
  },
  fox: {
    label: 'Fox', emoji: '🦊',
    patch: {
      name: 'Vixen',
      body: { length: 0.34, chestDepth: 0.16, chestWidth: 0.065, rumpWidth: 0.06, waist: 0.72 },
      legs: { front: 0.2, hind: 0.22, thickness: 0.026 },
      neck: { length: 0.1, thickness: 0.045, angle: 38 },
      head: { size: 0.05, muzzleLength: 0.085, muzzleWidth: 0.024, muzzleDepth: 0.025, muzzleTaper: 0.58, pitch: 10, cheeks: 1.15 },
      eyes: { size: 0.0095, angle: 30, color: '#c58a1c', pupil: 'slit' },
      ears: { length: 0.085, width: 0.06, tip: 0.9, spread: 20, tilt: 6, side: 0.3 },
      tail: { length: 0.4, thickness: 0.03, brush: 2.1, lift: -35, curl: 15 },
      coat: { base: '#d0612a', belly: '#f4eee6', countershade: 0.68, pattern: 'points', patternColor: '#2a1d17', patternAmount: 0.45, earTip: '#2a1d17', tailTip: '#f4eee6', earInner: '#f4eee6' },
    },
  },
  cat: {
    label: 'Cat', emoji: '🐈',
    patch: {
      name: 'Marmalade',
      body: { length: 0.26, chestDepth: 0.12, chestWidth: 0.055, rumpWidth: 0.055, waist: 0.82, haunch: 1.15 },
      legs: { front: 0.15, hind: 0.17, thickness: 0.019, footSize: 0.95 },
      neck: { length: 0.05, thickness: 0.036, angle: 40 },
      head: { size: 0.044, muzzleLength: 0.012, muzzleWidth: 0.022, muzzleDepth: 0.019, muzzleTaper: 0.85, pitch: 4, cheeks: 1.25, brow: 0.7, noseSize: 0.7 },
      eyes: { size: 0.0095, angle: 18, color: '#8fb83a', pupil: 'slit' },
      ears: { length: 0.045, width: 0.042, tip: 0.75, spread: 26, tilt: 0, side: 0.45 },
      tail: { length: 0.25, thickness: 0.013, brush: 1.1, lift: -10, curl: 85 },
      coat: { base: '#df8a3d', belly: '#f4dcc0', countershade: 0.45, pattern: 'tabby', patternColor: '#a5531c', patternAmount: 0.45, patternScale: 0.85, nose: '#d98a80', earInner: '#e9a99c' },
    },
  },
  lion: {
    label: 'Lion', emoji: '🦁',
    patch: {
      name: 'Leo',
      body: { length: 0.9, chestDepth: 0.48, chestWidth: 0.22, rumpWidth: 0.19, waist: 0.74, shoulders: 1.2 },
      legs: { front: 0.68, hind: 0.72, thickness: 0.088, footSize: 1.05 },
      neck: { length: 0.28, thickness: 0.15, angle: 28, mane: 'ruff', maneSize: 1.1 },
      head: { size: 0.14, muzzleLength: 0.1, muzzleWidth: 0.08, muzzleDepth: 0.075, muzzleTaper: 0.92, pitch: 8, cheeks: 1.2, brow: 1.1 },
      eyes: { size: 0.019, angle: 22, color: '#c8962e' },
      ears: { length: 0.07, width: 0.075, tip: 0.1, spread: 40, side: 0.45 },
      tail: { length: 0.8, thickness: 0.032, brush: 1, lift: -75, curl: 40, tuft: 1.3 },
      coat: { base: '#c99a5b', belly: '#ead5ad', countershade: 0.45, pattern: 'solid', mane: '#7c4a22', tailTip: '#3a2716', nose: '#9c5a4e', earInner: '#e3c8a0', muzzle: '#e8d6b6' },
    },
  },
  horse: {
    label: 'Horse', emoji: '🐎',
    patch: {
      name: 'Clover',
      body: { length: 1.08, chestDepth: 0.7, chestWidth: 0.28, rumpWidth: 0.27, waist: 0.95, belly: 0.15, shoulders: 1.05, haunch: 1.1, arch: 0.0 },
      legs: { front: 1.02, hind: 1.08, thickness: 0.082, stance: 'unguligrade', foot: 'hoof', footSize: 1.15 },
      neck: { length: 0.72, thickness: 0.15, angle: 52, mane: 'crest', maneSize: 1.2 },
      head: { size: 0.13, muzzleLength: 0.36, muzzleWidth: 0.075, muzzleDepth: 0.1, muzzleTaper: 0.85, pitch: 48, cheeks: 1.5, brow: 0.7, nose: 'broad' },
      eyes: { size: 0.024, angle: 72, color: '#3b2417', pupil: 'bar' },
      ears: { length: 0.15, width: 0.07, tip: 0.75, spread: 10, tilt: -6, side: 0.12 },
      tail: { length: 0.75, thickness: 0.05, brush: 1.7, lift: -62, curl: -15 },
      coat: { base: '#7a4427', belly: '#8a5333', countershade: 0.15, pattern: 'points', patternColor: '#1f1714', patternAmount: 0.35, mane: '#1f1714', tail: '#1f1714', nose: '#3a2b26', hoof: '#2f2724', earInner: '#3a2b26', blaze: true, socks: 0.35 },
      mesh: { tris: 5000 },
    },
  },
  cow: {
    label: 'Cow', emoji: '🐄',
    patch: {
      name: 'Daisy',
      body: { length: 1.2, chestDepth: 0.68, chestWidth: 0.3, rumpWidth: 0.31, waist: 1.05, belly: 0.75, haunch: 0.95, arch: -0.02 },
      legs: { front: 0.8, hind: 0.86, thickness: 0.08, stance: 'unguligrade', foot: 'cloven' },
      neck: { length: 0.36, thickness: 0.2, angle: 22 },
      head: { size: 0.14, muzzleLength: 0.25, muzzleWidth: 0.12, muzzleDepth: 0.1, muzzleTaper: 1.0, pitch: 50, cheeks: 1.2, brow: 1, nose: 'broad', noseSize: 1.1 },
      eyes: { size: 0.024, angle: 74, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.13, width: 0.085, tip: 0.3, spread: 85, tilt: 0, droop: 0.15, side: 0.9 },
      horns: { kind: 'cow', length: 0.18, thickness: 0.032 },
      tail: { length: 0.8, thickness: 0.03, brush: 1, lift: -86, curl: 0, tuft: 1.4 },
      coat: { base: '#f3f0e9', belly: '#f3f0e9', countershade: 0, pattern: 'patches', patternColor: '#1f1b1b', patternAmount: 0.5, nose: '#dea7a3', hoof: '#2b2522', earInner: '#e3b6b0', tailTip: '#1f1b1b' },
      mesh: { tris: 5000 },
    },
  },
  pig: {
    label: 'Pig', emoji: '🐖',
    patch: {
      name: 'Truffle',
      body: { length: 0.78, chestDepth: 0.45, chestWidth: 0.22, rumpWidth: 0.23, waist: 1.08, belly: 0.65, haunch: 1.1, arch: 0.04 },
      legs: { front: 0.42, hind: 0.44, thickness: 0.066, stance: 'unguligrade', foot: 'cloven', footSize: 0.9 },
      neck: { length: 0.08, thickness: 0.18, angle: 12 },
      head: { size: 0.13, muzzleLength: 0.16, muzzleWidth: 0.075, muzzleDepth: 0.075, muzzleTaper: 0.95, pitch: 15, cheeks: 1.45, brow: 0.8, nose: 'snout', noseSize: 1.1 },
      eyes: { size: 0.013, angle: 50, color: '#4a2f22' },
      ears: { length: 0.13, width: 0.11, tip: 0.6, spread: 40, tilt: -20, droop: 0.55, side: 0.4 },
      tail: { length: 0.15, thickness: 0.012, brush: 1, lift: 25, curl: 320 },
      coat: { base: '#f0b4a7', belly: '#f5c7bc', countershade: 0.3, pattern: 'solid', nose: '#e2958c', hoof: '#6b4a44', earInner: '#e9a094', jitter: 0.25 },
    },
  },
  sheep: {
    label: 'Sheep', emoji: '🐑',
    patch: {
      name: 'Dolly',
      body: { length: 0.62, chestDepth: 0.36, chestWidth: 0.18, rumpWidth: 0.18, waist: 1.0, belly: 0.3 },
      legs: { front: 0.4, hind: 0.43, thickness: 0.034, stance: 'unguligrade', foot: 'cloven', footSize: 0.85 },
      neck: { length: 0.18, thickness: 0.09, angle: 35 },
      head: { size: 0.08, muzzleLength: 0.1, muzzleWidth: 0.042, muzzleDepth: 0.05, muzzleTaper: 0.75, pitch: 50, cheeks: 1, brow: 0.7, nose: 'broad', noseSize: 0.8 },
      eyes: { size: 0.016, angle: 70, color: '#8a6a2a', pupil: 'bar' },
      ears: { length: 0.09, width: 0.045, tip: 0.5, spread: 80, tilt: 0, droop: 0.45, side: 0.85 },
      tail: { length: 0.14, thickness: 0.035, brush: 1.2, lift: -80, curl: 0 },
      coat: { base: '#ece6d6', belly: '#ece6d6', countershade: 0, pattern: 'points', patternColor: '#262222', patternAmount: 0.85, wool: 1, nose: '#1a1717', hoof: '#1a1717', earInner: '#3a3030' },
    },
  },
  bear: {
    label: 'Bear', emoji: '🐻',
    patch: {
      name: 'Bruno',
      body: { length: 0.85, chestDepth: 0.52, chestWidth: 0.27, rumpWidth: 0.25, waist: 0.98, belly: 0.3, hump: 0.65, shoulders: 1.3, haunch: 1.25 },
      legs: { front: 0.56, hind: 0.53, thickness: 0.095, stance: 'plantigrade', footSize: 1.0 },
      neck: { length: 0.18, thickness: 0.18, angle: 18 },
      head: { size: 0.13, muzzleLength: 0.12, muzzleWidth: 0.068, muzzleDepth: 0.068, muzzleTaper: 0.72, pitch: 14, cheeks: 1.35, brow: 0.9 },
      eyes: { size: 0.012, angle: 28, color: '#2a1a12' },
      ears: { length: 0.06, width: 0.065, tip: 0, spread: 38, side: 0.45 },
      tail: { length: 0.08, thickness: 0.04, brush: 1, lift: -30, curl: 0 },
      coat: { base: '#5d3c25', belly: '#4e3220', countershade: 0.2, pattern: 'solid', muzzle: '#8a6a4a', earInner: '#3d281a', jitter: 0.5 },
    },
  },
  deer: {
    label: 'Deer', emoji: '🦌',
    patch: {
      name: 'Hart',
      body: { length: 0.72, chestDepth: 0.38, chestWidth: 0.15, rumpWidth: 0.15, waist: 0.8 },
      legs: { front: 0.66, hind: 0.72, thickness: 0.042, stance: 'unguligrade', foot: 'cloven', footSize: 0.85 },
      neck: { length: 0.38, thickness: 0.075, angle: 55 },
      head: { size: 0.085, muzzleLength: 0.14, muzzleWidth: 0.04, muzzleDepth: 0.046, muzzleTaper: 0.7, pitch: 35, cheeks: 1, brow: 0.8, nose: 'broad', noseSize: 0.9 },
      eyes: { size: 0.019, angle: 62, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.13, width: 0.075, tip: 0.6, spread: 52, tilt: 10, side: 0.55 },
      horns: { kind: 'antlers', length: 0.48, thickness: 0.02 },
      tail: { length: 0.12, thickness: 0.035, brush: 1.1, lift: -25, curl: 0 },
      coat: { base: '#9a6a42', belly: '#efe6d8', countershade: 0.4, pattern: 'solid', tailTip: '#f4eee6', horn: '#cdb48c', earInner: '#d9c3a8', muzzle: '' },
    },
  },
  goat: {
    label: 'Goat', emoji: '🐐',
    patch: {
      name: 'Billy',
      body: { length: 0.6, chestDepth: 0.33, chestWidth: 0.14, rumpWidth: 0.14, waist: 0.9, belly: 0.35 },
      legs: { front: 0.4, hind: 0.43, thickness: 0.034, stance: 'unguligrade', foot: 'cloven', footSize: 0.85 },
      neck: { length: 0.22, thickness: 0.07, angle: 45 },
      head: { size: 0.075, muzzleLength: 0.12, muzzleWidth: 0.036, muzzleDepth: 0.042, muzzleTaper: 0.7, pitch: 45, cheeks: 0.9, nose: 'broad', noseSize: 0.8 },
      eyes: { size: 0.016, angle: 66, color: '#d6a52a', pupil: 'bar' },
      ears: { length: 0.1, width: 0.045, tip: 0.6, spread: 85, tilt: 10, droop: 0.25, side: 0.8 },
      horns: { kind: 'goat', length: 0.2, thickness: 0.022 },
      tail: { length: 0.1, thickness: 0.02, brush: 1.2, lift: 55, curl: 20 },
      coat: { base: '#f1ece2', belly: '#f1ece2', countershade: 0, pattern: 'patches', patternColor: '#6b4a33', patternAmount: 0.35, nose: '#3a2f2a', hoof: '#3a2f2a', horn: '#a89478' },
    },
  },
};

export function presetRecipe(species: string, seed = 1): AnimalRecipe {
  const sp = SPECIES[species] ?? SPECIES.dog;
  const rc = mergeRecipe(BASE, sp.patch);
  rc.species = species;
  rc.seed = seed;
  return rc;
}

/** individual variation: ±few % on proportions, a nudge on colours is left to the user */
export function vary(rc: AnimalRecipe, amount = 1): AnimalRecipe {
  const out = structuredClone(rc);
  const r = new Rng(`vary:${rc.species}:${rc.seed}`);
  const j = (x: number, f = 0.06) => x * (1 + (r.next() * 2 - 1) * f * amount);
  out.body.length = j(out.body.length);
  out.body.chestDepth = j(out.body.chestDepth);
  out.body.chestWidth = j(out.body.chestWidth);
  out.legs.front = j(out.legs.front, 0.04);
  out.legs.hind = out.legs.front * (rc.legs.hind / rc.legs.front);
  out.neck.length = j(out.neck.length);
  out.head.size = j(out.head.size, 0.05);
  out.head.muzzleLength = j(out.head.muzzleLength, 0.08);
  out.ears.length = j(out.ears.length, 0.08);
  out.tail.length = j(out.tail.length, 0.1);
  return out;
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Cross-breed two recipes: numbers and colours interpolate, choices (stance, pattern, horns…)
 * come from whichever parent is closer. t = 0 → a, t = 1 → b.
 */
export function blendRecipes(a: AnimalRecipe, b: AnimalRecipe, t: number): AnimalRecipe {
  const walk = (x: unknown, y: unknown): unknown => {
    if (typeof x === 'number' && typeof y === 'number') return x + (y - x) * t;
    if (isHex(x) && isHex(y)) return lerpHex(x, y, t);
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x)) o[k] = walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]);
      return o;
    }
    return t < 0.5 ? x : y;
  };
  const out = walk(a, b) as AnimalRecipe;
  out.name = a.name;
  out.seed = a.seed;
  out.species = t < 0.5 ? a.species : b.species;
  out.mesh = { ...a.mesh };
  // horns are all-or-nothing in kind but can still grow in from the other parent
  if (a.horns.kind === 'none' && b.horns.kind !== 'none') out.horns = { ...b.horns, length: b.horns.length * t, thickness: b.horns.thickness * Math.max(0.3, t) };
  if (b.horns.kind === 'none' && a.horns.kind !== 'none') out.horns = { ...a.horns, length: a.horns.length * (1 - t), thickness: a.horns.thickness * Math.max(0.3, 1 - t) };
  if (out.horns.kind !== 'none' && out.horns.length < 0.02) out.horns.kind = 'none';
  return out;
}

const NAMES = ['Biscuit', 'Waffles', 'Pickles', 'Noodle', 'Gravy', 'Turnip', 'Sprocket', 'Muffin', 'Clancy', 'Dumpling', 'Fig', 'Barnaby', 'Pudding', 'Tofu', 'Gus', 'Mabel', 'Hazel', 'Ziggy', 'Pepper', 'Kevin'];
const COATS: [string, string][] = [
  ['#b9814a', '#e2c49a'], ['#3b302a', '#7a6555'], ['#efe9dd', '#ffffff'], ['#8f877b', '#ddd6c8'], ['#d0612a', '#f4eee6'],
  ['#5d3c25', '#8a6a4a'], ['#c99a5b', '#ead5ad'], ['#2a2a2e', '#56565e'], ['#a8a39a', '#e4e0d8'], ['#7a4427', '#c79a72'],
];
const PATTERNS = ['solid', 'spots', 'rosettes', 'stripes', 'patches', 'saddle', 'points', 'tabby'] as const;

/** Surprise me: a random species, a random individual, maybe a hybrid, maybe a silly coat. */
export function randomRecipe(seed: number): AnimalRecipe {
  const r = new Rng(`surprise:${seed}`);
  const keys = Object.keys(SPECIES);
  const a = r.pick(keys);
  let rc = vary(presetRecipe(a, r.int(1, 9999)), 1.6);
  if (r.chance(0.35)) {
    const b = r.pick(keys.filter((k) => k !== a));
    rc = blendRecipes(rc, vary(presetRecipe(b, r.int(1, 9999)), 1.3), r.range(0.25, 0.6));
  }
  if (r.chance(0.5)) {
    const [base, belly] = r.pick(COATS);
    rc.coat.base = base;
    rc.coat.belly = belly;
    rc.coat.pattern = r.pick(PATTERNS);
    rc.coat.patternColor = r.pick(COATS)[0];
    rc.coat.patternAmount = r.range(0.25, 0.7);
    rc.coat.patternScale = r.range(0.7, 1.4);
  }
  rc.name = r.pick(NAMES);
  rc.seed = seed;
  return rc;
}
