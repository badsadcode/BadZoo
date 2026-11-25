/**
 * Riding gear. Every piece is a *shell* of the animal's own sculpt (the body field pushed outward
 * by a thickness) cut by a region: a blanket is "body + 1.5 cm, inside this box on the back", a
 * peytral is "body + 3 cm, inside this ellipsoid on the chest". So tack fits a horse, a bear or
 * a dragon without any per-species modelling, and it's skinned to the same bones as the skin
 * underneath it.
 */
import type { Anatomy } from './anatomy';
import type { MeshOut } from './animal';
import { decimate } from './decimate';
import { add, cross, dot, lerp, lerp3, norm, scale, sub, V3 } from './math';
import { flipWinding, relax, signedVolume, surfaceNets } from './mesher';
import { hexRgb, jitter, RGB, srgbToLinear } from './paint';
import type { AnimalRecipe } from './recipe';
import { fieldIn, Prim, sampleFn, sdBox, sdCapsule, sdEll, smax, smin } from './sdf';
import { skinVertex } from './skin';

interface Piece {
  name: string;
  material: 'tack' | 'metal';
  color: string;
  field: (p: V3) => number;
  min: V3;
  max: V3;
  tris: number;
  /** override skinning (reins) */
  weights?: (p: V3) => [number, number][];
}

export interface TackOut {
  tack: MeshOut | null;
  metal: MeshOut | null;
  pieces: string[];
}

const box = (c: V3, half: V3): { min: V3; max: V3 } => ({ min: sub(c, half), max: add(c, half) });

