/**
 * Swimmers, done properly: one continuous lofted body from snout to tail tip (no stacked blobs),
 * skin weights that flow along the spine (so the swim wave bends instead of hinging), fins as flat
 * low-poly sheets with real outlines (swept dorsal, forked / lunate tail, flukes, paddles, spiny
 * rays), and a carved mouth whose teeth are sized from the gape.
 */
import type { Anatomy, Bone, Eye, Wing } from './anatomy';
import { add, clamp, cross, DEG, dot, lerp, lerp3, norm, scale, sub, V3 } from './math';
import type { AnimalRecipe } from './recipe';
import { Rng } from './rng';
import { fieldAt, frame, Prim, Tube, Weights } from './sdf';

/** a flat fin: a fan of triangles around a root point, skinned per vertex */
export interface FinSheet {
  root: V3;
  rootW: Weights;
  outline: V3[];
  w: Weights[];
}

/** where each spine bone sits along the loft (0 = snout, 1 = tail tip) */
const BONE_T: [string, number][] = [
  ['Head', 0.1], ['Neck2', 0.16], ['Neck1', 0.21], ['Chest', 0.29], ['Spine2', 0.38], ['Spine1', 0.47], ['Hips', 0.56],
  ['Tail1', 0.64], ['Tail2', 0.72], ['Tail3', 0.8], ['Tail4', 0.87], ['Tail5', 0.94],
];

