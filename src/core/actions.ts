/**
 * Gameplay clips for legged animals: the moves a game actually asks for beyond locomotion.
 *
 *   Attack — style picked from the anatomy: bite/lunge (default), gore (horns, tusks, trunks), peck (birds)
 *   Hit    — flinch and recover            Death — buckle, fall on the side, stay down (one-shot)
 *   Jump   — crouch, launch, tuck, land    Sit / Sleep — resting loops
 *   Roar   — rear the head up and bellow   Rear — up on the hind legs (hoofed animals and mounts)
 *   Glide  — wings locked open (fliers)
 *
 * One-shot clips (loop: false) start and end near the Idle pose, so engines can cross-fade into
 * them and back out; Death ends lying down and should be held on its last frame.
 * Everything is in place: `speed` is 0, the engine owns root motion.
 */
import type { Anatomy } from './anatomy';
import type { Clip, LegTarget, Pose } from './anim';
import { DEG, Quat, QI, clamp, qMul, qNorm, qx, qy, qz, smooth } from './math';
import type { AnimalRecipe } from './recipe';

export interface ClipKit {
  blank: () => Pose;
  rot: (pose: Pose, name: string, q: Quat) => void;
  finish: (pose: Pose, targets: LegTarget[], flying?: boolean) => Pose;
  foldWings: (pose: Pose, breathe?: number) => void;
  ears: (pose: Pose, t: number, amt: number) => void;
  trunk: (pose: Pose, t: number, amt: number, curl?: number) => void;
  tailBones: number[];
  legLen: number;
  sim: number;
}

/** normalised lerp along the shorter arc */
const qLerp = (a: Quat, b: Quat, t: number): Quat => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qNorm([a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t]);
};
/** 0→1 between a and b */
const seg = (x: number, a: number, b: number) => smooth((x - a) / (b - a));
/** 0→1→0: rises over [a,b], holds, falls over [c,d] */
const env = (x: number, a: number, b: number, c: number, d: number) => seg(x, a, b) * (1 - seg(x, c, d));
const planted = (a: Anatomy): LegTarget[] => a.legs.map(() => ({ off: [0, 0, 0], toe: 0, foot: 0 }));