export function buildTack(a: Anatomy, rc: AnimalRecipe, h: number): TackOut {
  const T = rc.tack;
  const pieces: Piece[] = [];
  const s = rc.scale;
  const D = rc.body.chestDepth * s;
  const L = rc.body.length * s;
  const CW = rc.body.chestWidth * s;
  const RW = rc.body.rumpWidth * s;
  const ht = Math.max(h * 0.85, D * 0.012);
  const body = a.prims.filter((p) => p.region !== 'wing' && p.region !== 'spine');
  const bw = (n: string) => a.bones[a.index[n]].world;
  const sad = a.dims.saddle;
  const zc = sad[2];
  const thin = 2.8 * ht;
  const leather = T.barding === 'plate' ? T.leather : T.leather;

  // ── blanket + saddle + girth + stirrups
  if (T.blanket || T.saddle) {
    const tb = Math.max(thin, D * 0.022);
    const c: V3 = [0, sad[1] - D * 0.3, zc];
    const half: V3 = [CW * 2.6, D * 0.38, L * (T.saddle ? 0.25 : 0.22)];
    const bb = box(c, add(half, [0, tb * 2, 0]));
    const F = fieldIn(body, bb.min, bb.max);
    if (T.blanket) pieces.push({ name: 'Blanket', material: 'tack', color: T.cloth, field: (p) => smax(F(p) - tb, sdBox(p, c, half, D * 0.03), ht), ...bb, tris: 320 });
  }
  if (T.saddle) {
    const ts = Math.max(thin * 1.3, D * 0.06) + (T.blanket ? Math.max(thin, D * 0.022) : 0);
    const c: V3 = [0, sad[1] - D * 0.14, zc];
    const half: V3 = [CW * 2.6, D * 0.22, L * 0.14];
    const pomC: V3 = [0, sad[1] + ts * 0.9, zc + L * 0.12];
    const canC: V3 = [0, sad[1] + ts * 1.0, zc - L * 0.13];
    const bb = box(add(c, [0, D * 0.12, 0]), add(half, [0, D * 0.2, L * 0.03]));
    const F = fieldIn(body, bb.min, bb.max);
    pieces.push({
      name: 'Saddle', material: 'tack', color: leather,
      field: (p) => {
        let f = smax(F(p) - ts, sdBox(p, c, half, D * 0.04), ht);
        f = smin(f, sdEll(p, pomC, [CW * 0.35, ts * 0.9 + D * 0.04, L * 0.04]), ht * 2);
        f = smin(f, sdEll(p, canC, [CW * 0.6, ts * 0.8 + D * 0.05, L * 0.035]), ht * 2);
        return smax(f, -sdEll(p, [0, sad[1] + ts * 1.9, zc], [CW * 0.7, ts * 1.2, L * 0.1]), ht * 2);
      },
      ...bb, tris: 420,
    });
    // girth: a strap round the barrel just behind the elbows
    const gz = zc + L * 0.08;
    const gb = box([0, sad[1] - D * 0.6, gz], [CW * 2.2, D * 0.65, L * 0.06]);
    const FG = fieldIn(body, gb.min, gb.max);
    pieces.push({ name: 'Girth', material: 'tack', color: leather, field: (p) => smax(smax(FG(p) - thin, Math.abs(p[2] - gz) - L * 0.03, ht), p[1] - (sad[1] - D * 0.3), ht), ...gb, tris: 160 });
    // stirrup leathers + irons, hanging just outside the flank
    const FS = fieldIn(body, [-CW * 3, sad[1] - D * 1.2, zc - L * 0.1], [CW * 3, sad[1], zc + L * 0.1]);
    for (const sx of [1, -1]) {
      const yTop = sad[1] - D * 0.22;
      let x = 0;
      while (x < CW * 3 && FS([sx * x, yTop - D * 0.25, zc]) < 0) x += ht * 0.5;
      const top: V3 = [sx * (x + ts * 0.6), yTop, zc];
      const bot: V3 = [sx * (x + ts * 0.9), sad[1] - D * 0.95, zc];
      const r = thin * 0.55;
      const sb = box(lerp3(top, bot, 0.5), [r * 3 + D * 0.08, (top[1] - bot[1]) / 2 + D * 0.12, D * 0.12]);
      pieces.push({ name: `StirrupLeather_${sx > 0 ? 'L' : 'R'}`, material: 'tack', color: leather, field: (p) => sdCapsule(p, top, bot, r), ...sb, tris: 40 });
      const w = D * 0.09;
      const c0: V3 = add(bot, [0, -D * 0.02, 0]);
      const l: V3 = add(c0, [0, -D * 0.12, -w]);
      const rr: V3 = add(c0, [0, -D * 0.12, w]);
      pieces.push({
        name: `Stirrup_${sx > 0 ? 'L' : 'R'}`, material: 'metal', color: T.metal,
        field: (p) => Math.min(sdCapsule(p, c0, l, r), sdCapsule(p, c0, rr, r), sdCapsule(p, l, rr, r * 1.2)),
        min: [c0[0] - r * 3, l[1] - r * 3, l[2] - r * 3], max: [c0[0] + r * 3, c0[1] + r * 3, rr[2] + r * 3], tris: 60,
      });
    }
  }

  // ── bridle + reins
  const headSet = a.prims.filter((p) => ['head', 'muzzle', 'jaw', 'nose', 'brow', 'beak'].includes(p.region) && !p.sub);
  const H = bw('Head');
  const tip = a.dims.headTip;
  const axis = norm(sub(tip, H));
  const uh = norm(sub([0, 1, 0], scale(axis, dot([0, 1, 0], axis))));
  if (T.bridle && headSet.length) {
    const hb = box(lerp3(H, tip, 0.5), [rc.head.size * s * 1.8, rc.head.size * s * 1.8 + rc.head.muzzleLength * s * 0.3, (rc.head.size + rc.head.muzzleLength) * s * 1.2]);
    const FH = fieldIn(headSet, hb.min, hb.max);
    const band = (c: V3, w: number) => (p: V3) => smax(FH(p) - thin, Math.abs(dot(sub(p, c), axis)) - w, ht);
    const nose = lerp3(H, tip, 0.66);
    const poll = lerp3(H, tip, 0.2);
    const wB = Math.max(thin, rc.head.size * s * 0.1);
    pieces.push({ name: 'Bridle', material: 'tack', color: leather, field: (p) => Math.min(band(nose, wB)(p), band(poll, wB)(p)), ...hb, tris: 260 });
    if (T.saddle || T.barding !== 'none') {
      // reins: from the noseband to the front of the saddle
      for (const sx of [1, -1]) {
        let x = 0;
        while (x < rc.head.size * s * 2 && FH(add(nose, [sx * x, 0, 0])) < 0) x += ht * 0.5;
        const bit: V3 = add(nose, [sx * (x + thin), -thin, 0]);
        const hand: V3 = [sx * CW * 0.35, sad[1] + D * 0.08, zc + L * 0.13];
        const r = thin * 0.45;
        const head = a.index.Head;
        const chest = a.index.Chest;
        const neck = a.index.Neck2;
        // drape over the crest: bit → above the neck → saddle front
        const crest = add(lerp3(bw('Neck2'), bw('Neck1'), 0.4), [sx * thin * 2, rc.neck.thickness * s * 1.7, 0]);
        const lo = (p: V3, q: V3) => [Math.min(p[0], q[0]) - r * 3, Math.min(p[1], q[1]) - r * 3, Math.min(p[2], q[2]) - r * 3] as V3;
        const hi = (p: V3, q: V3) => [Math.max(p[0], q[0]) + r * 3, Math.max(p[1], q[1]) + r * 3, Math.max(p[2], q[2]) + r * 3] as V3;
        const segs: [V3, V3, [number, number][], [number, number][]][] = [
          [bit, crest, [[head, 1]], [[neck, 1]]],
          [crest, hand, [[neck, 1]], [[chest, 1]]],
        ];
        segs.forEach(([p0, p1, w0, w1], k) =>
          pieces.push({
            name: `Rein_${sx > 0 ? 'L' : 'R'}${k}`, material: 'tack', color: leather,
            field: (p) => sdCapsule(p, p0, p1, r),
            min: lo(p0, p1), max: hi(p0, p1), tris: 40,
            weights: (p) => {
              const t = Math.max(0, Math.min(1, dot(sub(p, p0), sub(p1, p0)) / dot(sub(p1, p0), sub(p1, p0))));
              return [[w0[0][0], 1 - t], [w1[0][0], t]];
            },
          }),
        );
      }
    }
  }

  // ── barding: leather or plate armour, in pieces so it moves with the animal
  if (T.barding !== 'none') {
    const plate = T.barding === 'plate';
    const tp = Math.max(thin * 1.2, D * (plate ? 0.04 : 0.03));
    const mat: Piece['material'] = plate ? 'metal' : 'tack';
    const col = plate ? T.metal : T.leather;
    const shell = (name: string, region: (p: V3) => number, bb: { min: V3; max: V3 }, tris: number, set: Prim[] = body) => {
      const F = fieldIn(set, bb.min, bb.max);
      pieces.push({ name, material: mat, color: col, field: (p) => smax(F(p) - tp, region(p), ht), ...bb, tris });
    };
    // crinet: the top of the neck
    const n1 = bw('Chest');
    const nh = H;
    const nAxis = norm(sub(nh, n1));
    const nUp = norm(sub([0, 1, 0], scale(nAxis, dot([0, 1, 0], nAxis))));
    const nr = Math.max(rc.neck.thickness * s * 2.2, D * 0.5);
    // (no crinet on animals without much neck: on an elephant it becomes a hood)
    if (rc.neck.length > rc.head.size * 1.2) shell('Crinet', (p) => smax(sdCapsule(p, add(n1, scale(nAxis, nr * 0.3)), sub(nh, scale(nAxis, rc.head.size * s * 0.2)), nr), -dot(sub(p, n1), nUp) + nr * 0.1, ht), box(lerp3(n1, nh, 0.5), [nr * 1.2, Math.abs(nh[1] - n1[1]) / 2 + nr * 1.2, Math.abs(nh[2] - n1[2]) / 2 + nr * 1.2]), 300);
    // peytral: the chest
    const ua = lerp3(bw('UpperArm_L'), bw('UpperArm_R'), 0.5);
    const pc: V3 = add(ua, [0, D * 0.05, D * 0.12]);
    const pr: V3 = [CW * 1.7, D * 0.45, L * 0.18];
    shell('Peytral', (p) => smax(sdEll(p, pc, pr), pc[2] - L * 0.12 - p[2], ht), box(pc, add(pr, [tp * 2, tp * 2, tp * 2])), 300);
    // crupper / flanchards: the hindquarters
    const hp = bw('Hips');
    const cc: V3 = [0, hp[1] + D * 0.02, hp[2] - L * 0.02];
    const ch: V3 = [RW * 2.6, D * 0.42, L * 0.24];
    shell('Crupper', (p) => smax(sdBox(p, cc, ch, D * 0.06), -(p[1] - (hp[1] - D * 0.32)), ht), box(cc, add(ch, [0, tp * 2, tp * 2])), 340);
    // chanfron: the face plate
    if (headSet.length) {
      const fc = add(lerp3(H, tip, 0.55), scale(uh, rc.head.size * s * 0.3));
      const fr = rc.head.size * s * 1.2 + rc.head.muzzleLength * s * 0.25;
      const hb = box(fc, [fr * 1.2, fr * 1.2, fr * 1.6]);
      shell('Chanfron', (p) => smax(sdCapsule(p, lerp3(H, tip, 0.25), lerp3(H, tip, 0.85), fr * 0.8), -dot(sub(p, lerp3(H, tip, 0.5)), uh) + rc.head.size * s * 0.1, ht), hb, 200, headSet);
    }
  }

  // ── mesh every piece
  const groups: Record<'tack' | 'metal', { pos: number[]; nrm: number[]; col: number[]; j: number[]; w: number[] }> = {
    tack: { pos: [], nrm: [], col: [], j: [], w: [] },
    metal: { pos: [], nrm: [], col: [], j: [], w: [] },
  };
  const names: string[] = [];
  let face = 0;
  for (const pc of pieces) {
    // keep each grid modest
    let hh = ht;
    const ext = sub(pc.max, pc.min);
    while ((ext[0] / hh) * (ext[1] / hh) * (ext[2] / hh) > 2.5e5) hh *= 1.15;
    const g = sampleFn(pc.field, pc.min, pc.max, hh);
    const m = surfaceNets(g);
    if (m.tri.length < 12) continue;
    if (signedVolume(m) < 0) flipWinding(m);
    relax(m, 1);
    // tack follows the animal's LOD
    const lod = Math.max(0.15, Math.min(2, rc.mesh.tris / 3000));
    const low = decimate(m, { targetTris: Math.max(12, Math.round(pc.tris * lod)) });
    names.push(pc.name);
    const grp = groups[pc.material];
    const base = hexRgb(pc.color);
    const nT = low.tri.length / 3;
    const skinCache = new Map<number, [number, number][]>();
    const skinOf = (vi: number) => {
      let w = skinCache.get(vi);
      if (!w) {
        const p: V3 = [low.pos[vi * 3], low.pos[vi * 3 + 1], low.pos[vi * 3 + 2]];
        w = pc.weights ? pc.weights(p) : skinVertex(body, p, h);
        skinCache.set(vi, w);
      }
      return w;
    };
    for (let t = 0; t < nT; t++) {
      const ids = [low.tri[t * 3], low.tri[t * 3 + 1], low.tri[t * 3 + 2]];
      const [A, B, C] = ids.map((i) => [low.pos[i * 3], low.pos[i * 3 + 1], low.pos[i * 3 + 2]] as V3);
      const n = norm(cross(sub(B, A), sub(C, A)));
      // a touch of top-light baked in so plates read as hammered metal / tooled leather
      const shade = lerp(0.88, 1.06, (n[1] + 1) / 2);
      const col = jitter([base[0] * shade, base[1] * shade, base[2] * shade].map((x) => Math.min(1, x)) as RGB, rc, 20000 + face++).map(srgbToLinear);
      ids.forEach((vi) => {
        grp.pos.push(low.pos[vi * 3], low.pos[vi * 3 + 1], low.pos[vi * 3 + 2]);
        grp.nrm.push(...n);
        grp.col.push(...col);
        const w = skinOf(vi);
        const sum = w.reduce((x, [, y]) => x + y, 0) || 1;
        for (let k = 0; k < 4; k++) {
          grp.j.push(w[k]?.[0] ?? 0);
          grp.w.push(w[k] ? w[k][1] / sum : k === 0 && !w.length ? 1 : 0);
        }
      });
    }
  }
  const toMesh = (g: (typeof groups)['tack']): MeshOut | null =>
    g.pos.length
      ? {
          positions: Float32Array.from(g.pos),
          normals: Float32Array.from(g.nrm),
          colors: Float32Array.from(g.col),
          joints: Uint8Array.from(g.j),
          weights: Float32Array.from(g.w),
          indices: Uint32Array.from({ length: g.pos.length / 3 }, (_, i) => i),
        }
      : null;
  return { tack: toMesh(groups.tack), metal: toMesh(groups.metal), pieces: names };
}
