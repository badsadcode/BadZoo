/**
 * Procedural quadruped animation. Spine, neck, head, tail and ears are driven by phase-locked
 * sine curves (forward kinematics); legs are placed by inverse kinematics so stance feet stay
 * planted on the ground while the body bobs, pitches and flexes over them.
 *
 * Gaits use real footfall orders:
 *   walk   — lateral sequence (LH, LF, RH, RF), 4-beat, duty ≈ 0.62
 *   trot   — diagonal pairs (LH+RF, RH+LF), 2-beat, duty ≈ 0.42
 *   gallop — rotary (LH, RH, RF, LF), duty ≈ 0.3, with spine flexion
 * Clips are in place (no root motion); `extras.speed` tells the engine how fast to move them.
 */
import type { Anatomy, Leg } from './anatomy';
import { add, clamp, cross, DEG, dot, len, norm, qMul, qNorm, qRotate, Quat, qx, qy, qz, QI, scale, smooth, sub, V3 } from './math';
import type { AnimalRecipe } from './recipe';

export interface Pose {
  /** local rotation per bone (rest rotations are identity, so this is also the delta) */
  local: Quat[];
  /** Hips translation offset from rest */
  hips: V3;
}

export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  /** forward speed (m/s) this cycle covers, for the engine's root motion */
  speed: number;
  sample(t: number): Pose;
}

const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** rotation that maps the rest frame (dir r, side rs) onto the posed frame (dir p, side ps) */
function frameRot(r: V3, rs: V3, p: V3, ps: V3): Quat {
  const basis = (d: V3, s: V3): [V3, V3, V3] => {
    const e1 = norm(d);
    let e2 = sub(s, scale(e1, dot(s, e1)));
    if (len(e2) < 1e-6) e2 = Math.abs(e1[1]) < 0.9 ? cross(e1, [0, 1, 0]) : cross(e1, [1, 0, 0]);
    e2 = norm(e2);
    return [e1, e2, cross(e1, e2)];
  };
  const E = basis(r, rs);
  const F = basis(p, ps);
  // R = F·Eᵀ
  const m = (i: number, j: number) => F[0][i] * E[0][j] + F[1][i] * E[1][j] + F[2][i] * E[2][j];
  const m00 = m(0, 0), m11 = m(1, 1), m22 = m(2, 2);
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m(2, 1) - m(1, 2)) / s, (m(0, 2) - m(2, 0)) / s, (m(1, 0) - m(0, 1)) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m(0, 1) + m(1, 0)) / s, (m(0, 2) + m(2, 0)) / s, (m(2, 1) - m(1, 2)) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m(0, 1) + m(1, 0)) / s, 0.25 * s, (m(1, 2) + m(2, 1)) / s, (m(0, 2) - m(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m(0, 2) + m(2, 0)) / s, (m(1, 2) + m(2, 1)) / s, 0.25 * s, (m(1, 0) - m(0, 1)) / s];
  }
  return qNorm(q);
}

/** forward kinematics: global rotations and positions for every bone */
export function fk(a: Anatomy, pose: Pose): { G: Quat[]; P: V3[] } {
  const G: Quat[] = [];
  const P: V3[] = [];
  a.bones.forEach((b, i) => {
    if (b.parent < 0) {
      G.push(pose.local[i]);
      P.push(b.world);
      return;
    }
    const pg = G[b.parent];
    G.push(qNorm(qMul(pg, pose.local[i])));
    let p = add(P[b.parent], qRotate(pg, sub(b.world, a.bones[b.parent].world)));
    if (b.name === 'Hips') p = add(p, pose.hips);
    P.push(p);
  });
  return { G, P };
}

interface LegTarget {
  /** toe-tip offset from its rest position */
  off: V3;
  /** extra rotation of the toe segment about the lateral axis (radians, + curls back) */
  toe: number;
  /** extra rotation of the foot (metacarpal / metatarsal) segment (radians, + folds back) */
  foot: number;
}

