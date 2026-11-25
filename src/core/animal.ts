/**
 * generateAnimal(recipe): sculpt → surface nets → relax → importance-weighted decimation →
 * skinning → coat painting → (flat | smooth) game mesh, plus eyes and animation clips.
 */
import { Anatomy, buildAnatomy, scaleAnatomy } from './anatomy';
import { buildClips, Clip } from './anim';
import { decimate } from './decimate';
import { cross, norm, sub, V3 } from './math';
import { flipWinding, relax, signedVolume, surfaceNets, TriMesh } from './mesher';
import { gridLaplacian, remesh } from './remesh';
import type { Grid } from './sdf';
import { hexRgb, jitter, LOCKED_REGIONS, paintFacet, PaintContext, RGB, srgbToLinear } from './paint';
import type { AnimalRecipe } from './recipe';
import { Region, sampleGrid } from './sdf';
import { owner, skinVertex } from './skin';
import { buildTack } from './tack';
import { buildWings } from './wings';

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
  /** riding gear, split by material */
  tack: MeshOut | null;
  metal: MeshOut | null;
  tackPieces: string[];
  clips: Clip[];
  stats: { tris: number; bodyTris: number; verts: number; sculptTris: number; shapes: number; ms: number; height: number; length: number };
}

/** extra decimation budget for the parts people look at */
const IMPORTANCE: Partial<Record<Region, number>> = {
  head: 5, muzzle: 6, jaw: 4, nose: 9, brow: 6, ear: 5, earInner: 5, paw: 2.5, hoof: 2.5, horn: 3, tailTip: 1.5, mane: 1.5, beak: 6, trunk: 2.5, spine: 2, wing: 1.5,
};

/**
 * Where the remesher should spend triangles (relative edge length, 1 = average):
 *  - finer on what people look at (face, ears, feet), via region importance
 *  - finer on tight curves (ear tips, horns, toes), via the field's curvature
 *  - extra edge loops around joints, so elbows and knees have geometry to bend with
 */
function sizeField(a: Anatomy, g: Grid, dense: TriMesh, target: number, rc: AnimalRecipe) {
  let area = 0;
  for (let i = 0; i < dense.tri.length; i += 3) {
    const [p, q, r] = [0, 1, 2].map((k) => v3(dense.pos, dense.tri[i + k]));
    area += Math.hypot(...cross(sub(q, p), sub(r, p))) / 2;
  }
  const Lref = Math.sqrt(area / ((Math.sqrt(3) / 4) * target));
  // coarse lookup of region importance near the surface
  const n = 40;
  const ext = [(g.nx - 1) * g.h, (g.ny - 1) * g.h, (g.nz - 1) * g.h];
  const cs = Math.max(...ext) / n;
  const dims = ext.map((e) => Math.ceil(e / cs) + 1);
  const imp = new Float32Array(dims[0] * dims[1] * dims[2]).fill(1);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const p: V3 = [g.origin[0] + x * cs, g.origin[1] + y * cs, g.origin[2] + z * cs];
        const d = gridSampleSafe(g, p);
        if (Math.abs(d) > cs * 1.8) continue;
        imp[(z * dims[1] + y) * dims[0] + x] = IMPORTANCE[owner(a.prims, p).prim.region] ?? 1;
      }
  const impAt = (x: number, y: number, z: number) => {
    const ix = Math.max(0, Math.min(dims[0] - 1, Math.round((x - g.origin[0]) / cs)));
    const iy = Math.max(0, Math.min(dims[1] - 1, Math.round((y - g.origin[1]) / cs)));
    const iz = Math.max(0, Math.min(dims[2] - 1, Math.round((z - g.origin[2]) / cs)));
    return imp[(iz * dims[1] + iy) * dims[0] + ix];
  };
  const jointNames = ['Forearm', 'FrontFoot', 'Shin', 'HindFoot', 'UpperArm', 'Thigh'].flatMap((j) => [`${j}_L`, `${j}_R`]).concat(['Neck1', 'Tail1', 'Tail2']);
  const joints = jointNames.filter((j) => a.index[j] !== undefined).map((j) => a.bones[a.index[j]].world);
  const jr = rc.legs.thickness * rc.scale * 1.6;
  return (x: number, y: number, z: number) => {
    const sImp = Math.pow(impAt(x, y, z), -0.42);
    const k = Math.abs(gridLaplacian(g, x, y, z)) / 2;
    const sCurv = k > 1e-6 ? Math.min(1.4, 1.15 / (k * Lref)) : 1.4;
    let s = Math.min(sImp, sCurv);
    let near = 0;
    for (const j of joints) near = Math.max(near, Math.exp(-((x - j[0]) ** 2 + (y - j[1]) ** 2 + (z - j[2]) ** 2) / (jr * jr)));
    s *= 1 - 0.35 * near;
    return Math.max(0.25, Math.min(1.6, s));
  };
}

