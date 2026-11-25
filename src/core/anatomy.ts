/**
 * Recipe → skeleton + sculpt. This is where an animal is "designed": joints are placed the way a
 * real quadruped's are (shoulder blade sloping forward, elbow tucked at the brisket, hock and
 * wrist raised for toe-walkers), then muscle masses are hung on them — ribcage, rump, haunches,
 * triceps, gaskins, cheeks, brows — so that the blended surface reads as anatomy rather than as
 * tubes. Axis convention: +Y up, +Z forward (the animal looks down +Z), +X is the animal's left.
 */
import { add, clamp, cross, DEG, dot, len, lerp, lerp3, norm, scale, sub, V3 } from './math';
import type { AnimalRecipe, Stance } from './recipe';
import { fieldAt, frame, Prim, Region, Weights } from './sdf';

// ───────────────────────────────────────────────────────── skeleton ──

export const SIDES = ['L', 'R'] as const;
export type Side = (typeof SIDES)[number];

export const TAIL_BONES = 5;

/** The fixed core rig every animal has. Bone order: parents always before children. */
export const BONE_DEFS: [string, string | null][] = [
  ['Root', null],
  ['Hips', 'Root'],
  ['Spine1', 'Hips'],
  ['Spine2', 'Spine1'],
  ['Chest', 'Spine2'],
  ['Neck1', 'Chest'],
  ['Neck2', 'Neck1'],
  ['Head', 'Neck2'],
  ['Ear_L', 'Head'],
  ['Ear_R', 'Head'],
  ...Array.from({ length: TAIL_BONES }, (_, i) => [`Tail${i + 1}`, i === 0 ? 'Hips' : `Tail${i}`] as [string, string]),
  ...SIDES.flatMap((s) => [
    [`Scapula_${s}`, 'Chest'],
    [`UpperArm_${s}`, `Scapula_${s}`],
    [`Forearm_${s}`, `UpperArm_${s}`],
    [`FrontFoot_${s}`, `Forearm_${s}`],
    [`FrontToe_${s}`, `FrontFoot_${s}`],
    [`Thigh_${s}`, 'Hips'],
    [`Shin_${s}`, `Thigh_${s}`],
    [`HindFoot_${s}`, `Shin_${s}`],
    [`HindToe_${s}`, `HindFoot_${s}`],
  ] as [string, string][]),
];

export const TRUNK_BONES = 3;

/** Core rig + optional bones (wings, trunk) for this recipe. */
export function boneDefs(rc: AnimalRecipe): [string, string | null][] {
  const defs = [...BONE_DEFS];
  if (rc.head.trunk > 0) for (let i = 0; i < TRUNK_BONES; i++) defs.push([`Trunk${i + 1}`, i === 0 ? 'Head' : `Trunk${i}`]);
  if (isWingWalker(rc)) {
    for (const s of SIDES) for (let i = 1; i <= 3; i++) defs.push([`FrontFinger${i}_${s}`, `FrontFoot_${s}`]);
  } else if (rc.wings.kind !== 'none')
    for (const s of SIDES) defs.push([`WingArm_${s}`, 'Chest'], [`WingFore_${s}`, `WingArm_${s}`], [`WingHand_${s}`, `WingFore_${s}`]);
  return defs;
}

/** wyvern body plan: membrane wings that double as the front legs */
export const isWingWalker = (rc: AnimalRecipe) => rc.wings.kind === 'membrane' && !!rc.wings.walk;

export interface Wing {
  side: Side;
  /** wing-walkers: one bone per finger (they fold the membrane like a fan) */
  fingerBones?: number[];
  /** bone indices [arm, fore, hand] */
  bones: number[];
  /** shoulder, elbow, wrist */
  joints: V3[];
  /** finger tips, leading edge first */
  fingers: V3[];
  /** where the membrane meets the flank */
  anchor: V3;
  anchorBone: number;
}

export interface Bone {
  name: string;
  parent: number;
  /** rest position in world space; every rest rotation is identity */
  world: V3;
}

export interface Leg {
  side: Side;
  front: boolean;
  /** bone indices: [girdle(Scapula|Hips), upper, lower, foot, toe] */
  chain: number[];
  /** toe tip (end of the toe bone) at rest */
  tip: V3;
  /** +1 = joint between upper and lower bends forward (hind knee), -1 = backward (front elbow) */
  knee: 1 | -1;
  /** where the toe tip stands when on the ground, if not its rest position (wing-walkers rest with arms spread) */
  stand?: V3;
  /** this leg is also a wing (wyvern) */
  wing?: boolean;
}

export interface Eye {
  bone: number;
  c: V3;
  r: number;
  look: V3;
  /** where the line of sight leaves the skull */
  surf: V3;
  /** drawn into the texture instead of modelled */
  painted?: boolean;
  lids: number;
}

export interface Anatomy {
  bones: Bone[];
  index: Record<string, number>;
  prims: Prim[];
  eyes: Eye[];
  legs: Leg[];
  wings: Wing[];
  /** small painted features (texture mode): nostrils */
  marks: { kind: 'nostril'; c: V3; r: number }[];
  /** useful measurements for animation & UI */
  dims: { withers: number; length: number; legFront: number; legHind: number; headTip: V3; tailTip: V3; earTips: V3[]; saddle: V3 };
}

// ───────────────────────────────────────────────────── leg patterns ──

/** segment lengths (relative) and angles from straight-down, + = toward the nose */
const PATTERNS: Record<Stance, { front: { len: number[]; ang: number[] }; hind: { len: number[]; ang: number[] } }> = {
  digitigrade: {
    front: { len: [0.35, 0.42, 0.15, 0.08], ang: [-30, 2, 16, 72] },
    hind: { len: [0.36, 0.39, 0.25, 0.08], ang: [36, -40, 12, 72] },
  },
  unguligrade: {
    front: { len: [0.3, 0.38, 0.27, 0.1], ang: [-34, 0, 3, 32] },
    hind: { len: [0.33, 0.37, 0.33, 0.1], ang: [30, -36, 6, 32] },
  },
  plantigrade: {
    front: { len: [0.42, 0.43, 0.14, 0.07], ang: [-20, 6, 72, 85] },
    hind: { len: [0.44, 0.4, 0.19, 0.07], ang: [18, -14, 80, 88] },
  },
  // sprawling legs are laid out in 3D by layLegSprawl; this entry is unused
  sprawling: { front: { len: [], ang: [] }, hind: { len: [], ang: [] } },
};

const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
/** rotate v about unit axis k by angle a (Rodrigues) */
function rotAxis(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}
const perp = (v: V3, to: V3): V3 => norm(sub(v, scale(to, dot(v, to))));

// ───────────────────────────────────────────────────────── builder ──

