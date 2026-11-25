/**
 * Wing sheets. Wing *arms* are sculpted with the body (so they grow out of the shoulders); the
 * thin parts are built here as explicit low-poly geometry, which is how a low-poly artist would
 * do it anyway: a sculpt can't hold a 3 mm membrane.
 *  - membrane (dragon / bat): scalloped panels between finger bones, with a little billow
 *  - feathered (griffin / pegasus): layered feather cards (primaries, secondaries, tertials,
 *    coverts), each card two-tone, so the wing reads as feathers from any angle
 * Sheets are single faces rendered double-sided (the material says so), skinned to the wing bones.
 */
import type { Anatomy, Wing } from './anatomy';
import { add, cross, lerp, lerp3, norm, scale, sub, V3 } from './math';
import { hexRgb, jitter, mix, RGB, srgbToLinear } from './paint';
import type { AnimalRecipe } from './recipe';

type W = [number, number][];

export interface Sheet {
  pos: number[];
  nrm: number[];
  col: number[];
  joints: number[];
  weights: number[];
}

function blendW(...ws: [W, number][]): W {
  const m = new Map<number, number>();
  for (const [w, f] of ws) for (const [b, x] of w) m.set(b, (m.get(b) ?? 0) + x * f);
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = list.reduce((a, [, x]) => a + x, 0) || 1;
  return list.map(([b, x]) => [b, x / s]);
}

class Builder {
  out: Sheet = { pos: [], nrm: [], col: [], joints: [], weights: [] };
  face = 0;
  constructor(private rc: AnimalRecipe, private eps: number) {}
  /** one double-sided triangle */
  tri(a: V3, b: V3, c: V3, wa: W, wb: W, wc: W, col: RGB) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const lin = jitter(col, this.rc, 9000 + this.face++).map(srgbToLinear) as RGB;
    const off = scale(n, this.eps);
    const emit = (p: V3, w: W, nn: V3, o: V3) => {
      this.out.pos.push(p[0] + o[0], p[1] + o[1], p[2] + o[2]);
      this.out.nrm.push(...nn);
      this.out.col.push(...lin);
      const j = [0, 0, 0, 0];
      const x = [0, 0, 0, 0];
      w.slice(0, 4).forEach(([bi, wi], k) => {
        j[k] = bi;
        x[k] = wi;
      });
      if (!w.length) x[0] = 1;
      this.out.joints.push(...j);
      this.out.weights.push(...x);
    };
    emit(a, wa, n, off);
    emit(b, wb, n, off);
    emit(c, wc, n, off);
  }
  /** a triangle split once into four, with an optional push on the new midpoints (billow) */
  tri4(a: V3, b: V3, c: V3, wa: W, wb: W, wc: W, col: RGB, sag: V3 = [0, 0, 0]) {
    const ab = add(lerp3(a, b, 0.5), sag);
    const bc = add(lerp3(b, c, 0.5), sag);
    const ca = add(lerp3(c, a, 0.5), sag);
    const wab = blendW([wa, 0.5], [wb, 0.5]);
    const wbc = blendW([wb, 0.5], [wc, 0.5]);
    const wca = blendW([wc, 0.5], [wa, 0.5]);
    this.tri(a, ab, ca, wa, wab, wca, col);
    this.tri(ab, b, bc, wab, wb, wbc, col);
    this.tri(ca, bc, c, wca, wbc, wc, col);
    this.tri(ab, bc, ca, wab, wbc, wca, col);
  }
  /** finger bone: a thin tapered ribbon lying in the wing (2 triangles) */
  rod(a: V3, b: V3, r: number, w: W, col: RGB) {
    const d = norm(sub(b, a));
    let side = cross(d, [0, 1, 0]);
    if (Math.hypot(...side) < 1e-6) side = cross(d, [1, 0, 0]);
    side = norm(side);
    const lift: V3 = [0, r * 0.6, 0];
    const a0 = add(add(a, scale(side, r)), lift);
    const a1 = add(add(a, scale(side, -r)), lift);
    const b0 = add(add(b, scale(side, r * 0.3)), lift);
    const b1 = add(add(b, scale(side, -r * 0.3)), lift);
    this.tri(a0, a1, b1, w, w, w, col);
    this.tri(a0, b1, b0, w, w, w, col);
  }
  /** (unused) thin triangular prism */
  prism(a: V3, b: V3, r: number, w: W, col: RGB) {
    const d = norm(sub(b, a));
    let u = cross(d, [0, 1, 0]);
    if (Math.hypot(...u) < 1e-6) u = cross(d, [1, 0, 0]);
    u = norm(u);
    const v = cross(d, u);
    const ring = (c: V3, rr: number) => [0, 1, 2].map((i) => add(c, add(scale(u, Math.cos((i * 2 * Math.PI) / 3) * rr), scale(v, Math.sin((i * 2 * Math.PI) / 3) * rr))));
    const A = ring(a, r);
    const B = ring(b, r * 0.35);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      this.tri(A[i], A[j], B[j], w, w, w, col);
      this.tri(A[i], B[j], B[i], w, w, w, col);
    }
  }
}

