# BadZoo rig & export contract (`badzoo/1`)

- Units: metres. Up: **+Y**. Forward: **+Z** (the animal faces +Z). Left: **+X**.
- Ground: the lowest foot surface sits at **y = 0** in the rest pose.
- Every bone's rest rotation is **identity**. Bones carry only translations, so animation
  rotations are pure deltas (retargeting-friendly).
- One skinned mesh, two primitives: `Coat` (per-facet `COLOR_0`, roughness 0.88) and `Eyes`
  (roughness 0.12). Up to 4 influences per vertex.

## Bones (33 core)

```
Root
└─ Hips
   ├─ Spine1 ─ Spine2 ─ Chest
   │                     ├─ Neck1 ─ Neck2 ─ Head ─ Ear_L, Ear_R
   │                     └─ Scapula_{L,R} ─ UpperArm ─ Forearm ─ FrontFoot ─ FrontToe
   ├─ Tail1 ─ Tail2 ─ Tail3 ─ Tail4 ─ Tail5
   └─ Thigh_{L,R} ─ Shin ─ HindFoot ─ HindToe
```

Optional bones, present only when the recipe has the feature:

```
Head ─ Trunk1 ─ Trunk2 ─ Trunk3                 (trunk > 0)
Chest ─ WingArm_{L,R} ─ WingFore ─ WingHand     (wings ≠ none; rest pose = spread)
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
| Fly | winged animals only: wing beat, legs tucked, tail streaming (`speed` = suggested airspeed) |

Cycle periods scale with √(leg length) (dynamic similarity), so a cat steps faster than a horse.

## Sockets

Plain child nodes (not skin joints), tagged `extras.badzoo.socket`:

| Socket | Parent | Use |
|---|---|---|
| `Socket_Saddle` | Spine2 | rider's hips (on the saddle seat when there is one, else the bare back) |
| `Socket_Head` | Head | muzzle / beak / trunk tip: bits, held items, breath effects |

## Materials

`Coat` (baked atlas via `TEXCOORD_0`, or vertex colours in facet mode), `Eyes` (same atlas; glossy; emissive when `eyes.glow`), `Wings` (vertex colours, textured mode only), and when tack is present
`Tack` (leather / cloth) and `Metal` (plate, stirrups; metallic 0.85).

## Extras

`scenes[0].extras.badzoo` holds the schema, bone list, clip list and the full **recipe**, so any
exported animal can be regenerated or edited.
