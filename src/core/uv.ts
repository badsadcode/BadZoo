/**
 * UV unwrap, the artist-friendly way:
 *  1. faces are grouped into body *parts* by the bone that drives them (head, each ear, each
 *     leg, torso, neck, tail…), so islands mean something ("that's the left foreleg");
 *  2. each part is split into charts by surface direction (no face more than ~66° from its
 *     chart's projection direction, like Blender's Smart UV Project), so a planar projection
 *     per chart has no flips and little stretch;
 *  3. charts are rotated to their tightest box and shelf-packed with pixel padding. The head
 *     gets extra texel density, because that's where people look.
 */
import type { Anatomy } from './anatomy';
import type { TriMesh } from './mesher';

type V = [number, number, number];

export interface Unwrap {
  /** 3 UVs per triangle corner (u, v in 0..1, v down) */
  cornerUV: Float32Array;
  /** chart id per triangle */
  chartOf: Int32Array;
  charts: number;
  /** reserved square slots (eyes), in uv units: [u0, v0, size] */
  slots: [number, number, number][];
}

/** bone → part name: islands follow anatomy */
function partOf(bone: string): string {
  if (bone.startsWith('Ear_') || bone.startsWith('Trunk')) return bone.startsWith('Trunk') ? 'trunk' : bone;
  if (bone === 'Head') return 'head';
  if (bone.startsWith('Neck')) return 'neck';
  if (bone.startsWith('Tail')) return 'tail';
  if (bone.startsWith('Wing')) return `wing${bone.slice(-2)}`;
  const leg = bone.match(/^(UpperArm|Forearm|FrontFoot|FrontToe)_(L|R)$/);
  if (leg) return `front_${leg[2]}`;
  const hleg = bone.match(/^(Thigh|Shin|HindFoot|HindToe)_(L|R)$/);
  if (hleg) return `hind_${hleg[2]}`;
  return 'torso';
}