const one = (b: number): W => [[b, 1]];

function membrane(bd: Builder, wing: Wing, S: number, col: RGB, boneCol: RGB, chest: number, hips: number) {
  const [arm, fore, hand] = wing.bones;
  const [J0, J1, J2] = wing.joints;
  const F = wing.fingers;
  const wJ0 = blendW([one(chest), 0.5], [one(arm), 0.5]);
  const wJ1 = blendW([one(arm), 0.5], [one(fore), 0.5]);
  const wJ2 = blendW([one(fore), 0.3], [one(hand), 0.7]);
  const wF = one(hand);
  const fb = wing.fingerBones;
  const wFi = (i: number): W => (fb ? one(fb[Math.min(i, fb.length - 1)]) : wF);
  const wA = blendW([one(wing.anchorBone), 0.6], [one(hips), 0.4]);
  const sag: V3 = [0, -S * 0.025, 0];
  // scalloped trailing edge: the membrane between two finger tips is pulled in toward the wrist
  const scallop = (p: V3, q: V3, toward: V3, k: number) => lerp3(lerp3(p, q, 0.5), toward, k);
  for (let i = 0; i < F.length - 1; i++) {
    const M = scallop(F[i], F[i + 1], J2, 0.28);
    const wM = blendW([wFi(i), 0.4], [wFi(i + 1), 0.4], [wJ2, 0.2]);
    bd.tri(J2, F[i], M, wJ2, wFi(i), wM, col);
    bd.tri(J2, M, F[i + 1], wJ2, wM, wFi(i + 1), col);
  }
  const M3 = scallop(F[F.length - 1], wing.anchor, J1, 0.3);
  const last = wFi(F.length - 1);
  const wM3 = blendW([wJ1, 0.4], [last, 0.3], [wA, 0.3]);
  void sag;
  bd.tri(J1, J2, F[F.length - 1], wJ1, wJ2, last, col);
  bd.tri(J1, F[F.length - 1], M3, wJ1, last, wM3, col);
  bd.tri(J1, M3, wing.anchor, wJ1, wM3, wA, col);
  bd.tri(J1, wing.anchor, J0, wJ1, wA, wJ0, col);
  // finger bones
  F.forEach((f, i) => bd.rod(J2, f, S * 0.014, wFi(i), boneCol));
  // a thumb claw at the wrist
  bd.rod(J2, add(J2, scale(norm(add(sub(J2, J1), [0, 0.4 * S, 0])), S * 0.06)), S * 0.012, wF, boneCol);
}

function feathers(bd: Builder, wing: Wing, S: number, base: RGB, tip: RGB, chest: number, ch: number) {
  const [arm, fore, hand] = wing.bones;
  const [J0, J1, J2] = wing.joints;
  const sx = Math.sign(J1[0] - J0[0]) || 1;
  const up: V3 = [0, 1, 0];
  const back: V3 = [sx * 0.08, -0.04, -1];
  /** a feather card: base → shoulder → tip, two-tone */
  const card = (b: V3, dir: V3, l: number, w: number, wt: W, lift: number, colA: RGB, colB: RGB) => {
    const d = norm(dir);
    const side = norm(cross(up, d));
    const nrm = norm(cross(d, side));
    const o = scale(nrm, lift);
    const p0 = add(b, o);
    const pl = add(add(p0, scale(d, l * 0.35)), scale(side, w * 0.5));
    const pr = add(add(p0, scale(d, l * 0.35)), scale(side, -w * 0.5));
    const pm = add(p0, scale(d, l * 0.7));
    const tipP = add(add(p0, scale(d, l)), scale(nrm, -l * 0.04));
    bd.tri(p0, pl, pm, wt, wt, wt, colA);
    bd.tri(p0, pm, pr, wt, wt, wt, colA);
    bd.tri(pl, tipP, pm, wt, wt, wt, colB);
    bd.tri(pm, tipP, pr, wt, wt, wt, colB);
  };
  const handDir = norm(sub(wing.fingers[0], J2));
  const handLen = S * 0.42;
  // primaries: fan off the hand, from swept-back to pointing out along the wing
  const nP = 5;
  for (let i = 0; i < nP; i++) {
    const t = i / (nP - 1);
    const b = add(J2, scale(handDir, handLen * t * 0.55));
    const d = norm(lerp3(back, handDir, Math.pow(t, 0.9)));
    card(b, d, S * lerp(0.36, 0.46, t) * (0.7 + 0.3 * ch), S * 0.085, one(hand), S * 0.003 * (nP - i), base, tip);
  }
  // secondaries along the forearm, tertials along the arm
  const row = (a: V3, c: V3, n: number, l: number, wa: W, wc: W, lift: number, colA: RGB, colB: RGB) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      card(lerp3(a, c, t), back, l, S * 0.1, blendW([wa, 1 - t], [wc, t]), lift, colA, colB);
    }
  };
  row(J1, J2, 4, S * 0.33 * ch, one(fore), blendW([one(fore), 0.4], [one(hand), 0.6]), S * 0.002, base, tip);
  row(J0, J1, 3, S * 0.27 * ch, blendW([one(chest), 0.5], [one(arm), 0.5]), one(fore), S * 0.002, base, tip);
  // coverts: a shorter, lighter top layer that hides the roots
  const light = mix(base, [1, 1, 1], 0.12);
  row(J1, J2, 4, S * 0.17 * ch, one(fore), one(hand), S * 0.012, light, base);
  row(J0, J1, 2, S * 0.15 * ch, blendW([one(chest), 0.5], [one(arm), 0.5]), one(fore), S * 0.012, light, base);
  row(J2, add(J2, scale(handDir, handLen * 0.5)), 2, S * 0.2, one(hand), one(hand), S * 0.025, light, base);
}