/** Place one leg: toe tip on target, foot angled, then two-bone IK for the upper/lower bones. */
function solveLeg(a: Anatomy, pose: Pose, G: Quat[], P: V3[], leg: Leg, tg: LegTarget) {
  const [gi, ui, li, fi, ti] = leg.chain;
  const rest = (i: number) => a.bones[i].world;
  const S = P[ui];
  // toe segment
  const toeR = sub(leg.tip, rest(ti));
  const toeQ = qx(tg.toe);
  const toeDir = qRotate(toeQ, toeR);
  const tip = add(leg.tip, tg.off);
  const TJ = sub(tip, toeDir);
  // foot segment
  const footR = sub(rest(ti), rest(fi));
  const footQ = qx(tg.foot);
  let W = sub(TJ, qRotate(footQ, footR));
  // two-bone IK
  const l1 = len(sub(rest(li), rest(ui)));
  const l2 = len(sub(rest(fi), rest(li)));
  let d = sub(W, S);
  let dl = len(d);
  const maxL = (l1 + l2) * 0.999;
  if (dl > maxL) {
    W = add(S, scale(d, maxL / dl));
    d = sub(W, S);
    dl = maxL;
  }
  dl = Math.max(dl, Math.abs(l1 - l2) + 1e-4);
  const u = norm(d);
  const aLen = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - aLen * aLen));
  // bend toward the rest-pose knee/elbow side
  const restMid = rest(li);
  const restU = norm(sub(rest(fi), rest(ui)));
  let pole = sub(sub(restMid, rest(ui)), scale(restU, dot(sub(restMid, rest(ui)), restU)));
  if (len(pole) < 1e-6) pole = [0, 0, leg.knee];
  pole = qRotate(G[gi], norm(pole));
  const v = norm(sub(pole, scale(u, dot(pole, u))));
  const K = add(add(S, scale(u, aLen)), scale(v, hgt));
  // the leg's bending plane, at rest and posed: a stable twist reference even for sprawling legs
  const restPole = norm(sub(sub(restMid, rest(ui)), scale(restU, dot(sub(restMid, rest(ui)), restU))));
  const nRest = len(restPole) > 0.5 ? norm(cross(restU, restPole)) : ([1, 0, 0] as V3);
  const nPose = norm(cross(u, v));

  const gUpper = frameRot(sub(rest(li), rest(ui)), nRest, sub(K, S), nPose);
  const gLower = frameRot(sub(rest(fi), rest(li)), nRest, sub(W, K), nPose);
  const gFoot = frameRot(footR, nRest, sub(TJ, W), nPose);
  const gToe = frameRot(toeR, nRest, sub(tip, TJ), nPose);
  pose.local[ui] = qMul(qConj(G[gi]), gUpper);
  pose.local[li] = qMul(qConj(gUpper), gLower);
  pose.local[fi] = qMul(qConj(gLower), gFoot);
  pose.local[ti] = qMul(qConj(gFoot), gToe);
}

interface Gait {
  name: string;
  /** seconds per cycle for a 0.4 m leg (scaled by √leg, dynamic similarity) */
  period: number;
  duty: number;
  /** phase of each leg's touchdown: [LF, LH, RF, RH] order matches anatomy.legs (L front, L hind, R front, R hind) */
  phase: [number, number, number, number];
  stride: number;
  lift: number;
  bob: number;
  pitch: number;
  flex: number;
  nod: number;
  roll: number;
}

const GAITS: Gait[] = [
  { name: 'Walk', period: 1.05, duty: 0.62, phase: [0.25, 0, 0.75, 0.5], stride: 0.55, lift: 0.14, bob: 0.012, pitch: 1.2, flex: 1.5, nod: 4, roll: 2 },
  { name: 'Trot', period: 0.62, duty: 0.42, phase: [0.5, 0, 0, 0.5], stride: 0.85, lift: 0.2, bob: 0.022, pitch: 1.5, flex: 2, nod: 3, roll: 1.5 },
  { name: 'Gallop', period: 0.46, duty: 0.3, phase: [0.62, 0, 0.52, 0.1], stride: 1.35, lift: 0.24, bob: 0.04, pitch: 6, flex: 11, nod: 6, roll: 1 },
];

