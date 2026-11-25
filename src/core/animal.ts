/**
 * generateAnimal(recipe): sculpt → surface nets → relax → importance-weighted decimation →
 * skinning → coat painting → (flat | smooth) game mesh, plus eyes and animation clips.
 */
import { Anatomy, buildAnatomy, scaleAnatomy } from './anatomy';
import { buildClips, Clip } from './anim';
import { decimate } from './decimate';
import { cross, norm, sub, V3 } from './math';
import { flipWinding, relax, signedVolume, surfaceNets, TriMesh } from './mesher';
import { hexRgb, jitter, LOCKED_REGIONS, Owner, paintFacet, PaintContext, RGB, srgbToLinear } from './paint';
import type { AnimalRecipe } from './recipe';
import { Prim, primDist, Region, sampleGrid } from './sdf';

export interface MeshOut {
  positions: Float32Array;
  normals: Float32Array;
  /** linear RGB */
  colors: Float32Array;
  joints: Uint8Array;
  weights: Float32Array;
  indices: Uint32Array;
}

export interface Animal {
  recipe: AnimalRecipe;
  anatomy: Anatomy;
  body: MeshOut;
  eyes: MeshOut;
  clips: Clip[];
  stats: { tris: number; verts: number; sculptTris: number; shapes: number; ms: number; height: number; length: number };
}

/** extra decimation budget for the parts people look at */
const IMPORTANCE: Partial<Record<Region, number>> = {
  head: 5, muzzle: 6, jaw: 4, nose: 9, brow: 6, ear: 5, earInner: 5, paw: 2.5, hoof: 2.5, horn: 3, tailTip: 1.5, mane: 1.5,
};

function owner(prims: Prim[], p: V3): Owner {
  let best = Infinity;
  let bp = prims[0];
  let bt = 0;
  for (const pr of prims) {
    if (pr.sub) continue;
    const r = primDist(p, pr);
    if (r.d < best) {
      best = r.d;
      bp = pr;
      bt = r.t;
    }
  }
  const u = bp.span ? bp.span[0] + (bp.span[1] - bp.span[0]) * bt : 0;
  return { prim: bp, u };
}

/**
 * Skin weights from the sculpt: a vertex listens to every shape it sits close to (within that
 * shape's blend radius), and each shape knows which bones it follows along its length.
 */
function skinVertex(prims: Prim[], p: V3, h: number): [number, number][] {
  const ds: number[] = [];
  const ts: number[] = [];
  let dmin = Infinity;
  for (let i = 0; i < prims.length; i++) {
    const pr = prims[i];
    if (pr.sub) {
      ds.push(Infinity);
      ts.push(0);
      continue;
    }
    const r = primDist(p, pr);
    ds.push(r.d);
    ts.push(r.t);
    if (r.d < dmin) dmin = r.d;
  }
  const acc = new Map<number, number>();
  for (let i = 0; i < prims.length; i++) {
    const pr = prims[i];
    const band = pr.k * 0.7 + h;
    const x = (ds[i] - dmin) / band;
    if (x >= 1) continue;
    const w = (1 - x) * (1 - x);
    for (const [b, bw] of bindingAt(pr, ts[i])) acc.set(b, (acc.get(b) ?? 0) + w * bw);
  }
  const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = list.reduce((a, [, w]) => a + w, 0) || 1;
  return list.map(([b, w]) => [b, w / sum]);
}

function bindingAt(pr: Prim, t: number): [number, number][] {
  if (pr.kind === 'ell' || !pr.wb) return pr.wa;
  const blend = (a: [number, number][], b: [number, number][], s: number) => {
    const m = new Map<number, number>();
    for (const [i, w] of a) m.set(i, (m.get(i) ?? 0) + w * (1 - s));
    for (const [i, w] of b) m.set(i, (m.get(i) ?? 0) + w * s);
    return [...m.entries()];
  };
  if (pr.wm) {
    if (t < 0.25) return blend(pr.wa, pr.wm, t / 0.25);
    if (t > 0.75) return blend(pr.wm, pr.wb, (t - 0.75) / 0.25);
    return pr.wm;
  }
  return blend(pr.wa, pr.wb, t);
}

const v3 = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

/** the sculpt's longest extent, for picking the grid spacing */
function extent(a: Anatomy): number {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const p of a.prims) {
    const pts = p.kind === 'cone' ? [p.a, p.b] : [p.c];
    const r = p.kind === 'cone' ? Math.max(p.ra, p.rb) : Math.max(...p.r);
    for (const q of pts)
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], q[i] - r);
        mx[i] = Math.max(mx[i], q[i] + r);
      }
  }
  mn = mn.map((x) => x);
  return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
}

