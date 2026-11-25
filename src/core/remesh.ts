/**
 * Adaptive isotropic remeshing (Botsch & Kobbelt 2004), the step that turns "decimated triangle
 * soup" into game-ready topology:
 *   split long edges → collapse short edges → flip edges toward valence 6 → tangential relaxation
 *   → project back onto the sculpt surface (the signed-distance grid)
 * repeated a few times. Triangles come out even and well-shaped; their size follows a size field
 * (finer on the face, around joints and on tight curves), so the triangle budget goes where it
 * shows and where the mesh has to bend.
 */
import type { TriMesh } from './mesher';
import type { Grid } from './sdf';

type V = [number, number, number];

/** trilinear sample of the grid's signed distance */
export function gridSample(g: Grid, x: number, y: number, z: number): number {
  const fx = (x - g.origin[0]) / g.h;
  const fy = (y - g.origin[1]) / g.h;
  const fz = (z - g.origin[2]) / g.h;
  const ix = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(g.ny - 2, Math.floor(fy)));
  const iz = Math.max(0, Math.min(g.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const ty = Math.max(0, Math.min(1, fy - iy));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const at = (a: number, b: number, c: number) => g.d[((iz + c) * g.ny + (iy + b)) * g.nx + (ix + a)];
  const c00 = at(0, 0, 0) * (1 - tx) + at(1, 0, 0) * tx;
  const c10 = at(0, 1, 0) * (1 - tx) + at(1, 1, 0) * tx;
  const c01 = at(0, 0, 1) * (1 - tx) + at(1, 0, 1) * tx;
  const c11 = at(0, 1, 1) * (1 - tx) + at(1, 1, 1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}

export function gridGrad(g: Grid, x: number, y: number, z: number): V {
  const e = g.h * 0.5;
  return [
    (gridSample(g, x + e, y, z) - gridSample(g, x - e, y, z)) / (2 * e),
    (gridSample(g, x, y + e, z) - gridSample(g, x, y - e, z)) / (2 * e),
    (gridSample(g, x, y, z + e) - gridSample(g, x, y, z - e)) / (2 * e),
  ];
}

/** mean-curvature-ish: Laplacian of the distance field (≈ 2H on a true SDF) */
export function gridLaplacian(g: Grid, x: number, y: number, z: number): number {
  const e = g.h;
  const c = gridSample(g, x, y, z);
  return (
    (gridSample(g, x + e, y, z) + gridSample(g, x - e, y, z) + gridSample(g, x, y + e, z) + gridSample(g, x, y - e, z) + gridSample(g, x, y, z + e) + gridSample(g, x, y, z - e) - 6 * c) /
    (e * e)
  );
}

export interface RemeshOptions {
  targetTris: number;
  /** relative edge length at a point (1 = average, 0.5 = twice as fine) */
  sizeAt: (x: number, y: number, z: number) => number;
  iterations?: number;
}

export function remesh(input: TriMesh, g: Grid, opts: RemeshOptions): TriMesh {
  let P: number[] = Array.from(input.pos);
  let T: number[] = Array.from(input.tri);
  const iters = opts.iterations ?? 6;

  const project = (i: number) => {
    for (let k = 0; k < 2; k++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const d = gridSample(g, x, y, z);
      const n = gridGrad(g, x, y, z);
      const l2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
      if (l2 < 1e-12) return;
      P[i * 3] = x - (d * n[0]) / l2;
      P[i * 3 + 1] = y - (d * n[1]) / l2;
      P[i * 3 + 2] = z - (d * n[2]) / l2;
    }
  };
  const vlen = (a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);

  // ── pick the base edge length so that the size field integrates to the triangle budget
  const area = (t: number[], i: number) => {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  let weighted = 0;
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i] * 3;
    const s = opts.sizeAt(P[a], P[a + 1], P[a + 2]);
    weighted += area(T, i) / (s * s);
  }
  let L0 = Math.sqrt(weighted / ((Math.sqrt(3) / 4) * opts.targetTris));
  const Lat = (i: number) => L0 * opts.sizeAt(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const Ledge = (a: number, b: number) => (Lat(a) + Lat(b)) / 2;

  /** edge → [face, face] and vertex → faces, rebuilt per pass (simple and robust) */
  const build = () => {
    const edges = new Map<number, number[]>();
    const nV = P.length / 3;
    const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
    for (let f = 0; f < T.length / 3; f++) {
      if (T[f * 3] < 0) continue;
      for (let e = 0; e < 3; e++) {
        const k = key(T[f * 3 + e], T[f * 3 + ((e + 1) % 3)]);
        const l = edges.get(k);
        if (l) l.push(f);
        else edges.set(k, [f]);
      }
    }
    return { edges, key, nV };
  };
  const vertFaces = () => {
    const vf: number[][] = Array.from({ length: P.length / 3 }, () => []);
    for (let f = 0; f < T.length / 3; f++) if (T[f * 3] >= 0) for (let e = 0; e < 3; e++) vf[T[f * 3 + e]].push(f);
    return vf;
  };
  const faceNormal = (a: number, b: number, c: number): V => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const n: V = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const opposite = (f: number, a: number, b: number) => {
    for (let e = 0; e < 3; e++) {
      const v = T[f * 3 + e];
      if (v !== a && v !== b) return v;
    }
    return -1;
  };
  /** is a→b the winding direction in face f? */
  const forward = (f: number, a: number, b: number) => {
    for (let e = 0; e < 3; e++) if (T[f * 3 + e] === a && T[f * 3 + ((e + 1) % 3)] === b) return true;
    return false;
  };

  /**
   * Feature vertices: corners where adjacent faces disagree strongly (ear and horn tips, toes,
   * the beak hook). They are pinned: never relaxed, never moved by a collapse. Without this, the
   * smoothing steps of remeshing slowly nibble every tip away.
   */
  let sharp = new Uint8Array(0);
  const findSharp = () => {
    const n = P.length / 3;
    const acc = new Float64Array(n * 3);
    const fn: V[] = [];
    for (let f = 0; f < T.length / 3; f++) {
      const nn = faceNormal(T[f * 3], T[f * 3 + 1], T[f * 3 + 2]);
      fn.push(nn);
      for (let e = 0; e < 3; e++) for (let k = 0; k < 3; k++) acc[T[f * 3 + e] * 3 + k] += nn[k];
    }
    const minDot = new Float64Array(n).fill(1);
    for (let f = 0; f < T.length / 3; f++)
      for (let e = 0; e < 3; e++) {
        const v = T[f * 3 + e];
        const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1;
        const d = (fn[f][0] * acc[v * 3] + fn[f][1] * acc[v * 3 + 1] + fn[f][2] * acc[v * 3 + 2]) / l;
        if (d < minDot[v]) minDot[v] = d;
      }
    sharp = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (minDot[i] < Math.cos(58 * (Math.PI / 180))) sharp[i] = 1;
  };

  const splitPass = () => {
    const { edges, nV } = build();
    const touched = new Uint8Array(T.length / 3);
    const list: [number, number, number][] = [];
    for (const [k, fs] of edges) {
      if (fs.length !== 2) continue;
      const a = Math.floor(k / nV);
      const b = k % nV;
      const l = vlen(a, b);
      if (l > Ledge(a, b) * (4 / 3)) list.push([l / Ledge(a, b), a, b]);
    }
    list.sort((x, y) => y[0] - x[0]);
    for (const [, a0, b0] of list) {
      const fs = edges.get(a0 < b0 ? a0 * nV + b0 : b0 * nV + a0)!;
      const [f1, f2] = fs;
      if (touched[f1] || touched[f2]) continue;
      // orient so that a→b runs forward in f1
      const fw = forward(f1, a0, b0);
      const a = fw ? a0 : b0;
      const b = fw ? b0 : a0;
      const c = opposite(f1, a, b);
      const d = opposite(f2, a, b);
      const m = P.length / 3;
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      project(m);
      // f1 = (a,b,c) → (a,m,c) + (m,b,c);  f2 = (b,a,d) → (b,m,d) + (m,a,d)
      T[f1 * 3] = a; T[f1 * 3 + 1] = m; T[f1 * 3 + 2] = c;
      T[f2 * 3] = b; T[f2 * 3 + 1] = m; T[f2 * 3 + 2] = d;
      T.push(m, b, c, m, a, d);
      touched[f1] = touched[f2] = 1;
    }
  };

  const collapsePass = () => {
    const vf = vertFaces();
    const { edges, nV } = build();
    const dead = new Uint8Array(P.length / 3);
    const touched = new Uint8Array(P.length / 3);
    const list: [number, number, number][] = [];
    for (const [k, fs] of edges) {
      if (fs.length !== 2) continue;
      const a = Math.floor(k / nV);
      const b = k % nV;
      const l = vlen(a, b);
      if (l < Ledge(a, b) * 0.8) list.push([l / Ledge(a, b), a, b]);
    }
    list.sort((x, y) => x[0] - y[0]);
    const ring = (v: number) => {
      const s = new Set<number>();
      for (const f of vf[v]) if (T[f * 3] >= 0) for (let e = 0; e < 3; e++) if (T[f * 3 + e] !== v) s.add(T[f * 3 + e]);
      return s;
    };
    for (const [, a, b] of list) {
      if (dead[a] || dead[b] || touched[a] || touched[b]) continue;
      const ra = ring(a);
      const rb = ring(b);
      if (!ra.has(b)) continue;
      let common = 0;
      for (const x of ra) if (rb.has(x)) common++;
      if (common !== 2) continue;
      if (sharp[a] && sharp[b]) continue;
      // a pinned vertex stays put: the other end collapses onto it
      const m: V = sharp[a]
        ? [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]]
        : sharp[b]
          ? [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]]
          : [(P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2];
      // new edges must not be long, faces must not flip
      let ok = true;
      const Lm = (Lat(a) + Lat(b)) / 2;
      for (const x of new Set([...ra, ...rb])) {
        if (x === a || x === b) continue;
        if (Math.hypot(m[0] - P[x * 3], m[1] - P[x * 3 + 1], m[2] - P[x * 3 + 2]) > Lm * (4 / 3)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const save = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      for (const v of [a, b]) {
        for (const f of vf[v]) {
          if (T[f * 3] < 0) continue;
          const tri = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]];
          if (tri.includes(a) && tri.includes(b)) continue;
          const n0 = faceNormal(tri[0], tri[1], tri[2]);
          const sv = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
          P[v * 3] = m[0]; P[v * 3 + 1] = m[1]; P[v * 3 + 2] = m[2];
          const n1 = faceNormal(tri[0], tri[1], tri[2]);
          P[v * 3] = sv[0]; P[v * 3 + 1] = sv[1]; P[v * 3 + 2] = sv[2];
          if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0.3) ok = false;
        }
      }
      if (!ok) continue;
      void save;
      // collapse b into a (placed at the midpoint)
      P[a * 3] = m[0]; P[a * 3 + 1] = m[1]; P[a * 3 + 2] = m[2];
      for (const f of vf[b]) {
        if (T[f * 3] < 0) continue;
        const tri = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]];
        if (tri.includes(a)) {
          T[f * 3] = T[f * 3 + 1] = T[f * 3 + 2] = -1;
          continue;
        }
        for (let e = 0; e < 3; e++) if (T[f * 3 + e] === b) T[f * 3 + e] = a;
        vf[a].push(f);
      }
      dead[b] = 1;
      if (sharp[b]) sharp[a] = 1;
      touched[a] = 1;
      for (const x of ra) touched[x] = 1;
      for (const x of rb) touched[x] = 1;
    }
    compact();
  };

  const compact = () => {
    const used = new Int32Array(P.length / 3).fill(-1);
    const nP: number[] = [];
    const nT: number[] = [];
    const nS: number[] = [];
    for (let f = 0; f < T.length / 3; f++) {
      if (T[f * 3] < 0) continue;
      for (let e = 0; e < 3; e++) {
        const v = T[f * 3 + e];
        if (used[v] < 0) {
          used[v] = nP.length / 3;
          nP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          nS.push(sharp[v] ?? 0);
        }
        nT.push(used[v]);
      }
    }
    P = nP;
    T = nT;
    sharp = Uint8Array.from(nS);
  };

  const flipPass = () => {
    const { edges, key, nV } = build();
    const val = new Int32Array(P.length / 3);
    for (const k of edges.keys()) {
      val[Math.floor(k / nV)]++;
      val[k % nV]++;
    }
    const touched = new Uint8Array(T.length / 3);
    for (const [k, fs] of edges) {
      if (fs.length !== 2) continue;
      const [f1, f2] = fs;
      if (touched[f1] || touched[f2]) continue;
      let a = Math.floor(k / nV);
      let b = k % nV;
      if (!forward(f1, a, b)) [a, b] = [b, a];
      const c = opposite(f1, a, b);
      const d = opposite(f2, a, b);
      if (c < 0 || d < 0 || c === d || edges.has(key(c, d))) continue;
      const dev = (x: number) => (x - 6) * (x - 6);
      const before = dev(val[a]) + dev(val[b]) + dev(val[c]) + dev(val[d]);
      const after = dev(val[a] - 1) + dev(val[b] - 1) + dev(val[c] + 1) + dev(val[d] + 1);
      if (after >= before) continue;
      // only flip across (nearly) flat hinges, and never into a fold
      const n1 = faceNormal(a, b, c);
      const n2 = faceNormal(b, a, d);
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < 0.85) continue;
      const m1 = faceNormal(c, a, d);
      const m2 = faceNormal(d, b, c);
      const avg: V = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
      if (m1[0] * avg[0] + m1[1] * avg[1] + m1[2] * avg[2] < 0.5 || m2[0] * avg[0] + m2[1] * avg[1] + m2[2] * avg[2] < 0.5) continue;
      T[f1 * 3] = c; T[f1 * 3 + 1] = a; T[f1 * 3 + 2] = d;
      T[f2 * 3] = d; T[f2 * 3 + 1] = b; T[f2 * 3 + 2] = c;
      val[a]--; val[b]--; val[c]++; val[d]++;
      edges.set(key(c, d), [f1, f2]);
      edges.delete(k);
      touched[f1] = touched[f2] = 1;
    }
  };

  const relaxPass = () => {
    const n = P.length / 3;
    const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
    for (let f = 0; f < T.length / 3; f++)
      for (let e = 0; e < 3; e++) {
        const a = T[f * 3 + e];
        const b = T[f * 3 + ((e + 1) % 3)];
        nb[a].add(b);
        nb[b].add(a);
      }
    const Q = P.slice();
    for (let i = 0; i < n; i++) {
      if (!nb[i].size || sharp[i]) continue;
      let cx = 0, cy = 0, cz = 0, wsum = 0;
      for (const j of nb[i]) {
        // weight neighbours by their target size so vertices drift toward the size field
        const w = 1 / Math.max(1e-6, Lat(j));
        cx += P[j * 3] * w; cy += P[j * 3 + 1] * w; cz += P[j * 3 + 2] * w;
        wsum += w;
      }
      cx /= wsum; cy /= wsum; cz /= wsum;
      const nrm = gridGrad(g, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      const nl = Math.hypot(...nrm) || 1;
      const nx = nrm[0] / nl, ny = nrm[1] / nl, nz = nrm[2] / nl;
      let dx = cx - P[i * 3], dy = cy - P[i * 3 + 1], dz = cz - P[i * 3 + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
      Q[i * 3] += dx * 0.6; Q[i * 3 + 1] += dy * 0.6; Q[i * 3 + 2] += dz * 0.6;
    }
    P = Q;
    for (let i = 0; i < n; i++) if (!sharp[i]) project(i);
  };

  findSharp();
  for (let i = 0; i < P.length / 3; i++) if (!sharp[i]) project(i);
  for (let it = 0; it < iters; it++) {
    splitPass();
    if (sharp.length < P.length / 3) {
      const grown = new Uint8Array(P.length / 3);
      grown.set(sharp);
      sharp = grown;
    }
    collapsePass();
    flipPass();
    relaxPass();
    // stay on budget: spiky animals (pinned tips, tight curves) attract extra triangles
    if (it >= iters - 3) {
      const ratio = T.length / 3 / opts.targetTris;
      if (ratio > 1.02 || ratio < 0.9) L0 *= Math.sqrt(ratio);
    }
  }
  for (let extra = 0; extra < 3 && T.length / 3 > opts.targetTris * 1.04; extra++) {
    L0 *= Math.sqrt((T.length / 3) / opts.targetTris);
    collapsePass();
    flipPass();
    relaxPass();
  }
  return { pos: Float64Array.from(P), tri: Uint32Array.from(T) };
}
