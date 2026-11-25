import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BASE, mergeRecipe, type AnimalRecipe } from '../core/recipe';
import { blendRecipes, Category, categoryOf, presetRecipe, randomRecipe, SPECIES, vary } from '../core/species';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────────────────────────────────────────────────────── state ──
interface State {
  own: AnimalRecipe;
  hybrid: string;
  blend: number;
}
let state: State = loadFromHash() ?? { own: presetRecipe('dog', 1), hybrid: '', blend: 0 };
let clipName = 'Idle';
const toggles = { skeleton: false, wire: false, turn: true };
let lastGlb: Uint8Array | null = null;

function effective(): AnimalRecipe {
  if (!state.hybrid || state.blend <= 0) return state.own;
  return blendRecipes(state.own, vary(presetRecipe(state.hybrid, state.own.seed)), state.blend);
}

// ───────────────────────────────────────────────────────────── scene ──
const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
scene.add(new THREE.HemisphereLight(0xe8e4ff, 0x3a2f45, 1.0));
const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
sun.position.set(2.5, 5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);
const rim = new THREE.DirectionalLight(0x9d8cff, 1.0);
rim.position.set(-3, 2.5, -3);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x241f33, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 80, 0x3d3556, 0x2e2843);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.6;
grid.position.y = -0.001;
scene.add(grid);

const stage = new THREE.Group();
scene.add(stage);
let actor: { root: THREE.Object3D; mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[]; meshes: THREE.Mesh[]; helper: THREE.SkeletonHelper } | null = null;
const loader = new GLTFLoader();
const clock = new THREE.Clock();
let framed = '';

function frameCamera(root: THREE.Object3D, force: boolean) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const key = `${state.own.species}:${Math.round(size.length() * 20)}`;
  if (!force && key === framed) return;
  framed = key;
  const d = Math.max(size.x, size.y, size.z) * 1.9 + 0.3;
  controls.target.copy(c);
  camera.position.set(c.x + d * 0.75, c.y + d * 0.35, c.z + d * 0.75);
  camera.near = d / 100;
  camera.far = d * 50;
  camera.updateProjectionMatrix();
  const s = Math.max(size.x, size.z) * 1.2 + 0.5;
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = cam.bottom = -s;
  cam.right = cam.top = s;
  cam.updateProjectionMatrix();
  sun.position.set(c.x + s * 1.5, s * 3, c.z + s * 2);
  sun.target.position.copy(c);
}

async function show(glb: Uint8Array, clips: string[]) {
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const gltf: GLTF = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  if (actor) {
    stage.remove(actor.root);
    scene.remove(actor.helper);
  }
  const root = gltf.scene;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      meshes.push(m);
    }
  });
  const helper = new THREE.SkeletonHelper(root);
  (helper.material as THREE.LineBasicMaterial).depthTest = false;
  helper.renderOrder = 9;
  scene.add(helper);
  stage.add(root);
  actor = { root, mixer: new THREE.AnimationMixer(root), clips: gltf.animations, meshes, helper };
  frameCamera(root, false);
  renderClips(clips);
  playClip(clips.includes(clipName) ? clipName : 'Idle');
  applyToggles();
}

function playClip(name: string) {
  clipName = name;
  if (actor) {
    actor.mixer.stopAllAction();
    const c = actor.clips.find((x) => x.name === name) ?? actor.clips[0];
    if (c) actor.mixer.clipAction(c).reset().play();
  }
  document.querySelectorAll<HTMLButtonElement>('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
}

function renderClips(names: string[]) {
  const el = $('clips');
  if (el.dataset.names === names.join()) return;
  el.dataset.names = names.join();
  const icon: Record<string, string> = { Idle: '🧘', Walk: '🚶', Trot: '🐾', Gallop: '💨', Eat: '🌿', Fly: '🪽' };
  el.innerHTML = names.map((n) => `<button data-clip="${n}">${icon[n] ?? '▶'} ${n}</button>`).join('');
  el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => playClip(b.dataset.clip!)));
}

