/**
 * Self-contained glTF 2.0 / GLB writer for an Animal: one skinned mesh with two primitives
 * (coat with per-facet vertex colours, glossy eyes), the quadruped skeleton and baked animation
 * clips. Adapted from BadCharacters' writer. No three.js in between.
 */
import type { Animal, MeshOut } from '../core/animal';
import { sub } from '../core/math';
import { encodePng } from '../core/texture';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
export const FPS = 30;

interface Acc {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

class Buf {
  chunks: Uint8Array[] = [];
  length = 0;
  views: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  accessors: Acc[] = [];

  view(bytes: Uint8Array, target?: number) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    return this.views.length - 1;
  }
  f32(data: ArrayLike<number>, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', target?: number, minmax = false) {
    const arr = Float32Array.from(data);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc: Acc = { bufferView: this.view(new Uint8Array(arr.buffer), target), componentType: FLOAT, count: arr.length / n, type };
    if (minmax) {
      const mn = new Array(n).fill(Infinity);
      const mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        mn[i % n] = Math.min(mn[i % n], arr[i]);
        mx[i % n] = Math.max(mx[i % n], arr[i]);
      }
      acc.min = mn;
      acc.max = mx;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  u8vec4(data: ArrayLike<number>, target?: number) {
    const arr = Uint8Array.from(data);
    this.accessors.push({ bufferView: this.view(arr, target), componentType: 5121, count: arr.length / 4, type: 'VEC4' });
    return this.accessors.length - 1;
  }
  indices(data: ArrayLike<number>, vertexCount: number) {
    const big = vertexCount > 65535;
    const arr = big ? Uint32Array.from(data) : Uint16Array.from(data);
    this.accessors.push({ bufferView: this.view(new Uint8Array(arr.buffer), ELEMENT_ARRAY_BUFFER), componentType: big ? 5125 : 5123, count: arr.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }
  concat() {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
function hexLinear(hex: string): number[] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [16, 8, 0].map((sh) => {
    const c = ((n >> sh) & 255) / 255;
    return r6(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  });
}

export interface GltfOptions {
  animations?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildGltf(an: Animal, opts: GltfOptions = {}): { json: any; bin: Uint8Array } {
  const a = an.anatomy;
  const name = an.recipe.name.replace(/\s+/g, '_') || 'Animal';
  const bb = new Buf();
  const json: any = {
    asset: { version: '2.0', generator: 'BadZoo glTF writer (Bad Ideas Works)' },
    scene: 0,
    scenes: [{ name, nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [
      { name: 'Coat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.88 } },
      {
        name: 'Eyes', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.12 },
        ...(an.recipe.eyes.glow ? { emissiveFactor: hexLinear(an.recipe.eyes.color) } : {}),
      },
      { name: 'Tack', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
      { name: 'Metal', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.85, roughnessFactor: 0.35 } },
    ],
    skins: [],
  };

  // ── bones (node index == bone index)
  a.bones.forEach((b) => {
    const parent = b.parent >= 0 ? a.bones[b.parent].world : ([0, 0, 0] as const);
    const t = sub(b.world, [parent[0], parent[1], parent[2]]).map(r6);
    const node: any = { name: b.name };
    if (t.some((x) => x !== 0)) node.translation = t;
    json.nodes.push(node);
    if (b.parent >= 0) (json.nodes[b.parent].children ??= []).push(json.nodes.length - 1);
  });
  json.scenes[0].nodes.push(0);

  // ── baked colour atlas, shared by the coat and the eyes
  if (an.texture) {
    json.images = [{ name: 'Atlas', mimeType: 'image/png', bufferView: bb.view(encodePng(an.texture)) }];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    json.textures = [{ sampler: 0, source: 0 }];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    json.materials[1].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  json.materials.push({ name: 'Wings', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } });
  const prim = (m: MeshOut, material: number) => {
    const n = m.positions.length / 3;
    const attributes: Record<string, number> = {
      POSITION: bb.f32(m.positions, 'VEC3', ARRAY_BUFFER, true),
      NORMAL: bb.f32(m.normals, 'VEC3', ARRAY_BUFFER),
    };
    if (m.uvs) attributes.TEXCOORD_0 = bb.f32(m.uvs, 'VEC2', ARRAY_BUFFER);
    else attributes.COLOR_0 = bb.f32(m.colors, 'VEC3', ARRAY_BUFFER);
    attributes.JOINTS_0 = bb.u8vec4(m.joints, ARRAY_BUFFER);
    attributes.WEIGHTS_0 = bb.f32(m.weights, 'VEC4', ARRAY_BUFFER);
    return {
      attributes,
      indices: bb.indices(m.indices, n),
      material,
      mode: 4,
    };
  };
  const prims = [prim(an.body, 0), prim(an.eyes, 1)];
  if (an.tack) prims.push(prim(an.tack, 2));
  if (an.metal) prims.push(prim(an.metal, 3));
  if (an.wings) prims.push(prim(an.wings, 4));
  json.meshes.push({ name: `${name}_mesh`, primitives: prims });
  // drop materials nobody uses (validator warns otherwise)
  const used = new Set(prims.map((p) => p.material));
  const remap = new Map<number, number>();
  json.materials = json.materials.filter((_: unknown, i: number) => used.has(i));
  [...used].sort().forEach((m, i) => remap.set(m, i));
  for (const p of prims) p.material = remap.get(p.material)!;

  // ── sockets: plain child nodes (not joints). Saddle = where a rider's hips go.
  const sockets: { name: string; bone: string; at: [number, number, number] }[] = [{ name: 'Socket_Saddle', bone: 'Spine2', at: a.dims.saddle }];
  if (an.tackPieces.includes('Saddle')) {
    const s = an.recipe.scale;
    sockets[0].at = [a.dims.saddle[0], a.dims.saddle[1] + an.recipe.body.chestDepth * s * 0.08, a.dims.saddle[2]];
  }
  sockets.push({ name: 'Socket_Head', bone: 'Head', at: a.dims.headTip });
  for (const sk of sockets) {
    const bi = a.index[sk.bone];
    const idx = json.nodes.length;
    json.nodes.push({ name: sk.name, translation: sub(sk.at, a.bones[bi].world).map(r6), extras: { badzoo: { socket: true } } });
    (json.nodes[bi].children ??= []).push(idx);
  }

  const ibm: number[] = [];
  for (const b of a.bones) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(-b.world[0]), r6(-b.world[1]), r6(-b.world[2]), 1);
  json.skins.push({ name: 'Quadruped', skeleton: 0, joints: a.bones.map((_, i) => i), inverseBindMatrices: bb.f32(ibm, 'MAT4') });
  const meshNode = json.nodes.length;
  json.nodes.push({ name, mesh: 0, skin: 0 });
  json.scenes[0].nodes.push(meshNode);

  // ── animations
  if ((opts.animations ?? true) && an.clips.length) {
    json.animations = [];
    const hips = a.index.Hips;
    const hipsRest = sub(a.bones[hips].world, a.bones[0].world);
    for (const clip of an.clips) {
      const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
      const times: number[] = [];
      const poses: ReturnType<typeof clip.sample>[] = [];
      for (let f = 0; f < frames; f++) {
        const t = (f / (frames - 1)) * clip.duration;
        times.push(t);
        poses.push(clip.sample(f === frames - 1 && clip.loop ? 0 : t));
      }
      const input = bb.f32(times, 'SCALAR', undefined, true);
      const samplers: any[] = [];
      const channels: any[] = [];
      a.bones.forEach((b, bi) => {
        if (b.parent < 0) return;
        const out: number[] = [];
        let prev: number[] | null = null;
        for (const p of poses) {
          let q = [...p.local[bi]];
          // keep quaternions in one hemisphere so LINEAR interpolation doesn't spin the long way
          if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map((x) => -x);
          out.push(...q);
          prev = q;
        }
        samplers.push({ input, output: bb.f32(out, 'VEC4'), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: bi, path: 'rotation' } });
      });
      const tr: number[] = [];
      for (const p of poses) tr.push(hipsRest[0] + p.hips[0], hipsRest[1] + p.hips[1], hipsRest[2] + p.hips[2]);
      samplers.push({ input, output: bb.f32(tr, 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: hips, path: 'translation' } });
      json.animations.push({ name: clip.name, samplers, channels, extras: { loop: clip.loop, speed: r6(clip.speed) } });
    }
  }

  json.scenes[0].extras = {
    badzoo: {
      schema: 'badzoo/1',
      units: 'metres',
      up: '+Y',
      forward: '+Z',
      rig: 'quadruped',
      sockets: ['Socket_Saddle', 'Socket_Head'],
      tack: an.tackPieces,
      bones: a.bones.map((b) => b.name),
      clips: an.clips.map((c) => ({ name: c.name, duration: r6(c.duration), loop: c.loop, speed: r6(c.speed) })),
      recipe: an.recipe,
    },
  };

  const bin = bb.concat();
  json.buffers = [{ byteLength: bin.byteLength }];
  json.bufferViews = bb.views;
  json.accessors = bb.accessors;
  return { json, bin };
}

export function toGlb(json: any, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const p = new Uint8Array(jsonBytes.length + jpad);
    p.set(jsonBytes);
    p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(bin, o + 8);
  return out;
}

export function exportGlb(an: Animal, opts: GltfOptions = {}): Uint8Array {
  const { json, bin } = buildGltf(an, opts);
  return toGlb(json, bin);
}
