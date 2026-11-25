/**
 * The animal recipe: everything that defines an animal, as plain JSON. Lengths are metres (before
 * the global `scale`), angles are degrees. A recipe + the generator version = the same animal,
 * every time.
 */

export type Stance = 'digitigrade' | 'unguligrade' | 'plantigrade' | 'sprawling';
export type Foot = 'paw' | 'hoof' | 'cloven' | 'talon' | 'webbed';
export type Plan = 'quadruped' | 'biped' | 'swimmer';
export type Nose = 'pad' | 'snout' | 'broad' | 'beak';
export type Mane = 'none' | 'crest' | 'ruff';
export type Horns = 'none' | 'cow' | 'ram' | 'goat' | 'antlers' | 'unicorn' | 'rhino' | 'dragon';
export type Wings = 'none' | 'membrane' | 'feathered' | 'flipper';
export type Barding = 'none' | 'leather' | 'plate';
export type Pattern = 'solid' | 'spots' | 'rosettes' | 'stripes' | 'patches' | 'saddle' | 'points' | 'tabby' | 'scales' | 'split';

export interface AnimalRecipe {
  name: string;
  species: string;
  seed: number;
  /** body plan: four legs, two legs + wings (birds), or no legs + fins (fish, whales) */
  plan: Plan;
  /** applied on top of everything else at generation time (presets describe the male) */
  sex: 'male' | 'female';
  /** global size multiplier */
  scale: number;
  body: {
    /** shoulder joint ↔ hip joint */
    length: number;
    /** withers → brisket */
    chestDepth: number;
    /** half widths */
    chestWidth: number;
    rumpWidth: number;
    /** 1 = barrel, 0.5 = greyhound tuck */
    waist: number;
    /** 0..1 belly sag */
    belly: number;
    /** shoulder muscle mass multiplier */
    shoulders: number;
    /** hindquarter muscle mass multiplier */
    haunch: number;
    /** 0..1 hump over the withers (bison, zebu, bear) */
    hump: number;
    /** 1 or 2 humps (dromedary / bactrian) */
    humps: number;
    /** dorsal spines / plates along neck, back and tail (size in m, 0 = none) */
    spines: number;
    spineCount: number;
    /** topline curvature, + = roach back */
    arch: number;
    /** 0 = soft clay blending (cute) … 1 = hard edges where shapes meet (bony, monstrous) */
    sharp: number;
  };
  legs: {
    /** shoulder joint height */
    front: number;
    /** hip joint height */
    hind: number;
    /** limb radius at the top */
    thickness: number;
    stance: Stance;
    foot: Foot;
    footSize: number;
    /** long hair over the hooves / lower legs, 0 … 1 (clydesdale, shire) */
    feathering: number;
  };
  neck: {
    length: number;
    thickness: number;
    /** degrees above horizontal */
    angle: number;
    mane: Mane;
    maneSize: number;
  };
  head: {
    /** cranium radius */
    size: number;
    muzzleLength: number;
    muzzleWidth: number;
    muzzleDepth: number;
    /** tip radius / base radius */
    muzzleTaper: number;
    /** 0 = round end … 1 = square-cornered end */
    muzzleSquare: number;
    /** 0 = domed end … 1 = cut flat at the front */
    muzzleFlat: number;
    /** 0 = no swelling … 1 = soft, swollen end (horse lips, cow, moose) */
    muzzleBulb: number;
    /** nose bridge profile: -1 dished … 0 straight … +1 Roman nose */
    muzzleBridge: number;
    /** -1 tip tilts up … +1 tip droops down */
    muzzleDrop: number;
    /** forehead step: 0 = none (bull terrier: one smooth line) … 0.5 = normal … 1 = steep (boxer, chihuahua) */
    stop: number;
    /** -1 flat skull (husky) … +1 apple dome (chihuahua) */
    dome: number;
    /** skull width multiplier (0.7 narrow collie … 1.5 bully breeds) */
    headWidth: number;
    /** hanging upper lips, 0 … 1 (mastiff, boxer, basset) */
    flews: number;
    /** degrees the face points down from the neck's line of sight */
    pitch: number;
    cheeks: number;
    brow: number;
    nose: Nose;
    /** elephant trunk length (m), 0 = none */
    trunk: number;
    /** tusk length (m), 0 = none */
    tusks: number;
    /** how much tusks curve: 1 = elephant, 2+ = mammoth spiral */
    tuskCurl: number;
    /** fangs along the jaw line, 0 … 1 */
    teeth: number;
    /** fangs per side (irregular needle teeth when high) */
    teethCount: number;
    /** lower jaw size: 1 normal … 2 huge underbite (anglerfish, viperfish) */
    jaw: number;
    /** anglerfish lure stalk length (m), 0 = none */
    lure: number;
    /** beak hook: 0 straight (duck, heron) … 1 hooked (eagle, parrot) */
    beakHook: number;
    /** comb / crest on top of the head, 0 … 1 (rooster, cockatoo) */
    crest: number;
    noseSize: number;
  };
  eyes: {
    size: number;
    /** 0° = both eyes look straight ahead (predator), 90° = fully sideways (prey) */
    angle: number;
    color: string;
    /** 'round' | 'slit' | 'bar' (goat) pupils */
    pupil: 'round' | 'slit' | 'bar';
    /** glowing eyes (emissive) */
    glow: boolean;
    /** ball = round eyeballs (classic), socket = set deeper under a brow, painted = drawn on the face (texture mode) */
    style: 'ball' | 'socket' | 'painted';
    /** upper eyelids: 0 = wide awake ("surprised") … 1 = sleepy */
    lids: number;
    /** number of eyes (2 … 8): extra pairs climb the skull. monsters only, please */
    count: number;
    /** 0 = calm … 1 = furious: the upper lid slants down toward the nose */
    anger: number;
  };
  ears: {
    length: number;
    width: number;
    /** 0 = round tip, 1 = sharp point */
    tip: number;
    /** degrees from vertical, outward */
    spread: number;
    /** degrees back */
    tilt: number;
    /** 0 = erect, 1 = hanging */
    droop: number;
    /** how much of the ear base sits toward the side of the head (0 top .. 1 side) */
    side: number;
    /** semi-erect ears: the top part folds forward, 0 … 1 (collie, jack russell) */
    fold: number;
  };
  tail: {
    length: number;
    thickness: number;
    /** mid-tail fluff multiplier (fox brush) */
    brush: number;
    /** base angle, degrees above horizontal-backwards (-90 = hanging) */
    lift: number;
    /** total bend along the tail, degrees (+ = curls up) */
    curl: number;
    /** end tuft size (lion, cow), 0 = none */
    tuft: number;
    /** spikes at the tail tip, 0 … 1 */
    spikes: number;
    /** fan of tail feathers, 0 … 1 (birds) */
    fan: number;
  };
  horns: {
    kind: Horns;
    length: number;
    thickness: number;
  };
  wings: {
    kind: Wings;
    /** one wing, shoulder to tip (m) */
    span: number;
    /** wing depth front-to-back, relative to span */
    chord: number;
    /** wyvern body plan: the wings are the front legs (walks on its wing-wrists, membrane folds) */
    walk: boolean;
  };
  /** swimmers: fin sizes (m) and the tail fin */
  fins: {
    dorsal: number;
    pectoral: number;
    pelvic: number;
    anal: number;
    /** vertical (fish, shark) or horizontal flukes (dolphin, whale) */
    tail: 'vertical' | 'flukes';
    tailSize: number;
    /** 0 = smooth paddles … 1 = jagged fin rays */
    spiny: number;
  };
  /** riding gear: generated as shells over the body, so it fits any animal */
  tack: {
    saddle: boolean;
    bridle: boolean;
    blanket: boolean;
    barding: Barding;
    leather: string;
    cloth: string;
    metal: string;
  };
  coat: {
    base: string;
    belly: string;
    /** 0..1 how far up the sides the belly colour reaches */
    countershade: number;
    pattern: Pattern;
    patternColor: string;
    patternScale: number;
    /** 0..1 coverage */
    patternAmount: number;
    /** mane colour ('' = coat) */
    mane: string;
    /** tail colour ('' = coat) */
    tail: string;
    /** muzzle / chin colour, or '' to use the coat */
    muzzle: string;
    nose: string;
    hoof: string;
    horn: string;
    /** beak colour */
    beak: string;
    /** wing membrane / feather colour ('' = coat) */
    wing: string;
    /** dorsal spine colour ('' = horn colour) */
    spine: string;
    earInner: string;
    /** eye patch colour (panda, raccoon), '' = none */
    eyePatch: string;
    /** ear-tip / tail-tip colours, '' = none */
    earTip: string;
    tailTip: string;
    /** 0..1 white socks height */
    socks: number;
    sockColor: string;
    /** white face stripe */
    blaze: boolean;
    /** leg feathering colour ('' = sock colour) */
    feather: string;
    /** comb / crest / wattle colour */
    crest: string;
    /** fin colour ('' = coat) */
    fin: string;
    /** bioluminescence colour ('' = none): baked into an emissive texture */
    glow: string;
    /** photophore spots along the flanks, a glowing lateral line, glowing fin edges */
    glowPattern: 'spots' | 'lines' | 'both';
    /** 0 … 1 how much glows */
    glowAmount: number;
    /** wool / fluff lumps, 0..1 */
    wool: number;
    /** per-facet brightness jitter, 0..1 (hand-made low-poly look) */
    jitter: number;
  };
  mesh: {
    /** decimation target for the body */
    tris: number;
    shading: 'flat' | 'smooth';
    /**
     * 'auto' = decimate + clean-up at low budgets (keeps the silhouette), even remesh above ~2.5k;
     * 'remesh' = always even, joint-aware triangles; 'decimate' = raw quadric decimation
     */
    topology: 'auto' | 'remesh' | 'decimate';
    /** baked colour texture size (0 = per-facet vertex colours instead) */
    texture: number;
    /** sculpt sampling resolution (cells along the longest axis) */
    resolution: number;
  };
}