export function actionClips(a: Anatomy, rc: AnimalRecipe, k: ClipKit): Clip[] {
  const { blank, rot, finish, foldWings, ears, trunk, tailBones, legLen } = k;
  const idx = a.index;
  const quad = a.legs.some((l) => l.front);
  const sprawl = rc.legs.stance === 'sprawling';
  const hooved = rc.legs.foot === 'hoof' || rc.legs.foot === 'cloven';
  const hipsY = a.bones[idx.Hips].world[1];
  const halfW = Math.max(rc.body.chestWidth, rc.body.rumpWidth) * rc.scale;
  const belly = Math.max(0.02, a.dims.withers - rc.body.chestDepth * rc.scale * 1.05);
  const L = Math.max(0.05, a.bones[idx.Chest].world[2] - a.bones[idx.Hips].world[2]);
  const winged = a.wings.length > 0;
  const walker = a.wings.some((w) => w.fingerBones);
  const clips: Clip[] = [];
  const tail = (pose: Pose, f: (i: number) => Quat) => tailBones.forEach((b, i) => (pose.local[b] = f(i)));
  /** open folded wings by `amt` degrees (raised away from the body) */
  const flare = (pose: Pose, amt: number) => {
    for (const w of a.wings) {
      if (w.fingerBones) continue;
      const sx = w.side === 'L' ? 1 : -1;
      pose.local[w.bones[0]] = qMul(qz(sx * amt * DEG), pose.local[w.bones[0]]);
      pose.local[w.bones[1]] = qMul(qz(-sx * amt * 0.5 * DEG), pose.local[w.bones[1]]);
    }
  };
  const one = (name: string, duration: number, sample: (s: number, t: number) => Pose): Clip => ({ name, duration, loop: false, speed: 0, sample: (t) => sample(clamp(t / duration), t) });
  const loop = (name: string, duration: number, sample: (w: number, t: number) => Pose): Clip => ({ name, duration, loop: true, speed: 0, sample: (t) => sample((2 * Math.PI * t) / duration, t) });

  // ── Attack
  {
    const gore = rc.horns.kind !== 'none' || rc.head.tusks > 0 || rc.head.trunk > 0;
    const style = !quad ? 'peck' : gore ? 'gore' : 'bite';
    const dur = (style === 'peck' ? 0.7 : style === 'gore' ? 1.3 : 1.0) * Math.min(1.4, k.sim);
    clips.push(
      one('Attack', dur, (s, t) => {
        const pose = blank();
        // wind-up → strike → recover
        const wind = env(s, 0, 0.3, 0.3, 0.45);
        const strike = env(s, 0.3, 0.45, 0.6, 1);
        const lunge = (style === 'bite' ? 0.22 : style === 'gore' ? 0.14 : 0.08) * legLen;
        pose.hips = [0, -wind * legLen * 0.08 - strike * legLen * 0.03, -wind * lunge * 0.5 + strike * lunge];
        if (style === 'gore') {
          // head down, drive forward, toss up at the end of the strike
          const toss = env(s, 0.45, 0.55, 0.6, 0.9);
          rot(pose, 'Chest', qx((wind * 8 + strike * 6) * DEG));
          rot(pose, 'Neck1', qx((wind * 25 + strike * 20 - toss * 35) * DEG));
          rot(pose, 'Head', qx((wind * 20 + strike * 15 - toss * 25) * DEG));
          trunk(pose, t * 4, 4, -strike * 60);
        } else {
          rot(pose, 'Chest', qx((wind * 6 - strike * 4) * DEG));
          rot(pose, 'Neck1', qx((wind * 18 - strike * 22) * DEG));
          rot(pose, 'Neck2', qx((-wind * 10 + strike * (style === 'peck' ? 35 : 6)) * DEG));
          rot(pose, 'Head', qx((-wind * 12 + strike * (style === 'peck' ? 30 : -6)) * DEG + Math.sin(t * 40) * strike * 2 * DEG));
        }
        ears(pose, 0, -(wind + strike) * 25 * DEG);
        tail(pose, (i) => qMul(qx((-wind * 8 + strike * 4) * (1 + i * 0.3) * DEG), qy(Math.sin(t * 9 - i * 0.6) * 4 * DEG)));
        foldWings(pose);
        flare(pose, (wind + strike) * 35);
        // the front feet step into a big lunge; hind feet stay put
        return finish(
          pose,
          a.legs.map((l): LegTarget => {
            if (!l.front || style !== 'bite') return { off: [0, 0, 0], toe: 0, foot: 0 };
            const step = seg(s, 0.3, 0.42) * (1 - seg(s, 0.65, 0.95));
            const lift = Math.sin(Math.PI * clamp((s - 0.3) / 0.12)) * (s < 0.42 ? 1 : 0) + Math.sin(Math.PI * clamp((s - 0.65) / 0.3)) * (s > 0.65 ? 1 : 0);
            return { off: [0, lift * legLen * 0.12, step * lunge * 1.4], toe: 0, foot: lift * 40 * DEG };
          }),
        );
      }),
    );
  }

  // ── Hit: flinch back, ears pinned, recover
  clips.push(
    one('Hit', 0.6, (s) => {
      const pose = blank();
      const hit = seg(s, 0, 0.12) * (1 - seg(s, 0.25, 1));
      pose.hips = [hit * legLen * 0.03, -hit * legLen * 0.05, -hit * legLen * 0.09];
      rot(pose, 'Hips', qz(hit * 4 * DEG));
      rot(pose, 'Chest', qMul(qx(-hit * 8 * DEG), qz(-hit * 6 * DEG)));
      rot(pose, 'Neck1', qx(-hit * 14 * DEG));
      rot(pose, 'Head', qMul(qx(-hit * 10 * DEG), qy(hit * 15 * DEG)));
      ears(pose, 0, -hit * 30 * DEG);
      tail(pose, (i) => qx(hit * (6 + i * 3) * DEG));
      trunk(pose, 0, 0, -hit * 30);
      foldWings(pose);
      flare(pose, hit * 25);
      return finish(pose, planted(a));
    }),
  );

  // ── Death: knees buckle, the body rolls onto its side and stays there
  {
    const dur = 2.2;
    const drop = Math.max(0, hipsY - halfW * 1.05);
    const limp = (i: number): Quat => {
      // stiff, splayed legs drooping toward the floor once the body is down
      const bone = a.bones[i].name;
      if (/^(UpperArm|Thigh)/.test(bone)) return qMul(qz(-25 * DEG), qx((bone.startsWith('Thigh') ? 15 : -15) * DEG));
      if (/^(Forearm|Shin)/.test(bone)) return qx((bone.startsWith('Shin') ? -20 : 20) * DEG);
      return QI;
    };
    clips.push(
      one('Death', dur, (s, t) => {
        const buckle = seg(s, 0, 0.3);
        const fall = seg(s, 0.22, 0.55);
        const settle = Math.sin(Math.PI * clamp((s - 0.55) / 0.15)) * (s > 0.55 && s < 0.7 ? 1 : 0);
        const roll = (fall * 90 - settle * 6) * DEG;
        const build = (r: number) => {
          const pose = blank();
          const sink = buckle * legLen * 0.2 + fall * Math.max(0, drop - legLen * 0.2);
          pose.hips = [-fall * halfW * 0.6, -sink + settle * legLen * 0.03, 0];
          rot(pose, 'Hips', qz(r));
          rot(pose, 'Chest', qx(buckle * 6 * DEG));
          rot(pose, 'Neck1', qMul(qx((buckle * 25 + fall * 10) * DEG), qz(fall * 20 * DEG)));
          rot(pose, 'Head', qMul(qx((buckle * 15) * DEG), qz(fall * 25 * DEG)));
          ears(pose, 0, -(buckle * 15 + fall * 20) * DEG);
          tail(pose, (i) => qMul(qx((buckle * 10 - fall * 4) * DEG), qz(fall * (8 + i * 4) * DEG)));
          trunk(pose, t, 0, -fall * 10);
          foldWings(pose);
          flare(pose, Math.sin(Math.PI * fall) * 30 + fall * 10);
          return pose;
        };
        // legs: IK while standing (knees fold as the body sinks), then go limp as it rolls
        const upright = finish(build(0), planted(a));
        const pose = build(roll);
        const g = clamp(fall * 1.6);
        for (const l of a.legs) for (const b of l.chain.slice(1)) pose.local[b] = qLerp(upright.local[b], limp(b), g);
        // shoulder blades relax too (a hind leg's girdle is the Hips bone itself: leave the roll alone)
        for (const l of a.legs) if (l.front) pose.local[l.chain[0]] = qLerp(upright.local[l.chain[0]], QI, g);
        return pose;
      }),
    );
  }

  // ── Jump: crouch, spring, tuck, land (in place, peak at ~0.55 leg lengths)
  if (!sprawl) {
    const dur = 1.2 * Math.min(1.3, k.sim);
    const H = legLen * (quad ? 0.55 : 0.7);
    clips.push(
      one('Jump', dur, (s) => {
        const pose = blank();
        const crouch = env(s, 0, 0.25, 0.25, 0.36) + env(s, 0.72, 0.8, 0.8, 1) * 0.8;
        const air = clamp((s - 0.33) / 0.42);
        const up = s > 0.33 && s < 0.75 ? Math.sin(Math.PI * air) : 0;
        const y = up * H - crouch * legLen * 0.18;
        // nose up on take-off, down on the way down
        const pitch = (s > 0.33 && s < 0.75 ? Math.cos(Math.PI * air) * 12 : 0) * (quad ? 1 : 0.3);
        pose.hips = [0, y, 0];
        rot(pose, 'Hips', qx(-pitch * DEG));
        rot(pose, 'Chest', qx(crouch * 6 * DEG));
        rot(pose, 'Neck1', qx((pitch * 0.6 + crouch * 10) * DEG));
        rot(pose, 'Head', qx(pitch * 0.4 * DEG));
        ears(pose, 0, -up * 20 * DEG);
        tail(pose, (i) => qx((-up * 10 + crouch * 6) * (1 + i * 0.2) * DEG));
        trunk(pose, 0, 0, up * 40);
        foldWings(pose);
        flare(pose, up * 50);
        const tuck = up;
        return finish(
          pose,
          a.legs.map((l): LegTarget => ({
            off: [0, Math.max(0, y) * 0.92 + tuck * legLen * 0.12, tuck * legLen * (l.front ? 0.18 : -0.22) * (quad ? 1 : 0.4)],
            toe: tuck * 30 * DEG,
            foot: tuck * (l.front ? 70 : 40) * DEG,
          })),
        );
      }),
    );
  }

  // ── Sit (quadrupeds: haunches down, front legs straight; birds: roost)
  {
    const sinT = quad ? clamp((a.dims.legHind * 0.55) / L, 0, Math.sin(48 * DEG)) : 0;
    const th = Math.asin(sinT);
    const drop = quad ? L * sinT : legLen * 0.4;
    clips.push(
      loop('Sit', 5, (w) => {
        const pose = blank();
        const breathe = Math.sin(w * 3);
        pose.hips = [0, -drop + breathe * legLen * 0.003, quad ? 0 : 0];
        rot(pose, 'Hips', qx(-th));
        rot(pose, 'Spine2', qx(breathe * 0.6 * DEG));
        rot(pose, 'Chest', qx(th * 0.2));
        rot(pose, 'Neck1', qx(th * 0.5 + Math.sin(w * 2) * 3 * DEG));
        const look = Math.sin(w) * 18 * DEG * smooth(Math.abs(Math.sin(w)) * 1.4);
        rot(pose, 'Neck2', qy(look * 0.5));
        rot(pose, 'Head', qMul(qx(th * 0.3), qy(look * 0.5)));
        ears(pose, w * 2, 5 * DEG);
        // tail lies on the floor and sweeps a little
        tail(pose, (i) => qMul(qx((i === 0 ? th * 0.9 / DEG : 4) * DEG), qy(Math.sin(w * 2 - i * 0.6) * (3 + i * 2) * DEG)));
        trunk(pose, w * 3, 8, 10);
        foldWings(pose, breathe * 2);
        return finish(
          pose,
          a.legs.map((l): LegTarget => (quad && !l.front ? { off: [0, 0, L * 0.18], toe: 0, foot: -15 * DEG } : { off: [0, 0, 0], toe: 0, foot: 0 })),
        );
      }),
    );
  }

  // ── Sleep: belly on the floor, legs folded, head down, slow breathing
  {
    const drop = Math.max(0, belly * 0.95);
    clips.push(
      loop('Sleep', 6, (w) => {
        const pose = blank();
        const breathe = Math.sin(w * 2);
        pose.hips = [0, -drop + breathe * legLen * 0.006, 0];
        rot(pose, 'Spine2', qx(breathe * 1.2 * DEG));
        rot(pose, 'Chest', qx(-breathe * 0.6 * DEG));
        if (quad) {
          rot(pose, 'Neck1', qx(28 * DEG));
          rot(pose, 'Neck2', qMul(qx(8 * DEG), qy(10 * DEG)));
          rot(pose, 'Head', qMul(qx(-12 * DEG + breathe * 1.5 * DEG), qz(8 * DEG)));
        } else {
          // birds tuck the head back over the shoulder
          rot(pose, 'Neck1', qx(30 * DEG));
          rot(pose, 'Neck2', qy(70 * DEG));
          rot(pose, 'Head', qMul(qy(60 * DEG), qx(20 * DEG)));
        }
        ears(pose, w, -10 * DEG);
        tail(pose, (i) => qMul(qx((i === 0 ? 12 : 2) * DEG), qy((10 + i * 7) * DEG)));
        trunk(pose, w, 2, -20);
        foldWings(pose, breathe);
        return finish(
          pose,
          a.legs.map((l): LegTarget => {
            const sx = l.side === 'L' ? 1 : -1;
            if (!quad) return { off: [0, 0, 0], toe: 0, foot: 0 };
            return l.front
              ? { off: [sx * halfW * 0.1, 0, a.dims.legFront * 0.55], toe: -10 * DEG, foot: -30 * DEG }
              : { off: [sx * halfW * 0.35, 0, a.dims.legHind * 0.35], toe: 0, foot: -20 * DEG };
          }),
        );
      }),
    );
  }

  // ── Roar: rise, head up, bellow with a tremble, settle
  clips.push(
    one('Roar', 2.2, (s, t) => {
      const pose = blank();
      const rise = env(s, 0.05, 0.3, 0.75, 1);
      const shake = env(s, 0.3, 0.35, 0.7, 0.75) * Math.sin(t * 45);
      pose.hips = [0, rise * legLen * 0.02, -rise * legLen * 0.05];
      rot(pose, 'Hips', qx(-rise * 3 * DEG));
      rot(pose, 'Chest', qx((-rise * 8 + shake * 0.8) * DEG));
      rot(pose, 'Neck1', qx((-rise * 18 + shake) * DEG));
      rot(pose, 'Neck2', qx(-rise * 10 * DEG));
      rot(pose, 'Head', qMul(qx((-rise * 25 + shake * 1.5) * DEG), qy(shake * 1.5 * DEG)));
      ears(pose, 0, -rise * 35 * DEG);
      tail(pose, (i) => qMul(qx(-rise * (8 + i * 2) * DEG), qy(shake * 2 * DEG)));
      trunk(pose, t * 6, 3 + rise * 4, -rise * 70);
      foldWings(pose);
      flare(pose, rise * (walker ? 0 : 70));
      return finish(pose, planted(a));
    }),
  );

  // ── Rear: up on the hind legs, front hooves paw the air (hoofed animals and mounts)
  if (quad && !sprawl && !walker && (hooved || rc.tack.saddle)) {
    const th = Math.min(55 * DEG, Math.asin(clamp((legLen * 0.9) / L, 0, 0.95)));
    clips.push(
      one('Rear', 2.4, (s, t) => {
        const pose = blank();
        const up = env(s, 0.05, 0.35, 0.72, 0.95);
        const paw = env(s, 0.3, 0.38, 0.65, 0.72);
        const p = (Math.PI * 2 * (t - 0.7)) / 0.45;
        pose.hips = [0, -up * legLen * 0.1, -up * legLen * 0.08];
        rot(pose, 'Hips', qx(-up * th));
        rot(pose, 'Chest', qx(up * th * 0.15));
        rot(pose, 'Neck1', qx(up * th * 0.35 + paw * Math.sin(p) * 4 * DEG));
        rot(pose, 'Head', qx(up * th * 0.3 - paw * 8 * DEG));
        ears(pose, 0, -up * 20 * DEG);
        tail(pose, (i) => qMul(qx(up * (i === 0 ? th / DEG * 0.7 : 6) * DEG), qy(Math.sin(t * 6 - i * 0.6) * 5 * DEG)));
        trunk(pose, t * 4, 6, -up * 60);
        foldWings(pose);
        flare(pose, up * 40);
        // where the chest went: front feet ride up with it and paddle
        const lift = Math.sin(up * th) * L;
        return finish(
          pose,
          a.legs.map((l): LegTarget => {
            if (!l.front) return { off: [0, 0, up * legLen * 0.06], toe: 0, foot: up * -10 * DEG };
            const ph = l.side === 'L' ? 0 : Math.PI;
            const pd = paw * Math.sin(p + ph);
            return {
              off: [0, up * (lift - legLen * 0.05) + pd * legLen * 0.12 * up, -up * L * (1 - Math.cos(up * th)) + up * legLen * 0.15 + pd * legLen * 0.15],
              toe: up * 30 * DEG,
              foot: up * (80 + pd * 20) * DEG,
            };
          }),
        );
      }),
    );
  }

  // ── Glide: wings locked out, gentle sway (fliers)
  if (winged) {
    clips.push(
      loop('Glide', 3, (w) => {
        const pose = blank();
        pose.hips = [0, Math.sin(w) * legLen * 0.02 + legLen * 0.1, 0];
        rot(pose, 'Hips', qMul(qx(-3 * DEG), qz(Math.sin(w) * 6 * DEG)));
        rot(pose, 'Chest', qz(-Math.sin(w) * 2 * DEG));
        rot(pose, 'Neck1', qx(-8 * DEG));
        rot(pose, 'Head', qMul(qx(10 * DEG), qz(-Math.sin(w) * 4 * DEG)));
        tail(pose, (i) => qMul(qx(-4 * DEG), qy(Math.sin(w - i * 0.6) * 3 * DEG)));
        for (const wg of a.wings) {
          const sx = wg.side === 'L' ? 1 : -1;
          const th = [8 + Math.sin(w) * 3, -3, 2];
          wg.bones.forEach((b, i) => (pose.local[b] = qMul(qz(sx * th[i] * DEG), qy(sx * (i === 0 ? -6 : i === 1 ? 4 : 0) * DEG))));
        }
        trunk(pose, w, 4);
        return finish(
          pose,
          a.legs.map((l): LegTarget => (l.front
            ? { off: [0, legLen * 0.42, -legLen * 0.3], toe: 30 * DEG, foot: 75 * DEG }
            : { off: [0, legLen * 0.35, -legLen * 0.5], toe: 30 * DEG, foot: 40 * DEG })),
          true,
        );
      }),
    );
  }
  return clips;
}

