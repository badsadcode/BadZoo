/**
 * Skin weights and "what is this point part of?", both answered by the sculpt itself.
 */
import type { V3 } from './math';
import type { Owner } from './paint';
import { Prim, primBounds, primDist } from './sdf';

export function owner(prims: Prim[], p: V3): Owner {
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
export function skinVertex(prims: Prim[], p: V3, h: number): [number, number][] {
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

export function bindingAt(pr: Prim, t: number): [number, number][] {
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


/**
 * A coarse spatial index over the sculpt's shapes, so "who owns this point" checks the handful of
 * shapes nearby instead of all of them (50k dense vertices × 100 shapes adds up).
 */
export function ownerIndex(prims: Prim[], cells = 20): (p: V3) => Owner {
  const add = prims.filter((p) => !p.sub);
  const bs = add.map(primBounds);
  const mn: V3 = [Infinity, Infinity, Infinity];
  const mx: V3 = [-Infinity, -Infinity, -Infinity];
  bs.forEach((b, i) => {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], b.min[k] - add[i].k);
      mx[k] = Math.max(mx[k], b.max[k] + add[i].k);
    }
  });
  const cs = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / cells;
  const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((mx[k] - mn[k]) / cs)));
  const bins: Prim[][] = Array.from({ length: dims[0] * dims[1] * dims[2] }, () => []);
  const cell = (v: number, k: number) => Math.max(0, Math.min(dims[k] - 1, Math.floor((v - mn[k]) / cs)));
  // a shape belongs to every cell its (blend-padded) bounds touch, plus a margin so the nearest
  // shape is always among a cell's candidates for points close to the surface
  add.forEach((p, i) => {
    const pad = p.k + cs * 0.75;
    const b = bs[i];
    for (let z = cell(b.min[2] - pad, 2); z <= cell(b.max[2] + pad, 2); z++)
      for (let y = cell(b.min[1] - pad, 1); y <= cell(b.max[1] + pad, 1); y++)
        for (let x = cell(b.min[0] - pad, 0); x <= cell(b.max[0] + pad, 0); x++) bins[(z * dims[1] + y) * dims[0] + x].push(p);
  });
  return (p: V3) => {
    const list = bins[(cell(p[2], 2) * dims[1] + cell(p[1], 1)) * dims[0] + cell(p[0], 0)];
    return owner(list.length ? list : add, p);
  };
}
