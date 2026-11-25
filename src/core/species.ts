/**
 * Species presets: each is a patch over the base recipe (a medium dog). Seeds add small,
 * believable individual variation on top, so two "dog, seed 1/2" are siblings, not clones.
 */
import { Rng } from './rng';
import { AnimalRecipe, BASE, mergeRecipe } from './recipe';

type Patch = Parameters<typeof mergeRecipe>[1];

export type Category = 'real' | 'fantasy' | 'mount';
interface SpeciesDef {
  label: string;
  emoji: string;
  patch: Patch;
  category?: Category;
  /** start from another species' patch first (mount presets) */
  base?: string;
}

export const SPECIES: Record<string, SpeciesDef> = {
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
  // ───────────────────────────────────────────── more real animals ──
  tiger: {
    label: 'Tiger', emoji: '🐅',
    patch: {
      name: 'Raja',
      body: { length: 0.95, chestDepth: 0.48, chestWidth: 0.21, rumpWidth: 0.19, waist: 0.76, shoulders: 1.2 },
      legs: { front: 0.64, hind: 0.68, thickness: 0.088, footSize: 1.1 },
      neck: { length: 0.26, thickness: 0.14, angle: 25 },
      head: { size: 0.14, muzzleLength: 0.09, muzzleWidth: 0.08, muzzleDepth: 0.07, muzzleTaper: 0.92, pitch: 8, cheeks: 1.35, brow: 1 },
      eyes: { size: 0.019, angle: 22, color: '#d8a030' },
      ears: { length: 0.07, width: 0.075, tip: 0.1, spread: 42, side: 0.5 },
      tail: { length: 0.9, thickness: 0.035, brush: 1, lift: -60, curl: 35 },
      coat: { base: '#d9772a', belly: '#f3ead8', countershade: 0.52, pattern: 'stripes', patternColor: '#1d1612', patternAmount: 0.42, patternScale: 1.1, muzzle: '#f3ead8', nose: '#c07a6a', earInner: '#f3ead8', tailTip: '#1d1612' },
    },
  },
  leopard: {
    label: 'Leopard', emoji: '🐆',
    patch: {
      name: 'Spot',
      body: { length: 0.68, chestDepth: 0.34, chestWidth: 0.14, rumpWidth: 0.13, waist: 0.74 },
      legs: { front: 0.44, hind: 0.48, thickness: 0.06 },
      neck: { length: 0.18, thickness: 0.09, angle: 25 },
      head: { size: 0.1, muzzleLength: 0.06, muzzleWidth: 0.055, muzzleDepth: 0.05, muzzleTaper: 0.9, pitch: 8, cheeks: 1.2 },
      eyes: { size: 0.015, angle: 22, color: '#c8b040' },
      ears: { length: 0.055, width: 0.055, tip: 0.15, spread: 40, side: 0.5 },
      tail: { length: 0.8, thickness: 0.028, brush: 1.05, lift: -55, curl: 50 },
      coat: { base: '#dba95c', belly: '#f2e6cc', countershade: 0.5, pattern: 'rosettes', patternColor: '#2a1e14', patternAmount: 0.55, patternScale: 0.8, nose: '#b0786a', earInner: '#f2e6cc' },
    },
  },
  zebra: {
    label: 'Zebra', emoji: '🦓', base: 'horse',
    patch: {
      name: 'Marty',
      body: { length: 0.95, chestDepth: 0.6, chestWidth: 0.25, rumpWidth: 0.25, waist: 0.98, belly: 0.25 },
      legs: { front: 0.85, hind: 0.9, thickness: 0.075 },
      neck: { length: 0.55, thickness: 0.15, angle: 45, mane: 'crest', maneSize: 1.1 },
      head: { size: 0.13, muzzleLength: 0.3, pitch: 45 },
      ears: { length: 0.16, width: 0.08 },
      tail: { length: 0.6, brush: 1, tuft: 1 },
      coat: { base: '#f2efe8', belly: '#f2efe8', countershade: 0, pattern: 'stripes', patternColor: '#1b1818', patternAmount: 0.55, patternScale: 0.85, mane: '#1b1818', tail: '#f2efe8', tailTip: '#1b1818', nose: '#1b1818', blaze: false, socks: 0, earInner: '#f2efe8' },
    },
  },
  donkey: {
    label: 'Donkey', emoji: '🫏', base: 'horse',
    patch: {
      name: 'Eeyore',
      body: { length: 0.8, chestDepth: 0.5, chestWidth: 0.21, rumpWidth: 0.2, waist: 1.0, belly: 0.35 },
      legs: { front: 0.66, hind: 0.7, thickness: 0.06 },
      neck: { length: 0.45, thickness: 0.13, angle: 38, mane: 'crest', maneSize: 0.7 },
      head: { size: 0.13, muzzleLength: 0.27, muzzleWidth: 0.075, muzzleDepth: 0.095, pitch: 40 },
      ears: { length: 0.24, width: 0.09, tip: 0.55, spread: 22, tilt: 8 },
      tail: { length: 0.55, thickness: 0.025, brush: 1, lift: -80, curl: 0, tuft: 1.1 },
      coat: { base: '#8a8178', belly: '#dcd6cc', countershade: 0.35, pattern: 'solid', muzzle: '#e8e2d8', mane: '#3a3430', tail: '', tailTip: '#3a3430', nose: '#3a3430', blaze: false, socks: 0, eyePatch: '', earTip: '#3a3430', earInner: '#dcd6cc' },
    },
  },
  elephant: {
    label: 'Elephant', emoji: '🐘',
    patch: {
      name: 'Nelly',
      body: { length: 1.9, chestDepth: 1.25, chestWidth: 0.62, rumpWidth: 0.58, waist: 1.05, belly: 0.35, shoulders: 1.1, haunch: 1.0, arch: 0.06 },
      legs: { front: 1.55, hind: 1.45, thickness: 0.25, stance: 'unguligrade', foot: 'paw', footSize: 1.1 },
      neck: { length: 0.15, thickness: 0.45, angle: 10 },
      head: { size: 0.42, muzzleLength: 0.12, muzzleWidth: 0.24, muzzleDepth: 0.27, muzzleTaper: 0.9, pitch: 30, cheeks: 1.0, brow: 1.3, nose: 'broad', trunk: 1.7, tusks: 0.9 },
      eyes: { size: 0.03, angle: 72, color: '#3a2618' },
      ears: { length: 0.7, width: 0.75, tip: 0.15, spread: 95, tilt: 45, droop: 0.4, side: 1 },
      tail: { length: 0.95, thickness: 0.05, brush: 1, lift: -85, curl: 0, tuft: 0.9 },
      coat: { base: '#77726d', belly: '#77726d', countershade: 0, pattern: 'solid', nose: '#7a7672', horn: '#efe6cf', earInner: '#9a8a86', jitter: 0.55, tailTip: '#3a3634' },
      mesh: { tris: 5500 },
    },
  },
  giraffe: {
    label: 'Giraffe', emoji: '🦒',
    patch: {
      name: 'Stretch',
      body: { length: 1.25, chestDepth: 0.85, chestWidth: 0.28, rumpWidth: 0.24, waist: 0.85, haunch: 0.9 },
      legs: { front: 2.0, hind: 1.75, thickness: 0.085, stance: 'unguligrade', foot: 'cloven' },
      neck: { length: 2.0, thickness: 0.14, angle: 62, mane: 'crest', maneSize: 0.45 },
      head: { size: 0.15, muzzleLength: 0.32, muzzleWidth: 0.07, muzzleDepth: 0.09, muzzleTaper: 0.8, pitch: 40, cheeks: 1, nose: 'broad' },
      eyes: { size: 0.03, angle: 70, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.17, width: 0.07, tip: 0.6, spread: 75, tilt: 10, side: 0.6 },
      horns: { kind: 'goat', length: 0.13, thickness: 0.045 },
      tail: { length: 0.9, thickness: 0.03, brush: 1, lift: -80, curl: 0, tuft: 1.1 },
      coat: { base: '#a8622c', belly: '#f2e3c2', countershade: 0.2, pattern: 'scales', patternColor: '#f2e3c2', patternAmount: 0.3, patternScale: 0.55, mane: '#7a4520', horn: '#5a3a24', nose: '#3a2a20', hoof: '#3a2a20', tailTip: '#2a1a12', earInner: '#f2e3c2' },
      mesh: { tris: 5000 },
    },
  },
  rhino: {
    label: 'Rhino', emoji: '🦏',
    patch: {
      name: 'Tank',
      body: { length: 1.55, chestDepth: 0.9, chestWidth: 0.45, rumpWidth: 0.42, waist: 1.05, belly: 0.4, shoulders: 1.2, hump: 0.25 },
      legs: { front: 0.72, hind: 0.78, thickness: 0.16, stance: 'unguligrade', foot: 'paw', footSize: 1.25 },
      neck: { length: 0.25, thickness: 0.36, angle: 8 },
      head: { size: 0.3, muzzleLength: 0.36, muzzleWidth: 0.16, muzzleDepth: 0.18, muzzleTaper: 0.85, pitch: 30, cheeks: 1.1, brow: 0.9, nose: 'broad' },
      eyes: { size: 0.02, angle: 80, color: '#2a1a12' },
      ears: { length: 0.2, width: 0.11, tip: 0.5, spread: 45, tilt: 5, side: 0.45 },
      horns: { kind: 'rhino', length: 0.5, thickness: 0.09 },
      tail: { length: 0.5, thickness: 0.035, brush: 1, lift: -80, curl: 0, tuft: 0.7 },
      coat: { base: '#8b8580', belly: '#8b8580', countershade: 0, pattern: 'solid', nose: '#6a6560', horn: '#7a6e64', hoof: '#5a5550', earInner: '#9a908a', jitter: 0.6 },
      mesh: { tris: 5000 },
    },
  },
  hippo: {
    label: 'Hippo', emoji: '🦛',
    patch: {
      name: 'Gloria',
      body: { length: 1.8, chestDepth: 1.0, chestWidth: 0.6, rumpWidth: 0.56, waist: 1.12, belly: 0.35, arch: 0.04 },
      legs: { front: 0.76, hind: 0.76, thickness: 0.2, stance: 'unguligrade', foot: 'paw', footSize: 1.2 },
      neck: { length: 0.1, thickness: 0.44, angle: 8 },
      head: { size: 0.38, muzzleLength: 0.45, muzzleWidth: 0.34, muzzleDepth: 0.28, muzzleTaper: 1.1, pitch: 5, cheeks: 1.35, brow: 1.4, nose: 'broad', noseSize: 1.2, tusks: 0 },
      eyes: { size: 0.035, angle: 45, color: '#3a2618' },
      ears: { length: 0.08, width: 0.075, tip: 0.2, spread: 40, side: 0.35 },
      tail: { length: 0.3, thickness: 0.05, brush: 1, lift: -60, curl: 0 },
      coat: { base: '#8a6d72', belly: '#d9a39c', countershade: 0.35, pattern: 'solid', nose: '#7a5c60', earInner: '#d9a39c', muzzle: '#b48a88', jitter: 0.4 },
      mesh: { tris: 5000 },
    },
  },
  camel: {
    label: 'Camel', emoji: '🐪',
    patch: {
      name: 'Humphrey',
      body: { length: 1.15, chestDepth: 0.7, chestWidth: 0.28, rumpWidth: 0.25, waist: 0.82, hump: 0.95, humps: 1 },
      legs: { front: 1.25, hind: 1.3, thickness: 0.075, stance: 'unguligrade', foot: 'paw', footSize: 1.25 },
      neck: { length: 0.95, thickness: 0.13, angle: 28 },
      head: { size: 0.14, muzzleLength: 0.25, muzzleWidth: 0.07, muzzleDepth: 0.09, muzzleTaper: 0.85, pitch: 12, cheeks: 1, brow: 1.2, nose: 'broad' },
      eyes: { size: 0.025, angle: 62, color: '#3a2618', pupil: 'bar' },
      ears: { length: 0.08, width: 0.06, tip: 0.3, spread: 55, side: 0.5 },
      tail: { length: 0.5, thickness: 0.03, brush: 1, lift: -80, curl: 0, tuft: 0.6 },
      coat: { base: '#c49a62', belly: '#d8b582', countershade: 0.3, pattern: 'solid', nose: '#6a4a30', earInner: '#d8b582' },
      mesh: { tris: 5000 },
    },
  },
  bison: {
    label: 'Bison', emoji: '🦬',
    patch: {
      name: 'Buffalo Bill',
      body: { length: 1.5, chestDepth: 0.95, chestWidth: 0.4, rumpWidth: 0.3, waist: 0.9, hump: 1, shoulders: 1.45, haunch: 0.85 },
      legs: { front: 0.85, hind: 0.85, thickness: 0.11, stance: 'unguligrade', foot: 'cloven' },
      neck: { length: 0.25, thickness: 0.35, angle: 0, mane: 'ruff', maneSize: 0.85 },
      head: { size: 0.3, muzzleLength: 0.18, muzzleWidth: 0.14, muzzleDepth: 0.13, muzzleTaper: 0.95, pitch: 60, cheeks: 1.1, brow: 1.3, nose: 'broad' },
      eyes: { size: 0.022, angle: 70, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.1, width: 0.07, spread: 85, side: 0.9 },
      horns: { kind: 'cow', length: 0.2, thickness: 0.05 },
      tail: { length: 0.5, thickness: 0.035, brush: 1, lift: -80, curl: 0, tuft: 1.1 },
      coat: { base: '#5a3f2a', belly: '#4a3322', countershade: 0.2, pattern: 'solid', mane: '#3a2a1e', nose: '#2a1e18', horn: '#2a2420', hoof: '#2a2420', tailTip: '#2a1e18', earInner: '#3a2a1e', jitter: 0.5 },
      mesh: { tris: 5000 },
    },
  },
  llama: {
    label: 'Llama', emoji: '🦙',
    patch: {
      name: 'Tina',
      body: { length: 0.85, chestDepth: 0.48, chestWidth: 0.2, rumpWidth: 0.19, waist: 0.9 },
      legs: { front: 0.85, hind: 0.9, thickness: 0.055, stance: 'unguligrade', foot: 'paw', footSize: 1 },
      neck: { length: 0.72, thickness: 0.1, angle: 76 },
      head: { size: 0.1, muzzleLength: 0.13, muzzleWidth: 0.05, muzzleDepth: 0.06, muzzleTaper: 0.85, pitch: 15, nose: 'broad', noseSize: 0.8 },
      eyes: { size: 0.02, angle: 60, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.16, width: 0.055, tip: 0.6, spread: 8, tilt: -10, side: 0.3 },
      tail: { length: 0.25, thickness: 0.04, brush: 1.2, lift: 10, curl: -30 },
      coat: { base: '#efe6d4', belly: '#efe6d4', countershade: 0, pattern: 'patches', patternColor: '#8a5a34', patternAmount: 0.25, wool: 0.75, nose: '#3a2a20', earInner: '#d9c8b0' },
    },
  },
  moose: {
    label: 'Moose', emoji: '🫎',
    patch: {
      name: 'Bullwinkle',
      body: { length: 1.25, chestDepth: 0.85, chestWidth: 0.33, rumpWidth: 0.28, waist: 0.85, hump: 0.45, shoulders: 1.2 },
      legs: { front: 1.25, hind: 1.3, thickness: 0.085, stance: 'unguligrade', foot: 'cloven' },
      neck: { length: 0.45, thickness: 0.2, angle: 22 },
      head: { size: 0.21, muzzleLength: 0.45, muzzleWidth: 0.12, muzzleDepth: 0.14, muzzleTaper: 1.05, pitch: 50, cheeks: 1.1, nose: 'broad', noseSize: 1.2 },
      eyes: { size: 0.025, angle: 70, color: '#2a1a12', pupil: 'bar' },
      ears: { length: 0.24, width: 0.1, tip: 0.5, spread: 75, side: 0.6 },
      horns: { kind: 'antlers', length: 0.85, thickness: 0.05 },
      tail: { length: 0.12, thickness: 0.04, lift: -60 },
      coat: { base: '#4a3526', belly: '#3a2a1e', countershade: 0.3, pattern: 'solid', socks: 0.45, sockColor: '#b8a58a', horn: '#c8b088', nose: '#2a1e18', earInner: '#3a2a1e', jitter: 0.5 },
      mesh: { tris: 5000 },
    },
  },
  boar: {
    label: 'Boar', emoji: '🐗',
    patch: {
      name: 'Tusker',
      body: { length: 0.85, chestDepth: 0.55, chestWidth: 0.2, rumpWidth: 0.16, waist: 0.9, shoulders: 1.3, haunch: 0.9, hump: 0.3, spines: 0.06, spineCount: 18 },
      legs: { front: 0.48, hind: 0.48, thickness: 0.06, stance: 'unguligrade', foot: 'cloven', footSize: 0.85 },
      neck: { length: 0.1, thickness: 0.2, angle: 8 },
      head: { size: 0.16, muzzleLength: 0.26, muzzleWidth: 0.07, muzzleDepth: 0.09, muzzleTaper: 0.68, pitch: 25, cheeks: 1.2, nose: 'snout', noseSize: 0.95, tusks: 0.13 },
      eyes: { size: 0.014, angle: 55, color: '#3a2216' },
      ears: { length: 0.11, width: 0.08, tip: 0.8, spread: 30, tilt: 10, side: 0.4 },
      tail: { length: 0.25, thickness: 0.015, lift: -70, tuft: 0.8 },
      coat: { base: '#4b3a2e', belly: '#3a2c22', countershade: 0.3, pattern: 'solid', nose: '#3a2a26', horn: '#efe6cf', spine: '#2a201a', hoof: '#2a201a', earInner: '#3a2c22', jitter: 0.6 },
    },
  },
  panda: {
    label: 'Panda', emoji: '🐼', base: 'bear',
    patch: {
      name: 'Bao',
      body: { length: 0.75, chestDepth: 0.48, hump: 0.2 },
      legs: { front: 0.45, hind: 0.42, thickness: 0.095 },
      head: { size: 0.14, muzzleLength: 0.07, muzzleWidth: 0.06, cheeks: 1.6 },
      ears: { length: 0.06, width: 0.065 },
      coat: { base: '#f1eee8', belly: '#f1eee8', countershade: 0, pattern: 'points', patternColor: '#1d1b1b', patternAmount: 0.55, muzzle: '', eyePatch: '#1d1b1b', nose: '#1d1b1b', earInner: '#1d1b1b', jitter: 0.3 },
    },
  },
  crocodile: {
    label: 'Crocodile', emoji: '🐊',
    patch: {
      name: 'Snappy',
      body: { length: 1.5, chestDepth: 0.34, chestWidth: 0.3, rumpWidth: 0.27, waist: 1.0, shoulders: 0.8, haunch: 0.9, spines: 0.05, spineCount: 26 },
      legs: { front: 0.24, hind: 0.27, thickness: 0.065, stance: 'sprawling', foot: 'paw' },
      neck: { length: 0.2, thickness: 0.16, angle: 2 },
      head: { size: 0.15, muzzleLength: 0.6, muzzleWidth: 0.11, muzzleDepth: 0.07, muzzleTaper: 0.7, pitch: 2, cheeks: 0.8, brow: 1.5, nose: 'broad', noseSize: 0.5 },
      eyes: { size: 0.025, angle: 50, color: '#c8b040', pupil: 'slit' },
      ears: { length: 0.03, width: 0.03, tip: 0.5, spread: 70, side: 0.6 },
      tail: { length: 1.7, thickness: 0.2, brush: 1, lift: -4, curl: 0 },
      coat: { base: '#4f5a32', belly: '#c9c08a', countershade: 0.45, pattern: 'scales', patternColor: '#2e351c', patternAmount: 0.55, patternScale: 0.8, nose: '#3a4224', spine: '#3a4224', earInner: '#3a4224', jitter: 0.5 },
      mesh: { tris: 5000 },
    },
  },
  lizard: {
    label: 'Monitor', emoji: '🦎', base: 'crocodile',
    patch: {
      name: 'Komodo',
      body: { length: 0.75, chestDepth: 0.22, chestWidth: 0.15, rumpWidth: 0.14, spines: 0, spineCount: 0 },
      legs: { front: 0.17, hind: 0.19, thickness: 0.045 },
      neck: { length: 0.22, thickness: 0.085, angle: 12 },
      head: { size: 0.075, muzzleLength: 0.13, muzzleWidth: 0.045, muzzleDepth: 0.04, muzzleTaper: 0.7, pitch: 5, brow: 1 },
      eyes: { size: 0.012, angle: 60, color: '#d0a040', pupil: 'round' },
      tail: { length: 0.95, thickness: 0.09, lift: -6 },
      coat: { base: '#6b6250', belly: '#8a8068', countershade: 0.35, pattern: 'scales', patternColor: '#3e382c', patternAmount: 0.6, patternScale: 1.2 },
    },
  },

  // ───────────────────────────────────────────────────── fantasy ──
  dragon: {
    label: 'Dragon', emoji: '🐉', category: 'fantasy',
    patch: {
      name: 'Ember',
      body: { length: 1.9, chestDepth: 0.95, chestWidth: 0.42, rumpWidth: 0.38, waist: 0.78, shoulders: 1.3, haunch: 1.3, spines: 0.22, spineCount: 22 },
      legs: { front: 0.9, hind: 1.0, thickness: 0.15, footSize: 1.3 },
      neck: { length: 1.3, thickness: 0.21, angle: 42 },
      head: { size: 0.3, muzzleLength: 0.45, muzzleWidth: 0.14, muzzleDepth: 0.14, muzzleTaper: 0.68, pitch: 10, cheeks: 1.1, brow: 1.7, nose: 'pad', noseSize: 0.7 },
      eyes: { size: 0.045, angle: 42, color: '#ffb000', pupil: 'slit', glow: true },
      ears: { length: 0.16, width: 0.13, tip: 0.95, spread: 75, tilt: 40, side: 0.75 },
      horns: { kind: 'dragon', length: 0.8, thickness: 0.09 },
      wings: { kind: 'membrane', span: 3.2, chord: 0.62 },
      tail: { length: 3.0, thickness: 0.3, brush: 1, lift: -12, curl: 25 },
      coat: { base: '#7a1f24', belly: '#d9a45a', countershade: 0.55, pattern: 'scales', patternColor: '#4a1015', patternAmount: 0.5, nose: '#3a1215', spine: '#2a1a1a', horn: '#d8c9a8', wing: '#5a1a2a', earInner: '#d9a45a', jitter: 0.5 },
      mesh: { tris: 7000 },
    },
  },
  drake: {
    label: 'Drake', emoji: '🦖', category: 'fantasy', base: 'dragon',
    patch: {
      name: 'Moss',
      body: { length: 1.4, chestDepth: 0.75, chestWidth: 0.34, rumpWidth: 0.32, spines: 0.14, spineCount: 18 },
      legs: { front: 0.75, hind: 0.82, thickness: 0.13 },
      neck: { length: 0.7, thickness: 0.19, angle: 30 },
      head: { size: 0.24, muzzleLength: 0.32, brow: 1.4 },
      eyes: { color: '#e8f040', glow: false },
      horns: { kind: 'goat', length: 0.35, thickness: 0.06 },
      wings: { kind: 'none' },
      tail: { length: 1.9, thickness: 0.26 },
      coat: { base: '#3e6a3a', belly: '#c9c48a', patternColor: '#24401f', spine: '#c9a030', horn: '#c9c0a0', wing: '' },
      mesh: { tris: 6000 },
    },
  },
  griffin: {
    label: 'Griffin', emoji: '🦅', category: 'fantasy',
    patch: {
      name: 'Aquila',
      body: { length: 1.0, chestDepth: 0.55, chestWidth: 0.24, rumpWidth: 0.19, waist: 0.7, shoulders: 1.2 },
      legs: { front: 0.7, hind: 0.72, thickness: 0.085, footSize: 1.05 },
      neck: { length: 0.42, thickness: 0.14, angle: 52, mane: 'ruff', maneSize: 0.6 },
      head: { size: 0.14, muzzleLength: 0.17, muzzleWidth: 0.055, muzzleDepth: 0.085, muzzleTaper: 0.45, pitch: 8, cheeks: 0.7, brow: 1.5, nose: 'beak' },
      eyes: { size: 0.026, angle: 45, color: '#e8a020' },
      ears: { length: 0.11, width: 0.05, tip: 1, spread: 30, tilt: 35, side: 0.3 },
      wings: { kind: 'feathered', span: 2.0, chord: 0.55 },
      tail: { length: 0.8, thickness: 0.03, brush: 1, lift: -60, curl: 30, tuft: 1.2 },
      coat: { base: '#c39a5e', belly: '#e8d2a6', countershade: 0.35, pattern: 'split', patternColor: '#f2ede4', patternAmount: 0.55, wing: '#6b4a2e', beak: '#e8b830', mane: '#f2ede4', socks: 0.4, sockColor: '#e0b040', tailTip: '#5a3a20', earInner: '#f2ede4', earTip: '#3a2a1a' },
      mesh: { tris: 5500 },
    },
  },
  pegasus: {
    label: 'Pegasus', emoji: '🪽', category: 'fantasy', base: 'horse',
    patch: {
      name: 'Cloud',
      wings: { kind: 'feathered', span: 2.4, chord: 0.6 },
      coat: { base: '#f1eee8', belly: '#f1eee8', pattern: 'solid', mane: '#d8d0ee', tail: '#d8d0ee', wing: '#f6f4f0', patternColor: '#c9c0e0', blaze: false, socks: 0, nose: '#9a8a94', hoof: '#c9b99a', earInner: '#d9c8d0' },
    },
  },
  unicorn: {
    label: 'Unicorn', emoji: '🦄', category: 'fantasy', base: 'horse',
    patch: {
      name: 'Sparkle',
      horns: { kind: 'unicorn', length: 0.6, thickness: 0.05 },
      eyes: { color: '#7a5ac8' },
      coat: { base: '#f4f1ec', belly: '#f4f1ec', pattern: 'solid', mane: '#c9a6f0', tail: '#f0a6d0', horn: '#f2d27a', hoof: '#e0cfa0', blaze: false, socks: 0, nose: '#c9a0b0', earInner: '#f0c8d8' },
    },
  },
  hellhound: {
    label: 'Hellhound', emoji: '🔥', category: 'fantasy', base: 'wolf',
    patch: {
      name: 'Cinder',
      scale: 1.3,
      body: { shoulders: 1.3, haunch: 1.15, spines: 0.07, spineCount: 16 },
      eyes: { color: '#ff3a10', glow: true },
      horns: { kind: 'goat', length: 0.14, thickness: 0.025 },
      ears: { tip: 0.95, length: 0.12 },
      coat: { base: '#1c1717', belly: '#2a2020', countershade: 0.3, pattern: 'scales', patternColor: '#5a1a10', patternAmount: 0.35, spine: '#8a2a10', horn: '#2a1a14', earInner: '#8a2a1a', tailTip: '#8a2a10', nose: '#0a0808' },
    },
  },
  direwolf: {
    label: 'Dire Wolf', emoji: '🌕', category: 'fantasy', base: 'wolf',
    patch: {
      name: 'Ghost',
      scale: 1.6,
      body: { shoulders: 1.25, haunch: 1.15 },
      head: { cheeks: 1.4 },
      neck: { mane: 'ruff', maneSize: 0.55 },
      eyes: { color: '#8ad0ff' },
      coat: { base: '#5a5650', belly: '#a8a296', patternColor: '#2a2724', patternAmount: 0.45, mane: '#6a655e' },
    },
  },
  owlbear: {
    label: 'Owlbear', emoji: '🦉', category: 'fantasy', base: 'bear',
    patch: {
      name: 'Hoots',
      neck: { mane: 'ruff', maneSize: 0.85 },
      head: { size: 0.15, muzzleLength: 0.08, muzzleWidth: 0.055, muzzleDepth: 0.08, muzzleTaper: 0.45, pitch: 10, nose: 'beak', brow: 1.6, cheeks: 1.2 },
      eyes: { size: 0.03, angle: 20, color: '#f0b020' },
      ears: { length: 0.12, width: 0.06, tip: 1, spread: 25, tilt: 20, side: 0.25 },
      coat: { base: '#6a4a30', belly: '#8a6a48', mane: '#d9c9a8', beak: '#3a3530', earTip: '#2a1a12', eyePatch: '#e8dcc0' },
    },
  },
  kirin: {
    label: 'Kirin', emoji: '✨', category: 'fantasy', base: 'deer',
    patch: {
      name: 'Qilin',
      body: { spines: 0.05, spineCount: 20 },
      neck: { mane: 'crest', maneSize: 1.1 },
      head: { brow: 1.4, cheeks: 1.2 },
      eyes: { color: '#e8c040', glow: true },
      horns: { kind: 'antlers', length: 0.4, thickness: 0.022 },
      tail: { length: 0.55, tuft: 1.4, lift: -40, curl: 40 },
      coat: { base: '#2f7a6e', belly: '#e8d8a0', countershade: 0.5, pattern: 'scales', patternColor: '#c8a040', patternAmount: 0.45, mane: '#f0d070', tailTip: '#f0d070', spine: '#f0d070', horn: '#f0d070', hoof: '#8a6a20' },
    },
  },
  salamander: {
    label: 'Salamander', emoji: '🦎', category: 'fantasy', base: 'lizard',
    patch: {
      name: 'Pyro',
      scale: 1.4,
      body: { spines: 0.04, spineCount: 20 },
      eyes: { color: '#ff8a10', glow: true, size: 0.016 },
      coat: { base: '#1c1a1a', belly: '#2a2420', pattern: 'spots', patternColor: '#f0a010', patternAmount: 0.5, patternScale: 0.9, spine: '#f06010' },
    },
  },

  // ─────────────────────────────────────────────────────── mounts ──
  ridinghorse: {
    label: 'Riding Horse', emoji: '🏇', category: 'mount', base: 'horse',
    patch: { name: 'Biscuit', tack: { saddle: true, bridle: true, blanket: true, barding: 'none', cloth: '#2f4a7a' } },
  },
  warhorse: {
    label: 'Warhorse', emoji: '🛡️', category: 'mount', base: 'horse',
    patch: {
      name: 'Valiant', scale: 1.08,
      body: { shoulders: 1.15, haunch: 1.15 },
      legs: { thickness: 0.092 },
      coat: { base: '#2a2220', belly: '#2a2220', socks: 0.5, blaze: true },
      tack: { saddle: true, bridle: true, blanket: true, barding: 'plate', cloth: '#7a2630' },
    },
  },
  caravan: {
    label: 'Caravan Camel', emoji: '🐫', category: 'mount', base: 'camel',
    patch: { name: 'Sahara', tack: { saddle: true, bridle: true, blanket: true, cloth: '#b8402a', leather: '#6a4428' } },
  },
  warelephant: {
    label: 'War Elephant', emoji: '🏰', category: 'mount', base: 'elephant',
    patch: { name: 'Hannibal', tack: { saddle: true, bridle: false, blanket: true, barding: 'leather', cloth: '#c8a030', leather: '#6a2a1a' } },
  },
  griffinmount: {
    label: 'Griffin Rider', emoji: '🪶', category: 'mount', base: 'griffin',
    patch: { name: 'Skyfang', scale: 1.15, tack: { saddle: true, bridle: true, blanket: false, cloth: '#2a5a3a' } },
  },
  dragonmount: {
    label: 'Dragon Rider', emoji: '🔥', category: 'mount', base: 'dragon',
    patch: { name: 'Smoulder', tack: { saddle: true, bridle: true, blanket: true, barding: 'none', cloth: '#1e1e28', leather: '#3a2418' } },
  },
  warboar: {
    label: 'War Boar', emoji: '⚔️', category: 'mount', base: 'boar',
    patch: { name: 'Gutripper', scale: 2.0, tack: { saddle: true, bridle: true, blanket: false, barding: 'leather', leather: '#4a2e1c' } },
  },
  wolfrider: {
    label: 'Wolf Rider', emoji: '🐾', category: 'mount', base: 'direwolf',
    patch: { name: 'Fang', tack: { saddle: true, bridle: true, blanket: true, cloth: '#5a2a5a' } },
  },
};

export function presetRecipe(species: string, seed = 1): AnimalRecipe {
  const sp = SPECIES[species] ?? SPECIES.dog;
  const chain: SpeciesDef[] = [sp];
  while (chain[0].base && SPECIES[chain[0].base]) chain.unshift(SPECIES[chain[0].base]);
  let rc = BASE;
  for (const c of chain) rc = mergeRecipe(rc, c.patch);
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
  const keys = Object.keys(SPECIES).filter((k) => SPECIES[k].category !== 'mount');
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

export const categoryOf = (k: string): Category => SPECIES[k]?.category ?? 'real';
