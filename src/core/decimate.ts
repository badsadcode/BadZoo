/**
 * Quadric-error edge-collapse decimation (Garland & Heckbert), with three guards that matter
 * for game assets:
 *  - link condition: never collapse an edge whose ends share more than two neighbours, so the
 *    mesh stays a closed 2-manifold (no pinches, no holes);
 *  - no fold-overs: a collapse that flips or slivers a neighbouring triangle is rejected;
 *  - importance: per-vertex weights scale the quadrics, so the face keeps its triangles and the
 *    belly gives them up. That is the difference between "low poly" and "lumpy".
 */
import type { TriMesh } from './mesher';

class Heap {
  cost: number[] = [];
  a: number[] = [];
  b: number[] = [];
  stamp: number[] = [];
  push(c: number, a: number, b: number, s: number) {
    const arr = this.cost;
    let i = arr.length;
    arr.push(c);
    this.a.push(a);
    this.b.push(b);
    this.stamp.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (arr[p] <= arr[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  private swap(i: number, j: number) {
    for (const arr of [this.cost, this.a, this.b, this.stamp]) {
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }
  pop(): [number, number, number, number] | null {
    const n = this.cost.length;
    if (!n) return null;
    const top: [number, number, number, number] = [this.cost[0], this.a[0], this.b[0], this.stamp[0]];
    this.swap(0, n - 1);
    this.cost.pop();
    this.a.pop();
    this.b.pop();
    this.stamp.pop();
    const m = n - 1;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < m && this.cost[l] < this.cost[s]) s = l;
      if (r < m && this.cost[r] < this.cost[s]) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
    return top;
  }
  get size() {
    return this.cost.length;
  }
}

/** symmetric 4x4 quadric stored as 10 numbers */
type Q = Float64Array;
const qNew = () => new Float64Array(10);
function qAddPlane(q: Q, a: number, b: number, c: number, d: number, w: number) {
  q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d;
  q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d;
  q[7] += w * c * c; q[8] += w * c * d;
  q[9] += w * d * d;
}
function qEval(q: Q, x: number, y: number, z: number) {
  return (
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z +
    q[9]
  );
}

export interface DecimateOptions {
  targetTris: number;
  /** per-vertex importance (default 1) */
  weight?: Float64Array;
}

export function decimate(mesh: TriMesh, opts: DecimateOptions): TriMesh {
  const P = Float64Array.from(mesh.pos);
  const nV = P.length / 3;
  const T = Int32Array.from(mesh.tri);
  const nT = T.length / 3;
  const tAlive = new Uint8Array(nT).fill(1);
  const vAlive = new Uint8Array(nV).fill(1);
  const vStamp = new Int32Array(nV);
  const vFaces: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) vFaces[T[t * 3 + e]].push(t);
  const W = opts.weight;

  // ── quadrics: area-weighted face planes, scaled by importance
  const Qv: Q[] = Array.from({ length: nV }, qNew);
  const faceN = (t: number, out: number[]) => {
    const a = T[t * 3] * 3;
    const b = T[t * 3 + 1] * 3;
    const c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const n3 = [0, 0, 0];
  for (let t = 0; t < nT; t++) {
    const l = faceN(t, n3);
    if (l < 1e-14) continue;
    const a = n3[0] / l, b = n3[1] / l, c = n3[2] / l;
    const i0 = T[t * 3];
    const d = -(a * P[i0 * 3] + b * P[i0 * 3 + 1] + c * P[i0 * 3 + 2]);
    const area = l / 2;
    for (let e = 0; e < 3; e++) {
      const v = T[t * 3 + e];
      qAddPlane(Qv[v], a, b, c, d, area * (W ? W[v] : 1));
    }
  }

  // ── optimal collapse position: solve the 3x3 system, fall back to the best of a few candidates
  const best = (u: number, v: number, out: number[]): number => {
    const q = qNew();
    const qu = Qv[u];
    const qv = Qv[v];
    for (let i = 0; i < 10; i++) q[i] = qu[i] + qv[i];
    const a00 = q[0], a01 = q[1], a02 = q[2], a11 = q[4], a12 = q[5], a22 = q[7];
    const det =
      a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
    const ux = P[u * 3], uy = P[u * 3 + 1], uz = P[u * 3 + 2];
    const vx = P[v * 3], vy = P[v * 3 + 1], vz = P[v * 3 + 2];
    const scale = Math.max(Math.abs(a00), Math.abs(a11), Math.abs(a22), 1e-30);
    let bestC = Infinity;
    if (Math.abs(det) > 1e-9 * scale * scale * scale) {
      const bx = -q[3], by = -q[6], bz = -q[8];
      const x = (bx * (a11 * a22 - a12 * a12) - a01 * (by * a22 - a12 * bz) + a02 * (by * a12 - a11 * bz)) / det;
      const y = (a00 * (by * a22 - a12 * bz) - bx * (a01 * a22 - a12 * a02) + a02 * (a01 * bz - by * a02)) / det;
      const z = (a00 * (a11 * bz - by * a12) - a01 * (a01 * bz - by * a02) + bx * (a01 * a12 - a11 * a02)) / det;
      // keep the solution near the edge (degenerate quadrics can shoot it far away)
      const mx = (ux + vx) / 2, my = (uy + vy) / 2, mz = (uz + vz) / 2;
      const el = Math.hypot(ux - vx, uy - vy, uz - vz);
      if (Math.hypot(x - mx, y - my, z - mz) < el * 1.5) {
        bestC = qEval(q, x, y, z);
        out[0] = x; out[1] = y; out[2] = z;
      }
    }
    const cands = [
      [ux, uy, uz],
      [vx, vy, vz],
      [(ux + vx) / 2, (uy + vy) / 2, (uz + vz) / 2],
    ];
    for (const c of cands) {
      const e = qEval(q, c[0], c[1], c[2]);
      if (e < bestC) {
        bestC = e;
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      }
    }
    // a gentle length term keeps triangles from turning into needles on flat areas
    const el2 = (ux - vx) ** 2 + (uy - vy) ** 2 + (uz - vz) ** 2;
    const w = W ? (W[u] + W[v]) / 2 : 1;
    return Math.max(0, bestC) + el2 * el2 * 0.02 * w;
  };

  const heap = new Heap();
  const tmp = [0, 0, 0];
  const pushEdge = (u: number, v: number) => {
    const c = best(u, v, tmp);
    heap.push(c, u, v, stampOf(u, v));
  };
  const stampOf = (u: number, v: number) => vStamp[u] + vStamp[v];
  // initial edges
  for (let t = 0; t < nT; t++)
    for (let e = 0; e < 3; e++) {
      const a = T[t * 3 + e];
      const b = T[t * 3 + ((e + 1) % 3)];
      if (a < b) pushEdge(a, b); // the twin half-edge has a > b, so each edge is pushed once
    }

  let alive = nT;
  const neighbours = (v: number, out: Set<number>) => {
    out.clear();
    for (const t of vFaces[v]) {
      if (!tAlive[t]) continue;
      for (let e = 0; e < 3; e++) {
        const w = T[t * 3 + e];
        if (w !== v) out.add(w);
      }
    }
    return out;
  };
  const nu = new Set<number>();
  const nv = new Set<number>();
  const pos = [0, 0, 0];
  const before = [0, 0, 0];
  const after = [0, 0, 0];

  // would moving vertex `a` (whose partner `b` vanishes) to `pos` fold or sliver any of its faces?
  const folds = (a: number, b: number) => {
    for (const t of vFaces[a]) {
      if (!tAlive[t]) continue;
      const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
      if (i0 === b || i1 === b || i2 === b) continue; // removed by the collapse
      const lb = faceN(t, before);
      const save = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      P[a * 3] = pos[0]; P[a * 3 + 1] = pos[1]; P[a * 3 + 2] = pos[2];
      const la = faceN(t, after);
      P[a * 3] = save[0]; P[a * 3 + 1] = save[1]; P[a * 3 + 2] = save[2];
      if (la < 1e-14 || lb < 1e-14) return true;
      const cos = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (la * lb);
      if (cos < 0.3) return true;
      // sliver check: area vs. longest edge²
      const A = P, x0 = i0 === a ? pos : [A[i0 * 3], A[i0 * 3 + 1], A[i0 * 3 + 2]];
      const x1 = i1 === a ? pos : [A[i1 * 3], A[i1 * 3 + 1], A[i1 * 3 + 2]];
      const x2 = i2 === a ? pos : [A[i2 * 3], A[i2 * 3 + 1], A[i2 * 3 + 2]];
      const e2 = Math.max(
        (x0[0] - x1[0]) ** 2 + (x0[1] - x1[1]) ** 2 + (x0[2] - x1[2]) ** 2,
        (x1[0] - x2[0]) ** 2 + (x1[1] - x2[1]) ** 2 + (x1[2] - x2[2]) ** 2,
        (x2[0] - x0[0]) ** 2 + (x2[1] - x0[1]) ** 2 + (x2[2] - x0[2]) ** 2,
      );
      if (la / 2 < e2 * 0.02) return true;
    }
    return false;
  };

  while (alive > opts.targetTris && heap.size) {
    const top = heap.pop()!;
    const [, u, v, s] = top;
    if (!vAlive[u] || !vAlive[v] || s !== stampOf(u, v)) continue;
    // edge still exists?
    let shared = 0;
    for (const t of vFaces[u]) {
      if (!tAlive[t]) continue;
      if (T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v) shared++;
    }
    if (shared !== 2) continue;
    // link condition
    neighbours(u, nu);
    neighbours(v, nv);
    let common = 0;
    for (const w of nu) if (nv.has(w)) common++;
    if (common !== 2) continue;
    best(u, v, pos);
    if (folds(u, v) || folds(v, u)) {
      // can't collapse now; it may become legal after neighbours change
      continue;
    }
    // ── collapse v into u
    P[u * 3] = pos[0]; P[u * 3 + 1] = pos[1]; P[u * 3 + 2] = pos[2];
    for (let i = 0; i < 10; i++) Qv[u][i] += Qv[v][i];
    if (W) W[u] = Math.max(W[u], W[v]);
    for (const t of vFaces[v]) {
      if (!tAlive[t]) continue;
      let hasU = false;
      for (let e = 0; e < 3; e++) if (T[t * 3 + e] === u) hasU = true;
      if (hasU) {
        tAlive[t] = 0;
        alive--;
      } else {
        for (let e = 0; e < 3; e++) if (T[t * 3 + e] === v) T[t * 3 + e] = u;
        vFaces[u].push(t);
      }
    }
    vAlive[v] = 0;
    vFaces[v] = [];
    vFaces[u] = vFaces[u].filter((t) => tAlive[t]);
    // only u moved / changed its quadric, so only u's edges need new costs
    vStamp[u]++;
    neighbours(u, nu);
    for (const w of nu) {
      const x = Math.min(u, w);
      const y = Math.max(u, w);
      heap.push(best(x, y, tmp), x, y, stampOf(x, y));
    }
  }

  // ── compact
  const remap = new Int32Array(nV).fill(-1);
  const outPos: number[] = [];
  const outTri: number[] = [];
  for (let t = 0; t < nT; t++) {
    if (!tAlive[t]) continue;
    for (let e = 0; e < 3; e++) {
      const v = T[t * 3 + e];
      if (remap[v] < 0) {
        remap[v] = outPos.length / 3;
        outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      }
      outTri.push(remap[v]);
    }
  }
  return { pos: Float64Array.from(outPos), tri: Uint32Array.from(outTri) };
}
