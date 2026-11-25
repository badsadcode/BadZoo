/**
 * Recipe → skeleton + sculpt. This is where an animal is "designed": joints are placed the way a
 * real quadruped's are (shoulder blade sloping forward, elbow tucked at the brisket, hock and
 * wrist raised for toe-walkers), then muscle masses are hung on them — ribcage, rump, haunches,
 * triceps, gaskins, cheeks, brows — so that the blended surface reads as anatomy rather than as
 * tubes. Axis convention: +Y up, +Z forward (the animal looks down +Z), +X is the animal's left.
 */
import { add, cross, DEG, dot, len, lerp, lerp3, norm, scale, sub, V3 } from './math';
import type { AnimalRecipe, Stance } from './recipe';
import { fieldAt, frame, Prim, Region, Weights } from './sdf';

// ───────────────────────────────────────────────────────── skeleton ──

export const SIDES = ['L', 'R'] as const;
export type Side = (typeof SIDES)[number];

export const TAIL_BONES = 5;

/** Bone order: parents always before children. */
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
}

export interface Eye {
  bone: number;
  c: V3;
  r: number;
  look: V3;
}

export interface Anatomy {
  bones: Bone[];
  index: Record<string, number>;
  prims: Prim[];
  eyes: Eye[];
  legs: Leg[];
  /** useful measurements for animation & UI */
  dims: { withers: number; length: number; legFront: number; legHind: number; headTip: V3; tailTip: V3; earTips: V3[] };
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
  BONE_DEFS.forEach(([n], i) => (index[n] = i));
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
    const fp = layLeg(sj, pat.front);
    world[`Scapula_${s}`] = [sx * B.chestWidth * 0.55, yW - D * 0.08, scapTopZ];
    world[`UpperArm_${s}`] = fp[0];
    world[`Forearm_${s}`] = fp[1];
    world[`FrontFoot_${s}`] = fp[2];
    world[`FrontToe_${s}`] = fp[3];
    legs.push({ side: s, front: true, chain: ['Scapula', 'UpperArm', 'Forearm', 'FrontFoot', 'FrontToe'].map((n) => index[`${n}_${s}`]), tip: fp[4], knee: -1 });

    const hj: V3 = [sx * B.rumpWidth * 0.78, hipY, hipZ];
    const hp = layLeg(hj, pat.hind);
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
  const wool = rc.coat.wool * 0.035;
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
  ell('body', [0, (yP + hipY) / 2 - rumpDepth * 0.1, hipZ - L * 0.02], norm([0, -0.15, 1]), up, [B.rumpWidth * 1.02, rumpDepth * 1.35 + D * 0.1, L * 0.22], kBody, W(['Hips', 1]), woolly);
  // withers bridge between the shoulder blades
  ell('body', [0, yW - D * 0.12, scapTopZ + L * 0.02], fwd, up, [B.chestWidth * 0.75, D * 0.16, L * 0.2], kBody * 0.8, W(['Chest', 1]), woolly);
  if (B.hump > 0) {
    ell('body', [0, yW + D * 0.05 * B.hump, scapTopZ - L * 0.02], norm([0, 0.2, 1]), up, [B.chestWidth * 0.7, D * (0.12 + 0.3 * B.hump), L * (0.18 + 0.12 * B.hump)], kBody, W(['Chest', 1]), woolly);
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

    const hj = world[`Thigh_${s}`];
    const kn = world[`Shin_${s}`];
    const hk = world[`HindFoot_${s}`];
    const htj = world[`HindToe_${s}`];
    const ht = legs.find((l) => l.side === s && !l.front)!.tip;
    const hc = B.haunch;
    // haunch: the big hamstring/quad mass that gives a quadruped its back end
    ell('body', add(lerp3(hj, kn, 0.42), [0, T * 0.05, -T * 0.55]), sub(kn, hj), side, [T * 1.6 * hc, T * 1.85 * hc, len(sub(kn, hj)) * 0.78], kBody * 0.6, W([n('Thigh'), 0.7], ['Hips', 0.3]), woolly);
    cone('leg', hj, kn, T * 1.45, T * 0.9, T * 0.7, W(['Hips', 0.5], [n('Thigh'), 0.5]), W([n('Thigh'), 1]), W([n('Thigh'), 0.5], [n('Shin'), 0.5]), { span: [0, 0.3], ...legWool });
    // gaskin (calf) + the point of the hock
    ell('leg', add(lerp3(kn, hk, 0.3), [0, 0, -T * 0.4]), sub(hk, kn), side, [T * 0.8 * hc, T * 0.9 * hc, len(sub(hk, kn)) * 0.4], T * 0.5, W([n('Shin'), 1]), legWool);
    cone('lowerLeg', kn, hk, T * 0.88, T * 0.46, T * 0.4, W([n('Thigh'), 0.4], [n('Shin'), 0.6]), W([n('Shin'), 1]), W([n('Shin'), 0.5], [n('HindFoot'), 0.5]), { span: [0.3, 0.65] });
    ell('lowerLeg', add(hk, [0, T * 0.12, -T * 0.32]), [0, 1, 0], side, [T * 0.36, T * 0.5, T * 0.4], T * 0.35, W([n('HindFoot'), 0.5], [n('Shin'), 0.5]));
    cone('lowerLeg', hk, htj, T * 0.5, T * 0.44, T * 0.3, W([n('Shin'), 0.5], [n('HindFoot'), 0.5]), W([n('HindFoot'), 1]), W([n('HindFoot'), 0.5], [n('HindToe'), 0.5]), { span: [0.65, 0.9] });
    addFoot(n('HindFoot'), n('HindToe'), hk, htj, ht);
  }