export function buildSwimmer(rc: AnimalRecipe, h: number, defs: [string, string | null][], index: Record<string, number>): Anatomy & { sheets: FinSheet[] } {
  const B = rc.body;
  const Hd = rc.head;
  const Fn = rc.fins;
  const prims: Prim[] = [];
  const sheets: FinSheet[] = [];
  const world: Record<string, V3> = {};
  const W = (...pairs: [string, number][]): Weights => pairs.map(([n, w]) => [index[n], w]);
  const minThick = 2.6 * h;

  // ── the loft: snout → tail tip along -Z (the animal faces +Z)
  const headLen = Hd.size * 2 + Hd.muzzleLength;
  const total = headLen + B.length + rc.tail.length;
  const H = B.chestDepth * 0.5;
  const Wd = B.chestWidth;
  const N = 40;
  const pk = clamp(0.18 + (headLen / total) * 0.6, 0.18, 0.42); // deepest point
  const blunt = clamp(Hd.muzzleTaper ?? 0.7); // 0 pointed snout … 1 blunt
  const ped = clamp(rc.tail.thickness / Math.max(H, 1e-4), 0.05, 0.6); // tail stalk thickness
  const jawK = Hd.jaw ?? 1;
  const prof = (T: number) => {
    let f: number;
    if (T < pk) f = 1 - Math.pow(1 - T / pk, 1.5 + 2.5 * blunt);
    else f = Math.max(ped, Math.pow(Math.cos(((T - pk) / (0.93 - pk)) * Math.PI * 0.5), 1.15) * (1 - ped) + ped);
    if (T > 0.93) f = ped * (1 - (T - 0.93) / 0.07) * 0.9 + 0.05 * ped;
    return Math.max(f, 0.04);
  };
  const pts: V3[] = [];
  const hs: number[] = [];
  const ws: number[] = [];
  const sides: V3[] = [];
  const ups: V3[] = [];
  const sw: Weights[] = [];
  const zHead = total * 0.5;
  for (let i = 0; i < N; i++) {
    const T = i / (N - 1);
    const z = zHead - T * total;
    const y = H + Math.sin(Math.PI * T) * B.arch;
    pts.push([0, y, z]);
    const f = prof(T);
    // big-jawed heads are deeper at the front
    const jawBoost = T < pk ? 1 + 0.45 * (jawK - 1) * (1 - T / pk) : 1;
    hs.push(Math.max(H * f * jawBoost, minThick * 0.55));
    ws.push(Math.max(Wd * f * (T < pk ? 1 + 0.25 * (jawK - 1) * (1 - T / pk) : 1), minThick * 0.55));
    sides.push([1, 0, 0]);
    ups.push([0, 1, 0]);
    // weights: blend between the two bones bracketing T
    let k = 0;
    while (k < BONE_T.length - 1 && BONE_T[k + 1][1] <= T) k++;
    if (T <= BONE_T[0][1]) sw.push(W(['Head', 1]));
    else if (k >= BONE_T.length - 1) sw.push(W([BONE_T[BONE_T.length - 1][0], 1]));
    else {
      const [b0, t0] = BONE_T[k];
      const [b1, t1] = BONE_T[k + 1];
      const s = clamp((T - t0) / (t1 - t0));
      sw.push(W([b0, 1 - s], [b1, s]));
    }
  }
  const at = (T: number): { c: V3; h: number; w: number } => {
    const f = clamp(T) * (N - 1);
    const i = Math.min(N - 2, Math.floor(f));
    const s = f - i;
    return { c: lerp3(pts[i], pts[i + 1], s), h: lerp(hs[i], hs[i + 1], s), w: lerp(ws[i], ws[i + 1], s) };
  };
  const iHead = Math.round(0.17 * (N - 1));
  const tube = (region: 'head' | 'body', i0: number, i1: number): Tube => ({
    kind: 'tube', region, pts, h: hs, w: ws, side: sides, up: ups, sw, i0, i1, k: h * 0.5, wa: sw[i0],
  });
  // two prims over one loft: the front is 'head' (for face painting), the rest 'body'
  prims.push(tube('head', 0, iHead + 1));
  prims.push(tube('body', iHead, N - 1));

  for (const [name, T] of BONE_T) world[name] = at(T).c;
  world.Root = [0, 0, 0];

  // ── mouth: a carved gape whose size comes from the jaw slider, with teeth on both rims
  const snout = pts[0];
  const mouthLen = headLen * (0.28 + 0.18 * (jawK - 1));
  const mT = mouthLen / total;
  const mm = at(mT * 0.55);
  const gape = jawK > 1.05 ? mm.h * 0.32 * (jawK - 1) + h : 0;
  const mouthC: V3 = [0, mm.c[1] - mm.h * 0.12, snout[2] - mouthLen * 0.45];
  const mrx = mm.w * 0.88;
  const mrz = mouthLen * 0.62;
  if (gape > 0) {
    prims.push({ kind: 'ell', region: 'head', sub: true, c: mouthC, ax: frame([0, 0, 1]), r: [mrx, gape, mrz], k: gape * 0.4, wa: W(['Head', 1]) });
  }
  const teeth = Hd.teeth ?? 0;
  if (teeth > 0.03) {
    const n = Math.max(2, Math.min(14, Math.round(Hd.teethCount ?? 4)));
    const tr = new Rng(`teeth:${rc.seed}`);
    // fangs scale with the head, not just the gape (a viperfish's teeth are longer than its mouth)
    const gH = Math.max(gape, mm.h * 0.12);
    const fangBase = Math.max(gH, mm.h * 0.45);
    for (const upper of [true, false])
      for (let k = 0; k < n; k++) {
        // teeth sit along the rim, from one corner of the mouth round the front to the other
        const a = lerp(-1.25, 1.25, n === 1 ? 0.5 : k / (n - 1));
        const root: V3 = [Math.sin(a) * mrx * 0.92, mouthC[1] + (upper ? gH * 0.92 : -gH * 0.92), mouthC[2] + Math.cos(a) * mrz * 0.9];
        const irregular = n > 6 ? 0.55 + tr.next() * 0.8 : 1 - Math.abs(a) * 0.25;
        const l = teeth * fangBase * (upper ? 1.0 : 0.8) * irregular;
        const r = Math.max(l * 0.2, minThick * 0.4);
        const dir = norm([-Math.sin(a) * 0.2, upper ? -1 : 1, 0.15]);
        prims.push({ kind: 'cone', region: 'horn', a: root, b: add(root, scale(dir, l)), ra: r, rb: Math.max(r * 0.12, minThick * 0.25), k: r * 0.25, wa: W(['Head', 1]), wb: W(['Head', 1]) });
      }
  }

  // ── eyes on the flanks of the head, with sockets, lids and anger
  const eyes: Eye[] = [];
  const Ey = rc.eyes;
  const eT = Math.max(0.05, Math.min(0.15, (Hd.size * 1.1) / total));
  const pairs = Math.max(1, Math.min(4, Math.round((Ey.count ?? 2) / 2)));
  const headSet = prims.filter((p) => !p.sub);
  for (let pi = 0; pi < pairs; pi++)
    for (const sx of [1, -1]) {
      const e = at(eT + pi * 0.035);
      const a = (Ey.angle ?? 70) * DEG; // 0 = looking forward, 90 = straight out to the side
      const look = norm([sx * Math.sin(a), 0.12 + 0.35 * pi, Math.cos(a)]);
      const from: V3 = [e.c[0], e.c[1] + e.h * (0.22 + 0.3 * pi), e.c[2]];
      let t = 0;
      while (t < e.w * 3 && fieldAt(headSet, add(from, scale(look, t))) < 0) t += h * 0.4;
      const surf = add(from, scale(look, t));
      const r = Ey.size * Math.pow(0.78, pi);
      const deep = Ey.style === 'socket';
      const c = sub(surf, scale(look, r * (deep ? 0.8 : 0.55)));
      eyes.push({ bone: index.Head, c, r, look, surf, lids: clamp(Ey.lids ?? 0), painted: Ey.style === 'painted' && rc.mesh.texture > 0 });
      if (eyes[eyes.length - 1].painted) {
        eyes[eyes.length - 1].c = surf;
        continue;
      }
      prims.push({ kind: 'ell', region: 'head', sub: true, c: sub(surf, scale(look, r * 0.2)), ax: frame(look), r: [r * 1.15, r * 0.95, r * 0.8], k: r * 0.45, wa: W(['Head', 1]) });
      const anger = clamp(Ey.anger ?? 0);
      if (deep || (Ey.lids ?? 0) > 0.02 || anger > 0.02) {
        const lid = Math.max(Ey.lids ?? 0, deep ? 0.2 : 0);
        const up0 = norm(sub([0, 1, 0], scale(look, dot([0, 1, 0], look))));
        const upE = rotate(up0, look, -sx * anger * 34 * DEG);
        prims.push({ kind: 'ell', region: 'head', c: add(add(c, scale(upE, r * (1.12 - 0.62 * lid - 0.12 * anger))), scale(look, r * 0.22)), ax: frame(look, upE), r: [r * 1.25, r * 0.5, r * 0.98], k: r * 0.25, wa: W(['Head', 1]) });
      }
    }

  // ── lure (anglerfish): a stalk off the forehead with a glowing bulb
  if ((Hd.lure ?? 0) > 0.01) {
    const base = at(0.1);
    let p: V3 = [0, base.c[1] + base.h * 0.95, base.c[2]];
    let d: V3 = norm([0, 1, 0.5]);
    const n = 5;
    const segL = Hd.lure / n;
    for (let i = 0; i < n; i++) {
      const q = add(p, scale(d, segL));
      prims.push({ kind: 'cone', region: 'fin', a: p, b: q, ra: Math.max(minThick * 0.5, Hd.size * 0.05), rb: Math.max(minThick * 0.45, Hd.size * 0.04), k: h * 0.3, wa: W(['Head', 1]), wb: W(['Head', 1]) });
      p = q;
      d = norm(add(d, [0, -0.28, 0.12]));
    }
    prims.push({ kind: 'ell', region: 'lure', c: p, ax: frame([0, 0, 1]), r: [Hd.size * 0.15, Hd.size * 0.15, Hd.size * 0.17].map((x) => Math.max(x, minThick)) as V3, k: h * 0.3, wa: W(['Head', 1]) });
  }

  // ── horns / head spikes (monsters): swept back off the skull
  if (rc.horns.kind !== 'none') {
    const hb = at(0.13);
    for (const sx of [1, -1]) {
      let p: V3 = [sx * hb.w * 0.55, hb.c[1] + hb.h * 0.75, hb.c[2]];
      let d = norm([sx * 0.4, 0.55, -1]);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const q = add(p, scale(d, rc.horns.length / n));
        const r0 = Math.max(lerp(rc.horns.thickness, rc.horns.thickness * 0.15, i / n), minThick * 0.45);
        const r1 = Math.max(lerp(rc.horns.thickness, rc.horns.thickness * 0.15, (i + 1) / n), minThick * 0.3);
        prims.push({ kind: 'cone', region: 'horn', a: p, b: q, ra: r0, rb: r1, k: i === 0 ? r0 * 0.5 : r0 * 0.05, wa: W(['Head', 1]), wb: W(['Head', 1]) });
        p = q;
        d = norm(add(d, [0, -0.06, -0.05]));
      }
    }
  }

  // ── dorsal spike ridge (monsters): from behind the head to the tail, tallest mid-back
  if ((B.spines ?? 0) > 0 && (B.spineCount ?? 0) > 0) {
    const n = Math.round(B.spineCount);
    for (let k = 0; k < n; k++) {
      const T = lerp(0.17, 0.9, (k + 0.5) / n);
      const s = at(T);
      const size = B.spines * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, T * 1.1)));
      const base: V3 = [0, s.c[1] + s.h * 0.85, s.c[2]];
      const r = Math.max(size * 0.32, minThick * 0.6);
      const wv = sw[Math.round(T * (N - 1))];
      prims.push({ kind: 'cone', region: 'spine', a: base, b: add(base, scale(norm([0, 1, -0.75]), size)), ra: r, rb: minThick * 0.3, k: r * 0.25, wa: wv, wb: wv, flat: { axis: [1, 0, 0], f: Math.max(0.3, Math.min(1, minThick / r)) } } as Prim);
    }
  }

  // ── fins: flat sheets with real outlines
  const spiny = clamp(Fn.spiny ?? 0);
  /** outline from (span, chord) coordinates in a fin plane, jagged when spiny */
  const finSheet = (root: V3, e1: V3, e2: V3, shape: [number, number][], wRoot: Weights, wTip: Weights) => {
    let outline = shape;
    if (spiny > 0.03) {
      // saw-tooth rays: between outline points push spikes outward along e1
      const jag: [number, number][] = [];
      for (let i = 0; i < shape.length; i++) {
        const a = shape[i];
        const b = shape[(i + 1) % shape.length];
        jag.push(a);
        if (i < shape.length - 1 && Math.max(a[0], b[0]) > 0.2) {
          const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          jag.push([m[0] * (1 - 0.25 * spiny), m[1]]);
        }
      }
      outline = jag;
    }
    const pts3 = outline.map(([u, v]) => add(add(root, scale(e1, u)), scale(e2, v)));
    const span = Math.max(...shape.map(([u]) => u), 1e-6);
    sheets.push({ root, rootW: wRoot, outline: pts3, w: outline.map(([u]) => blendW(wRoot, wTip, clamp(u / span))) });
  };
  const back: V3 = [0, 0, -1];
  if (Fn.dorsal > 0) {
    const T = 0.36;
    const s = at(T);
    const root: V3 = [0, s.c[1] + s.h * 0.92, s.c[2]];
    const L = Fn.dorsal;
    finSheet(root, [0, 1, 0], back, [[0, -L * 0.15], [L * 0.55, L * 0.15], [L, L * 0.55], [L * 0.75, L * 0.75], [L * 0.2, L * 0.85], [0, L * 1.05]], W(['Spine2', 0.6], ['Chest', 0.4]), W(['Spine2', 1]));
  }
  for (const sd of ['L', 'R'] as const) {
    const sx = sd === 'L' ? 1 : -1;
    const ps = at(0.27);
    const proot: V3 = [sx * ps.w * 0.85, ps.c[1] - ps.h * 0.35, ps.c[2]];
    world[`PecFin_${sd}`] = proot;
    if (Fn.pectoral > 0) {
      const L = Fn.pectoral;
      const e1 = norm([sx, -0.3, -0.25]);
      const e2 = norm(cross(cross(e1, back), e1));
      finSheet(proot, e1, scale(e2, -1), [[0, -L * 0.1], [L * 0.6, -L * 0.15], [L, L * 0.2], [L * 0.75, L * 0.5], [0, L * 0.45]], W([`PecFin_${sd}`, 1]), W([`PecFin_${sd}`, 1]));
    }
    if (Fn.pelvic > 0) {
      const s = at(0.47);
      const L = Fn.pelvic;
      const r: V3 = [sx * s.w * 0.45, s.c[1] - s.h * 0.85, s.c[2]];
      finSheet(r, norm([sx * 0.4, -1, -0.3]), back, [[0, 0], [L, L * 0.45], [L * 0.6, L * 0.75], [0, L * 0.6]], W(['Spine1', 1]), W(['Spine1', 1]));
    }
  }
  if (Fn.anal > 0) {
    const s = at(0.62);
    const L = Fn.anal;
    finSheet([0, s.c[1] - s.h * 0.9, s.c[2]], [0, -1, 0], back, [[0, 0], [L * 0.7, L * 0.25], [L, L * 0.65], [0, L * 0.85]], W(['Hips', 0.5], ['Tail1', 0.5]), W(['Tail1', 1]));
  }
  if (Fn.tailSize > 0) {
    const s = at(0.95);
    const L = Fn.tailSize;
    const root: V3 = s.c;
    const flukes = Fn.tail === 'flukes';
    const e1: V3 = flukes ? [1, 0, 0] : [0, 1, 0];
    // forked tail (fish, shark): two lobes and a notch, upper lobe a bit longer
    const half = (sgn: number, k: number): [number, number][] => [[sgn * s.h * 0.6, -L * 0.05], [sgn * L * k, L * 0.95], [sgn * L * k * 0.55, L * 0.75], [sgn * L * 0.08, L * 0.42]];
    const up = half(1, 1);
    const lo = half(-1, flukes ? 1 : 0.85).reverse();
    finSheet(root, e1, back, [...up, ...lo], W(['Tail4', 0.4], ['Tail5', 0.6]), W(['Tail5', 1]));
  }

  // ── ground: the lowest point of body or fins goes to y = 0
  let minY = Infinity;
  for (let i = 0; i < N; i++) minY = Math.min(minY, pts[i][1] - hs[i]);
  for (const sh of sheets) for (const p of sh.outline) minY = Math.min(minY, p[1]);
  for (const p of prims) if (p.kind === 'cone' && !p.sub) minY = Math.min(minY, p.b[1] - p.rb, p.a[1] - p.ra);
  const dy = -minY;
  const shift = (v: V3): V3 => [v[0], v[1] + dy, v[2]];
  for (let i = 0; i < N; i++) pts[i] = shift(pts[i]);
  for (const p of prims) {
    if (p.kind === 'cone') {
      p.a = shift(p.a);
      p.b = shift(p.b);
    } else if (p.kind === 'ell') p.c = shift(p.c);
  }
  for (const sh of sheets) {
    sh.root = shift(sh.root);
    sh.outline = sh.outline.map(shift);
  }
  for (const e of eyes) {
    e.c = shift(e.c);
    e.surf = shift(e.surf);
  }
  for (const k of Object.keys(world)) if (k !== 'Root') world[k] = shift(world[k]);
  // ears are parked on the skull
  for (const sd of ['L', 'R']) world[`Ear_${sd}`] = add(world.Head, [sd === 'L' ? Hd.size * 0.4 : -Hd.size * 0.4, 0, 0]);

  const bones: Bone[] = defs.map(([name, parent]) => ({ name, parent: parent ? index[parent] : -1, world: world[name] ?? world.Head }));
  const wings: Wing[] = [];
  return {
    bones,
    index,
    prims,
    eyes,
    legs: [],
    wings,
    marks: [],
    sheets,
    dims: {
      withers: Math.max(...hs) * 2,
      length: total,
      legFront: Math.max(...hs),
      legHind: Math.max(...hs),
      headTip: shift(snout),
      tailTip: pts[N - 1],
      earTips: [world.Ear_L, world.Ear_R],
      saddle: [0, Math.max(...pts.map((p, i) => p[1] + hs[i])), at(0.35).c[2]],
    },
  };
}

function blendW(a: Weights, b: Weights, s: number): Weights {
  const m = new Map<number, number>();
  for (const [i, w] of a) m.set(i, (m.get(i) ?? 0) + w * (1 - s));
  for (const [i, w] of b) m.set(i, (m.get(i) ?? 0) + w * s);
  return [...m.entries()].filter(([, w]) => w > 1e-4);
}

function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}
