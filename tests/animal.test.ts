import { describe, expect, it } from 'vitest';
import validator from 'gltf-validator';
import { generateAnimal } from '../src/core/animal';
import { fk } from '../src/core/anim';
import { decimate } from '../src/core/decimate';
import { add, qRotate, sub } from '../src/core/math';
import { flipWinding, signedVolume, surfaceNets } from '../src/core/mesher';
import { sampleGrid } from '../src/core/sdf';
import { blendRecipes, presetRecipe, randomRecipe, SPECIES } from '../src/core/species';
import { exportGlb } from '../src/export/gltf';

const FAST = { tris: 1500, resolution: 90 } as const;
const quick = (sp: string, seed = 1) => {
  const rc = presetRecipe(sp, seed);
  rc.mesh = { ...rc.mesh, ...FAST };
  return rc;
};

/** every edge of a closed 2-manifold is shared by exactly two triangles */
function edgeUse(tri: ArrayLike<number>) {
  const m = new Map<string, number>();
  for (let i = 0; i < tri.length; i += 3)
    for (let e = 0; e < 3; e++) {
      const a = tri[i + e];
      const b = tri[i + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  return [...m.values()];
}

describe('mesh kernel', () => {
  it('surface nets + decimation keep a sculpt closed and manifold', () => {
    const prims = [
      { kind: 'ell' as const, region: 'body' as const, c: [0, 0, 0] as [number, number, number], ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], r: [0.5, 0.3, 0.4] as [number, number, number], k: 0.1, wa: [] },
      { kind: 'cone' as const, region: 'leg' as const, a: [0.2, 0, 0] as [number, number, number], b: [0.2, -0.6, 0.1] as [number, number, number], ra: 0.12, rb: 0.05, k: 0.08, wa: [] },
    ];
    const m = surfaceNets(sampleGrid(prims, 0.02));
    if (signedVolume(m) < 0) flipWinding(m);
    expect(edgeUse(m.tri).every((n) => n === 2)).toBe(true);
    const low = decimate(m, { targetTris: 400 });
    expect(low.tri.length / 3).toBeLessThanOrEqual(420);
    expect(edgeUse(low.tri).every((n) => n === 2)).toBe(true);
    expect(signedVolume(low)).toBeGreaterThan(0);
  });
});

describe.each(Object.keys(SPECIES))('%s', (sp) => {
  const an = generateAnimal(quick(sp));

  it('stands on the ground, within its triangle budget', () => {
    let minY = Infinity;
    for (let i = 1; i < an.body.positions.length; i += 3) minY = Math.min(minY, an.body.positions[i]);
    expect(Math.abs(minY)).toBeLessThan(0.02 * an.recipe.scale + 0.01);
    expect(an.body.indices.length / 3).toBeLessThanOrEqual(FAST.tris * 1.1);
    expect(an.stats.height).toBeGreaterThan(0.1);
  });

  it('has sane skin weights', () => {
    const nb = an.anatomy.bones.length;
    for (let v = 0; v < an.body.weights.length / 4; v++) {
      const w = an.body.weights.subarray(v * 4, v * 4 + 4);
      expect(Math.abs(w[0] + w[1] + w[2] + w[3] - 1)).toBeLessThan(1e-4);
      for (let k = 0; k < 4; k++) expect(an.body.joints[v * 4 + k]).toBeLessThan(nb);
    }
  });

  it('animates without NaNs and keeps planted feet on the floor', () => {
    for (const clip of an.clips) {
      for (let f = 0; f <= 12; f++) {
        const pose = clip.sample((f / 12) * clip.duration);
        for (const q of pose.local) for (const x of q) expect(Number.isFinite(x)).toBe(true);
        if (clip.name === 'Idle' || clip.name === 'Eat') {
          const { G, P } = fk(an.anatomy, pose);
          for (const leg of an.anatomy.legs) {
            const toe = leg.chain[4];
            const tip = add(P[toe], qRotate(G[toe], sub(leg.tip, an.anatomy.bones[toe].world)));
            expect(Math.abs(tip[1] - leg.tip[1])).toBeLessThan(0.01);
          }
        }
      }
    }
  });

  it('exports a validator-clean GLB', async () => {
    const glb = exportGlb(an);
    const report = await validator.validateBytes(glb);
    if (report.issues.numErrors) console.log(JSON.stringify(report.issues.messages.slice(0, 5), null, 1));
    expect(report.issues.numErrors).toBe(0);
  });
});

describe('recipes', () => {
  it('are deterministic', () => {
    const a = generateAnimal(quick('fox', 7), { clips: false });
    const b = generateAnimal(quick('fox', 7), { clips: false });
    expect(Buffer.from(a.body.positions.buffer).equals(Buffer.from(b.body.positions.buffer))).toBe(true);
  });
  it('hybrids and surprises generate', () => {
    const h = blendRecipes(quick('horse'), quick('cow'), 0.5);
    expect(generateAnimal(h, { clips: false }).stats.tris).toBeGreaterThan(500);
    for (let s = 1; s <= 3; s++) {
      const rc = randomRecipe(s);
      rc.mesh = { ...rc.mesh, ...FAST };
      expect(generateAnimal(rc, { clips: false }).stats.tris).toBeGreaterThan(500);
    }
  });
});