function applyToggles() {
  if (actor) {
    actor.helper.visible = toggles.skeleton;
    for (const m of actor.meshes) (m.material as THREE.MeshStandardMaterial).wireframe = toggles.wire;
  }
  document.querySelectorAll<HTMLButtonElement>('#toggles button').forEach((b) => b.classList.toggle('on', toggles[b.dataset.t as keyof typeof toggles]));
}
document.querySelectorAll<HTMLButtonElement>('#toggles button').forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.t as keyof typeof toggles;
    toggles[k] = !toggles[k];
    applyToggles();
  };
});

// ───────────────────────────────────────────────────────── generation ──
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
let pending = false;
let queued = false;
worker.onmessage = async (e) => {
  const { id, glb, stats, clips, error } = e.data;
  pending = false;
  $('busy').classList.remove('show');
  if (error) {
    console.error(error);
    toast('😵 That one broke the sculptor (see console)');
  } else if (id === reqId) {
    lastGlb = glb;
    await show(glb, clips);
    const s = stats;
    $('stats').textContent = `${s.tris.toLocaleString()} tris · ${effective().mesh.texture ? `${effective().mesh.texture}² texture · ` : ''}${s.height.toFixed(2)} m tall · ${s.length.toFixed(2)} m long · ${Math.round(s.ms)} ms`;
  }
  if (queued) {
    queued = false;
    rebuild();
  }
};

function rebuild() {
  if (pending) {
    queued = true;
    return;
  }
  pending = true;
  reqId++;
  $('busy').classList.add('show');
  worker.postMessage({ id: reqId, recipe: effective() });
  writeHash();
}
let debounce = 0;
function rebuildSoon() {
  clearTimeout(debounce);
  debounce = window.setTimeout(rebuild, 120);
}