function gridSampleSafe(g: Grid, p: V3) {
  const fx = (p[0] - g.origin[0]) / g.h;
  const fy = (p[1] - g.origin[1]) / g.h;
  const fz = (p[2] - g.origin[2]) / g.h;
  const ix = Math.max(0, Math.min(g.nx - 1, Math.round(fx)));
  const iy = Math.max(0, Math.min(g.ny - 1, Math.round(fy)));
  const iz = Math.max(0, Math.min(g.nz - 1, Math.round(fz)));
  return g.d[(iz * g.ny + iy) * g.nx + ix];
}

const v3 = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

/** the sculpt's longest extent, for picking the grid spacing */
function extent(a: Anatomy): number {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const p of a.prims) {
    if (p.region === 'wing') continue; // wings shouldn't coarsen the body's grid
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
  const target = Math.max(300, rc.mesh.tris);
  let low = decimate(dense, { targetTris: Math.round(target * 1.6), weight: imp });
  if (rc.mesh.topology === 'remesh') low = remesh(low, grid, { targetTris: target, sizeAt: sizeField(anat, grid, dense, target, rc), iterations: 6 });

  // ── skin + paint
  const size = anat.dims.withers;
  const ctx: PaintContext = { rc, size, withers: anat.dims.withers, eyes: anat.eyes };
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

  // ── wing sheets join the coat primitive (same material, explicit flat facets)
  const sheet = buildWings(anat, rc);
  if (sheet) body = mergeMesh(body, sheet);
  const tackOut = rc.tack.saddle || rc.tack.bridle || rc.tack.blanket || rc.tack.barding !== 'none' ? buildTack(anat, rc, h) : { tack: null, metal: null, pieces: [] };

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
    tack: tackOut.tack,
    metal: tackOut.metal,
    tackPieces: tackOut.pieces,
    clips,
    stats: { bodyTris: nT, tris: body.indices.length / 3 + eyes.indices.length / 3 + ((tackOut.tack?.indices.length ?? 0) + (tackOut.metal?.indices.length ?? 0)) / 3, verts: body.positions.length / 3, sculptTris, shapes: prims.length, ms: performance.now() - t0, height, length: zmax - zmin },
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

function mergeMesh(m: MeshOut, s: { pos: number[]; nrm: number[]; col: number[]; joints: number[]; weights: number[] }): MeshOut {
  const n0 = m.positions.length / 3;
  const n1 = s.pos.length / 3;
  const cat = <T extends Float32Array | Uint8Array>(a: T, b: number[], C: new (n: number) => T) => {
    const o = new C(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  };
  const idx = new Uint32Array(m.indices.length + n1);
  idx.set(m.indices);
  for (let i = 0; i < n1; i++) idx[m.indices.length + i] = n0 + i;
  return {
    positions: cat(m.positions, s.pos, Float32Array),
    normals: cat(m.normals, s.nrm, Float32Array),
    colors: cat(m.colors, s.col, Float32Array),
    joints: cat(m.joints, s.joints, Uint8Array),
    weights: cat(m.weights, s.weights, Float32Array),
    indices: idx,
  };
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
