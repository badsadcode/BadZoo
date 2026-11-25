/**
 * Texture baking. Every texel of the atlas is mapped back to its 3D point on the mesh and painted
 * there with the same coat rules as the facets, only softer (gradients, anti-aliased pattern
 * edges), plus the small details that don't deserve geometry:
 *   eye rims · nostrils · mouth line · toe grooves · coronet bands · fur variation
 * Eyes get their own square in the atlas with a painted iris, pupil and catch-light.
 * Gutters are dilated so mip-mapping and bilinear filtering never bleed background into islands.
 */
import { zlibSync } from 'fflate';
import type { Anatomy } from './anatomy';
import { clamp, V3 } from './math';
import type { TriMesh } from './mesher';
import { hexRgb, mix, Owner, paintFacet, PaintContext, RGB } from './paint';
import { gridGrad } from './remesh';
import { Grid, noise3, Prim, primBounds, primDist } from './sdf';
import type { Unwrap } from './uv';

export interface Texture {
  size: number;
  rgba: Uint8Array;
}

function candidates(prims: Prim[], bounds: { min: V3; max: V3 }[], mn: V3, mx: V3, pad: number): Prim[] {
  const out: Prim[] = [];
  prims.forEach((p, i) => {
    if (p.sub) return;
    const b = bounds[i];
    const g = pad + p.k * 0.5;
    if (b.min[0] - g <= mx[0] && b.max[0] + g >= mn[0] && b.min[1] - g <= mx[1] && b.max[1] + g >= mn[1] && b.min[2] - g <= mx[2] && b.max[2] + g >= mn[2]) out.push(p);
  });
  return out.length ? out : prims.filter((p) => !p.sub);
}

function ownerIn(cands: Prim[], p: V3): { o: Owner; dMuzzle: number; dJaw: number } {
  let best = Infinity;
  let bp = cands[0];
  let bt = 0;
  let dMuzzle = Infinity;
  let dJaw = Infinity;
  for (const pr of cands) {
    const r = primDist(p, pr);
    if (pr.region === 'muzzle' || pr.region === 'beak') dMuzzle = Math.min(dMuzzle, r.d);
    if (pr.region === 'jaw') dJaw = Math.min(dJaw, r.d);
    if (r.d < best) {
      best = r.d;
      bp = pr;
      bt = r.t;
    }
  }
  const u = bp.span ? bp.span[0] + (bp.span[1] - bp.span[0]) * bt : 0;
  return { o: { prim: bp, u }, dMuzzle, dJaw };
}