// ─────────────────────────────────────────────────────────── controls ──
type Kind = 'len' | 'num' | 'deg' | 'color' | 'ocolor' | 'select' | 'nselect' | 'bool';
interface Ctl {
  path: string;
  label: string;
  kind: Kind;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** slider range base when the species has none (e.g. a dog's trunk) */
  fallback?: (rc: AnimalRecipe) => number;
}
const L = (path: string, label: string, fallback?: (rc: AnimalRecipe) => number): Ctl => ({ path, label, kind: 'len', fallback });
const B = (path: string, label: string): Ctl => ({ path, label, kind: 'bool' });
const N = (path: string, label: string, min: number, max: number, step = 0.01): Ctl => ({ path, label, kind: 'num', min, max, step });
const A = (path: string, label: string, min: number, max: number): Ctl => ({ path, label, kind: 'deg', min, max, step: 1 });
const C = (path: string, label: string): Ctl => ({ path, label, kind: 'color' });
const OC = (path: string, label: string): Ctl => ({ path, label, kind: 'ocolor' });
const S = (path: string, label: string, options: string[]): Ctl => ({ path, label, kind: 'select', options });

const SECTIONS: { title: string; open?: boolean; ctls: Ctl[] }[] = [
  {
    title: 'Body', open: true,
    ctls: [N('scale', 'Scale', 0.25, 3), L('body.length', 'Length'), L('body.chestDepth', 'Chest depth'), L('body.chestWidth', 'Chest width'), L('body.rumpWidth', 'Rump width'),
      N('body.waist', 'Waist', 0.4, 1.25), N('body.belly', 'Belly', 0, 1), N('body.shoulders', 'Shoulders', 0.5, 1.8), N('body.haunch', 'Haunches', 0.5, 1.8), N('body.hump', 'Hump', 0, 1), N('body.humps', 'Humps', 1, 2, 1), N('body.arch', 'Back arch', -0.06, 0.1, 0.005), L('body.spines', 'Spines', (r) => r.body.chestDepth * 0.4), N('body.spineCount', 'Spine count', 4, 40, 1)],
  },
  { title: 'Legs', ctls: [L('legs.front', 'Front'), L('legs.hind', 'Hind'), L('legs.thickness', 'Thickness'), S('legs.stance', 'Stance', ['digitigrade', 'unguligrade', 'plantigrade', 'sprawling']), S('legs.foot', 'Feet', ['paw', 'hoof', 'cloven']), N('legs.footSize', 'Foot size', 0.5, 2), N('legs.feathering', 'Feathering', 0, 1)] },
  { title: 'Neck', ctls: [L('neck.length', 'Length'), L('neck.thickness', 'Thickness'), A('neck.angle', 'Angle', -15, 85), S('neck.mane', 'Mane', ['none', 'crest', 'ruff']), N('neck.maneSize', 'Mane size', 0.3, 2)] },
  {
    title: 'Head',
    ctls: [L('head.size', 'Skull'), L('head.muzzleLength', 'Muzzle length', (r) => r.head.size * 2.4), L('head.muzzleWidth', 'Muzzle width'), L('head.muzzleDepth', 'Muzzle depth'), N('head.muzzleTaper', 'Taper', 0.3, 1.3), N('head.muzzleSquare', 'Tip squareness', 0, 1), N('head.muzzleFlat', 'Tip flatness', 0, 1), N('head.muzzleBulb', 'Tip bulb', 0, 1), N('head.muzzleBridge', 'Nose bridge', -1, 1), N('head.muzzleDrop', 'Muzzle droop', -1, 1), N('head.stop', 'Stop (forehead)', 0, 1), N('head.dome', 'Skull dome', -1, 1), N('head.headWidth', 'Head width', 0.6, 1.6), N('head.flews', 'Flews (lips)', 0, 1),
      A('head.pitch', 'Head angle', -15, 80), N('head.cheeks', 'Cheeks', 0.5, 1.8), N('head.brow', 'Brow', 0, 2), S('head.nose', 'Nose', ['pad', 'snout', 'broad', 'beak']), N('head.noseSize', 'Nose size', 0.4, 2), L('head.trunk', 'Trunk', (r) => r.head.size * 4), L('head.tusks', 'Tusks', (r) => r.head.size * 2), N('head.tuskCurl', 'Tusk curl', 0, 3), N('head.teeth', 'Fangs', 0, 1)],
  },
  { title: 'Eyes', ctls: [L('eyes.size', 'Size'), A('eyes.angle', 'Facing', 0, 90), C('eyes.color', 'Iris'), S('eyes.style', 'Style', ['ball', 'socket', 'painted']), N('eyes.lids', 'Lids (calm)', 0, 1), S('eyes.pupil', 'Pupil', ['round', 'slit', 'bar']), B('eyes.glow', 'Glow')] },
  { title: 'Ears', ctls: [L('ears.length', 'Length'), L('ears.width', 'Width'), N('ears.tip', 'Pointy', 0, 1), A('ears.spread', 'Spread', -20, 100), A('ears.tilt', 'Tilt back', -40, 60), N('ears.droop', 'Floppy', 0, 1), N('ears.side', 'On the side', 0, 1), N('ears.fold', 'Tip fold', 0, 1)] },
  { title: 'Tail', ctls: [L('tail.length', 'Length'), L('tail.thickness', 'Thickness'), N('tail.brush', 'Fluff', 0.6, 3), A('tail.lift', 'Lift', -90, 90), A('tail.curl', 'Curl', -180, 360), N('tail.tuft', 'Tuft', 0, 2), N('tail.spikes', 'Tail spikes', 0, 1)] },
  { title: 'Horns', ctls: [S('horns.kind', 'Kind', ['none', 'cow', 'ram', 'goat', 'antlers', 'unicorn', 'rhino', 'dragon']), L('horns.length', 'Length'), L('horns.thickness', 'Thickness')] },
  { title: 'Wings', ctls: [S('wings.kind', 'Kind', ['none', 'membrane', 'feathered']), L('wings.span', 'Span', (r) => r.body.length * 1.6), N('wings.chord', 'Depth', 0.3, 1), B('wings.walk', 'Wings are front legs (wyvern)')] },
  {
    title: 'Coat',
    ctls: [C('coat.base', 'Base'), C('coat.belly', 'Belly'), N('coat.countershade', 'Countershade', 0, 1), S('coat.pattern', 'Pattern', ['solid', 'spots', 'rosettes', 'stripes', 'patches', 'saddle', 'points', 'tabby', 'scales', 'split']),
      C('coat.patternColor', 'Pattern col.'), N('coat.patternAmount', 'Amount', 0, 1), N('coat.patternScale', 'Pattern size', 0.3, 3), OC('coat.mane', 'Mane'), OC('coat.tail', 'Tail'), OC('coat.muzzle', 'Muzzle'),
      OC('coat.earTip', 'Ear tips'), OC('coat.tailTip', 'Tail tip'), C('coat.earInner', 'Inner ear'), C('coat.nose', 'Nose'), C('coat.hoof', 'Hooves'), C('coat.horn', 'Horns'), C('coat.beak', 'Beak'), OC('coat.wing', 'Wings'), OC('coat.spine', 'Spines'), OC('coat.eyePatch', 'Eye patches'),
      N('coat.socks', 'Socks', 0, 1), C('coat.sockColor', 'Sock colour'), OC('coat.feather', 'Feathering'), { path: 'coat.blaze', label: 'Blaze', kind: 'bool' }, N('coat.wool', 'Wool', 0, 1), N('coat.jitter', 'Facet jitter', 0, 1)],
  },
  {
    title: 'Tack (mounts)',
    ctls: [B('tack.saddle', 'Saddle'), B('tack.bridle', 'Bridle'), B('tack.blanket', 'Blanket'), S('tack.barding', 'Barding', ['none', 'leather', 'plate']), C('tack.leather', 'Leather'), C('tack.cloth', 'Cloth'), C('tack.metal', 'Metal')],
  },
  {
    title: 'Mesh & texture',
    ctls: [
      { path: 'mesh.tris', label: 'LOD', kind: 'nselect', options: ['300', '600', '1200', '2000', '4000'] },
      N('mesh.tris', 'Triangles', 200, 8000, 50),
      S('mesh.topology', 'Topology', ['auto', 'remesh', 'decimate']),
      S('mesh.shading', 'Shading', ['flat', 'smooth']),
      { path: 'mesh.texture', label: 'Texture', kind: 'nselect', options: ['0', '512', '1024', '2048'] },
      N('mesh.resolution', 'Sculpt res.', 80, 260, 10),
    ],
  },
];

const get = (o: unknown, path: string): unknown => path.split('.').reduce((a: any, k) => a?.[k], o); // eslint-disable-line @typescript-eslint/no-explicit-any
function set(o: unknown, path: string, v: unknown) {
  const ks = path.split('.');
  const last = ks.pop()!;
  const tgt = ks.reduce((a: any, k) => a[k], o); // eslint-disable-line @typescript-eslint/no-explicit-any
  tgt[last] = v;
}
const fmtLen = (m: number) => (m < 1 ? `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm` : `${m.toFixed(2)} m`);

function renderControls() {
  const host = $('controls');
  const openNow = new Set([...host.querySelectorAll('details[open]')].map((d) => d.getAttribute('data-title')));
  const first = !host.children.length;
  const preset = presetRecipe(state.own.species, 1);
  host.innerHTML = '';
  for (const sec of SECTIONS) {
    const det = document.createElement('details');
    det.dataset.title = sec.title;
    if (first ? sec.open : openNow.has(sec.title)) det.open = true;
    det.innerHTML = `<summary>${sec.title}</summary><div></div>`;
    const body = det.querySelector('div')!;
    for (const c of sec.ctls) {
      const row = document.createElement('div');
      row.className = 'row';
      const v = get(state.own, c.path);
      const lab = `<label>${c.label}</label>`;
      if (c.kind === 'len' || c.kind === 'num' || c.kind === 'deg') {
        let min = c.min ?? 0;
        let max = c.max ?? 1;
        let step = c.step ?? 0.01;
        if (c.kind === 'len') {
          const base = Math.max(Number(get(preset, c.path)) || 0, Number(v) || 0, c.path.startsWith('horns') ? state.own.head.size * 2.5 : 0.01, c.fallback?.(state.own) ?? 0);
          min = 0;
          max = base * 2.5;
          step = max / 400;
        }
        row.innerHTML = `${lab}<input type="range" min="${min}" max="${max}" step="${step}" value="${v}"><output></output>`;
        const inp = row.querySelector('input')!;
        const out = row.querySelector('output')!;
        const fmt = (x: number) => (c.kind === 'len' ? fmtLen(x) : c.kind === 'deg' ? `${Math.round(x)}°` : c.path === 'mesh.tris' || c.path === 'mesh.resolution' ? String(Math.round(x)) : x.toFixed(2));
        out.textContent = fmt(Number(v));
        inp.oninput = () => {
          set(state.own, c.path, Number(inp.value));
          out.textContent = fmt(Number(inp.value));
          rebuildSoon();
        };
      } else if (c.kind === 'color' || c.kind === 'ocolor') {
        const on = c.kind === 'color' || !!v;
        const shown = (v as string) || state.own.coat.base;
        row.innerHTML = `${lab}<div class="colors">${c.kind === 'ocolor' ? `<input type="checkbox" ${on ? 'checked' : ''} title="Use a separate colour">` : ''}<input type="color" value="${shown}" ${on ? '' : 'disabled'}></div><span></span>`;
        const col = row.querySelector<HTMLInputElement>('input[type=color]')!;
        const chk = row.querySelector<HTMLInputElement>('input[type=checkbox]');
        col.oninput = () => {
          set(state.own, c.path, col.value);
          rebuildSoon();
        };
        if (chk)
          chk.onchange = () => {
            col.disabled = !chk.checked;
            set(state.own, c.path, chk.checked ? col.value : '');
            rebuildSoon();
          };
      } else if (c.kind === 'nselect') {
        const label = (o: string) => (c.path === 'mesh.texture' ? (o === '0' ? 'none (facet colours)' : `${o}²`) : `${o} tris`);
        const cur = String(v);
        const opts = c.options!.includes(cur) ? c.options! : [cur, ...c.options!];
        row.innerHTML = `${lab}<select>${opts.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${c.options!.includes(o) ? label(o) : `custom (${o})`}</option>`).join('')}</select><span></span>`;
        const sel = row.querySelector('select')!;
        sel.onchange = () => {
          set(state.own, c.path, Number(sel.value));
          renderControls();
          rebuildSoon();
        };
      } else if (c.kind === 'select') {
        row.innerHTML = `${lab}<select>${c.options!.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select><span></span>`;
        const sel = row.querySelector('select')!;
        sel.onchange = () => {
          set(state.own, c.path, sel.value);
          if (c.path === 'horns.kind' && sel.value !== 'none' && state.own.horns.length < 0.01) state.own.horns.length = state.own.head.size * 2;
          if (c.path === 'wings.kind' && sel.value !== 'none' && state.own.wings.span < state.own.body.length * 0.5) state.own.wings.span = state.own.body.length * 1.6;
          rebuildSoon();
        };
      } else {
        row.innerHTML = `${lab}<input type="checkbox" ${v ? 'checked' : ''}><span></span>`;
        const chk = row.querySelector('input')!;
        chk.onchange = () => {
          set(state.own, c.path, chk.checked);
          rebuildSoon();
        };
      }
      body.appendChild(row);
    }
    host.appendChild(det);
  }
}

function renderBasics() {
  document.querySelectorAll<HTMLButtonElement>('#species .chip').forEach((b) => b.classList.toggle('on', b.dataset.s === state.own.species));
  $<HTMLInputElement>('in-name').value = state.own.name;
  $<HTMLInputElement>('in-seed').value = String(state.own.seed);
  document.querySelectorAll<HTMLButtonElement>('#in-sex button').forEach((b) => b.classList.toggle('on', b.dataset.sex === (state.own.sex ?? 'male')));
  $<HTMLSelectElement>('in-hybrid').value = state.hybrid;
  $<HTMLInputElement>('in-blend').value = String(state.blend);
  $('out-blend').textContent = `${Math.round(state.blend * 100)}%`;
}

function renderAll() {
  renderBasics();
  renderControls();
  rebuild();
}

function initUI() {
  renderSpecies();
}

let cat: Category = categoryOf(state.own.species);
function renderSpecies() {
  const tabs: [Category, string][] = [['real', '🌍 Real'], ['breeds', '🐾 Breeds'], ['fantasy', '🐉 Fantasy'], ['mount', '🏇 Mounts']];
  $('cats').innerHTML = tabs.map(([k, l]) => `<button data-c="${k}" class="${k === cat ? 'on' : ''}">${l}</button>`).join('');
  $('cats').querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    cat = b.dataset.c as Category;
    renderSpecies();
  }));
  $('species').innerHTML = Object.entries(SPECIES)
    .filter(([k]) => categoryOf(k) === cat)
    .map(([k, s]) => `<button class="chip ${k === state.own.species ? 'on' : ''}" data-s="${k}" title="${s.label}"><span class="em">${s.emoji}</span>${s.label}</button>`)
    .join('');
  document.querySelectorAll<HTMLButtonElement>('#species .chip').forEach((b) => {
    b.onclick = () => {
      state = { own: presetRecipe(b.dataset.s!, 1), hybrid: state.hybrid === b.dataset.s ? '' : state.hybrid, blend: state.blend };
      framed = '';
      renderAll();
    };
  });
}

function initControls() {
  $<HTMLSelectElement>('in-hybrid').innerHTML = `<option value="">— none —</option>` + Object.entries(SPECIES).map(([k, s]) => `<option value="${k}">${s.emoji} ${s.label}</option>`).join('');
  $<HTMLSelectElement>('in-hybrid').onchange = (e) => {
    state.hybrid = (e.target as HTMLSelectElement).value;
    if (state.hybrid && state.blend === 0) state.blend = 0.5;
    renderBasics();
    rebuild();
  };
  $<HTMLInputElement>('in-blend').oninput = (e) => {
    state.blend = Number((e.target as HTMLInputElement).value);
    $('out-blend').textContent = `${Math.round(state.blend * 100)}%`;
    rebuildSoon();
  };
  document.querySelectorAll<HTMLButtonElement>('#in-sex button').forEach((b) => {
    b.onclick = () => {
      state.own.sex = b.dataset.sex as 'male' | 'female';
      renderBasics();
      rebuild();
    };
  });
  $<HTMLInputElement>('in-name').oninput = (e) => {
    state.own.name = (e.target as HTMLInputElement).value;
    rebuildSoon();
  };
  $<HTMLInputElement>('in-seed').onchange = (e) => {
    const seed = Number((e.target as HTMLInputElement).value) || 1;
    state.own = { ...vary(presetRecipe(state.own.species, seed)), coat: state.own.coat, mesh: state.own.mesh, name: state.own.name };
    renderAll();
  };
  $('btn-seed').onclick = () => {
    const seed = Math.floor(Math.random() * 99999);
    state.own = { ...vary(presetRecipe(state.own.species, seed)), coat: state.own.coat, mesh: state.own.mesh, name: state.own.name };
    renderAll();
  };
  const surprise = () => {
    state = { own: randomRecipe(Math.floor(Math.random() * 1e9)), hybrid: '', blend: 0 };
    cat = categoryOf(state.own.species);
    renderSpecies();
    framed = '';
    renderAll();
  };
  $('btn-random').onclick = surprise;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') surprise();
  });
  $('btn-export').onclick = () => {
    if (!lastGlb) return;
    download(new Blob([lastGlb as BlobPart], { type: 'model/gltf-binary' }), `${slug()}.glb`);
    toast('📦 GLB exported: skinned, rigged, 5 clips');
  };
  $('btn-save').onclick = () => {
    download(new Blob([JSON.stringify({ badzoo: 1, ...state }, null, 2)], { type: 'application/json' }), `${slug()}.badzoo.json`);
    toast('💾 Recipe saved');
  };
  $<HTMLInputElement>('file-load').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      state = j.own ? { own: mergeRecipe(BASE, j.own), hybrid: j.hybrid ?? '', blend: j.blend ?? 0 } : { own: mergeRecipe(BASE, j), hybrid: '', blend: 0 };
      framed = '';
      renderAll();
      toast('📂 Recipe loaded');
    } catch {
      toast('😬 Not a BadZoo recipe');
    }
  };
  $('btn-share').onclick = async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('🔗 Link copied');
    } catch {
      toast('🔗 Link is in the address bar');
    }
  };
}

const slug = () => `${state.own.name || state.own.species}`.replace(/[^\w-]+/g, '_');
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
let toastT = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.classList.remove('show'), 2200);
}

function writeHash() {
  try {
    const s = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    history.replaceState(null, '', `#z=${s}`);
  } catch {
    /* ignore */
  }
}
function loadFromHash(): State | null {
  const m = location.hash.match(/#z=(.+)/);
  if (!m) return null;
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (s?.own?.body) return { ...s, own: mergeRecipe(BASE, s.own) };
  } catch {
    /* ignore */
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── loop ──
function resize() {
  const vp = $('viewport');
  const w = vp.clientWidth;
  const h = vp.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (actor) {
    actor.mixer.update(dt);
    if (toggles.turn) actor.root.rotation.y += dt * 0.35;
  }
  controls.update();
  renderer.render(scene, camera);
}

initUI();
initControls();
resize();
renderAll();
tick();