export function buildClips(a: Anatomy, rc: AnimalRecipe): Clip[] {
  const idx = a.index;
  const nb = a.bones.length;
  const legLen = (a.dims.legFront + a.dims.legHind) / 2;
  const sim = Math.sqrt(legLen / 0.4);
  const tailBones = a.bones.filter((b) => b.name.startsWith('Tail')).map((b) => idx[b.name]);
  const blank = (): Pose => ({ local: Array.from({ length: nb }, () => QI), hips: [0, 0, 0] });
  const rot = (pose: Pose, name: string, q: Quat) => {
    if (idx[name] !== undefined) pose.local[idx[name]] = qMul(pose.local[idx[name]], q);
  };
  const has = (name: string) => idx[name] !== undefined;
  const trunk = (pose: Pose, t: number, amt: number, curl = 0) => {
    for (let i = 1; has(`Trunk${i}`); i++) rot(pose, `Trunk${i}`, qMul(qx((Math.sin(t - i * 0.7) * amt * 0.6 - curl) * DEG), qy(Math.sin(t * 0.7 - i * 0.5) * amt * DEG)));
  };
  // wings: folded along the body by default, flapped in Fly
  const foldQ: Record<string, Quat[]> = {};
  for (const w of a.wings) {
    const sx = w.side === 'L' ? 1 : -1;
    const restDir = (i: number) => sub(i < 2 ? a.bones[w.bones[i + 1]].world : w.fingers[0], a.bones[w.bones[i]].world);
    const targets: V3[] = [norm([sx * 0.35, 0.45, -1]), norm([sx * 0.12, -0.2, 1]), norm([sx * 0.08, 0.02, -1])];
    const R = targets.map((d, i) => frameRot(restDir(i), [0, 1, 0], d, [sx * 0.2, 1, 0]));
    foldQ[w.side] = [R[0], qMul(qConj(R[0]), R[1]), qMul(qConj(R[1]), R[2])];
  }
  const foldWings = (pose: Pose, breathe = 0) => {
    for (const w of a.wings) {
      const sx = w.side === 'L' ? 1 : -1;
      w.bones.forEach((b, i) => (pose.local[b] = qMul(foldQ[w.side][i], i === 0 ? qz(sx * breathe * DEG) : QI)));
    }
  };
  const sprawl = rc.legs.stance === 'sprawling';
  const ears = (pose: Pose, t: number, amt: number) => {
    const droop = rc.ears.droop;
    rot(pose, 'Ear_L', qz(Math.sin(t) * amt * (1 - droop * 0.5)));
    rot(pose, 'Ear_R', qz(-Math.sin(t + 0.7) * amt * (1 - droop * 0.5)));
  };

  const finish = (pose: Pose, targets: LegTarget[]) => {
    const { G, P } = fk(a, pose);
    a.legs.forEach((leg, i) => solveLeg(a, pose, G, P, leg, targets[i]));
    return pose;
  };

  const clips: Clip[] = [];

  // ── Idle: breathe, look around, flick an ear, wag a little
  {
    const dur = 6;
    clips.push({
      name: 'Idle', duration: dur, loop: true, speed: 0,
      sample(t) {
        const w = (2 * Math.PI * t) / dur;
        const pose = blank();
        const breathe = Math.sin(w * 3);
        pose.hips = [Math.sin(w) * legLen * 0.012, breathe * legLen * 0.004 - legLen * 0.005, 0];
        rot(pose, 'Spine2', qx(breathe * 0.6 * DEG));
        rot(pose, 'Chest', qx(-breathe * 0.4 * DEG));
        const look = Math.sin(w) * 22 * DEG * smooth(Math.abs(Math.sin(w)) * 1.4);
        rot(pose, 'Neck1', qx(Math.sin(w * 2) * 3 * DEG));
        rot(pose, 'Neck2', qy(look * 0.45));
        rot(pose, 'Head', qMul(qy(look * 0.55), qz(Math.sin(w) * 5 * DEG)));
        tailBones.forEach((b, i) => (pose.local[b] = qy(Math.sin(w * 4 - i * 0.6) * (5 + i * 2) * DEG)));
        const flick = Math.max(0, Math.sin(w * 5)) ** 12;
        ears(pose, w * 2, 6 * DEG + flick * 14 * DEG);
        trunk(pose, w * 3, 10);
        foldWings(pose, breathe * 2);
        return finish(pose, a.legs.map(() => ({ off: [0, 0, 0], toe: 0, foot: 0 })));
      },
    });
  }

  // ── gaits
  for (const g of GAITS) {
    const dur = g.period * sim;
    const stride = g.stride * legLen;
    clips.push({
      name: g.name, duration: dur, loop: true, speed: stride / (dur * g.duty),
      sample(t) {
        const p = (t / dur) % 1;
        const w = 2 * Math.PI * p;
        const pose = blank();
        const gallop = g.name === 'Gallop';
        // body: bob twice per cycle (once per beat pair) — gallop once, with pitch
        const bob = gallop ? Math.sin(w) : Math.cos(2 * w);
        pose.hips = [Math.sin(w) * legLen * 0.01 * (gallop ? 0 : 1), bob * g.bob * legLen - g.bob * legLen * 0.5, 0];
        const pitch = Math.sin(w + (gallop ? 0.4 : 0)) * g.pitch * DEG;
        const flex = Math.sin(w + 1.1) * g.flex * DEG;
        rot(pose, 'Hips', qMul(qx(-pitch * 0.5 - flex * 0.6), qz(Math.sin(w) * g.roll * DEG)));
        rot(pose, 'Spine1', qx(flex * 0.5));
        rot(pose, 'Spine2', qx(flex * 0.4));
        rot(pose, 'Chest', qMul(qx(flex * 0.3 + pitch * 0.2), qz(-Math.sin(w) * g.roll * DEG)));
        // head: counter the body so the eyes stay steady, plus the gait's nod
        rot(pose, 'Neck1', qx(-flex * 0.6 + Math.cos(2 * w) * g.nod * 0.5 * DEG));
        rot(pose, 'Head', qx(-pitch * 0.5 + Math.cos(2 * w + 0.5) * g.nod * 0.5 * DEG));
        tailBones.forEach((b, i) => {
          const lag = i * 0.5;
          pose.local[b] = qMul(qy(Math.sin(w - lag) * (gallop ? 2 : 4 + i * 2.5) * DEG), qx((gallop ? Math.sin(w - lag) * 8 : 0) * DEG));
        });
        ears(pose, w, 4 * DEG);
        trunk(pose, w * 2, 8);
        foldWings(pose, gallop ? Math.sin(w) * 6 : 0);
        if (sprawl) {
          // lizards walk with their spines: a sideways S-wave from head to tail
          const yaw = Math.sin(w) * 9 * DEG;
          rot(pose, 'Hips', qy(yaw));
          rot(pose, 'Spine1', qy(-yaw * 0.5));
          rot(pose, 'Chest', qy(-yaw * 0.9));
          rot(pose, 'Neck1', qy(yaw * 0.6));
          tailBones.forEach((b, i) => (pose.local[b] = qMul(pose.local[b], qy(Math.sin(w - 1 - i * 0.6) * (6 + i * 3) * DEG))));
        }
        const targets = a.legs.map((leg, i): LegTarget => {
          const ph = (((p - g.phase[i]) % 1) + 1) % 1;
          if (ph < g.duty) {
            const s = ph / g.duty;
            const push = smooth((s - 0.6) / 0.4);
            return { off: [0, 0, stride * (0.5 - s)], toe: 0, foot: push * (leg.front ? 20 : 25) * DEG };
          }
          const s = (ph - g.duty) / (1 - g.duty);
          const e = smooth(s);
          const lift = Math.sin(Math.PI * Math.min(1, s * 1.1)) * g.lift * legLen * (leg.front ? 1.1 : 0.9);
          const fold = Math.sin(Math.PI * clamp(s * 1.25)) * (leg.front ? 70 : 35) * DEG;
          return { off: [0, lift, stride * (-0.5 + e)], toe: Math.sin(Math.PI * s) * 25 * DEG, foot: fold };
        });
        // scapulae swing with their legs
        a.legs.forEach((leg, i) => {
          if (!leg.front) return;
          const ph = (((p - g.phase[i]) % 1) + 1) % 1;
          const sw = ph < g.duty ? 0.5 - ph / g.duty : -0.5 + smooth((ph - g.duty) / (1 - g.duty));
          pose.local[leg.chain[0]] = qx(-sw * g.stride * 9 * DEG);
        });
        return finish(pose, targets);
      },
    });
  }

  // ── Eat: lower the head toward the ground, nibble, come back up
  {
    const dur = 4;
    const reach = Math.min(1, (a.dims.withers * 0.9) / Math.max(0.05, len(sub(a.dims.headTip, a.bones[idx.Neck1].world))));
    clips.push({
      name: 'Eat', duration: dur, loop: true, speed: 0,
      sample(t) {
        const pose = blank();
        const s = t / dur;
        const down = smooth(s / 0.2) * (1 - smooth((s - 0.82) / 0.18));
        const nibble = Math.sin(t * 14) * down;
        pose.hips = [0, -down * legLen * 0.03, 0];
        rot(pose, 'Chest', qx(down * 6 * DEG));
        rot(pose, 'Neck1', qx(down * (38 + 22 * reach) * DEG));
        rot(pose, 'Neck2', qx(down * 22 * DEG));
        rot(pose, 'Head', qx(down * 18 * DEG + nibble * 3 * DEG));
        tailBones.forEach((b, i) => (pose.local[b] = qy(Math.sin(t * 3 - i * 0.6) * (4 + i * 2) * DEG)));
        ears(pose, t * 2, 5 * DEG);
        trunk(pose, t * 3, 6, down * 25);
        foldWings(pose);
        return finish(pose, a.legs.map(() => ({ off: [0, 0, 0], toe: 0, foot: 0 })));
      },
    });
  }

  // ── Fly: wings beat, legs tucked, tail streaming (in place: the engine moves the root)
  if (a.wings.length) {
    const dur = 0.9 * Math.sqrt(Math.max(0.3, rc.wings.span * rc.scale) / 1.2);
    clips.push({
      name: 'Fly', duration: dur, loop: true, speed: legLen * 6,
      sample(t) {
        const w = (2 * Math.PI * t) / dur;
        const pose = blank();
        const beat = Math.sin(w);
        pose.hips = [0, -beat * legLen * 0.05 + legLen * 0.1, 0];
        rot(pose, 'Hips', qx(-4 * DEG));
        rot(pose, 'Chest', qx(beat * 3 * DEG));
        rot(pose, 'Neck1', qx(-10 * DEG - beat * 3 * DEG));
        rot(pose, 'Head', qx(14 * DEG));
        tailBones.forEach((b, i) => (pose.local[b] = qx((-6 + Math.sin(w - i * 0.7) * 4) * DEG)));
        for (const wg of a.wings) {
          const sx = wg.side === 'L' ? 1 : -1;
          const th = [beat * 45, Math.sin(w - 0.6) * 22, Math.sin(w - 1.1) * 18];
          wg.bones.forEach((b, i) => (pose.local[b] = qMul(qz(sx * th[i] * DEG), qy(sx * (i === 0 ? -8 : i === 1 ? 6 : 0) * DEG))));
        }
        trunk(pose, w, 5);
        return finish(pose, a.legs.map((l): LegTarget => (l.front
          ? { off: [0, legLen * 0.42, -legLen * 0.3], toe: 30 * DEG, foot: 75 * DEG }
          : { off: [0, legLen * 0.35, -legLen * 0.5], toe: 30 * DEG, foot: 40 * DEG })));
      },
    });
  }
  return clips;
}

/** Root-to-bone global pose for tests and the exporter. */
export function restPose(a: Anatomy): Pose {
  return { local: a.bones.map(() => QI), hips: [0, 0, 0] };
}
