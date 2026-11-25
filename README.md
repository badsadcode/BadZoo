# BadZoo

**Procedural low-poly animals that are sculpted, not assembled.**
*Bad Ideas Works: We Create Worlds. Badly. Now with livestock.*

BadZoo is BadCharacters' sibling for four-legged things. It produces game-ready quadrupeds as
skinned, rigged, animated GLBs: one continuous faceted surface, a painted coat, glossy eyes, a
quadruped skeleton and procedural gaits, all from a seed-reproducible recipe.

![The lineup](docs/lineup.webp)

- **App:** `npm install && npm run dev`
- **Rig / export contract:** [`docs/RIG.md`](docs/RIG.md)

## What you get

| | |
|---|---|
| Species | Dog, Wolf, Fox, Cat, Lion, Horse, Cow, Pig, Sheep, Bear, Deer, Goat |
| Hybrids | Cross-breed any two species with a slider (numbers and colours blend, horns grow in) |
| Controls | About 70 parameters: body, legs (digitigrade / unguligrade / plantigrade; paw / hoof / cloven), neck and mane, head and muzzle, nose type, eyes and pupils, ears (pointy → floppy), tail (brush, curl, tuft), horns (cow, ram, goat, antlers, unicorn) |
| Coat | Countershading, solid / spots / rosettes / stripes / tabby / patches / saddle / colour points, socks, blaze, ear and tail tips, wool |
| Rig | 33 bones (spine, neck, head, ears, 5-bone tail, 4 legs × 5), identity rest rotations |
| Animations | Idle, Walk (lateral sequence), Trot (diagonal), Gallop (rotary, with spine flex), Eat |
| Export | GLB (Khronos-validator clean), `.badzoo.json` recipe, share links |
| Budget | 600–12k triangles (default ~4.5k) |

## How it works (short version)

1. **Anatomy → sculpt.** The recipe places joints the way a real quadruped's sit (sloped
   shoulder blade, elbow tucked at the brisket, raised hock for toe-walkers). It then hangs about
   60–100 signed-distance "clay" shapes on them: ribcage, rump, haunches, triceps, gaskins,
   cheeks, brows, cupped ears, nostrils and eye sockets (carved). These are blended with a
   smooth minimum.
2. **Surface nets** turn the sculpt into one closed surface (~50k triangles).
3. **Quadric decimation** reduces it to the budget. It keeps the mesh manifold, rejects
   fold-overs and **spends triangles on the face**: the nose, muzzle and ears get 5–9× importance.
4. **Skinning comes from the sculpt.** Every shape knows which bones it follows, so each vertex
   listens to the shapes it sits on.
5. **Painting** gives each facet one colour from what it is (nose, hoof, inner ear), which way it
   faces, and 3D pattern fields. A majority filter then removes stray "torn" triangles.
6. **Gaits** come from real footfall orders, with IK legs so stance feet stay planted.

The viewer **renders the exported GLB**, the same file your engine gets.

## Commands

```bash
npm run dev                              # the app
npm test                                 # 51 tests: manifold meshing, feet on floor, weights, NaN-free clips, validator-clean GLB per species
npm run cli -- export horse 3 out/       # one animal → GLB + recipe
npm run cli -- samples out/samples       # every species
```

## Status (honest version)

| Area | State |
|---|---|
| Sculpt → mesh → decimate → skin → paint | ✅ working, ~0.6–2.5 s per animal in a Web Worker |
| GLB export | ✅ Khronos validator: 0 errors on all 12 species |
| Gaits | ✅ procedural and IK-planted; walk/trot look right, gallop is plausible rather than beautiful |
| Unity / Godot / Unreal import | ⚠️ not yet verified in those editors (Generic rig; no Humanoid mapping for quadrupeds) |
| Birds, snakes, fish, insects | ❌ not yet: other body plans are the next archetypes |
| Facial animation / mouth | ❌ the jaw doesn't open yet |
