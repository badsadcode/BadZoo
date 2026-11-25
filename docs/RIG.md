# BadZoo rig & export contract (`badzoo/1`)

- Units: metres. Up: **+Y**. Forward: **+Z** (the animal faces +Z). Left: **+X**.
- Ground: the lowest foot surface sits at **y = 0** in the rest pose.
- Every bone's rest rotation is **identity**. Bones carry only translations, so animation
  rotations are pure deltas (retargeting-friendly).
- One skinned mesh, two primitives: `Coat` (per-facet `COLOR_0`, roughness 0.88) and `Eyes`
  (roughness 0.12). Up to 4 influences per vertex.

## Bones (33)

```
Root
└─ Hips
   ├─ Spine1 ─ Spine2 ─ Chest
   │                     ├─ Neck1 ─ Neck2 ─ Head ─ Ear_L, Ear_R
   │                     └─ Scapula_{L,R} ─ UpperArm ─ Forearm ─ FrontFoot ─ FrontToe
   ├─ Tail1 ─ Tail2 ─ Tail3 ─ Tail4 ─ Tail5
   └─ Thigh_{L,R} ─ Shin ─ HindFoot ─ HindToe
```

(`_L` / `_R` suffix on every leg bone, e.g. `Forearm_L`.) The set is fixed for every species,
so animations and scripts transfer between animals; a horse's `FrontFoot` is its cannon bone,
a bear's is its palm.

## Animations

All in place (no root motion). The Hips translation is animated, everything else is rotation.
Each clip has `extras: { loop, speed }`, where `speed` is the forward speed (m/s) the cycle
covers. Move the root at that speed to avoid foot sliding.

| Clip | Notes |
|---|---|
| Idle | 6 s: breathing, looking around, ear flicks, slow tail wag |
| Walk | lateral-sequence 4-beat, duty 0.62 |
| Trot | diagonal pairs, duty 0.42 |
| Gallop | rotary, duty 0.3, spine flexion |
| Eat | head to the ground and nibble |

Cycle periods scale with √(leg length) (dynamic similarity), so a cat steps faster than a horse.

## Extras

`scenes[0].extras.badzoo` holds the schema, bone list, clip list and the full **recipe**, so any
exported animal can be regenerated or edited.