/** a bird's tail: feather cards fanned out from the last tail bone */
function tailFan(bd: Builder, a: Anatomy, rc: AnimalRecipe) {
  const n = a.index[`Tail5`];
  const t4 = a.bones[a.index.Tail4].world;
  const tip = a.dims.tailTip;
  const dir = norm(sub(tip, t4));
  const side = norm(cross([0, 1, 0], dir));
  const up = cross(dir, side);
  const L = rc.body.length * rc.scale * (0.35 + 0.65 * rc.tail.fan);
  const base = hexRgb(rc.coat.tail || rc.coat.wing || rc.coat.base);
  const tipC = mix(base, hexRgb(rc.coat.patternColor), 0.5);
  const count = 7;
  const spread = (0.6 + 0.9 * rc.tail.fan) * Math.PI * 0.5;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5;
    const d = norm(add(add(scale(dir, Math.cos(t * spread)), scale(side, Math.sin(t * spread))), scale(up, 0.05)));
    const l = L * (1 - Math.abs(t) * 0.35);
    const w = l * 0.22;
    const sd = norm(cross(up, d));
    const p0 = add(tip, scale(up, Math.abs(t) * L * 0.01));
    const pl = add(add(p0, scale(d, l * 0.45)), scale(sd, w * 0.5));
    const pr = add(add(p0, scale(d, l * 0.45)), scale(sd, -w * 0.5));
    const pt = add(p0, scale(d, l));
    const pm = add(p0, scale(d, l * 0.72));
    const wt: W = [[n, 1]];
    bd.tri(p0, pl, pm, wt, wt, wt, base);
    bd.tri(p0, pm, pr, wt, wt, wt, base);
    bd.tri(pl, pt, pm, wt, wt, wt, tipC);
    bd.tri(pm, pt, pr, wt, wt, wt, tipC);
  }
}

export function buildWings(a: Anatomy, rc: AnimalRecipe): Sheet | null {
  const fan = (rc.tail.fan ?? 0) > 0.03;
  if (!fan && (!a.wings.length || rc.wings.kind === 'flipper')) return null;
  if (!a.wings.length || rc.wings.kind === 'flipper') {
    const bd = new Builder(rc, rc.body.length * rc.scale * 0.002);
    tailFan(bd, a, rc);
    return bd.out;
  }
  const S = rc.wings.span * rc.scale;
  const bd = new Builder(rc, S * 0.0015);
  const base = hexRgb(rc.coat.wing || rc.coat.base);
  const chest = a.index.Chest;
  const hips = a.index.Hips;
  for (const w of a.wings) {
    if (rc.wings.kind === 'membrane') {
      membrane(bd, w, S, rc.coat.wing ? base : mix(base, [0, 0, 0], 0.25), mix(hexRgb(rc.coat.base), [0, 0, 0], 0.35), chest, hips);
    } else {
      feathers(bd, w, S, base, mix(base, hexRgb(rc.coat.patternColor), 0.55), chest, rc.wings.chord / 0.55);
    }
  }
  if (fan) tailFan(bd, a, rc);
  return bd.out;
}
