/**
 * Coat painting. Every facet gets one flat colour (the classic low-poly look), decided from what
 * the facet belongs to (nose, hoof, inner ear…), which way it faces (countershading: animals are
 * lighter underneath) and a 3D pattern field evaluated in the rest pose (spots, rosettes, stripes,
 * patches, saddle, colour points). Patterns live in 3D, so they wrap the body without UV seams.
 */
import { clamp, dot, lerp, V3 } from './math';
import type { AnimalRecipe } from './recipe';
import { noise3, Prim } from './sdf';

export type RGB = [number, number, number];

export function hexRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function hash3i(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(s, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** distance to the nearest jittered feature point (Worley F1) */
function worley(p: V3, seed: number): number {
  const xi = Math.floor(p[0]);
  const yi = Math.floor(p[1]);
  const zi = Math.floor(p[2]);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const fx = cx + hash3i(cx, cy, cz, seed);
        const fy = cy + hash3i(cx, cy, cz, seed + 1);
        const fz = cz + hash3i(cx, cy, cz, seed + 2);
        const d = Math.hypot(p[0] - fx, p[1] - fy, p[2] - fz);
        if (d < best) best = d;
      }
  return best;
}

/** Worley F1, F2 and a stable random value for the nearest cell (scales) */
function worleyCells(p: V3, seed: number): [number, number, number] {
  const xi = Math.floor(p[0]);
  const yi = Math.floor(p[1]);
  const zi = Math.floor(p[2]);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const d = Math.hypot(p[0] - cx - hash3i(cx, cy, cz, seed), p[1] - cy - hash3i(cx, cy, cz, seed + 1), p[2] - cz - hash3i(cx, cy, cz, seed + 2));
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = hash3i(cx, cy, cz, seed + 3);
        } else if (d < f2) f2 = d;
      }
  return [f1, f2, id];
}

export interface PaintContext {
  rc: AnimalRecipe;
  /** withers height (pattern scale reference) */
  size: number;
  withers: number;
  /** eye centres + radius, for eye patches */
  eyes?: { c: V3; r: number }[];
}

/** What the facet "is": the shape it sits on, and how far along that shape's chain. */
export interface Owner {
  prim: Prim;
  /** 0..1 along the chain (prim.span), when the prim has one */
  u: number;
}

