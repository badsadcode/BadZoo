/**
 * The sculpt. An animal is a list of signed-distance "clay" shapes — tapered cones for bones and
 * limbs, ellipsoids for muscle masses — blended with a smooth minimum, so a thigh flows into a
 * haunch flows into a belly the way a sculptor would push clay, instead of tubes poking out of
 * a sausage. The result is then sampled on a grid and meshed (see mesher.ts).
 *
 * Distances are approximate (flattened cones, ellipsoids) — that is fine: we only need the zero
 * level set and a field that behaves near it.
 */
import { add, cross, dot, len, norm, scale, sub, V3 } from './math';

/** [boneIndex, weight] */
export type Weights = [number, number][];

/** What a shape is, for painting and for the decimator's detail budget. */
export type Region =
  | 'body'
  | 'chest'
  | 'belly'
  | 'neck'
  | 'mane'
  | 'head'
  | 'muzzle'
  | 'jaw'
  | 'nose'
  | 'brow'
  | 'ear'
  | 'earInner'
  | 'leg'
  | 'lowerLeg'
  | 'paw'
  | 'hoof'
  | 'tail'
  | 'tailTip'
  | 'horn'
  | 'beak'
  | 'trunk'
  | 'spine'
  | 'wing'
  | 'feather';

interface PrimBase {
  /** blend radius into everything sculpted before it */
  k: number;
  region: Region;
  /** carve instead of add */
  sub?: boolean;
  /** wool / fluff: lumpy displacement amplitude (metres) */
  fluff?: number;
  /**
   * Skin binding. Ellipsoids use `wa` only. Cones blend wa → wm → wb along their length (wm is
   * the plateau in the middle), which is what lets a joint bend as one surface.
   */
  wa: Weights;
  wm?: Weights;
  wb?: Weights;
  /** where this shape sits along its chain (tail, leg, ear), for painting tips and socks */
  span?: [number, number];
  /** a direction the painter cares about (the inside of an ear faces this way) */
  axis?: V3;
  /** slice the shape with a plane (keeps dot(p, n) ≤ o), softened by k: flat-fronted muzzles */
  cut?: { n: V3; o: number; k: number };
}

export interface Cone extends PrimBase {
  kind: 'cone';
  a: V3;
  b: V3;
  ra: number;
  rb: number;
  /** optional cross-section squash: axis (unit, ⟂ to a→b) scaled by f (<1 = thinner) */
  flat?: { axis: V3; f: number };
}

export interface Ellipsoid extends PrimBase {
  kind: 'ell';
  c: V3;
  /** orthonormal local axes */
  ax: [V3, V3, V3];
  r: V3;
  /** > 0: a rounded box with half-extents r instead of an ellipsoid (corner radius = boxy × smallest r) */
  boxy?: number;
}

export type Prim = Cone | Ellipsoid;

// ───────────────────────────────────────────────────────── primitives ──