export function generateAnimal(rc: AnimalRecipe, opts: { clips?: boolean } = {}): Animal {
  const t0 = performance.now();
  const res = Math.max(40, Math.min(320, rc.mesh.resolution));
  // pass 1 to measure, pass 2 with the real grid spacing (thin parts are thickened to ≥ 2.6 cells)
  let hU = 0.008;
  let anat = buildAnatomy(rc, hU);
  hU = extent(anat) / res;
  anat = buildAnatomy(rc, hU);
  scaleAnatomy(anat, rc.scale);
  const h = hU * rc.scale;
  const prims = anat.prims;

  // ── sculpt → dense mesh
  const grid = sampleGrid(prims, h);
  const dense: TriMesh = surfaceNets(grid);
  if (signedVolume(dense) < 0) flipWinding(dense);
  relax(dense, 2);
  const sculptTris = dense.tri.length / 3;

  // ── importance-weighted decimation
  const nD = dense.pos.length / 3;
  const imp = new Float64Array(nD);
  for (let i = 0; i < nD; i++) imp[i] = IMPORTANCE[owner(prims, v3(dense.pos, i)).prim.region] ?? 1;
  const low = decimate(dense, { targetTris: Math.max(300, rc.mesh.tris), weight: imp });

  // ── skin + paint
  const size = anat.dims.withers;
  const ctx: PaintContext = { rc, size, withers: anat.dims.withers };
  const nV = low.pos.length / 3;
  const skin = Array.from({ length: nV }, (_, i) => skinVertex(prims, v3(low.pos, i), h));
  const nT = low.tri.length / 3;

  let body: MeshOut;
  if (rc.mesh.shading === 'flat') {
    // paint every facet, then clean up the pattern edges, then unweld (3 vertices per facet)
    const faceN: V3[] = [];
    const faceCol: RGB[] = [];
    const locked: boolean[] = [];
    for (let t = 0; t < nT; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => v3(low.pos, low.tri[t * 3 + k]));
      const n = norm(cross(sub(b, a), sub(c, a)));
      const cen: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const o = owner(prims, cen);
      faceN.push(n);
      faceCol.push(paintFacet(ctx, cen, n, o));
      locked.push(LOCKED_REGIONS.has(o.prim.region));
    }
    smoothLabels(low, faceCol, locked, 2);
    const P = new Float32Array(nT * 9);
    const N = new Float32Array(nT * 9);
    const Cc = new Float32Array(nT * 9);
    const J = new Uint8Array(nT * 12);
    const Wt = new Float32Array(nT * 12);
    for (let t = 0; t < nT; t++) {
      const ids = [low.tri[t * 3], low.tri[t * 3 + 1], low.tri[t * 3 + 2]];
      const col = jitter(faceCol[t], rc, t).map(srgbToLinear) as RGB;
      ids.forEach((vi, k) => {
        const o = t * 3 + k;
        P.set(v3(low.pos, vi), o * 3);
        N.set(faceN[t], o * 3);
        Cc.set(col, o * 3);
        skin[vi].forEach(([bi, w], s) => {
          J[o * 4 + s] = bi;
          Wt[o * 4 + s] = w;
        });
      });
    }
    body = { positions: P, normals: N, colors: Cc, joints: J, weights: Wt, indices: Uint32Array.from({ length: nT * 3 }, (_, i) => i) };
  } else {
    const N = new Float32Array(nV * 3);
    for (let t = 0; t < nT; t++) {
      const ids = [low.tri[t * 3], low.tri[t * 3 + 1], low.tri[t * 3 + 2]];
      const [a, b, c] = ids.map((i) => v3(low.pos, i));
      const n = cross(sub(b, a), sub(c, a)); // area-weighted
      for (const i of ids) for (let k = 0; k < 3; k++) N[i * 3 + k] += n[k];
    }
    const Cc = new Float32Array(nV * 3);
    const J = new Uint8Array(nV * 4);
    const Wt = new Float32Array(nV * 4);
    for (let i = 0; i < nV; i++) {
      const n = norm(v3(N, i));
      N.set(n, i * 3);
      const p = v3(low.pos, i);
      Cc.set(jitter(paintFacet(ctx, p, n, owner(prims, p)), rc, i).map(srgbToLinear), i * 3);
      skin[i].forEach(([bi, w], s) => {
        J[i * 4 + s] = bi;
        Wt[i * 4 + s] = w;
      });
    }
    body = { positions: Float32Array.from(low.pos), normals: N, colors: Cc, joints: J, weights: Wt, indices: low.tri };
  }

  const eyes = eyeMesh(anat, rc);
  const clips = opts.clips === false ? [] : buildClips(anat, rc);
  let height = 0;
  for (let i = 1; i < body.positions.length; i += 3) height = Math.max(height, body.positions[i]);
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let i = 2; i < body.positions.length; i += 3) {
    zmin = Math.min(zmin, body.positions[i]);
    zmax = Math.max(zmax, body.positions[i]);
  }
  return {
    recipe: rc,
    anatomy: anat,
    body,
    eyes,
    clips,
    stats: { tris: nT + eyes.indices.length / 3, verts: body.positions.length / 3, sculptTris, shapes: prims.length, ms: performance.now() - t0, height, length: zmax - zmin },
  };
}