export function buildAnatomy(rc: AnimalRecipe, h: number): Anatomy {
  const index: Record<string, number> = {};
  const defs = boneDefs(rc);
  defs.forEach(([n], i) => (index[n] = i));
  const world: Record<string, V3> = {};
  const prims: Prim[] = [];
  const W = (...pairs: [string, number][]): Weights => pairs.map(([n, w]) => [index[n], w]);

  const B = rc.body;
  const D = B.chestDepth;
  const L = B.length;
  const T = rc.legs.thickness;
  const minThick = 2.6 * h;

  const ell = (region: Region, c: V3, fwd: V3, up: V3, r: V3, k: number, wa: Weights, extra: Partial<Prim> = {}) =>
    prims.push({ kind: 'ell', region, c, ax: frame(fwd, up), r: [r[0], r[1], r[2]], k, wa, ...extra } as Prim);
  const cone = (region: Region, a: V3, b: V3, ra: number, rb: number, k: number, wa: Weights, wm?: Weights, wb?: Weights, extra: Partial<Prim> = {}) =>
    prims.push({ kind: 'cone', region, a, b, ra, rb, k, wa, wm, wb: wb ?? wa, ...extra } as Prim);

  // ── legs (joint placement first: they decide how tall the body stands)
  const pat = PATTERNS[rc.legs.stance];
  const foot = rc.legs.foot;
  const fs = rc.legs.footSize;
  const pawH = T * 0.55 * fs;
  const hoofR = T * 0.58 * fs;
  const groundClear = foot === 'paw' ? pawH * 0.85 : hoofR * 0.9;

  const shoulderZ = L / 2;
  const hipZ = -L / 2;
  const shoulderY = rc.legs.front;
  const hipY = rc.legs.hind;
  const layLeg = (top: V3, p: { len: number[]; ang: number[] }) => {
    const vert = p.len.reduce((a, l, i) => a + l * Math.cos(p.ang[i] * DEG), 0);
    const k = (top[1] - groundClear) / vert;
    const pts: V3[] = [top];
    for (let i = 0; i < p.len.length; i++) {
      const a = p.ang[i] * DEG;
      const prev = pts[pts.length - 1];
      pts.push([prev[0], prev[1] - Math.cos(a) * p.len[i] * k, prev[2] + Math.sin(a) * p.len[i] * k]);
    }
    return pts; // [top, j1, j2, j3, tip]
  };
  const sprawl = rc.legs.stance === 'sprawling';
  const wingWalk = isWingWalker(rc);
  /** lizard legs: upper bone points out sideways, lower bone down, foot flat and turned out */
  const layLegSprawl = (top: V3, front: boolean, sx: number) => {
    const dirs: V3[] = [
      norm([sx, -0.3, front ? -0.3 : 0.35]),
      norm([sx * 0.12, -1, front ? 0.08 : -0.05]),
      norm([sx * 0.35, -0.1, 1]),
      norm([sx * 0.2, -0.04, 1]),
    ];
    const lens = [0.5, 0.55, 0.22, 0.12];
    const vert = dirs.reduce((a, d, i) => a - d[1] * lens[i], 0);
    const k = (top[1] - groundClear) / vert;
    const pts: V3[] = [top];
    dirs.forEach((d, i) => pts.push(add(pts[i], scale(d, lens[i] * k))));
    return pts;
  };

  // ── torso landmarks
  const yW = shoulderY + D * 0.52; // withers (top of the back over the shoulders)
  const rumpDepth = D * 0.3;
  const yP = hipY + rumpDepth; // croup
  const scapSlope = 30 * DEG;
  const scapTopZ = shoulderZ - Math.tan(scapSlope) * (yW - shoulderY) * 0.85;
  const spineY = (z: number) => {
    const t = (z - hipZ) / (scapTopZ - hipZ);
    return lerp(yP, yW, t) + Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * B.arch;
  };

  world.Root = [0, 0, 0];
  world.Hips = [0, yP - rumpDepth * 0.45, hipZ];
  world.Chest = [0, yW - D * 0.22, scapTopZ];
  world.Spine1 = lerp3(world.Hips, world.Chest, 1 / 3);
  world.Spine2 = lerp3(world.Hips, world.Chest, 2 / 3);
  world.Spine1[1] = spineY(world.Spine1[2]) - D * 0.22;
  world.Spine2[1] = spineY(world.Spine2[2]) - D * 0.22;

  const legs: Leg[] = [];
  for (const s of SIDES) {
    const sx = s === 'L' ? 1 : -1;
    const sj: V3 = [sx * B.chestWidth * 0.74, shoulderY, shoulderZ];
    let fp = sprawl ? layLegSprawl(sj, true, sx) : layLeg(sj, pat.front);
    let stand: V3 | undefined;
    if (wingWalk) {
      // rest pose = wings spread; on the ground the wrist knuckles carry the front of the body
      const S = rc.wings.span;
      const sh: V3 = [sx * B.chestWidth * 0.62, yW - D * 0.12, shoulderZ - L * 0.04];
      const el = add(sh, scale(norm([sx, 0.3, -0.32]), S * 0.3));
      const wr = add(el, scale(norm([sx, 0.1, 0.34]), S * 0.33));
      const kn = add(wr, scale(norm([sx * 0.25, -0.75, 0.45]), T * 0.75));
      const cl = add(kn, scale(norm([sx * 0.1, -0.35, 1]), T * 0.55));
      fp = [sh, el, wr, kn, cl];
      stand = [sx * (B.chestWidth * 1.35 + T), groundClear * 0.4, shoulderZ + L * 0.12];
    }
    world[`Scapula_${s}`] = [sx * B.chestWidth * 0.55, yW - D * 0.08, scapTopZ];
    world[`UpperArm_${s}`] = fp[0];
    world[`Forearm_${s}`] = fp[1];
    world[`FrontFoot_${s}`] = fp[2];
    world[`FrontToe_${s}`] = fp[3];
    legs.push({ side: s, front: true, chain: ['Scapula', 'UpperArm', 'Forearm', 'FrontFoot', 'FrontToe'].map((n) => index[`${n}_${s}`]), tip: fp[4], knee: -1, ...(stand ? { stand, wing: true } : {}) });

    const hj: V3 = [sx * B.rumpWidth * 0.78, hipY, hipZ];
    const hp = sprawl ? layLegSprawl(hj, false, sx) : layLeg(hj, pat.hind);
    world[`Thigh_${s}`] = hp[0];
    world[`Shin_${s}`] = hp[1];
    world[`HindFoot_${s}`] = hp[2];
    world[`HindToe_${s}`] = hp[3];
    legs.push({ side: s, front: false, chain: [index.Hips, ...['Thigh', 'Shin', 'HindFoot', 'HindToe'].map((n) => index[`${n}_${s}`])], tip: hp[4], knee: 1 });
  }

  // ── torso sculpt
  const fwd: V3 = [0, 0, 1];
  const up: V3 = [0, 1, 0];
  const kBody = D * 0.32;
  // wool depth grows with the animal (a mammoth's coat is deeper than a sheep's)
  const wool = rc.coat.wool * 0.035 * Math.max(1, Math.sqrt(D / 0.3));
  const woolly = wool > 0 ? { fluff: wool } : {};
  // topline: a slim cone along the spine keeps the back continuous from croup to withers
  const midZ = (hipZ + scapTopZ) / 2;
  cone('body', [0, yP - D * 0.1, hipZ - L * 0.05], [0, spineY(midZ) - D * 0.1, midZ], D * 0.12, D * 0.12, kBody, W(['Hips', 1]), W(['Spine1', 1]), W(['Spine2', 1]), woolly);
  cone('body', [0, spineY(midZ) - D * 0.1, midZ], [0, yW - D * 0.1, scapTopZ], D * 0.12, D * 0.13, kBody, W(['Spine1', 1]), W(['Spine2', 1]), W(['Chest', 1]), woolly);
  // ribcage: deep, egg-shaped, widest behind the elbows
  ell('chest', [0, yW - D * 0.5, shoulderZ - L * 0.24], fwd, up, [B.chestWidth, D * 0.5, L * 0.36], kBody, W(['Chest', 0.6], ['Spine2', 0.4]), woolly);
  // brisket / pectorals between the front legs
  ell('chest', [0, yW - D * 0.66, shoulderZ - L * 0.02], norm([0, -0.35, 1]), up, [B.chestWidth * 0.72, D * 0.3, L * 0.14 + D * 0.08], kBody * 0.8, W(['Chest', 1]), woolly);
  // loin / waist: hangs from the topline, tucks up toward the rump
  {
    const za = shoulderZ - L * 0.42;
    const zb = hipZ + L * 0.16;
    const ra = D * 0.47;
    const rb = Math.max(rumpDepth * 1.05, D * 0.47 * B.waist * 0.78);
    cone('belly', [0, spineY(za) - ra, za], [0, spineY(zb) - rb, zb], ra, rb, kBody, W(['Spine2', 1]), W(['Spine1', 1]), W(['Hips', 0.7], ['Spine1', 0.3]), woolly);
  }
  if (B.belly > 0) {
    const z = (shoulderZ + hipZ) / 2 - L * 0.05;
    ell('belly', [0, yW - D * (0.62 + 0.2 * B.belly), z], fwd, up, [B.chestWidth * (0.85 + 0.25 * B.belly), D * (0.3 + 0.18 * B.belly), L * (0.3 + 0.1 * B.belly)], kBody, W(['Spine1', 0.5], ['Spine2', 0.5]), woolly);
  }
  // rump: hips, croup and the top of the hamstrings
  // (sloped down toward the tail, and not pushed out behind the hips: no bubble butts)
  ell('body', [0, (yP + hipY) / 2 - rumpDepth * 0.05, hipZ + L * 0.03], norm([0, -0.32, 1]), up, [B.rumpWidth * 0.98, rumpDepth * 1.15 + D * 0.08, L * 0.2], kBody * 0.85, W(['Hips', 1]), woolly);
  // withers bridge between the shoulder blades
  ell('body', [0, yW - D * 0.12, scapTopZ + L * 0.02], fwd, up, [B.chestWidth * 0.75, D * 0.16, L * 0.2], kBody * 0.8, W(['Chest', 1]), woolly);
  if (B.hump > 0) {
    const two = B.humps >= 2;
    const hz = two ? [scapTopZ - L * 0.12, midZ - L * 0.12] : [scapTopZ - L * (two ? 0.1 : 0.02)];
    hz.forEach((z, i) => {
      const bone = two && i === 1 ? 'Spine1' : 'Chest';
      ell('body', [0, spineY(z) + D * 0.05 * B.hump, z], norm([0, 0.2, 1]), up, [B.chestWidth * 0.7, D * (0.12 + 0.3 * B.hump), L * (two ? 0.13 : 0.18 + 0.12 * B.hump)], kBody, W([bone, 1]), woolly);
    });
  }

  // ── limbs
  const legWool = wool * 0.6 > 0 ? { fluff: wool * 0.6 } : {};
  for (const s of SIDES) {
    const sx = s === 'L' ? 1 : -1;
    const side: V3 = [sx, 0, 0];
    const sc = world[`Scapula_${s}`];
    const sj = world[`UpperArm_${s}`];
    const el = world[`Forearm_${s}`];
    const wr = world[`FrontFoot_${s}`];
    const tj = world[`FrontToe_${s}`];
    const ft = legs.find((l) => l.side === s && l.front)!.tip;
    const n = (x: string) => `${x}_${s}`;
    const sh = B.shoulders;
    if (wingWalk) {
      // wing-arm: heavy shoulder, long arm bones, a knuckle and a claw to walk on
      ell('body', lerp3(sc, sj, 0.5), sub(sj, sc), side, [T * 1.6 * sh, T * 0.9 * sh, len(sub(sj, sc)) * 0.7 + T * 0.5], kBody * 0.6, W([n('Scapula'), 0.6], ['Chest', 0.4]), woolly);
      cone('leg', sj, el, T * 1.3, T * 0.8, T * 0.7, W([n('Scapula'), 0.5], [n('UpperArm'), 0.5]), W([n('UpperArm'), 1]), W([n('UpperArm'), 0.5], [n('Forearm'), 0.5]), { span: [0, 0.3] });
      cone('lowerLeg', el, wr, T * 0.82, T * 0.55, T * 0.45, W([n('UpperArm'), 0.4], [n('Forearm'), 0.6]), W([n('Forearm'), 1]), W([n('Forearm'), 0.5], [n('FrontFoot'), 0.5]), { span: [0.3, 0.8] });
      ell('lowerLeg', wr, sub(tj, wr), side, [T * 0.62, T * 0.6, T * 0.7], T * 0.35, W([n('FrontFoot'), 0.7], [n('Forearm'), 0.3]));
      cone('lowerLeg', wr, tj, T * 0.55, T * 0.4, T * 0.25, W([n('FrontFoot'), 1]), W([n('FrontFoot'), 1]), W([n('FrontToe'), 1]), { span: [0.8, 0.9] });
      cone('horn', tj, ft, T * 0.32, T * 0.06, T * 0.08, W([n('FrontToe'), 1]));
    } else {
    // shoulder blade + deltoid/triceps mass
    ell('body', lerp3(sc, sj, 0.55), sub(sj, sc), side, [T * 1.6 * sh, T * 0.75 * sh, len(sub(sj, sc)) * 0.62], kBody * 0.6, W([n('Scapula'), 0.7], ['Chest', 0.3]), woolly);
    ell('leg', add(lerp3(sj, el, 0.5), [0, 0, -T * 0.45]), sub(el, sj), side, [T * 1.2 * sh, T * 1.05 * sh, len(sub(el, sj)) * 0.55], T * 0.8, W([n('UpperArm'), 0.8], [n('Scapula'), 0.2]), legWool);
    // bones of the foreleg
    cone('leg', sj, el, T * 1.3, T * 0.85, T * 0.7, W([n('Scapula'), 0.5], [n('UpperArm'), 0.5]), W([n('UpperArm'), 1]), W([n('UpperArm'), 0.5], [n('Forearm'), 0.5]), { span: [0, 0.3], ...legWool });
    ell('leg', add(el, [0, T * 0.05, -T * 0.55]), [0, 1, 0], side, [T * 0.6, T * 0.5, T * 0.5], T * 0.5, W([n('Forearm'), 0.6], [n('UpperArm'), 0.4])); // elbow point
    cone('lowerLeg', el, wr, T * 0.88, T * 0.5, T * 0.45, W([n('UpperArm'), 0.4], [n('Forearm'), 0.6]), W([n('Forearm'), 1]), W([n('Forearm'), 0.5], [n('FrontFoot'), 0.5]), { span: [0.3, 0.7] });
    ell('lowerLeg', add(lerp3(el, wr, 0.3), [0, 0, T * 0.12]), sub(wr, el), side, [T * 0.75, T * 0.8, len(sub(wr, el)) * 0.33], T * 0.4, W([n('Forearm'), 1]));
    cone('lowerLeg', wr, tj, T * 0.52, T * 0.44, T * 0.3, W([n('Forearm'), 0.5], [n('FrontFoot'), 0.5]), W([n('FrontFoot'), 1]), W([n('FrontFoot'), 0.5], [n('FrontToe'), 0.5]), { span: [0.7, 0.9] });
    addFoot(n('FrontFoot'), n('FrontToe'), wr, tj, ft);
    }

    const hj = world[`Thigh_${s}`];
    const kn = world[`Shin_${s}`];
    const hk = world[`HindFoot_${s}`];
    const htj = world[`HindToe_${s}`];
    const ht = legs.find((l) => l.side === s && !l.front)!.tip;
    const hc = B.haunch;
    // haunch: the big hamstring/quad mass that gives a quadruped its back end
    // (long along the femur, deep front-to-back, but flat sideways: thighs, not cheeks)
    ell('body', add(lerp3(hj, kn, 0.4), [0, 0, -T * 0.22]), sub(kn, hj), side, [T * 1.45 * hc, T * 1.02 * hc, len(sub(kn, hj)) * 0.7], kBody * 0.5, W([n('Thigh'), 0.7], ['Hips', 0.3]), woolly);
    cone('leg', hj, kn, T * 1.45, T * 0.9, T * 0.7, W(['Hips', 0.5], [n('Thigh'), 0.5]), W([n('Thigh'), 1]), W([n('Thigh'), 0.5], [n('Shin'), 0.5]), { span: [0, 0.3], ...legWool });
    // gaskin (calf) + the point of the hock
    ell('leg', add(lerp3(kn, hk, 0.3), [0, 0, -T * 0.4]), sub(hk, kn), side, [T * 0.8 * hc, T * 0.9 * hc, len(sub(hk, kn)) * 0.4], T * 0.5, W([n('Shin'), 1]), legWool);
    cone('lowerLeg', kn, hk, T * 0.88, T * 0.46, T * 0.4, W([n('Thigh'), 0.4], [n('Shin'), 0.6]), W([n('Shin'), 1]), W([n('Shin'), 0.5], [n('HindFoot'), 0.5]), { span: [0.3, 0.65] });
    ell('lowerLeg', add(hk, [0, T * 0.12, -T * 0.32]), [0, 1, 0], side, [T * 0.36, T * 0.5, T * 0.4], T * 0.35, W([n('HindFoot'), 0.5], [n('Shin'), 0.5]));
    cone('lowerLeg', hk, htj, T * 0.5, T * 0.44, T * 0.3, W([n('Shin'), 0.5], [n('HindFoot'), 0.5]), W([n('HindFoot'), 1]), W([n('HindFoot'), 0.5], [n('HindToe'), 0.5]), { span: [0.65, 0.9] });
    addFoot(n('HindFoot'), n('HindToe'), hk, htj, ht);
  }

  function addFoot(footBone: string, toeBone: string, ankle: V3, toe: V3, tip: V3) {
    // feathering: a fluffy skirt of long hair from mid-cannon down over the hoof
    const fe = rc.legs.feathering ?? 0;
    if (fe > 0.03) {
      const top = lerp3(ankle, toe, 0.35);
      const rbF = T * (0.75 + 0.7 * fe);
      // the skirt rests on the ground at its widest (hair can't go through the floor)
      const bot: V3 = [tip[0], rbF + T * 0.3 * fe, lerp(toe[2], tip[2], 0.2) - T * 0.15];
      cone('feather', add(top, [0, 0, -T * 0.08]), bot, T * 0.46, rbF, T * 0.45, W([footBone, 0.6], [toeBone, 0.4]), W([toeBone, 0.7], [footBone, 0.3]), W([toeBone, 1]), { fluff: T * 0.3 * fe, span: [0.8, 0.97] });
    }
    const dir = norm(sub(tip, toe));
    const flatDir = sprawl ? norm([dir[0], 0, dir[2]]) : norm([0, 0, dir[2] || 1]);
    if (foot === 'paw') {
      const plant = rc.legs.stance === 'plantigrade' || sprawl;
      const back = plant ? ankle : toe;
      const c = lerp3(back, tip, plant ? 0.55 : 0.45);
      const half = len(sub(tip, back)) * 0.5 + T * (plant ? 0.25 : 0.45);
      ell('paw', [c[0], pawH * 1.0, c[2]], flatDir, [0, 1, 0], [T * (plant ? 0.7 : 0.82) * fs, pawH * (plant ? 0.85 : 1), half], T * 0.35, W([toeBone, 0.7], [footBone, 0.3]), { span: [0.9, 1] });
    } else {
      const coronet = lerp3(toe, tip, 0.45);
      cone('lowerLeg', toe, coronet, T * 0.46, T * 0.47, T * 0.25, W([footBone, 0.4], [toeBone, 0.6]), W([toeBone, 1]), W([toeBone, 1]), { span: [0.9, 0.95] });
      const base: V3 = [tip[0], hoofR * 0.9, tip[2] - hoofR * 0.15];
      if (foot === 'hoof') {
        cone('hoof', coronet, base, T * 0.5, hoofR, T * 0.12, W([toeBone, 1]), undefined, undefined, { span: [0.95, 1] });
      } else {
        for (const o of [-1, 1]) {
          const off: V3 = [o * hoofR * 0.42, 0, 0];
          cone('hoof', add(coronet, scale(off, 0.6)), add(base, off), T * 0.32, hoofR * 0.62, T * 0.1, W([toeBone, 1]), undefined, undefined, { span: [0.95, 1] });
        }
      }
    }
  }

  // ── neck
  const N = rc.neck;
  const na = N.angle * DEG;
  const dn: V3 = [0, Math.sin(na), Math.cos(na)];
  const n0: V3 = [0, yW - D * 0.34, shoulderZ - L * 0.02];
  const hj: V3 = add(n0, scale(dn, N.length + D * 0.15));
  world.Neck1 = n0;
  world.Neck2 = lerp3(n0, hj, 0.5);
  world.Head = hj;
  const neckBase = Math.max(N.thickness * 1.5, D * 0.33);
  cone('neck', add(n0, [0, -D * 0.05, -L * 0.06]), hj, neckBase, N.thickness * 0.85, kBody * 0.9, W(['Chest', 0.6], ['Neck1', 0.4]), W(['Neck1', 0.5], ['Neck2', 0.5]), W(['Neck2', 0.4], ['Head', 0.6]), { flat: { axis: [1, 0, 0], f: 0.78 }, ...woolly });
  // crest: the arched top line from withers to poll
  const crestA: V3 = [0, yW - D * 0.06, scapTopZ + L * 0.04];
  const crestB: V3 = add(hj, [0, N.thickness * 0.55, -N.thickness * 0.2]);
  const crestMid: V3 = add(lerp3(crestA, crestB, 0.5), scale(norm([0, Math.cos(na), -Math.sin(na)]), N.thickness * 0.25));
  const maneR = N.mane === 'crest' ? N.thickness * 0.5 * N.maneSize : N.thickness * 0.45;
  const crestRegion: Region = N.mane === 'crest' ? 'mane' : 'neck';
  const crestFlat = { flat: { axis: [1, 0, 0] as V3, f: N.mane === 'crest' ? 0.55 : 0.85 } };
  cone(crestRegion, crestA, crestMid, maneR * 1.1, maneR, N.thickness * 0.6, W(['Chest', 1]), W(['Neck1', 1]), W(['Neck1', 0.5], ['Neck2', 0.5]), { ...crestFlat, ...woolly });
  cone(crestRegion, crestMid, crestB, maneR, maneR * 0.75, N.thickness * 0.5, W(['Neck1', 0.5], ['Neck2', 0.5]), W(['Neck2', 1]), W(['Head', 1]), { ...crestFlat, ...woolly });

  // ── head
  const Hd = rc.head;
  const hs = Hd.size;
  const pitch = Hd.pitch * DEG;
  const f: V3 = [0, -Math.sin(pitch), Math.cos(pitch)];
  const uh: V3 = [0, Math.cos(pitch), Math.sin(pitch)];
  const C = add(add(hj, scale(uh, hs * 0.3)), scale(f, hs * 0.55));
  const at = (o: V3, x: number, y: number, z: number): V3 => add(add(add(o, [x, 0, 0]), scale(uh, y)), scale(f, z));
  const head = W(['Head', 1]);
  // throat: from chest to under the jaw
  cone('neck', add(n0, [0, -D * 0.12, L * 0.02]), at(C, 0, -hs * 0.65, -hs * 0.35), neckBase * 0.7, hs * 0.42, kBody * 0.7, W(['Chest', 0.5], ['Neck1', 0.5]), W(['Neck2', 1]), W(['Head', 0.7], ['Neck2', 0.3]), { flat: { axis: [1, 0, 0], f: 0.8 }, ...woolly });
  const hw = Hd.headWidth ?? 1;
  const dome = Hd.dome ?? 0;
  ell('head', add(C, scale(uh, hs * 0.08 * dome)), f, uh, [hs * 0.92 * hw, hs * 0.86 * (1 + 0.28 * dome), hs * 1.02 * (1 + 0.06 * dome)], hs * 0.4, head);
  const muzzleBase = at(C, 0, -hs * 0.22, hs * 0.38);
  const muzzleTip = at(C, 0, -hs * 0.3 - Hd.muzzleDepth * 0.15 - (Hd.muzzleDrop ?? 0) * (Hd.muzzleLength * 0.3 + hs * 0.08), hs * 0.62 + Hd.muzzleLength);
  const mR = Math.max(Hd.muzzleWidth, Hd.muzzleDepth);
  const mFlat = Hd.muzzleWidth < Hd.muzzleDepth ? { axis: [1, 0, 0] as V3, f: Hd.muzzleWidth / Hd.muzzleDepth } : { axis: uh, f: Hd.muzzleDepth / Hd.muzzleWidth };
  const beak = Hd.nose === 'beak';
  const sq = beak ? 0 : clamp(Hd.muzzleSquare ?? 0);
  const fl = beak ? 0 : clamp(Hd.muzzleFlat ?? 0);
  const bulb = beak ? 0 : clamp(Hd.muzzleBulb ?? 0);
  // squarer muzzles taper less (a box doesn't come to a point)
  const tipR = mR * lerp(Hd.muzzleTaper, Math.max(Hd.muzzleTaper, 0.88), sq);
  const fx = mFlat.axis === uh ? 1 : mFlat.f; // width factor at the tip
  const fy = mFlat.axis === uh ? mFlat.f : 1; // depth factor at the tip
  const mDir = norm(sub(muzzleTip, muzzleBase));
  const mUp = norm(sub(uh, scale(mDir, dot(uh, mDir))));
  const mLen = len(sub(muzzleTip, muzzleBase));
  // how far the front of the muzzle sits beyond the tip point (a flat cut pulls it back)
  const frontK = 1 - 0.6 * fl;
  const cut = fl > 0.02 ? { n: mDir, o: dot(muzzleTip, mDir) + tipR * frontK * Math.max(fx, fy) * (1 + 0.25 * bulb), k: tipR * lerp(0.35, 0.12, fl) } : undefined;
  cone(beak ? 'beak' : 'muzzle', muzzleBase, muzzleTip, mR * 1.05, tipR, hs * (beak ? 0.15 : 0.35), head, undefined, undefined, { flat: mFlat, ...(cut ? { cut } : {}) });
  if (sq > 0.03) {
    // squared-off end: a rounded box grows over the tip as squareness rises
    ell('muzzle', sub(muzzleTip, scale(mDir, tipR * 0.3)), mDir, mUp, [tipR * lerp(0.6, 0.98, sq) * fx, tipR * lerp(0.6, 0.92, sq) * fy, tipR * lerp(0.5, 0.8, sq)], tipR * lerp(0.5, 0.3, sq), head, { boxy: lerp(0.9, 0.35, sq), ...(cut ? { cut } : {}) });
  }
  if (bulb > 0.03) {
    // soft swollen end
    ell('muzzle', add(muzzleTip, scale(mDir, tipR * 0.05)), mDir, mUp, [tipR * (1 + 0.36 * bulb) * fx, tipR * (1 + 0.3 * bulb) * fy, tipR * (0.85 + 0.25 * bulb)], tipR * 0.5, head, cut ? { cut } : {});
  }
  // stop: the step between forehead and muzzle
  const stop = Hd.stop ?? 0.5;
  if (!beak && Hd.trunk <= 0) {
    if (stop < 0.45) {
      // fill the step: forehead runs straight down the muzzle (bull terrier)
      const t = (0.45 - stop) / 0.45;
      const a = at(C, 0, hs * 0.5 * (1 + 0.2 * dome), hs * 0.35);
      const b = add(lerp3(muzzleBase, muzzleTip, 0.45), scale(mUp, mR * 0.55 * fy));
      cone('muzzle', a, b, hs * 0.42 * t * hw + h, mR * 0.6 * t * fx + h, hs * 0.3, head);
    } else if (stop > 0.55) {
      // steep forehead (boxer, chihuahua): the brow block rises over the muzzle
      const t = (stop - 0.55) / 0.45;
      ell('head', at(C, 0, hs * 0.38, hs * 0.62), f, uh, [hs * 0.55 * hw, hs * (0.25 + 0.2 * t), hs * (0.18 + 0.12 * t)], hs * 0.25, head);
    }
  }
  // flews: hanging upper lips at the sides of the muzzle
  const flews = Hd.flews ?? 0;
  if (flews > 0.03 && !beak && Hd.trunk <= 0) {
    for (const sx of [1, -1]) {
      const c = add(add(lerp3(muzzleBase, muzzleTip, 0.62), scale([1, 0, 0], sx * mR * 0.62 * fx)), scale(mUp, -mR * (0.45 + 0.45 * flews) * fy));
      ell('jaw', c, mDir, mUp, [mR * 0.42 * fx, mR * (0.3 + 0.45 * flews) * fy, mLen * 0.32 + tipR * 0.35], mR * 0.3, head);
    }
  }
  // fangs along the mouth line, the front pair longest
  const teeth = Hd.teeth ?? 0;
  if (teeth > 0.03 && !beak && Hd.trunk <= 0) {
    const ts = [0.38, 0.55, 0.7, 0.86];
    for (const sx of [1, -1])
      ts.forEach((t, i) => {
        const rt = lerp(mR * 1.05, tipR, t);
        const root = add(add(lerp3(muzzleBase, muzzleTip, t), scale([1, 0, 0], sx * rt * 0.72 * fx)), scale(mUp, -rt * 0.5 * fy));
        const l = teeth * mR * (i === ts.length - 1 ? 0.95 : 0.5);
        const rb = Math.max(teeth * mR * (i === ts.length - 1 ? 0.16 : 0.11), minThick * 0.45);
        cone('horn', root, add(root, scale(norm(add(scale(mUp, -1), [sx * 0.15, 0, 0])), l)), rb, Math.max(rb * 0.15, minThick * 0.3), rb * 0.3, head);
      });
  }
  // nose bridge: Roman bump or dished dip along the top of the muzzle
  const bridge = Hd.muzzleBridge ?? 0;
  if (Math.abs(bridge) > 0.02 && !beak) {
    const bc = add(lerp3(muzzleBase, muzzleTip, 0.45), scale(mUp, mR * 0.75 * fy));
    const br: V3 = [mR * 0.6 * fx, mR * 0.32 * Math.abs(bridge) + h, mLen * 0.38 + mR * 0.2];
    if (bridge > 0) ell('muzzle', bc, mDir, mUp, br, mR * 0.35, head);
    else prims.push({ kind: 'ell', region: 'muzzle', sub: true, c: add(bc, scale(mUp, mR * 0.18)), ax: frame(mDir, mUp), r: br, k: mR * 0.3, wa: head } as Prim);
  }
  // lower jaw
  const jawA = at(C, 0, -hs * 0.55, -hs * 0.05);
  const jawB = add(muzzleTip, add(scale(uh, -tipR * 0.75 * (mFlat.axis === uh ? mFlat.f : 1)), scale(f, -tipR * 0.45)));
  cone('jaw', jawA, beak ? lerp3(jawA, jawB, 0.8) : jawB, hs * 0.4 * Hd.cheeks, tipR * 0.55, hs * 0.25, head, undefined, undefined, { flat: { axis: [1, 0, 0], f: 0.8 } });
  for (const sx of [1, -1]) {
    ell('head', at(C, sx * hs * 0.5 * hw, -hs * 0.32, -hs * 0.02), f, uh, [hs * 0.38 * Hd.cheeks * Math.sqrt(hw), hs * 0.42 * Hd.cheeks, hs * 0.48 * Hd.cheeks], hs * 0.3, head); // cheek
    ell('brow', at(C, sx * hs * 0.36 * hw, hs * 0.32, hs * 0.55), norm(add(f, [sx * 0.3, 0, 0])), uh, [hs * 0.24 * Hd.brow, hs * 0.14 * Hd.brow, hs * 0.22 * Hd.brow], hs * 0.18, head);
  }
  // nose
  const ns = Hd.noseSize;
  const tipFlatY = mFlat.axis === uh ? mFlat.f : 1;
  const tipFlatX = mFlat.axis === uh ? 1 : mFlat.f;
  const nostrils: V3[] = [];
  if (beak || Hd.trunk > 0) {
    // the beak hook / trunk tip replaces the nose
  } else if (Hd.nose === 'pad') {
    const nc = add(muzzleTip, add(scale(f, tipR * 0.72 * frontK), scale(uh, tipR * 0.25 * tipFlatY)));
    ell('nose', nc, norm(add(f, scale(uh, 0.5))), uh, [tipR * 0.75 * ns * tipFlatX + h * 0.5, tipR * 0.5 * ns, tipR * 0.45 * ns], tipR * 0.25, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.3 * ns * tipFlatX, 0, 0], scale(f, tipR * 0.4 * ns))));
  } else if (Hd.nose === 'snout') {
    const nc = add(muzzleTip, scale(f, tipR * 0.92 * frontK));
    ell('nose', nc, f, uh, [tipR * 1.02 * ns * tipFlatX, tipR * 0.9 * ns * tipFlatY, tipR * 0.32], tipR * 0.18, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.35 * ns * tipFlatX, 0, 0], scale(f, tipR * 0.33))));
  } else {
    const nc = add(muzzleTip, add(scale(f, tipR * 0.45 * frontK), scale(uh, -tipR * 0.05)));
    ell('nose', nc, f, uh, [tipR * 1.02 * ns * tipFlatX, tipR * 0.85 * ns * tipFlatY, tipR * 0.62], tipR * 0.3, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.5 * ns * tipFlatX, tipR * 0.15, 0], scale(f, tipR * 0.6))));
  }
  let headTip = add(muzzleTip, scale(f, tipR));

  /** a curved, tapering chain of cones (horns, tusks, trunks, spines) */
  const hornChain = (start: V3, dir0: V3, steps: number, segLen: number, r0: number, r1: number, turn: (d: V3, i: number) => V3, region: Region = 'horn', wts: (i: number) => Weights = () => head) => {
    let p = start;
    let d = norm(dir0);
    const pts: V3[] = [p];
    for (let i = 0; i < steps; i++) {
      const q = add(p, scale(d, segLen));
      pts.push(q);
      p = q;
      d = norm(turn(d, i));
    }
    for (let i = 0; i < steps; i++) {
      cone(region, pts[i], pts[i + 1], Math.max(lerp(r0, r1, i / steps), minThick * 0.5), Math.max(lerp(r0, r1, (i + 1) / steps), minThick * 0.4), i === 0 ? r0 * 0.6 : r0 * 0.05, wts(i), undefined, undefined, { span: [i / steps, (i + 1) / steps] });
    }
    return pts;
  };

  // ── beak hook (griffin, owlbear)
  if (beak) {
    hornChain(muzzleTip, norm(add(f, scale(uh, -0.4))), 3, tipR * 0.9 + Hd.muzzleLength * 0.12, tipR * 0.95, tipR * 0.25, (d) => norm(rotX(d, 28 * DEG)), 'beak');
    headTip = add(muzzleTip, scale(f, tipR * 1.5));
  }

  // ── trunk (elephant): a curling chain from the upper lip, with its own bones
  if (Hd.trunk > 0) {
    const n = TRUNK_BONES * 2;
    const tw = (i: number): Weights => {
      const b = Math.min(TRUNK_BONES, Math.floor(i / 2) + 1);
      return i === 0 ? W(['Head', 0.5], ['Trunk1', 0.5]) : W([`Trunk${b}`, 1]);
    };
    const r0 = Math.max(tipR * 0.95, Hd.trunk * 0.09);
    const start = add(muzzleTip, scale(f, -tipR * 0.3));
    const dir0 = norm(add(f, scale(uh, -0.5)));
    const turn = (d: V3, i: number) => norm(rotX(d, (i < n - 2 ? 16 : -22) * DEG));
    // never drag the trunk through the floor: shorten it until the tip clears the ground
    let tl = Hd.trunk;
    for (let it = 0; it < 12; it++) {
      let p = start;
      let d = dir0;
      let lowY = Infinity;
      for (let i = 0; i < n; i++) {
        p = add(p, scale(d, tl / n));
        lowY = Math.min(lowY, p[1]);
        d = turn(d, i);
      }
      if (lowY > r0 * 0.9 + groundClear * 0.2) break;
      tl *= 0.9;
    }
    const pts = hornChain(start, dir0, n, tl / n, r0, r0 * 0.45, (d, i) => norm(rotX(d, (i < n - 2 ? 16 : -22) * DEG)), 'trunk', tw);
    for (let i = 0; i < TRUNK_BONES; i++) world[`Trunk${i + 1}`] = pts[i * 2];
    const end = pts[n];
    const dirE = norm(sub(end, pts[n - 1]));
    ell('nose', add(end, scale(dirE, r0 * 0.15)), dirE, [0, 0, 1], [r0 * 0.5, r0 * 0.5, r0 * 0.22], r0 * 0.2, W([`Trunk${TRUNK_BONES}`, 1]));
    headTip = end;
  }

  // ── tusks: elephant (from the upper jaw, sweeping forward and up) or boar (up from the jaw)
  if (Hd.tusks > 0) {
    for (const sx of [1, -1]) {
      const side: V3 = [sx, 0, 0];
      if (Hd.trunk > 0) {
        const st = add(at(muzzleBase, sx * mR * 0.55, -mR * 0.55, hs * 0.1), [0, 0, 0]);
        const curl = Hd.tuskCurl ?? 1;
        const n = curl > 1.3 ? 8 : 5;
        // elephant: a gentle upward sweep. mammoth: out, up and back in, a big spiral
        hornChain(st, norm(add(add(f, scale(uh, -0.9)), scale(side, 0.12 + 0.12 * (curl - 1)))), n, Hd.tusks / n, Hd.tusks * 0.11, Hd.tusks * 0.035, (d, i) =>
          norm(add(rotX(d, (-17 * curl * 5) / n * DEG), scale(side, curl > 1.3 ? (i < n / 2 ? 0.03 : -0.12) * (curl - 1) : 0))));
      } else {
        const st = add(muzzleTip, add(add(scale(f, -tipR * 1.1), scale(side, tipR * 0.75)), scale(uh, -tipR * 0.45)));
        hornChain(st, norm(add(add(scale(uh, 1), scale(side, 0.45)), scale(f, 0.15))), 4, Hd.tusks / 4, Hd.tusks * 0.16, Hd.tusks * 0.05, (d) => norm(rotAxis(d, side, sx * -18 * DEG)));
      }
    }
  }

  // ── ears
  const E = rc.ears;
  const earTips: V3[] = [];
  const headPrims = prims.filter((p) => p.region === 'head' || p.region === 'brow' || p.region === 'muzzle');
  const surfaceAlong = (from: V3, dir: V3, set: Prim[] = headPrims): V3 => {
    let t = 0;
    const step = h * 0.5;
    while (t < hs * 3 && fieldAt(set, add(from, scale(dir, t))) < 0) t += step;
    return add(from, scale(dir, t));
  };
  for (const s of SIDES) {
    const sx = s === 'L' ? 1 : -1;
    const side: V3 = [sx, 0, 0];
    const sAng = lerp(18, 78, E.side) * DEG;
    const bd = norm(add(add(scale(uh, Math.cos(sAng)), scale(side, Math.sin(sAng))), scale(f, -0.25)));
    const surf = surfaceAlong(add(C, scale(f, -hs * 0.1)), bd);
    const base = sub(surf, scale(bd, E.width * 0.22));
    const spread = E.spread * DEG;
    // erect direction: up, spread outward, tilted back
    const outUp = norm(add(scale(uh, Math.cos(spread)), scale(side, Math.sin(spread))));
    const de = norm(add(scale(outUp, Math.cos(E.tilt * DEG)), scale(f, -Math.sin(E.tilt * DEG))));
    const dd = norm(add(add(scale(side, 0.45), scale(uh, -1)), scale(f, 0.12)));
    const dir = norm(lerp3(de, dd, E.droop));
    const tip = add(base, scale(dir, E.length));
    earTips.push(tip);
    const thickAxis = perp(norm(lerp3(f, side, E.droop * 0.9)), dir);
    const ra = E.width * 0.5;
    const rb = Math.max(E.width * 0.5 * (1 - E.tip) * 0.75, E.width * 0.07);
    const thick = Math.max(E.width * 0.15, minThick);
    const ear = W([`Ear_${s}`, 1]);
    const fold = clamp(E.fold ?? 0);
    if (fold < 0.04) {
      cone('ear', sub(base, scale(dir, E.width * 0.15)), tip, ra, rb, Math.min(hs * 0.12, ra * 0.4), W(['Head', 0.5], [`Ear_${s}`, 0.5]), ear, ear, {
        flat: { axis: thickAxis, f: thick / ra },
        span: [0, 1],
        axis: thickAxis,
      });
    } else {
      // semi-erect: the top of the ear tips forward over a crease
      const k = 0.55;
      const mid = add(base, scale(dir, E.length * k));
      const ang = fold * 115 * DEG;
      const dir2 = norm(add(scale(dir, Math.cos(ang)), scale(thickAxis, Math.sin(ang))));
      const th2 = perp(norm(sub(scale(thickAxis, Math.cos(ang)), scale(dir, Math.sin(ang)))), dir2);
      const rm = lerp(ra, rb, k);
      const tip2 = add(mid, scale(dir2, E.length * (1 - k)));
      cone('ear', sub(base, scale(dir, E.width * 0.15)), mid, ra, rm, Math.min(hs * 0.12, ra * 0.4), W(['Head', 0.5], [`Ear_${s}`, 0.5]), ear, ear, {
        flat: { axis: thickAxis, f: thick / ra },
        span: [0, k],
        axis: thickAxis,
      });
      cone('ear', mid, tip2, rm, rb, rm * 0.3, ear, ear, ear, { flat: { axis: th2, f: Math.min(1, thick / rm) }, span: [k, 1], axis: th2 });
      earTips[earTips.length - 1] = tip2;
    }
    world[`Ear_${s}`] = base;
    // cup the inside of erect ears (only the upright part of folded ones)
    if (E.droop < 0.5 && (E.fold ?? 0) < 0.04) {
      const off = scale(thickAxis, thick * 0.95);
      prims.push({
        kind: 'cone', region: 'earInner', sub: true,
        a: add(add(base, off), scale(dir, E.length * 0.2)),
        b: add(sub(tip, scale(dir, E.length * 0.12)), scale(off, 0.6)),
        ra: ra * 0.68, rb: rb * 0.6, k: thick * 0.4,
        flat: { axis: thickAxis, f: (thick * 0.9) / (ra * 0.68) },
        wa: ear, axis: thickAxis,
      });
    }
  }

  // ── tail
  const Tl = rc.tail;
  const t0: V3 = [0, yP - rumpDepth * 0.15, hipZ - L * 0.17];
  let td: V3 = norm([0, Math.sin(Tl.lift * DEG), -Math.cos(Tl.lift * DEG)]);
  const seg = Tl.length / TAIL_BONES;
  const tailPts: V3[] = [t0];
  for (let i = 0; i < TAIL_BONES; i++) {
    const p = add(tailPts[i], scale(td, seg));
    tailPts.push(p);
    td = norm(rotX(td, (Tl.curl * DEG) / TAIL_BONES));
  }
  tailPts.forEach((p, i) => i < TAIL_BONES && (world[`Tail${i + 1}`] = p));
  const tailR = (t: number) => {
    const taper = lerp(1, 0.3, t);
    const brush = 1 + (Tl.brush - 1) * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.1)) ** 0.7;
    return Math.max(Tl.thickness * taper * brush, minThick * 0.5);
  };
  for (let i = 0; i < TAIL_BONES; i++) {
    const b = `Tail${i + 1}`;
    const nb = i + 1 < TAIL_BONES ? `Tail${i + 2}` : b;
    const pb = i === 0 ? 'Hips' : `Tail${i}`;
    cone('tail', tailPts[i], tailPts[i + 1], tailR(i / TAIL_BONES), tailR((i + 1) / TAIL_BONES), Tl.thickness * (i === 0 ? 1.2 : 0.5),
      W([pb, 0.5], [b, 0.5]), W([b, 1]), W([b, 0.5], [nb, 0.5]), { span: [i / TAIL_BONES, (i + 1) / TAIL_BONES], ...(Tl.brush > 1.15 ? woolly : {}) });
  }
  if (Tl.tuft > 0) {
    const tp = tailPts[TAIL_BONES];
    const dirT = norm(sub(tp, tailPts[TAIL_BONES - 1]));
    ell('tailTip', add(tp, scale(dirT, -Tl.thickness * 0.3)), dirT, [0, 1, 0], [Tl.thickness * 1.3 * Tl.tuft, Tl.thickness * 1.3 * Tl.tuft, Tl.thickness * 2.6 * Tl.tuft], Tl.thickness * 0.5, W([`Tail${TAIL_BONES}`, 1]), { span: [1, 1] });
  }
  const tailTip = tailPts[TAIL_BONES];
  // tail spikes: a crown of spikes at the tip, raking backward
  if ((Tl.spikes ?? 0) > 0.03) {
    const dT = norm(sub(tailPts[TAIL_BONES], tailPts[TAIL_BONES - 1]));
    const sideT = norm(cross([0, 1, 0], dT));
    const upT = cross(dT, sideT);
    const th = tailR(1);
    const base = sub(tailTip, scale(dT, th * 1.2));
    const outs: V3[] = [norm(add(upT, scale(sideT, 0.6))), norm(add(upT, scale(sideT, -0.6))), sideT, scale(sideT, -1)];
    for (const o of outs) {
      const l = Tl.spikes * Math.max(th, Tl.thickness * 0.5) * 4.5;
      cone('spine', base, add(base, scale(norm(add(o, scale(dT, 0.9))), l)), Math.max(th * 0.55 * Tl.spikes, minThick * 0.5), minThick * 0.3, th * 0.2, W([`Tail${TAIL_BONES}`, 1]));
    }
  }

  // ── mane ruff (lion): a big fluffy collar around head and neck
  if (N.mane === 'ruff') {
    const ms = N.maneSize;
    const c1 = at(C, 0, -hs * 0.1, -hs * 0.55);
    ell('mane', c1, f, uh, [hs * 1.45 * ms, hs * 1.55 * ms, hs * 0.75 * ms], hs * 0.5, W(['Head', 0.6], ['Neck2', 0.4]), { fluff: hs * 0.12 });
    ell('mane', lerp3(hj, n0, 0.45), dn, [0, Math.cos(na), -Math.sin(na)], [hs * 1.2 * ms, hs * 1.2 * ms, N.length * 0.55 + hs * 0.3], hs * 0.6, W(['Neck1', 0.5], ['Neck2', 0.5]), { fluff: hs * 0.14 });
  }

  // ── horns
  const Hn = rc.horns;
  if (Hn.kind !== 'none') {
    const HL = Hn.length;
    const HT = Hn.thickness;
    if (Hn.kind === 'rhino') {
      // a big horn on the nose and a smaller one behind it
      const s0 = surfaceAlong(add(muzzleTip, scale(f, -tipR * 0.6)), uh, prims.filter((p) => p.region === 'muzzle' || p.region === 'nose'));
      hornChain(sub(s0, scale(uh, HT * 0.4)), norm(add(uh, scale(f, 0.35))), 5, HL / 5, HT * 1.3, HT * 0.12, (d) => norm(rotX(d, -9 * DEG)));
      const s1 = surfaceAlong(lerp3(muzzleBase, muzzleTip, 0.35), uh, prims.filter((p) => p.region === 'muzzle'));
      hornChain(sub(s1, scale(uh, HT * 0.3)), norm(add(uh, scale(f, 0.2))), 3, (HL * 0.4) / 3, HT * 0.85, HT * 0.12, (d) => norm(rotX(d, -6 * DEG)));
    }
    for (const sx of Hn.kind === 'unicorn' ? [0] : Hn.kind === 'rhino' ? [] : [1, -1]) {
      const side: V3 = [sx, 0, 0];
      if (Hn.kind === 'unicorn') {
        const s0 = surfaceAlong(C, norm(add(uh, scale(f, 0.6))));
        hornChain(sub(s0, scale(uh, HT * 0.5)), norm(add(uh, scale(f, 0.9))), 4, HL / 4, HT, HT * 0.12, (d) => d);
        continue;
      }
      const bd = norm(add(add(scale(uh, 0.85), scale(side, Hn.kind === 'cow' ? 0.75 : 0.45)), scale(f, Hn.kind === 'antlers' ? -0.1 : 0.05)));
      const s0 = sub(surfaceAlong(add(C, scale(f, hs * 0.05)), bd), scale(bd, HT * 0.6));
      if (Hn.kind === 'cow') {
        const n = 6;
        hornChain(s0, norm(add(side, scale(uh, 0.25))), n, HL / n, HT, HT * 0.18, (d) => norm(rotAxis(d, norm(add(f, [0, 0, 0])), (sx * 22 * DEG))));
      } else if (Hn.kind === 'goat') {
        const n = 6;
        hornChain(s0, norm(add(add(uh, scale(f, -0.35)), scale(side, 0.18))), n, HL / n, HT, HT * 0.2, (d) => norm(rotAxis(d, side, sx * 14 * DEG)));
      } else if (Hn.kind === 'ram') {
        const n = 11;
        let r = 0;
        hornChain(s0, norm(add(add(scale(uh, 0.7), scale(f, -0.8)), scale(side, 0.25))), n, HL / n, HT * 1.2, HT * 0.3, (d) => {
          r++;
          const spun = rotAxis(d, side, sx * 32 * DEG);
          return norm(add(spun, scale(side, 0.08 + r * 0.01)));
        });
      } else if (Hn.kind === 'dragon') {
        // long swept-back horns plus a smaller pair below them
        const n = 7;
        hornChain(s0, norm(add(add(scale(uh, 0.35), scale(f, -1)), scale(side, 0.28))), n, HL / n, HT, HT * 0.12, (d) => norm(rotX(d, -5 * DEG)));
        const s2 = sub(surfaceAlong(C, norm(add(add(side, scale(f, -0.6)), scale(uh, -0.1)))), scale(side, HT * 0.4));
        hornChain(s2, norm(add(add(side, scale(f, -1)), scale(uh, -0.1))), 4, (HL * 0.45) / 4, HT * 0.65, HT * 0.12, (d) => norm(rotAxis(d, side, sx * 5 * DEG)));
      } else if (Hn.kind === 'antlers') {
        const n = 6;
        const beam = hornChain(s0, norm(add(add(uh, scale(f, -0.35)), scale(side, 0.55))), n, HL / n, HT, HT * 0.35, (d) => norm(rotAxis(d, side, sx * 9 * DEG)));
        const tine = (i: number, l: number) => {
          const tf = norm(add(add(f, scale(uh, 0.9)), scale(side, 0.15)));
          hornChain(beam[i], tf, 3, l / 3, HT * 0.55, HT * 0.2, (d) => norm(rotAxis(d, side, sx * -10 * DEG)));
        };
        tine(1, HL * 0.32);
        tine(3, HL * 0.34);
        tine(5, HL * 0.26);
      }
    }
  }

  // ── dorsal spines / plates: along the crest, the back and the tail
  if (B.spines > 0 && B.spineCount > 0) {
    const path: V3[] = [crestB, crestMid, crestA];
    for (let i = 1; i <= 6; i++) {
      const z = lerp(scapTopZ, hipZ, i / 6);
      path.push([0, spineY(z) - D * 0.05, z]);
    }
    for (let i = 1; i <= TAIL_BONES; i++) path.push(tailPts[i]);
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + len(sub(path[i], path[i - 1])));
    const total = cum[cum.length - 1];
    const bodySet = prims.filter((p) => !p.sub && p.region !== 'horn');
    const boneNames = ['Neck1', 'Neck2', 'Head', 'Chest', 'Spine2', 'Spine1', 'Hips', ...Array.from({ length: TAIL_BONES }, (_, i) => `Tail${i + 1}`)];
    for (let k = 0; k < B.spineCount; k++) {
      const u = (k + 0.5) / B.spineCount;
      const dist = u * total;
      let j = 1;
      while (j < cum.length - 1 && cum[j] < dist) j++;
      const t = (dist - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
      const pIn = lerp3(path[j - 1], path[j], t);
      const tan = norm(sub(path[j - 1], path[j])); // toward the head
      const upDir = norm(sub([0, 1, 0], scale(tan, dot([0, 1, 0], tan))));
      let tt = 0;
      while (tt < D && fieldAt(bodySet, add(pIn, scale(upDir, tt))) < 0) tt += h * 0.5;
      const base = add(pIn, scale(upDir, tt - h));
      const size = B.spines * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.08)));
      const dir = norm(sub(upDir, scale(tan, 0.65)));
      let nb = boneNames[0];
      let nd = Infinity;
      for (const bn of boneNames) {
        const dd = len(sub(world[bn], base));
        if (dd < nd) {
          nd = dd;
          nb = bn;
        }
      }
      const r = Math.max(size * 0.42, minThick * 0.6);
      cone('spine', sub(base, scale(dir, r * 0.5)), add(base, scale(dir, size)), r, Math.max(size * 0.05, minThick * 0.35), r * 0.25, W([nb, 1]), undefined, undefined, {
        flat: { axis: [1, 0, 0], f: Math.min(1, Math.max(0.3, (minThick * 1.1) / r)) },
      });
    }
  }

  // ── wings: arm bones are sculpted (so they grow out of the shoulders); membrane / feathers are
  // built as explicit low-poly sheets in wings.ts
  const wings: Wing[] = [];
  if (wingWalk) {
    // wyvern: the membrane hangs between the front-leg arm bones and three finger bones
    const S = rc.wings.span;
    const ch = rc.wings.chord / 0.55;
    for (const s of SIDES) {
      const sx = s === 'L' ? 1 : -1;
      const sh = world[`UpperArm_${s}`];
      const el = world[`Forearm_${s}`];
      const wr = world[`FrontFoot_${s}`];
      const fingers = [
        add(wr, scale(norm([sx, -0.04, 0.06]), S * 0.44)),
        add(wr, scale(norm([sx * 0.62, -0.12, -0.66]), S * 0.42 * ch)),
        add(wr, scale(norm([sx * 0.16, -0.16, -1]), S * 0.34 * ch)),
      ];
      for (let i = 1; i <= 3; i++) world[`FrontFinger${i}_${s}`] = wr;
      wings.push({
        side: s,
        bones: ['UpperArm', 'Forearm', 'FrontFoot'].map((b) => index[`${b}_${s}`]),
        fingerBones: [1, 2, 3].map((i) => index[`FrontFinger${i}_${s}`]),
        joints: [sh, el, wr],
        fingers,
        anchor: [sx * B.rumpWidth * 0.85, yP - D * 0.12, hipZ + L * 0.22],
        anchorBone: index.Spine1,
      });
    }
  } else if (rc.wings.kind !== 'none') {
    const S = rc.wings.span;
    const ch = rc.wings.chord / 0.55;
    const feathered = rc.wings.kind === 'feathered';
    for (const s of SIDES) {
      const sx = s === 'L' ? 1 : -1;
      const J0: V3 = [sx * B.chestWidth * 0.5, yW - D * 0.06, scapTopZ + L * 0.06];
      const J1 = add(J0, scale(norm([sx, 0.35, -0.3]), S * 0.3));
      const J2 = add(J1, scale(norm([sx, 0.12, 0.32]), S * 0.32));
      const fingers = [
        add(J2, scale(norm([sx, -0.05, 0.05]), S * 0.42)),
        add(J2, scale(norm([sx * 0.75, -0.12, -0.5]), S * 0.4 * ch)),
        add(J2, scale(norm([sx * 0.42, -0.15, -0.85]), S * 0.36 * ch)),
        add(J2, scale(norm([sx * 0.1, -0.15, -1]), S * 0.3 * ch)),
      ];
      world[`WingArm_${s}`] = J0;
      world[`WingFore_${s}`] = J1;
      world[`WingHand_${s}`] = J2;
      const r0 = Math.max(S * (feathered ? 0.05 : 0.04), minThick * 0.6);
      const nA = `WingArm_${s}`;
      const nF = `WingFore_${s}`;
      const nH = `WingHand_${s}`;
      ell('wing', lerp3(J0, J1, 0.2), sub(J1, J0), [0, 1, 0], [r0 * 1.6, r0 * 1.3, S * 0.12], r0 * 1.2, W([nA, 0.6], ['Chest', 0.4]));
      cone('wing', J0, J1, r0 * 1.15, r0 * 0.8, r0 * 0.8, W(['Chest', 0.4], [nA, 0.6]), W([nA, 1]), W([nA, 0.5], [nF, 0.5]));
      cone('wing', J1, J2, r0 * 0.8, r0 * 0.6, r0 * 0.4, W([nA, 0.5], [nF, 0.5]), W([nF, 1]), W([nF, 0.5], [nH, 0.5]));
      if (!feathered) cone('wing', J2, lerp3(J2, fingers[0], 0.25), r0 * 0.6, r0 * 0.45, r0 * 0.3, W([nF, 0.3], [nH, 0.7]), W([nH, 1]), W([nH, 1]));
      wings.push({
        side: s,
        bones: [nA, nF, nH].map((n) => index[n]),
        joints: [J0, J1, J2],
        fingers,
        anchor: [sx * B.rumpWidth * 0.85, yP - D * 0.12, hipZ + L * 0.22],
        anchorBone: index.Spine1,
      });
    }
  }

  // ── where a rider sits: on the back, a bit behind the withers
  const saddleZ = lerp(scapTopZ, midZ, 0.55);
  const saddle: V3 = [0, spineY(saddleZ) + D * 0.04 + rc.coat.wool * 0.035, saddleZ];

  // ── eyes: find the skull surface along each eye's line of sight
  const eyes: Eye[] = [];
  const Ey = rc.eyes;
  const faceSet = prims.filter((p) => ['head', 'brow', 'muzzle', 'jaw', 'mane'].includes(p.region) && !p.sub);
  for (const sx of [1, -1]) {
    const a = Ey.angle * DEG;
    const look = norm(add(add(scale(f, Math.cos(a)), [sx * Math.sin(a), 0, 0]), scale(uh, 0.12)));
    const origin = at(C, sx * hs * 0.25, hs * 0.18, hs * 0.48);
    const surf = surfaceAlong(origin, look, faceSet.filter((p) => p.region !== 'mane'));
    const style = Ey.style === 'painted' && rc.mesh.texture <= 0 ? 'ball' : (Ey.style ?? 'ball');
    const lids = clamp(Ey.lids ?? 0);
    const r = Ey.size;
    if (style === 'painted') {
      eyes.push({ bone: index.Head, c: surf, r, look, surf, painted: true, lids });
      continue;
    }
    const deep = style === 'socket';
    const c = sub(surf, scale(look, r * (deep ? 0.85 : 0.6)));
    eyes.push({ bone: index.Head, c, r, look, surf, lids });
    // a socket so the eye sits in the head instead of on it (deeper for 'socket')
    prims.push({ kind: 'ell', region: 'head', sub: true, c: sub(surf, scale(look, r * (deep ? 0.3 : 0.15))), ax: frame(look), r: deep ? [r * 1.25, r * 1.02, r * 0.95] : [r * 1.05, r * 0.85, r * 0.6], k: r * 0.5, wa: head });
    if (deep || lids > 0.02) {
      // upper eyelid: covers the top of the iris. this is what stops the "surprised" look
      const lid = deep ? Math.max(lids, 0.25) : lids;
      const upE = perp(uh, look);
      prims.push({ kind: 'ell', region: 'head', c: add(add(c, scale(upE, r * (1.12 - 0.62 * lid))), scale(look, r * 0.22)), ax: frame(look, upE), r: [r * 1.18, r * 0.5, r * 0.98], k: r * 0.28, wa: head } as Prim);
    }
  }
  // nostrils: painted when the animal is textured, carved when it's facet-coloured
  const marks: Anatomy['marks'] = [];
  for (const c of nostrils) {
    const r = tipR * 0.16 * ns + h * 0.4;
    marks.push({ kind: 'nostril', c, r: r * 0.75 });
    if (rc.mesh.texture > 0) continue;
    prims.push({ kind: 'ell', region: 'nose', sub: true, c, ax: frame(f, uh), r: [r, r * 0.8, r * 1.5], k: r * 0.6, wa: head });
  }

  // ── stand on the ground: the lowest foot surface goes to y = 0
  let minY = Infinity;
  for (const p of prims) {
    if (p.region !== 'paw' && p.region !== 'hoof') continue;
    minY = Math.min(minY, p.kind === 'cone' ? Math.min(p.a[1] - p.ra, p.b[1] - p.rb) : p.c[1] - p.r[1]);
  }
  const dy = -minY;
  const shift = (v: V3): V3 => [v[0], v[1] + dy, v[2]];
  for (const p of prims) {
    if (p.kind === 'cone') {
      p.a = shift(p.a);
      p.b = shift(p.b);
    } else p.c = shift(p.c);
  }
  for (const e of eyes) {
    e.c = shift(e.c);
    e.surf = shift(e.surf);
  }
  for (const k of marks) k.c = shift(k.c);
  for (const l of legs) {
    l.tip = shift(l.tip);
    if (l.stand) l.stand = [l.stand[0], 0, l.stand[2]]; // standing points rest on the floor
  }
  for (const w of wings) {
    w.joints = w.joints.map(shift);
    w.fingers = w.fingers.map(shift);
    w.anchor = shift(w.anchor);
  }
  for (const k of Object.keys(world)) if (k !== 'Root') world[k] = shift(world[k]);

  const bones: Bone[] = defs.map(([name, parent]) => ({ name, parent: parent ? index[parent] : -1, world: world[name] }));
  return {
    bones,
    index,
    prims,
    eyes,
    legs,
    wings,
    marks,
    dims: {
      withers: yW + dy,
      length: L,
      legFront: shoulderY + dy,
      legHind: hipY + dy,
      headTip: shift(headTip),
      tailTip: shift(tailTip),
      earTips: earTips.map(shift),
      saddle: shift(saddle),
    },
  };
}