export function bakeTexture(m: TriMesh, uw: Unwrap, a: Anatomy, g: Grid, ctx: PaintContext, size: number): Texture {
  const rc = ctx.rc;
  const S = size;
  const rgb = new Float32Array(S * S * 3);
  const filled = new Uint8Array(S * S);
  const prims = a.prims;
  const bounds = prims.map(primBounds);
  const nV = m.pos.length / 3;
  const vn: V3[] = [];
  for (let i = 0; i < nV; i++) {
    const n = gridGrad(g, m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
    const l = Math.hypot(...n) || 1;
    vn.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  const C = rc.coat;
  const dark = hexRgb(C.nose);
  const hs = rc.head.size * rc.scale;
  const nostrilMarks = a.marks.filter((k) => k.kind === 'nostril');
  const soft = 0.04;

  const nT = m.tri.length / 3;
  for (let t = 0; t < nT; t++) {
    const ids = [m.tri[t * 3], m.tri[t * 3 + 1], m.tri[t * 3 + 2]];
    const P = ids.map((i) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]] as V3);
    const N = ids.map((i) => vn[i]);
    const U = [0, 1, 2].map((k) => [uw.cornerUV[t * 6 + k * 2] * S, uw.cornerUV[t * 6 + k * 2 + 1] * S]);
    const mn: V3 = [Math.min(P[0][0], P[1][0], P[2][0]), Math.min(P[0][1], P[1][1], P[2][1]), Math.min(P[0][2], P[1][2], P[2][2])];
    const mx: V3 = [Math.max(P[0][0], P[1][0], P[2][0]), Math.max(P[0][1], P[1][1], P[2][1]), Math.max(P[0][2], P[1][2], P[2][2])];
    const cands = candidates(prims, bounds, mn, mx, hs * 0.02);
    const x0 = Math.max(0, Math.floor(Math.min(U[0][0], U[1][0], U[2][0])) - 1);
    const x1 = Math.min(S - 1, Math.ceil(Math.max(U[0][0], U[1][0], U[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(U[0][1], U[1][1], U[2][1])) - 1);
    const y1 = Math.min(S - 1, Math.ceil(Math.max(U[0][1], U[1][1], U[2][1])) + 1);
    const det = (U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (U[1][1] - U[0][1]);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const b1 = ((px - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (py - U[0][1])) / det;
        const b2 = ((U[1][0] - U[0][0]) * (py - U[0][1]) - (px - U[0][0]) * (U[1][1] - U[0][1])) / det;
        const b0 = 1 - b1 - b2;
        if (b0 < -0.02 || b1 < -0.02 || b2 < -0.02) continue;
        const idx = y * S + x;
        // texels exactly inside win over the slight overdraw of a neighbour
        const inside = b0 >= 0 && b1 >= 0 && b2 >= 0;
        if (filled[idx] === 2 || (filled[idx] === 1 && !inside)) continue;
        const p: V3 = [0, 1, 2].map((k) => P[0][k] * b0 + P[1][k] * b1 + P[2][k] * b2) as V3;
        const nn: V3 = [0, 1, 2].map((k) => N[0][k] * b0 + N[1][k] * b1 + N[2][k] * b2) as V3;
        const nl = Math.hypot(...nn) || 1;
        const n: V3 = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
        const { o, dMuzzle, dJaw } = ownerIn(cands, p);
        let col = paintFacet(ctx, p, n, o, soft);
        const reg = o.prim.region;

        // ── painted details
        const head = reg === 'head' || reg === 'brow' || reg === 'muzzle' || reg === 'jaw';
        if (head) {
          // eye rims: a darkened version of the local coat (never the nose colour: pink rims = haunted)
          for (const e of a.eyes) {
            if (e.painted) continue;
            const d = Math.hypot(p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]) / e.r;
            if (d < 1.45) col = mix(col, col.map((c) => c * 0.18) as RGB, 0.9 * clamp((1.45 - d) / 0.18) * clamp((d - 0.85) / 0.1));
          }
          // mouth: where muzzle and lower jaw meet, on the underside half
          if (dMuzzle < Infinity && dJaw < Infinity && rc.head.nose !== 'beak') {
            const w = hs * 0.035;
            const gap = Math.abs(dMuzzle - dJaw);
            if (gap < w && n[1] < 0.35) col = mix(col, col.map((c) => c * 0.25) as RGB, 0.75 * (1 - gap / w));
          }
        }
        // painted eyes: drawn straight onto the face, with the upper lid cutting across the top
        if (head) {
          for (const e of a.eyes) {
            if (!e.painted) continue;
            const v: V3 = [p[0] - e.surf[0], p[1] - e.surf[1], p[2] - e.surf[2]];
            const z = e.look;
            let xa: V3 = [z[2], 0, -z[0]];
            const xl = Math.hypot(...xa) || 1;
            xa = [xa[0] / xl, xa[1] / xl, xa[2] / xl];
            const ya: V3 = [z[1] * xa[2] - z[2] * xa[1], z[2] * xa[0] - z[0] * xa[2], z[0] * xa[1] - z[1] * xa[0]];
            const R = e.r * 1.05;
            const lx = (v[0] * xa[0] + v[1] * xa[1] + v[2] * xa[2]) / R;
            const ly = (v[0] * ya[0] + v[1] * ya[1] + v[2] * ya[2]) / R;
            const rr = Math.hypot(lx, ly);
            if (rr > 1.15 || n[0] * z[0] + n[1] * z[1] + n[2] * z[2] < 0.1) continue;
            const lidY = 0.95 - 1.15 * e.lids;
            if (rr < 0.9 && ly < lidY) col = paintEye(lx / 0.9, ly / 0.9, hexRgb(rc.eyes.color), rc.eyes.pupil);
            else if (rr < 1.15 && ly < lidY + 0.18) col = mix(col, col.map((c) => c * 0.15) as RGB, 0.9 * clamp((1.15 - rr) / 0.15));
          }
        }
        if (reg === 'nose') {
          for (const k of nostrilMarks) {
            const d = Math.hypot(p[0] - k.c[0], p[1] - k.c[1], p[2] - k.c[2]) / k.r;
            if (d < 1.2) col = mix(col, [0.03, 0.025, 0.025], clamp((1.2 - d) / 0.3));
          }
        }
        if (reg === 'paw' && o.prim.kind === 'ell') {
          // toe grooves on the front of the paw
          const e = o.prim;
          const rel: V3 = [p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]];
          const lx = (rel[0] * e.ax[0][0] + rel[1] * e.ax[0][1] + rel[2] * e.ax[0][2]) / e.r[0];
          const fwd = n[0] * e.ax[2][0] + n[1] * e.ax[2][1] + n[2] * e.ax[2][2];
          if (fwd > 0.15 && n[1] > -0.5) {
            const gD = Math.min(Math.abs(Math.abs(lx) - 0.36), Math.abs(lx));
            if (Math.abs(Math.abs(lx) - 0.36) < 0.07) col = mix(col, dark, 0.55 * (1 - gD / 0.07));
          }
        }
        if (reg === 'hoof' && o.u < 0.965) col = mix(col, [0, 0, 0], 0.25);
        // fur / skin variation: subtle, so flat areas don't look plastic
        if (!['nose', 'hoof', 'horn', 'beak'].includes(reg) && C.jitter > 0) {
          const f = noise3([p[0] / ctx.size * 22, p[1] / ctx.size * 22, p[2] / ctx.size * 22]) * 0.6 + noise3([p[0] / ctx.size * 70, p[1] / ctx.size * 70, p[2] / ctx.size * 70]) * 0.4;
          const k = 1 + f * 0.09 * C.jitter;
          col = [clamp(col[0] * k), clamp(col[1] * k), clamp(col[2] * k)];
        }
        rgb[idx * 3] = col[0];
        rgb[idx * 3 + 1] = col[1];
        rgb[idx * 3 + 2] = col[2];
        filled[idx] = inside ? 2 : 1;
      }
  }

  // ── eyes: painted into their reserved squares
  uw.slots.forEach(([u0, v0, sz], i) => {
    if (i >= a.eyes.filter((e) => !e.painted).length) return;
    const iris = hexRgb(rc.eyes.color);
    const X0 = Math.floor(u0 * S);
    const Y0 = Math.floor(v0 * S);
    const W = Math.floor(sz * S);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const lx = ((x + 0.5) / W) * 2 - 1;
        const ly = 1 - ((y + 0.5) / W) * 2;
        const col = paintEye(lx, ly, iris, rc.eyes.pupil);
        const idx = (Y0 + y) * S + X0 + x;
        if (X0 + x >= S || Y0 + y >= S) continue;
        rgb[idx * 3] = col[0];
        rgb[idx * 3 + 1] = col[1];
        rgb[idx * 3 + 2] = col[2];
        filled[idx] = 2;
      }
  });

  // ── dilate into the gutters (allocation-free: this runs over a million texels per pass)
  const fresh = new Uint8Array(S * S);
  for (let pass = 0; pass < 8; pass++) {
    fresh.fill(0);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const idx = y * S + x;
        if (filled[idx]) continue;
        let r = 0, gg = 0, b = 0, c = 0;
        if (x > 0 && filled[idx - 1] && !fresh[idx - 1]) { r += rgb[(idx - 1) * 3]; gg += rgb[(idx - 1) * 3 + 1]; b += rgb[(idx - 1) * 3 + 2]; c++; }
        if (x < S - 1 && filled[idx + 1] && !fresh[idx + 1]) { r += rgb[(idx + 1) * 3]; gg += rgb[(idx + 1) * 3 + 1]; b += rgb[(idx + 1) * 3 + 2]; c++; }
        if (y > 0 && filled[idx - S] && !fresh[idx - S]) { r += rgb[(idx - S) * 3]; gg += rgb[(idx - S) * 3 + 1]; b += rgb[(idx - S) * 3 + 2]; c++; }
        if (y < S - 1 && filled[idx + S] && !fresh[idx + S]) { r += rgb[(idx + S) * 3]; gg += rgb[(idx + S) * 3 + 1]; b += rgb[(idx + S) * 3 + 2]; c++; }
        if (!c) continue;
        rgb[idx * 3] = r / c;
        rgb[idx * 3 + 1] = gg / c;
        rgb[idx * 3 + 2] = b / c;
        filled[idx] = 1;
        fresh[idx] = 1;
      }
  }
  const rgba = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    rgba[i * 4] = Math.round(clamp(rgb[i * 3]) * 255);
    rgba[i * 4 + 1] = Math.round(clamp(rgb[i * 3 + 1]) * 255);
    rgba[i * 4 + 2] = Math.round(clamp(rgb[i * 3 + 2]) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return { size: S, rgba };
}