/**
 * Majority filter over facet colours: a facet whose neighbours mostly agree on another colour
 * takes it. Removes the lone "torn" triangles that make low-poly pattern edges look noisy.
 */
function smoothLabels(m: TriMesh, col: RGB[], locked: boolean[], iters: number) {
  const nT = m.tri.length / 3;
  const edge = new Map<string, number>();
  const nb: number[][] = Array.from({ length: nT }, () => []);
  for (let t = 0; t < nT; t++)
    for (let e = 0; e < 3; e++) {
      const a = m.tri[t * 3 + e];
      const b = m.tri[t * 3 + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const o = edge.get(key);
      if (o === undefined) edge.set(key, t);
      else {
        nb[t].push(o);
        nb[o].push(t);
      }
    }
  const key = (c: RGB) => `${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)}`;
  for (let it = 0; it < iters; it++) {
    const next = col.slice();
    for (let t = 0; t < nT; t++) {
      if (locked[t]) continue;
      const own = key(col[t]);
      const counts = new Map<string, { n: number; c: RGB }>();
      for (const o of nb[t]) {
        if (locked[o]) continue;
        const k = key(col[o]);
        const e = counts.get(k) ?? { n: 0, c: col[o] };
        e.n++;
        counts.set(k, e);
      }
      for (const [k, e] of counts) if (k !== own && e.n >= 2 && !counts.has(own)) next[t] = e.c;
    }
    for (let t = 0; t < nT; t++) col[t] = next[t];
  }
}

// ───────────────────────────────────────────────────────────── eyes ──

function icosphere(sub: number): { pos: V3[]; tri: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => norm(p as V3));
  let tri = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < sub; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = cache.get(key);
      if (i === undefined) {
        i = pos.length;
        pos.push(norm([(pos[a][0] + pos[b][0]) / 2, (pos[a][1] + pos[b][1]) / 2, (pos[a][2] + pos[b][2]) / 2]));
        cache.set(key, i);
      }
      return i;
    };
    const nt: number[] = [];
    for (let i = 0; i < tri.length; i += 3) {
      const [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nt.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    tri = nt;
    pos = [...pos];
  }
  return { pos, tri };
}

function eyeMesh(a: Anatomy, rc: AnimalRecipe): MeshOut {
  const ico = icosphere(2);
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const J: number[] = [];
  const Wt: number[] = [];
  const iris = hexRgb(rc.eyes.color).map(srgbToLinear) as RGB;
  const pupil: RGB = [0.004, 0.004, 0.005];
  const sclera = hexRgb('#2b211c').map(srgbToLinear) as RGB;
  const glint: RGB = [0.9, 0.9, 0.9];
  for (const e of a.eyes) {
    const z = e.look;
    const x = norm(cross([0, 1, 0], z));
    const y = cross(z, x);
    for (let i = 0; i < ico.tri.length; i += 3) {
      const vs = [ico.pos[ico.tri[i]], ico.pos[ico.tri[i + 1]], ico.pos[ico.tri[i + 2]]];
      const c = norm([(vs[0][0] + vs[1][0] + vs[2][0]) / 3, (vs[0][1] + vs[1][1] + vs[2][1]) / 3, (vs[0][2] + vs[1][2] + vs[2][2]) / 3]);
      // in the eye's own frame
      const lx = c[0] * x[0] + c[1] * x[1] + c[2] * x[2];
      const ly = c[0] * y[0] + c[1] * y[1] + c[2] * y[2];
      const lz = c[0] * z[0] + c[1] * z[1] + c[2] * z[2];
      let col = sclera;
      if (lz > 0.55) col = iris;
      const pu = rc.eyes.pupil;
      if (pu === 'round' && lz > 0.86) col = pupil;
      if (pu === 'slit' && lz > 0.6 && Math.abs(lx) < 0.16) col = pupil;
      if (pu === 'bar' && lz > 0.6 && Math.abs(ly) < 0.15) col = pupil;
      // a baked catch-light: low-poly eyes look dead without one
      if (lz > 0.55 && ly > 0.42 && lx * Math.sign(z[0] || 1) < 0.25 && lx * Math.sign(z[0] || 1) > -0.15) col = glint;
      const n = norm(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])));
      for (const v of vs) {
        P.push(e.c[0] + v[0] * e.r, e.c[1] + v[1] * e.r, e.c[2] + v[2] * e.r);
        N.push(...n);
        C.push(...col);
        J.push(e.bone, 0, 0, 0);
        Wt.push(1, 0, 0, 0);
      }
    }
  }
  return {
    positions: Float32Array.from(P),
    normals: Float32Array.from(N),
    colors: Float32Array.from(C),
    joints: Uint8Array.from(J),
    weights: Float32Array.from(Wt),
    indices: Uint32Array.from({ length: P.length / 3 }, (_, i) => i),
  };
}
