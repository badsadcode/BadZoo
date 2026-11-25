/**
 * Grid → triangles (naive surface nets: one vertex per surface cell, one quad per sign-changing
 * edge). Produces a closed, fairly even mesh that the decimator then reduces to a low-poly budget.
 */
import type { Grid } from './sdf';

export interface TriMesh {
  /** xyz per vertex */
  pos: Float64Array;
  /** 3 vertex indices per triangle, counter-clockwise seen from outside */
  tri: Uint32Array;
}

export function surfaceNets(g: Grid): TriMesh {
  const { nx, ny, nz, d, h, origin } = g;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const at = (x: number, y: number, z: number) => d[(z * ny + y) * nx + x];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float64Array(8);
  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = at(x + corners[c][0], y + corners[c][1], z + corners[c][2]);
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          const ia = (mask >> a) & 1;
          const ib = (mask >> b) & 1;
          if (ia === ib) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          n++;
        }
        cellVert[(z * cy + y) * cx + x] = pos.length / 3;
        pos.push(origin[0] + (x + sx / n) * h, origin[1] + (y + sy / n) * h, origin[2] + (z + sz / n) * h);
      }

  const tri: number[] = [];
  const cell = (x: number, y: number, z: number) => cellVert[(z * cy + y) * cx + x];
  const quad = (a: number, b: number, c: number, e: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (flip) tri.push(a, c, b, a, e, c);
    else tri.push(a, b, c, a, c, e);
  };
  // every grid edge whose ends straddle the surface emits the quad of the 4 cells around it
  for (let z = 1; z < cz; z++)
    for (let y = 1; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        // x-edge (x,y,z)-(x+1,y,z): cells (x, y-1..y, z-1..z)
        const a = at(x, y, z) < 0;
        if (a !== at(x + 1, y, z) < 0) quad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), !a);
      }
  for (let z = 1; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 1; x < cx; x++) {
        const a = at(x, y, z) < 0;
        if (a !== at(x, y + 1, z) < 0) quad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), !a);
      }
  for (let z = 0; z < cz; z++)
    for (let y = 1; y < cy; y++)
      for (let x = 1; x < cx; x++) {
        const a = at(x, y, z) < 0;
        if (a !== at(x, y, z + 1) < 0) quad(cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z), !a);
      }
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri) };
}

/** Signed volume (positive when triangles wind outward). */
export function signedVolume(m: TriMesh): number {
  let vol = 0;
  const p = m.pos;
  for (let i = 0; i < m.tri.length; i += 3) {
    const a = m.tri[i] * 3;
    const b = m.tri[i + 1] * 3;
    const c = m.tri[i + 2] * 3;
    vol +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return vol;
}

/** Flip every triangle (used if the winding test says the mesh came out inside-out). */
export function flipWinding(m: TriMesh) {
  for (let i = 0; i < m.tri.length; i += 3) {
    const t = m.tri[i + 1];
    m.tri[i + 1] = m.tri[i + 2];
    m.tri[i + 2] = t;
  }
}

/** A couple of Taubin-style smoothing passes (no shrink) to take the grid "stair" out. */
export function relax(m: TriMesh, iters = 2) {
  const n = m.pos.length / 3;
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < m.tri.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.tri[i + e];
      const b = m.tri[i + ((e + 1) % 3)];
      nb[a].push(b);
      nb[b].push(a);
    }
  }
  const tmp = new Float64Array(m.pos.length);
  const step = (lambda: number) => {
    for (let i = 0; i < n; i++) {
      const l = nb[i];
      if (!l.length) {
        tmp[i * 3] = m.pos[i * 3];
        tmp[i * 3 + 1] = m.pos[i * 3 + 1];
        tmp[i * 3 + 2] = m.pos[i * 3 + 2];
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const j of l) {
        sx += m.pos[j * 3];
        sy += m.pos[j * 3 + 1];
        sz += m.pos[j * 3 + 2];
      }
      for (let a = 0; a < 3; a++) {
        const avg = [sx, sy, sz][a] / l.length;
        tmp[i * 3 + a] = m.pos[i * 3 + a] + lambda * (avg - m.pos[i * 3 + a]);
      }
    }
    m.pos.set(tmp);
  };
  for (let k = 0; k < iters; k++) {
    step(0.5);
    step(-0.53);
  }
}