/** eye texture: (lx, ly) in -1..1 across the front of the eyeball */
export function paintEye(lx: number, ly: number, iris: RGB, pupil: 'round' | 'slit' | 'bar'): RGB {
  const r = Math.hypot(lx, ly);
  const sclera: RGB = [0.14, 0.1, 0.08];
  const ri = 0.74;
  if (r > ri + 0.04) return sclera;
  if (r > ri) return mix(sclera, [0.02, 0.015, 0.015], 0.7);
  // iris: darker rim, lighter around the pupil, with fine radial fibres
  const fib = 0.92 + 0.08 * Math.sin(Math.atan2(ly, lx) * 23);
  let col = mix(iris.map((c) => c * 0.55) as RGB, iris.map((c) => Math.min(1, c * 1.25)) as RGB, clamp(1 - r / ri));
  col = col.map((c) => c * fib) as RGB;
  if (r > ri - 0.08) col = mix(col, [0.02, 0.015, 0.015], ((r - (ri - 0.08)) / 0.08) * 0.6);
  let inPupil = false;
  if (pupil === 'round') inPupil = r < 0.34;
  if (pupil === 'slit') inPupil = Math.abs(lx) < 0.11 * Math.sqrt(Math.max(0, 1 - (ly / 0.7) ** 2)) + 0.02 && Math.abs(ly) < 0.7;
  if (pupil === 'bar') inPupil = Math.abs(ly) < 0.13 * Math.sqrt(Math.max(0, 1 - (lx / 0.62) ** 2)) + 0.03 && Math.abs(lx) < 0.62;
  if (inPupil) col = [0.01, 0.01, 0.012];
  // catch-light: what makes a low-poly eye look alive
  if (Math.hypot(lx + 0.28, ly - 0.32) < 0.15) col = [0.97, 0.97, 0.97];
  if (Math.hypot(lx - 0.22, ly + 0.25) < 0.06) col = mix(col, [0.9, 0.9, 0.9], 0.8);
  return col;
}

/** Minimal PNG encoder (RGBA8) */
export function encodePng(tex: Texture): Uint8Array {
  const { size: S, rgba } = tex;
  const raw = new Uint8Array((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * S * 4, (y + 1) * S * 4), y * (S * 4 + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 6 });
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, S);
  dv.setUint32(4, S);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