/** Swimmer extras: flinch and the classic belly-up float. */
export function swimActionClips(rc: AnimalRecipe, blank: () => Pose, rot: (p: Pose, n: string, q: Quat) => void, tailBones: number[], size: number): Clip[] {
  const flukes = rc.fins.tail === 'flukes';
  const bend = (x: number) => (flukes ? qx(x) : qy(x));
  return [
    {
      name: 'Hit', duration: 0.6, loop: false, speed: 0,
      sample(t) {
        const s = clamp(t / 0.6);
        const hit = seg(s, 0, 0.12) * (1 - seg(s, 0.25, 1));
        const pose = blank();
        pose.hips = [hit * size * 0.04, 0, -hit * size * 0.06];
        rot(pose, 'Chest', bend(hit * 18 * DEG));
        rot(pose, 'Head', bend(hit * 10 * DEG));
        tailBones.forEach((b, i) => (pose.local[b] = bend(-hit * (10 + i * 4) * DEG)));
        rot(pose, 'PecFin_L', qz(hit * 30 * DEG));
        rot(pose, 'PecFin_R', qz(-hit * 30 * DEG));
        return pose;
      },
    },
    {
      name: 'Death', duration: 3, loop: false, speed: 0,
      sample(t) {
        const s = clamp(t / 3);
        const spasm = (1 - seg(s, 0.1, 0.4)) * Math.sin(t * 18);
        const roll = seg(s, 0.15, 0.85);
        const pose = blank();
        pose.hips = [0, roll * size * 0.06, 0];
        rot(pose, 'Hips', qz(roll * 180 * DEG));
        tailBones.forEach((b, i) => (pose.local[b] = bend((spasm * (8 + i * 4) + roll * 6) * DEG)));
        rot(pose, 'Chest', bend(spasm * 6 * DEG));
        rot(pose, 'PecFin_L', qz(roll * 35 * DEG));
        rot(pose, 'PecFin_R', qz(-roll * 35 * DEG));
        return pose;
      },
    },
  ];
}