export function paintFacet(ctx: PaintContext, p: V3, n: V3, o: Owner): RGB {
  const { rc } = ctx;
  const C = rc.coat;
  const reg = o.prim.region;
  const base = hexRgb(C.base);
  let col = base;

  const pat = hexRgb(C.patternColor);
  const q: V3 = [p[0] / ctx.size, p[1] / ctx.size, p[2] / ctx.size];
  const fs = 1 / Math.max(0.2, C.patternScale);
  const amt = C.patternAmount;
  const furry = !['nose', 'hoof', 'horn', 'earInner', 'beak', 'spine', 'wing'].includes(reg);
  const isLeg = reg === 'leg' || reg === 'lowerLeg' || reg === 'paw';

  // ── countershading (lighter underneath)
  if (furry && reg !== 'tail' && reg !== 'tailTip' && reg !== 'ear' && C.countershade > 0) {
    const thr = lerp(-0.85, 0.35, C.countershade);
    let under = n[1] < thr;
    if (reg === 'head' || reg === 'brow') under = n[1] < thr - 0.25;
    if (under) col = hexRgb(C.belly);
  }

  // ── pattern
  if (furry && reg !== 'tailTip') {
    let on = false;
    switch (C.pattern) {
      case 'spots': {
        const w = worley([q[0] * 7 * fs, q[1] * 7 * fs, q[2] * 7 * fs], rc.seed);
        on = w < 0.18 + 0.22 * amt;
        break;
      }
      case 'rosettes': {
        const w = worley([q[0] * 6 * fs, q[1] * 6 * fs, q[2] * 6 * fs], rc.seed);
        on = w > 0.2 && w < 0.2 + 0.16 * (0.5 + amt);
        if (w <= 0.2 && amt > 0.3) col = mix(col, pat, 0.22);
        if (n[1] < -0.3) on = on && amt > 0.6;
        break;
      }
      case 'stripes':
      case 'tabby': {
        const warp = noise3([q[0] * 3 * fs, q[1] * 3 * fs, q[2] * 3 * fs]) * 0.9;
        const coord = isLeg || reg === 'tail' ? q[1] * 1.3 + q[2] * 0.4 : q[2] + Math.abs(q[0]) * 0.25 + q[1] * 0.15;
        const sv = Math.sin((coord * (C.pattern === 'tabby' ? 12 : 9) * fs + warp * (C.pattern === 'tabby' ? 0.6 : 1)) * Math.PI);
        const width = C.pattern === 'tabby' ? 0.25 + 0.4 * amt : 0.15 + 0.6 * amt;
        on = sv > 1 - width;
        if (C.pattern === 'tabby' && n[1] > 0.55 && reg !== 'head' && reg !== 'muzzle') on = true; // dorsal stripe
        if (n[1] < -0.5 && C.countershade > 0.3) on = on && C.pattern === 'stripes' && amt > 0.7;
        break;
      }
      case 'patches': {
        const v = noise3([q[0] * 2.6 * fs + 11, q[1] * 2.6 * fs, q[2] * 2.6 * fs]) + noise3([q[0] * 6 * fs, q[1] * 6 * fs + 3, q[2] * 6 * fs]) * 0.35;
        on = v > 0.55 - amt * 1.1;
        break;
      }
      case 'saddle': {
        const line = ctx.withers * (0.92 - 0.38 * amt);
        const body = ['body', 'chest', 'belly', 'neck', 'mane', 'tail'].includes(reg);
        on = body && p[1] > line && n[1] > -0.25 && !(reg === 'neck' && p[2] > ctx.size * 0.55);
        if (reg === 'tail' && n[1] > 0.1) on = true;
        if (reg === 'head' || reg === 'muzzle' || reg === 'brow') on = amt > 0.5 && (reg === 'muzzle' || n[1] > 0.6);
        break;
      }
      case 'points': {
        const face = amt > 0.7 && (reg === 'head' || reg === 'brow');
        const ext = face || (isLeg && o.u > 0.55 - amt * 0.3) || reg === 'ear' || reg === 'tail' || reg === 'muzzle' || reg === 'jaw' || reg === 'nose';
        if (ext) {
          col = mix(col, pat, face ? 1 : isLeg ? clamp((o.u - 0.35) * 2.5) : reg === 'tail' ? clamp(0.3 + o.u) : 0.9);
        }
        break;
      }
      case 'scales': {
        // irregular plates: each cell its own shade between base and pattern, darker seams
        const [f1, f2, id] = worleyCells([q[0] * 9 * fs, q[1] * 9 * fs, q[2] * 9 * fs], rc.seed);
        if (n[1] < lerp(-0.85, 0.35, C.countershade) && C.countershade > 0) break; // belly plates stay clean
        col = mix(col, pat, id * amt * 0.7);
        on = f2 - f1 < 0.08 * (0.5 + amt);
        if (on) col = mix(col, pat, 0.75);
        on = false;
        break;
      }
      case 'split': {
        // front half / back half (griffin: eagle at the front, lion at the back)
        const zs = ctx.size * lerp(0.6, -0.6, amt);
        on = p[2] > zs + noise3([q[0] * 4, q[1] * 4, q[2] * 4]) * ctx.size * 0.06;
        break;
      }
      case 'solid':
        break;
    }
    if (on) col = pat;
  }

  // ── markings
  if (C.eyePatch && ctx.eyes && (reg === 'head' || reg === 'brow' || reg === 'muzzle')) {
    for (const e of ctx.eyes) if (Math.hypot(p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]) < e.r * 2.5) col = hexRgb(C.eyePatch);
  }
  if (C.mane && reg === 'mane') col = hexRgb(C.mane);
  if (C.tail && (reg === 'tail' || reg === 'tailTip')) col = hexRgb(C.tail);
  if (C.muzzle && (reg === 'muzzle' || reg === 'jaw')) col = hexRgb(C.muzzle);
  if (C.socks > 0 && isLeg && o.u > 1 - C.socks * 0.55) col = hexRgb(C.sockColor);
  if (C.blaze && (reg === 'head' || reg === 'muzzle' || reg === 'brow')) {
    const w = rc.head.size * (reg === 'muzzle' ? 0.32 : 0.22) * rc.scale;
    if (Math.abs(p[0]) < w && (n[1] > 0.2 || n[2] > 0.4)) col = hexRgb(C.sockColor);
  }
  if (reg === 'ear') {
    const inner = o.prim.axis ? dot(n, o.prim.axis) > 0.45 : false;
    if (C.earTip && o.u > 0.62) col = hexRgb(C.earTip);
    else if (inner && rc.ears.droop < 0.5) col = hexRgb(C.earInner);
  }
  if (reg === 'earInner') col = hexRgb(C.earInner);
  if (C.tailTip && ((reg === 'tail' && o.u > 0.8) || reg === 'tailTip')) col = hexRgb(C.tailTip);
  if (reg === 'tailTip' && !C.tailTip) col = mix(col, pat, 0.8);
  if (reg === 'nose') col = hexRgb(C.nose);
  if (reg === 'beak') col = hexRgb(C.beak);
  if (reg === 'spine') col = hexRgb(C.spine || C.horn);
  if (reg === 'wing') col = C.wing ? hexRgb(C.wing) : col;
  if (reg === 'hoof') col = hexRgb(C.hoof);
  if (reg === 'horn') col = mix(hexRgb(C.horn), hexRgb(C.hoof), 0.15);
  if (reg === 'paw' && n[1] < -0.55) col = hexRgb(C.nose); // pads

  return col;
}

/** regions whose colour is a hard rule (never smoothed into their neighbours) */
export const LOCKED_REGIONS = new Set(['nose', 'hoof', 'horn', 'earInner', 'paw', 'beak', 'spine']);

/** hand-made facet jitter: a few % of brightness per facet */
export function jitter(col: RGB, rc: AnimalRecipe, faceId: number): RGB {
  if (rc.coat.jitter <= 0) return col;
  const j = (hash3i(faceId, 7, 13, rc.seed) - 0.5) * 0.1 * rc.coat.jitter;
  return [clamp(col[0] * (1 + j)), clamp(col[1] * (1 + j)), clamp(col[2] * (1 + j))];
}

export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
