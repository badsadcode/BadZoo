/**
 * npm run cli -- export <species> [seed] [outDir]   one animal → GLB + recipe
 * npm run cli -- samples [outDir]                   every preset
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAnimal } from '../src/core/animal';
import { presetRecipe, SPECIES } from '../src/core/species';
import { exportGlb } from '../src/export/gltf';

const [cmd = 'samples', ...rest] = process.argv.slice(2);
function one(species: string, seed: number, out: string) {
  const rc = presetRecipe(species, seed);
  const an = generateAnimal(rc);
  mkdirSync(out, { recursive: true });
  const file = join(out, `${species}_${seed}`);
  writeFileSync(`${file}.glb`, exportGlb(an));
  writeFileSync(`${file}.badzoo.json`, JSON.stringify(rc, null, 2));
  const s = an.stats;
  console.log(`${species.padEnd(8)} ${String(s.tris).padStart(5)} tris (sculpt ${s.sculptTris}, ${s.shapes} shapes) ${s.ms.toFixed(0)} ms  h=${s.height.toFixed(2)}m → ${file}.glb`);
}
if (cmd === 'export') one(rest[0] ?? 'dog', Number(rest[1] ?? 1), rest[2] ?? 'out');
else for (const sp of Object.keys(SPECIES)) one(sp, 1, rest[0] ?? 'out/samples');