  function addFoot(footBone: string, toeBone: string, ankle: V3, toe: V3, tip: V3) {
    const dir = norm(sub(tip, toe));
    const flatDir = norm([0, 0, dir[2] || 1]);
    if (foot === 'paw') {
      const plant = rc.legs.stance === 'plantigrade';
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
  ell('head', C, f, uh, [hs * 0.92, hs * 0.86, hs * 1.02], hs * 0.4, head);
  const muzzleBase = at(C, 0, -hs * 0.22, hs * 0.38);
  const muzzleTip = at(C, 0, -hs * 0.3 - Hd.muzzleDepth * 0.15, hs * 0.62 + Hd.muzzleLength);
  const mR = Math.max(Hd.muzzleWidth, Hd.muzzleDepth);
  const mFlat = Hd.muzzleWidth < Hd.muzzleDepth ? { axis: [1, 0, 0] as V3, f: Hd.muzzleWidth / Hd.muzzleDepth } : { axis: uh, f: Hd.muzzleDepth / Hd.muzzleWidth };
  const tipR = mR * Hd.muzzleTaper;
  cone('muzzle', muzzleBase, muzzleTip, mR * 1.05, tipR, hs * 0.35, head, undefined, undefined, { flat: mFlat });
  // lower jaw
  const jawA = at(C, 0, -hs * 0.55, -hs * 0.05);
  const jawB = add(muzzleTip, add(scale(uh, -tipR * 0.75 * (mFlat.axis === uh ? mFlat.f : 1)), scale(f, -tipR * 0.45)));
  cone('jaw', jawA, jawB, hs * 0.4 * Hd.cheeks, tipR * 0.55, hs * 0.25, head, undefined, undefined, { flat: { axis: [1, 0, 0], f: 0.8 } });
  for (const sx of [1, -1]) {
    ell('head', at(C, sx * hs * 0.5, -hs * 0.32, -hs * 0.02), f, uh, [hs * 0.38 * Hd.cheeks, hs * 0.42 * Hd.cheeks, hs * 0.48 * Hd.cheeks], hs * 0.3, head); // cheek
    ell('brow', at(C, sx * hs * 0.36, hs * 0.32, hs * 0.55), norm(add(f, [sx * 0.3, 0, 0])), uh, [hs * 0.24 * Hd.brow, hs * 0.14 * Hd.brow, hs * 0.22 * Hd.brow], hs * 0.18, head);
  }
  // nose
  const ns = Hd.noseSize;
  const tipFlatY = mFlat.axis === uh ? mFlat.f : 1;
  const tipFlatX = mFlat.axis === uh ? 1 : mFlat.f;
  const nostrils: V3[] = [];
  if (Hd.nose === 'pad') {
    const nc = add(muzzleTip, add(scale(f, tipR * 0.72), scale(uh, tipR * 0.25 * tipFlatY)));
    ell('nose', nc, norm(add(f, scale(uh, 0.5))), uh, [tipR * 0.75 * ns * tipFlatX + h * 0.5, tipR * 0.5 * ns, tipR * 0.45 * ns], tipR * 0.25, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.3 * ns * tipFlatX, 0, 0], scale(f, tipR * 0.4 * ns))));
  } else if (Hd.nose === 'snout') {
    const nc = add(muzzleTip, scale(f, tipR * 0.92));
    ell('nose', nc, f, uh, [tipR * 1.02 * ns * tipFlatX, tipR * 0.9 * ns * tipFlatY, tipR * 0.32], tipR * 0.18, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.35 * ns * tipFlatX, 0, 0], scale(f, tipR * 0.33))));
  } else {
    const nc = add(muzzleTip, add(scale(f, tipR * 0.45), scale(uh, -tipR * 0.05)));
    ell('nose', nc, f, uh, [tipR * 1.02 * ns * tipFlatX, tipR * 0.85 * ns * tipFlatY, tipR * 0.62], tipR * 0.3, head);
    for (const sx of [1, -1]) nostrils.push(add(nc, add([sx * tipR * 0.5 * ns * tipFlatX, tipR * 0.15, 0], scale(f, tipR * 0.6))));
  }
  const headTip = add(muzzleTip, scale(f, tipR));

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
    cone('ear', sub(base, scale(dir, E.width * 0.15)), tip, ra, rb, Math.min(hs * 0.12, ra * 0.4), W(['Head', 0.5], [`Ear_${s}`, 0.5]), ear, ear, {
      flat: { axis: thickAxis, f: thick / ra },
      span: [0, 1],
      axis: thickAxis,
    });
    world[`Ear_${s}`] = base;
    // cup the inside of erect ears
    if (E.droop < 0.5) {
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
    const hornChain = (start: V3, dir0: V3, steps: number, segLen: number, r0: number, r1: number, turn: (d: V3, i: number) => V3) => {
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
        cone('horn', pts[i], pts[i + 1], Math.max(lerp(r0, r1, i / steps), minThick * 0.5), Math.max(lerp(r0, r1, (i + 1) / steps), minThick * 0.4), i === 0 ? r0 * 0.6 : r0 * 0.05, head);
      }
      return pts;
    };
    const HL = Hn.length;
    const HT = Hn.thickness;
    for (const sx of Hn.kind === 'unicorn' ? [0] : [1, -1]) {
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

  // ── eyes: find the skull surface along each eye's line of sight
  const eyes: Eye[] = [];
  const Ey = rc.eyes;
  const faceSet = prims.filter((p) => ['head', 'brow', 'muzzle', 'jaw', 'mane'].includes(p.region) && !p.sub);
  for (const sx of [1, -1]) {
    const a = Ey.angle * DEG;
    const look = norm(add(add(scale(f, Math.cos(a)), [sx * Math.sin(a), 0, 0]), scale(uh, 0.12)));
    const origin = at(C, sx * hs * 0.25, hs * 0.18, hs * 0.48);
    const surf = surfaceAlong(origin, look, faceSet.filter((p) => p.region !== 'mane'));
    eyes.push({ bone: index.Head, c: sub(surf, scale(look, Ey.size * 0.5)), r: Ey.size, look });
    // a shallow socket so the eye sits in the head instead of on it
    prims.push({ kind: 'ell', region: 'head', sub: true, c: sub(surf, scale(look, Ey.size * 0.15)), ax: frame(look), r: [Ey.size * 1.05, Ey.size * 0.85, Ey.size * 0.6], k: Ey.size * 0.5, wa: head });
  }
  // nostrils
  for (const c of nostrils) {
    const r = tipR * 0.16 * ns + h * 0.4;
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
  for (const e of eyes) e.c = shift(e.c);
  for (const l of legs) l.tip = shift(l.tip);
  for (const k of Object.keys(world)) if (k !== 'Root') world[k] = shift(world[k]);

  const bones: Bone[] = BONE_DEFS.map(([name, parent]) => ({ name, parent: parent ? index[parent] : -1, world: world[name] }));
  return {
    bones,
    index,
    prims,
    eyes,
    legs,
    dims: {
      withers: yW + dy,
      length: L,
      legFront: shoulderY + dy,
      legHind: hipY + dy,
      headTip: shift(headTip),
      tailTip: shift(tailTip),
      earTips: earTips.map(shift),
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
    e.r *= s;
  }
  for (const l of a.legs) l.tip = S(l.tip);
  const d = a.dims;
  d.withers *= s;
  d.length *= s;
  d.legFront *= s;
  d.legHind *= s;
  d.headTip = S(d.headTip);
  d.tailTip = S(d.tailTip);
  d.earTips = d.earTips.map(S);
}