/** Inigo Quilez' exact round cone (sphere-swept cone between two spheres). */
function sdRoundCone(p: V3, a: V3, b: V3, r1: number, r2: number): { d: number; t: number } {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const pa = sub(p, a);
  const y = dot(pa, ba);
  const t = l2 > 0 ? Math.min(1, Math.max(0, y / l2)) : 0;
  if (l2 < 1e-12) return { d: len(pa) - Math.max(r1, r2), t: 0 };
  let rr = r1 - r2;
  // the exact formula needs |r1-r2| < |b-a|
  const L = Math.sqrt(l2);
  if (Math.abs(rr) >= L * 0.999) {
    rr = Math.sign(rr) * L * 0.999;
    r2 = r1 - rr;
  }
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const z = y - l2;
  const qx = pa[0] * l2 - ba[0] * y;
  const qy = pa[1] * l2 - ba[1] * y;
  const qz = pa[2] * l2 - ba[2] * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  let d: number;
  if (Math.sign(z) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - r2;
  else if (Math.sign(y) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - r1;
  else d = (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  return { d, t };
}

function sdEllipsoid(p: V3, e: Ellipsoid): number {
  const q = sub(p, e.c);
  if (e.boxy) {
    const rr = Math.min(e.r[0], e.r[1], e.r[2]) * Math.min(0.95, e.boxy);
    const qx = Math.abs(dot(q, e.ax[0])) - e.r[0] + rr;
    const qy = Math.abs(dot(q, e.ax[1])) - e.r[1] + rr;
    const qz = Math.abs(dot(q, e.ax[2])) - e.r[2] + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  }
  const lx = dot(q, e.ax[0]) / e.r[0];
  const ly = dot(q, e.ax[1]) / e.r[1];
  const lz = dot(q, e.ax[2]) / e.r[2];
  const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const k1 = Math.sqrt((lx / e.r[0]) ** 2 + (ly / e.r[1]) ** 2 + (lz / e.r[2]) ** 2);
  if (k1 < 1e-9) return -Math.min(e.r[0], e.r[1], e.r[2]);
  return (k0 * (k0 - 1)) / k1;
}

/** cheap smooth 3D value noise in [-1, 1] (for wool) */
function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise3(p: V3): number {
  const xi = Math.floor(p[0]);
  const yi = Math.floor(p[1]);
  const zi = Math.floor(p[2]);
  const xf = p[0] - xi;
  const yf = p[1] - yi;
  const zf = p[2] - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  let acc = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        acc += wt * hash3(xi + dx, yi + dy, zi + dz);
      }
  return acc * 2 - 1;
}

/** Wool: rounded lumps (cellular-ish), always pushing outward. */
function woolLumps(p: V3, amp: number): number {
  // lump size follows the fluff depth, so a mammoth's coat isn't made of sheep-sized curls
  const f = 0.5 / Math.max(0.005, amp);
  const n = noise3(scale(p, f)) * 0.6 + noise3(scale(p, f * 2.1)) * 0.4;
  return 0.5 + 0.5 * n;
}

/** Distance from p to one primitive, plus the position along it (0..1) for skin blending. */
export function primDist(p: V3, pr: Prim): { d: number; t: number } {
  let r: { d: number; t: number };
  if (pr.kind === 'cone') {
    if (pr.flat) {
      // stretch space along the squash axis → thinner shape; scale the distance back down
      const off = dot(sub(p, pr.a), pr.flat.axis);
      const q = add(p, scale(pr.flat.axis, off * (1 / pr.flat.f - 1)));
      r = sdRoundCone(q, pr.a, pr.b, pr.ra, pr.rb);
      r.d *= pr.flat.f;
    } else r = sdRoundCone(p, pr.a, pr.b, pr.ra, pr.rb);
  } else r = { d: sdEllipsoid(p, pr), t: 0 };
  if (pr.fluff) r.d -= pr.fluff * woolLumps(p, pr.fluff);
  if (pr.cut) r.d = smax(r.d, dot(p, pr.cut.n) - pr.cut.o, pr.cut.k);
  return r;
}

/** polynomial smooth min / max */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export interface AABB {
  min: V3;
  max: V3;
}

export function primBounds(pr: Prim): AABB {
  const pad = (pr.fluff ?? 0) + 0.001;
  if (pr.kind === 'cone') {
    const r = Math.max(pr.ra, pr.rb) + pad;
    return {
      min: [Math.min(pr.a[0], pr.b[0]) - r, Math.min(pr.a[1], pr.b[1]) - r, Math.min(pr.a[2], pr.b[2]) - r],
      max: [Math.max(pr.a[0], pr.b[0]) + r, Math.max(pr.a[1], pr.b[1]) + r, Math.max(pr.a[2], pr.b[2]) + r],
    };
  }
  // bounding box of a rotated ellipsoid
  const ext: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++)
    ext[i] = (pr.boxy
      ? Math.abs(pr.ax[0][i] * pr.r[0]) + Math.abs(pr.ax[1][i] * pr.r[1]) + Math.abs(pr.ax[2][i] * pr.r[2])
      : Math.hypot(pr.ax[0][i] * pr.r[0], pr.ax[1][i] * pr.r[1], pr.ax[2][i] * pr.r[2])) + pad;
  return { min: sub(pr.c, ext), max: add(pr.c, ext) };
}

/** Orthonormal frame whose z axis is `fwd` and whose y axis is as close to `up` as possible. */
export function frame(fwd: V3, up: V3 = [0, 1, 0]): [V3, V3, V3] {
  const z = norm(fwd);
  let x = cross(up, z);
  if (len(x) < 1e-6) x = cross([1, 0, 0], z);
  x = norm(x);
  const y = cross(z, x);
  return [x, y, z];
}

// ───────────────────────────────────────────────────────────── field ──

export interface Grid {
  origin: V3;
  h: number;
  nx: number;
  ny: number;
  nz: number;
  /** signed distance at every node (x fastest) */
  d: Float32Array;
}

/**
 * Sample the sculpt on a regular grid. Shapes are applied in order (union or carve), each one
 * only over its own bounding box: outside it, it can't change the field near the surface.
 */
export function sampleGrid(prims: Prim[], h: number): Grid {
  const bb: AABB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const bounds = prims.map(primBounds);
  prims.forEach((p, i) => {
    if (p.sub) return;
    for (let a = 0; a < 3; a++) {
      bb.min[a] = Math.min(bb.min[a], bounds[i].min[a]);
      bb.max[a] = Math.max(bb.max[a], bounds[i].max[a]);
    }
  });
  const margin = 3 * h;
  const origin: V3 = [bb.min[0] - margin, bb.min[1] - margin, bb.min[2] - margin];
  const nx = Math.ceil((bb.max[0] - bb.min[0] + 2 * margin) / h) + 1;
  const ny = Math.ceil((bb.max[1] - bb.min[1] + 2 * margin) / h) + 1;
  const nz = Math.ceil((bb.max[2] - bb.min[2] + 2 * margin) / h) + 1;
  const far = margin * 4;
  const d = new Float32Array(nx * ny * nz).fill(far);
  const p: V3 = [0, 0, 0];
  prims.forEach((pr, i) => {
    const b = bounds[i];
    const grow = pr.k + margin;
    const x0 = Math.max(0, Math.floor((b.min[0] - grow - origin[0]) / h));
    const y0 = Math.max(0, Math.floor((b.min[1] - grow - origin[1]) / h));
    const z0 = Math.max(0, Math.floor((b.min[2] - grow - origin[2]) / h));
    const x1 = Math.min(nx - 1, Math.ceil((b.max[0] + grow - origin[0]) / h));
    const y1 = Math.min(ny - 1, Math.ceil((b.max[1] + grow - origin[1]) / h));
    const z1 = Math.min(nz - 1, Math.ceil((b.max[2] + grow - origin[2]) / h));
    for (let z = z0; z <= z1; z++) {
      p[2] = origin[2] + z * h;
      for (let y = y0; y <= y1; y++) {
        p[1] = origin[1] + y * h;
        let idx = (z * ny + y) * nx + x0;
        for (let x = x0; x <= x1; x++, idx++) {
          p[0] = origin[0] + x * h;
          const v = primDist(p, pr).d;
          d[idx] = pr.sub ? smax(d[idx], -v, pr.k) : smin(d[idx], v, pr.k);
        }
      }
    }
  });
  return { origin, h, nx, ny, nz, d };
}

/** Field value at an arbitrary point (same composition rules as the grid). */
export function fieldAt(prims: Prim[], p: V3): number {
  let d = 1e9;
  for (const pr of prims) {
    const v = primDist(p, pr).d;
    d = pr.sub ? smax(d, -v, pr.k) : smin(d, v, pr.k);
  }
  return d;
}

/** Sample an arbitrary field over a box (used for tack shells). */
export function sampleFn(fn: (p: V3) => number, min: V3, max: V3, h: number): Grid {
  const margin = 2 * h;
  const origin: V3 = [min[0] - margin, min[1] - margin, min[2] - margin];
  const nx = Math.ceil((max[0] - min[0] + 2 * margin) / h) + 1;
  const ny = Math.ceil((max[1] - min[1] + 2 * margin) / h) + 1;
  const nz = Math.ceil((max[2] - min[2] + 2 * margin) / h) + 1;
  const d = new Float32Array(nx * ny * nz);
  const p: V3 = [0, 0, 0];
  let i = 0;
  for (let z = 0; z < nz; z++) {
    p[2] = origin[2] + z * h;
    for (let y = 0; y < ny; y++) {
      p[1] = origin[1] + y * h;
      for (let x = 0; x < nx; x++, i++) {
        p[0] = origin[0] + x * h;
        const onEdge = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
        d[i] = onEdge ? Math.max(h, fn(p)) : fn(p);
      }
    }
  }
  return { origin, h, nx, ny, nz, d };
}

/** The sculpt's field, restricted to the shapes that can matter inside a box (fast). */
export function fieldIn(prims: Prim[], min: V3, max: V3): (p: V3) => number {
  const sel = prims.filter((pr) => {
    const b = primBounds(pr);
    const g = pr.k + 0.001;
    return b.min[0] - g <= max[0] && b.max[0] + g >= min[0] && b.min[1] - g <= max[1] && b.max[1] + g >= min[1] && b.min[2] - g <= max[2] && b.max[2] + g >= min[2];
  });
  return (p: V3) => fieldAt(sel, p);
}

export function sdBox(p: V3, c: V3, half: V3, r: number): number {
  const qx = Math.abs(p[0] - c[0]) - half[0] + r;
  const qy = Math.abs(p[1] - c[1]) - half[1] + r;
  const qz = Math.abs(p[2] - c[2]) - half[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
export function sdEll(p: V3, c: V3, r: V3): number {
  const lx = (p[0] - c[0]) / r[0];
  const ly = (p[1] - c[1]) / r[1];
  const lz = (p[2] - c[2]) / r[2];
  const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const k1 = Math.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2);
  return k1 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
}
/** distance to a capsule a→b of radius r */
export function sdCapsule(p: V3, a: V3, b: V3, r: number): number {
  const ba = sub(b, a);
  const pa = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(pa, ba) / Math.max(1e-12, dot(ba, ba))));
  return len(sub(pa, scale(ba, t))) - r;
}