/** Scale an anatomy uniformly about the origin (the global `scale` slider). */
export function scaleAnatomy(a: Anatomy, s: number) {
  if (s === 1) return;
  const S = (v: V3): V3 => [v[0] * s, v[1] * s, v[2] * s];
  for (const b of a.bones) b.world = S(b.world);
  for (const p of a.prims) {
    p.k *= s;
    if (p.fluff) p.fluff *= s;
    if (p.kind === 'cone') {
      p.a = S(p.a);
      p.b = S(p.b);
      p.ra *= s;
      p.rb *= s;
    } else {
      p.c = S(p.c);
      p.r = S(p.r);
    }
  }
  for (const e of a.eyes) {
    e.c = S(e.c);
    e.surf = S(e.surf);
    e.r *= s;
  }
  for (const k of a.marks) {
    k.c = S(k.c);
    k.r *= s;
  }
  for (const l of a.legs) {
    l.tip = S(l.tip);
    if (l.stand) l.stand = S(l.stand);
  }
  for (const w of a.wings) {
    w.joints = w.joints.map(S);
    w.fingers = w.fingers.map(S);
    w.anchor = S(w.anchor);
  }
  a.dims.saddle = S(a.dims.saddle);
  const d = a.dims;
  d.withers *= s;
  d.length *= s;
  d.legFront *= s;
  d.legHind *= s;
  d.headTip = S(d.headTip);
  d.tailTip = S(d.tailTip);
  d.earTips = d.earTips.map(S);
}
