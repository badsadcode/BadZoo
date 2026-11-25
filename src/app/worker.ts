/** Generation runs off the main thread: recipe in, GLB bytes + stats out. */
import { generateAnimal } from '../core/animal';
import type { AnimalRecipe } from '../core/recipe';
import { exportGlb } from '../export/gltf';

self.onmessage = (e: MessageEvent<{ id: number; recipe: AnimalRecipe }>) => {
  const { id, recipe } = e.data;
  try {
    const an = generateAnimal(recipe);
    const glb = exportGlb(an);
    (self as unknown as Worker).postMessage({ id, glb, stats: an.stats, clips: an.clips.map((c) => c.name) }, [glb.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