export function unwrap(m: TriMesh, skin: [number, number][][], a: Anatomy, opts: { texSize: number; slots: number; headBoost?: number }): Unwrap {
  const nT = m.tri.length / 3;
  const P = m.pos;
  const vtx = (i: number): V => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const sub = (x: V, y: V): V => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const cross = (x: V, y: V): V => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const dot = (x: V, y: V) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];

  // ── per-face normal, area and part
  const fN: V[] = [];
  const fA: number[] = [];
  const fPart: string[] = [];
  for (let t = 0; t < nT; t++) {
    const [A, B, C] = [0, 1, 2].map((k) => vtx(m.tri[t * 3 + k]));
    const c = cross(sub(B, A), sub(C, A));
    const l = Math.hypot(...c) || 1e-12;
    fN.push([c[0] / l, c[1] / l, c[2] / l]);
    fA.push(l / 2);
    const acc = new Map<number, number>();
    for (let k = 0; k < 3; k++) for (const [b, w] of skin[m.tri[t * 3 + k]]) acc.set(b, (acc.get(b) ?? 0) + w);
    let best = 0;
    let bw = -1;
    for (const [b, w] of acc) if (w > bw) [best, bw] = [b, w];
    fPart.push(partOf(a.bones[best]?.name ?? 'Hips'));
  }

  // ── face adjacency over shared edges
  const adj: number[][] = Array.from({ length: nT }, () => []);
  const edge = new Map<string, number>();
  for (let t = 0; t < nT; t++)
    for (let e = 0; e < 3; e++) {
      const x = m.tri[t * 3 + e];
      const y = m.tri[t * 3 + ((e + 1) % 3)];
      const k = x < y ? `${x},${y}` : `${y},${x}`;
      const o = edge.get(k);
      if (o === undefined) edge.set(k, t);
      else {
        adj[t].push(o);
        adj[o].push(t);
      }
    }

  // ── grow charts: seed = biggest unassigned face; accept neighbours of the same part within 66°
  const chartOf = new Int32Array(nT).fill(-1);
  const order = [...Array(nT).keys()].sort((x, y) => fA[y] - fA[x]);
  const cosLimit = Math.cos((66 * Math.PI) / 180);
  const chartAxis: V[] = [];
  let nc = 0;
  for (const seed of order) {
    if (chartOf[seed] >= 0) continue;
    const id = nc++;
    const axis = fN[seed];
    chartAxis.push(axis);
    const stack = [seed];
    chartOf[seed] = id;
    while (stack.length) {
      const f = stack.pop()!;
      for (const g of adj[f]) {
        if (chartOf[g] >= 0 || fPart[g] !== fPart[seed] || dot(fN[g], axis) < cosLimit) continue;
        chartOf[g] = id;
        stack.push(g);
      }
    }
  }

  // ── project each chart onto its plane, rotate to the tightest box
  const cornerUV = new Float32Array(nT * 6);
  const faces: number[][] = Array.from({ length: nc }, () => []);
  for (let t = 0; t < nT; t++) faces[chartOf[t]].push(t);
  const boxes: { w: number; h: number; boost: number }[] = [];
  for (let c = 0; c < nc; c++) {
    const n = chartAxis[c];
    let ux: V = Math.abs(n[1]) < 0.9 ? cross([0, 1, 0], n) : cross([1, 0, 0], n);
    const ul = Math.hypot(...ux);
    ux = [ux[0] / ul, ux[1] / ul, ux[2] / ul];
    const uy = cross(n, ux);
    const pts: number[] = [];
    for (const t of faces[c]) for (let k = 0; k < 3; k++) {
      const p = vtx(m.tri[t * 3 + k]);
      pts.push(dot(p, ux), dot(p, uy));
    }
    // principal axis → rotate so the chart's long side is horizontal
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i += 2) {
      mx += pts[i];
      my += pts[i + 1];
    }
    mx /= pts.length / 2;
    my /= pts.length / 2;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - mx, dy = pts[i + 1] - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - mx, dy = pts[i + 1] - my;
      const rx = dx * ca - dy * sa;
      const ry = dx * sa + dy * ca;
      pts[i] = rx;
      pts[i + 1] = ry;
      x0 = Math.min(x0, rx); y0 = Math.min(y0, ry); x1 = Math.max(x1, rx); y1 = Math.max(y1, ry);
    }
    faces[c].forEach((t, j) => {
      for (let k = 0; k < 3; k++) {
        cornerUV[t * 6 + k * 2] = pts[(j * 3 + k) * 2] - x0;
        cornerUV[t * 6 + k * 2 + 1] = pts[(j * 3 + k) * 2 + 1] - y0;
      }
    });
    const part = fPart[faces[c][0]];
    const boost = part === 'head' || part.startsWith('Ear_') || part === 'trunk' ? (opts.headBoost ?? 1.6) : 1;
    boxes.push({ w: x1 - x0, h: y1 - y0, boost });
  }

  // ── shelf packing with a binary search on texel density
  const pad = 3 / opts.texSize;
  const slotSize = 0.07;
  const items = boxes.map((b, i) => ({ i, w: b.w * b.boost, h: b.h * b.boost }));
  for (let s = 0; s < opts.slots; s++) items.push({ i: -1 - s, w: -1, h: -1 });
  const tryPack = (scale: number) => {
    const sized = items.map((it) => ({ ...it, W: it.w < 0 ? slotSize : it.w * scale + 2 * pad, H: it.h < 0 ? slotSize : it.h * scale + 2 * pad }));
    sized.sort((p, q) => q.H - p.H);
    const place = new Map<number, [number, number]>();
    let x = 0, y = 0, rowH = 0;
    for (const it of sized) {
      if (it.W > 1) return null;
      if (x + it.W > 1) {
        y += rowH;
        x = 0;
        rowH = 0;
      }
      if (y + it.H > 1) return null;
      place.set(it.i, [x, y]);
      x += it.W;
      rowH = Math.max(rowH, it.H);
    }
    return place;
  };
  let lo = 0, hi = 1e4, best: Map<number, [number, number]> | null = null, bestS = 0;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const r = tryPack(mid);
    if (r) {
      best = r;
      bestS = mid;
      lo = mid;
    } else hi = mid;
  }
  if (!best) throw new Error('UV packing failed');
  for (let c = 0; c < nc; c++) {
    const [ox, oy] = best.get(c)!;
    const sc = bestS * boxes[c].boost;
    for (const t of faces[c])
      for (let k = 0; k < 3; k++) {
        cornerUV[t * 6 + k * 2] = ox + pad + cornerUV[t * 6 + k * 2] * sc;
        cornerUV[t * 6 + k * 2 + 1] = oy + pad + cornerUV[t * 6 + k * 2 + 1] * sc;
      }
  }
  const slots: [number, number, number][] = [];
  for (let s = 0; s < opts.slots; s++) {
    const [ox, oy] = best.get(-1 - s)!;
    slots.push([ox, oy, slotSize]);
  }
  return { cornerUV, chartOf, charts: nc, slots };
}