export const RECIPE_VERSION = 1;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeRecipe(base: AnimalRecipe, patch: DeepPartial<AnimalRecipe>): AnimalRecipe {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...(out[k] as object), ...v };
    else if (v !== undefined) out[k] = v;
  }
  return out as unknown as AnimalRecipe;
}

/** The reference animal: a medium, shepherd-ish dog. Every species is a patch on top. */
export const BASE: AnimalRecipe = {
  name: 'Rex',
  species: 'dog',
  seed: 1,
  plan: 'quadruped',
  sex: 'male',
  scale: 1,
  body: { length: 0.5, chestDepth: 0.27, chestWidth: 0.115, rumpWidth: 0.1, waist: 0.72, belly: 0, shoulders: 1, haunch: 1, hump: 0, humps: 1, spines: 0, spineCount: 14, arch: 0.01, sharp: 0 },
  legs: { front: 0.36, hind: 0.4, thickness: 0.048, stance: 'digitigrade', foot: 'paw', footSize: 1, feathering: 0 },
  neck: { length: 0.2, thickness: 0.07, angle: 45, mane: 'none', maneSize: 1 },
  head: { size: 0.075, muzzleLength: 0.11, muzzleWidth: 0.04, muzzleDepth: 0.04, muzzleTaper: 0.72, muzzleSquare: 0, muzzleFlat: 0, muzzleBulb: 0, muzzleBridge: 0, muzzleDrop: 0, stop: 0.5, dome: 0, headWidth: 1, flews: 0, pitch: 12, cheeks: 1, brow: 1, nose: 'pad', noseSize: 1, trunk: 0, tusks: 0, tuskCurl: 1, teeth: 0, teethCount: 4, jaw: 1, lure: 0, beakHook: 0.6, crest: 0 },
  eyes: { size: 0.013, angle: 32, color: '#9a6a2c', pupil: 'round', glow: false, style: 'socket', lids: 0.3, count: 2, anger: 0 },
  ears: { length: 0.12, width: 0.065, tip: 0.8, spread: 22, tilt: 8, droop: 0, side: 0.35, fold: 0 },
  tail: { length: 0.38, thickness: 0.03, brush: 1.45, lift: -55, curl: 25, tuft: 0, spikes: 0, fan: 0 },
  horns: { kind: 'none', length: 0.2, thickness: 0.03 },
  wings: { kind: 'none', span: 0.6, chord: 0.55, walk: false },
  fins: { dorsal: 0, pectoral: 0, pelvic: 0, anal: 0, tail: 'vertical', tailSize: 0, spiny: 0 },
  tack: { saddle: false, bridle: false, blanket: false, barding: 'none', leather: '#5a3a24', cloth: '#7a2630', metal: '#b9bcc4' },
  coat: {
    base: '#b9814a',
    belly: '#e2c49a',
    countershade: 0.45,
    pattern: 'saddle',
    patternColor: '#2a221c',
    patternScale: 1,
    patternAmount: 0.6,
    mane: '',
    tail: '',
    muzzle: '',
    nose: '#1d1716',
    hoof: '#3a3330',
    horn: '#d8c9a8',
    beak: '#e0b13a',
    wing: '',
    spine: '',
    earInner: '#8e5d3a',
    eyePatch: '',
    earTip: '',
    tailTip: '',
    socks: 0,
    sockColor: '#f1ece2',
    blaze: false,
    feather: '',
    crest: '#d63a2a',
    fin: '',
    glow: '',
    glowPattern: 'spots',
    glowAmount: 0.5,
    wool: 0,
    jitter: 0.35,
  },
  mesh: { tris: 1200, shading: 'flat', topology: 'auto', texture: 1024, resolution: 150 },
};
