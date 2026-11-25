/** Tiny vector / quaternion kit. The core stays free of three.js so it runs anywhere (CLI, tests, workers). */
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x y z w (glTF order)

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const DEG = Math.PI / 180;

export const QI: Quat = [0, 0, 0, 1];
export function qAxis(axis: V3, angle: number): Quat {
  const [x, y, z] = norm(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
export const qx = (a: number) => qAxis([1, 0, 0], a);
export const qy = (a: number) => qAxis([0, 1, 0], a);
export const qz = (a: number) => qAxis([0, 0, 1], a);
/** a·b — apply b first, then a (both in the parent frame). */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/** Compose many: qChain(a, b, c) = a·b·c (c applied first). */
export const qChain = (...qs: Quat[]) => qs.reduce((acc, q) => qMul(acc, q), QI);
export function qRotate(q: Quat, v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}
export function qNorm(q: Quat): Quat {
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** shortest-arc rotation taking unit vector a onto unit vector b */
export function qFromTo(a: V3, b: V3): Quat {
  const an = norm(a);
  const bn = norm(b);
  const d = dot(an, bn);
  if (d < -0.99999) {
    const axis = Math.abs(an[0]) < 0.9 ? cross(an, [1, 0, 0]) : cross(an, [0, 1, 0]);
    return qAxis(axis, Math.PI);
  }
  const c = cross(an, bn);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
