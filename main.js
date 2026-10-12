// The browser window is treated as a real window into a box. The viewer's eye
// position (from the webcam, or the pointer when there is no webcam) drives an
// off-axis projection, so the box and the 77 inside it keep their place behind
// the glass while the perspective shifts with the head.
//
// World units: the window is H units tall and sits on the z = 0 plane, the box
// recedes along -Z, the viewer is on +Z.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

const MP_VERSION = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const CREAM = 0xf0e8d6;
const SHADE = 0x77777a;

const H = 20;          // window height in world units
const DEPTH = 30;      // how far the box recedes
const CELL = H / 8;    // grid spacing
let W = H;             // window width, set on resize

const CM_PER_CSS_PX = 2.54 / 96;
const REST_CM = 60;        // assumed viewing distance without a webcam
const IPD_CM = 6.3;        // average distance between pupils
const CAM_HFOV = 60 * Math.PI / 180;  // typical laptop webcam
const GAIN = 1.3;          // exaggerates sideways head movement a little

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer / scene ----------

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 45, 135);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(8, 16, 30);
scene.add(key);

// Never rotated and never given a normal projection: see updateCamera().
const camera = new THREE.PerspectiveCamera();

// ---------- the box ----------

const gridMaterial = new THREE.LineBasicMaterial({ color: CREAM, transparent: true, opacity: 0.7 });
let grid = null;

function buildGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
  const p = [];
  const hw = W / 2, hh = H / 2;
  const line = (a, b) => p.push(...a, ...b);
  // Offsets symmetric about the centre, always including the wall itself.
  const steps = (half) => {
    const out = [-half, half];
    for (let v = 0; v < half; v += CELL) { out.push(v); if (v) out.push(-v); }
    return out;
  };
  const xs = steps(hw), ys = steps(hh);
  const zs = [];
  for (let z = 0; z > -DEPTH; z -= CELL) zs.push(z);
  zs.push(-DEPTH);

  for (const x of xs) {
    line([x, -hh, 0], [x, -hh, -DEPTH]);       // floor
    line([x, hh, 0], [x, hh, -DEPTH]);         // ceiling
    line([x, -hh, -DEPTH], [x, hh, -DEPTH]);   // back wall
  }
  for (const y of ys) {
    line([-hw, y, 0], [-hw, y, -DEPTH]);       // left wall
    line([hw, y, 0], [hw, y, -DEPTH]);         // right wall
    line([-hw, y, -DEPTH], [hw, y, -DEPTH]);   // back wall
  }
  for (const z of zs) {                        // rings around the box
    line([-hw, -hh, z], [hw, -hh, z]);
    line([-hw, hh, z], [hw, hh, z]);
    line([-hw, -hh, z], [-hw, hh, z]);
    line([hw, -hh, z], [hw, hh, z]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  grid = new THREE.LineSegments(geometry, gridMaterial);
  scene.add(grid);
}

// ---------- the 77 ----------

// seventyseven.svg is the footer mark: two nested sevens. Each is extruded on
// its own plane so they slide against each other as the head moves.
const LOGO_DEPTH = 11;  // extrusion, in SVG units
const SEVEN_Z = { 'seven-outer': 8, 'seven-inner': -70 };
const LOGO_Z = -10;

const logo = new THREE.Group();
logo.position.z = LOGO_Z;  // held still: any sway would break the head-on alignment
const logoSize = new THREE.Vector2(1, 1);
scene.add(logo);

async function buildLogo() {
  const svg = new SVGLoader().parse(await (await fetch('seventyseven.svg')).text());
  // Extrusions come with two groups: the caps, then the sides.
  const materials = [
    new THREE.MeshStandardMaterial({ color: CREAM, metalness: 0.15, roughness: 0.38, fog: false }),
    new THREE.MeshStandardMaterial({ color: SHADE, metalness: 0.4, roughness: 0.4, fog: false }),
  ];
  const bounds = new THREE.Box3();
  for (const path of svg.paths) {
    const geometry = new THREE.ExtrudeGeometry(SVGLoader.createShapes(path), {
      depth: LOGO_DEPTH, bevelEnabled: false,
    });
    geometry.rotateX(Math.PI);  // SVG y runs downward
    const z = SEVEN_Z[path.userData.node.getAttribute('class')];
    geometry.translate(0, 0, LOGO_DEPTH / 2 + z);
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
    const seven = new THREE.Mesh(geometry, materials);
    seven.userData.z = z;
    logo.add(seven);
  }
  const mid = bounds.getCenter(new THREE.Vector3());
  for (const mesh of logo.children) mesh.geometry.translate(-mid.x, -mid.y, 0);
  logoSize.set(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
  fitLogo();
}

function fitLogo() {
  const fit = Math.min(W * 0.6 / logoSize.x, H * 0.5 / logoSize.y);
  logo.scale.setScalar(fit);
  // Enlarge whatever sits further back so that, seen straight on from the
  // resting distance, every seven lands exactly where the flat mark has it.
  const eyeToFront = restZ - (LOGO_Z + Math.max(...Object.values(SEVEN_Z)) * fit);
  for (const seven of logo.children) {
    const k = (restZ - (LOGO_Z + seven.userData.z * fit)) / eyeToFront;
    seven.scale.set(k, k, 1);
  }
}

// ---------- layout ----------

let unitsPerCm = 1;
let restZ = 50;

function resize() {
  const w = innerWidth, h = innerHeight;
  if (!w || !h) return;  // a hidden tab reports no size; wait for the real one
  renderer.setSize(w, h, false);
  W = H * w / h;
  // Rough physical size of the window, so head movement in centimetres lands
  // at about the right scale inside the box.
  unitsPerCm = H / (h * CM_PER_CSS_PX);
  restZ = REST_CM * unitsPerCm;
  buildGrid();
  fitLogo();
}
addEventListener('resize', resize);

// ---------- eye position ----------

const eye = new THREE.Vector3(0, 0, 50);
const target = new THREE.Vector3(0, 0, 50);

// The window is the rectangle |x| <= W/2, |y| <= H/2 at z = 0. The frustum is
// the pyramid from the eye through that rectangle, which is generally skewed.
function updateCamera() {
  const near = 0.5, far = 500;
  const k = near / eye.z;
  camera.projectionMatrix.makePerspective(
    (-W / 2 - eye.x) * k, (W / 2 - eye.x) * k,
    (H / 2 - eye.y) * k, (-H / 2 - eye.y) * k,
    near, far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.position.copy(eye);
}

// A soft dead zone: nearly flat within about `slack` of zero, then a straight
// line that trails the input by `slack`.
const CENTRE_SLACK = 3;     // world units, sideways and up/down
const DISTANCE_SLACK = 10;  // world units, towards and away from the screen
const soften = (v, slack) => v - slack * Math.tanh(v / slack);

// Pointer fallback: -1..1 across the window. A mouse steers just by moving; a
// finger steers by tapping or dragging on the scene.
const pointer = { x: 0, y: 0, moved: false };
function steer(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -((e.clientY / innerHeight) * 2 - 1);
  pointer.moved = true;
}
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.target === canvas) steer(e); });
canvas.addEventListener('pointerdown', steer);

// ---------- head tracking ----------

// One Euro filter: heavy smoothing while still, light smoothing while moving.
class OneEuro {
  constructor(minCutoff, beta) { this.minCutoff = minCutoff; this.beta = beta; this.reset(); }
  reset() { this.t = null; this.x = 0; this.dx = 0; }
  static alpha(dt, cutoff) { return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt)); }
  filter(x, t) {
    if (this.t === null) { this.t = t; this.x = x; return x; }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    this.dx += OneEuro.alpha(dt, 1) * ((x - this.x) / dt - this.dx);
    this.x += OneEuro.alpha(dt, this.minCutoff + this.beta * Math.abs(this.dx)) * (x - this.x);
    return this.x;
  }
}

const video = document.getElementById('cam');
const statusEl = document.getElementById('status');
const camButton = document.getElementById('camToggle');
const recenterButton = document.getElementById('recenter');
const recenterTip = recenterButton.parentElement;  // hidden unless a face is being tracked
const helpEl = document.getElementById('camHelp');
const helpReload = document.getElementById('camHelpReload');

const filters = { x: new OneEuro(1.0, 0.08), y: new OneEuro(1.0, 0.08), z: new OneEuro(0.4, 0.03) };
const head = { x: 0, y: 0, z: REST_CM, seenAt: -Infinity };  // cm, relative to the webcam
const centre = { x: 0, y: 0 };                                // where "straight on" is
let landmarker = null;
let stream = null;
let camOn = false;
let lastVideoTime = -1;

function setStatus(mode, text) {
  if (statusEl.dataset.mode === mode && statusEl.lastChild.textContent === text) return;
  statusEl.dataset.mode = mode;
  statusEl.lastChild.textContent = text;
  statusEl.hidden = !text;
}

// What to tell someone whose click on the camera did not work.
const CAMERA_HELP = {
  blocked: {
    title: 'Camera access is blocked',
    body: 'Head tracking needs the camera, and this site is not allowed to use it.',
    steps: [
      'Open the site settings from the icon at the left of the address bar (on iPhone, the page menu, then Website Settings).',
      'Set Camera to Allow.',
      'Reload this page.',
    ],
    note: 'Still blocked? Check that your browser itself is allowed to use the camera in your system privacy settings.',
  },
  busy: {
    title: 'The camera could not be started',
    body: 'Something else may be using it.',
    steps: ['Close other apps or tabs that use the camera, such as a video call.', 'Try the camera switch again.'],
  },
  model: {
    title: 'Head tracking could not load',
    body: 'The face tracking model is downloaded the first time the camera is used, and that download failed.',
    steps: ['Check your internet connection.', 'Try the camera switch again.'],
  },
};

function showCameraHelp(kind) {
  const help = CAMERA_HELP[kind];
  helpEl.querySelector('h2').textContent = help.title;
  helpEl.querySelector('p').textContent = help.body;
  helpEl.querySelector('ol').replaceChildren(...help.steps.map((step) => Object.assign(document.createElement('li'), { textContent: step })));
  const note = helpEl.querySelector('.help__note');
  note.textContent = help.note || '';
  note.hidden = !help.note;
  helpReload.hidden = kind !== 'blocked';
  helpEl.hidden = false;
}

// `asked` is true when the person clicked the switch, as opposed to the quiet
// attempt made on load; only then is a failure worth interrupting them for.
async function startCamera(asked) {
  camButton.disabled = true;
  helpEl.hidden = true;
  setStatus('pointer', 'Starting camera');
  let stage = 'camera';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
    });
    video.srcObject = stream;
    await video.play();
    if (!landmarker) {
      stage = 'model';
      setStatus('pointer', 'Loading face model');
      const { FaceLandmarker, FilesetResolver } = await import(MP_BUNDLE);
      const files = await FilesetResolver.forVisionTasks(MP_WASM);
      landmarker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    }
    for (const f of Object.values(filters)) f.reset();
    camOn = true;
    video.hidden = false;
    camButton.setAttribute('aria-checked', 'true');
  } catch (err) {
    console.warn('Head tracking unavailable:', err);
    stopCamera();
    setStatus('pointer', '');
    const name = err && err.name;
    if (stage === 'camera' && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
      camButton.hidden = true;  // no camera after all
    } else if (asked) {
      showCameraHelp(stage === 'model' ? 'model' : name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'busy');
    }
  }
  camButton.disabled = false;
}

function stopCamera() {
  camOn = false;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
  video.hidden = true;
  head.seenAt = -Infinity;
  camButton.setAttribute('aria-checked', 'false');
  recenterTip.hidden = true;
}

camButton.addEventListener('click', () => {
  if (camOn) { stopCamera(); setStatus('pointer', ''); } else startCamera(true);
});
recenterButton.addEventListener('click', () => { centre.x = head.x; centre.y = head.y; });
helpEl.querySelector('.help__close').addEventListener('click', () => { helpEl.hidden = true; });
helpReload.addEventListener('click', () => location.reload());

// Reads the head position off the two iris centres: their midpoint gives the
// direction from the webcam, their spacing in the image gives the distance.
function track(now) {
  if (!camOn || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const face = landmarker.detectForVideo(video, now * 1000).faceLandmarks[0];
  if (!face) return;

  const vw = video.videoWidth, vh = video.videoHeight;
  const a = face[468], b = face[473];
  const spacing = Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
  if (spacing < 1) return;
  const focal = (vw / 2) / Math.tan(CAM_HFOV / 2);
  const z = focal * IPD_CM / spacing;
  // The webcam looks back at the viewer, so image-left is the viewer's right.
  const x = -((a.x + b.x) / 2 * vw - vw / 2) * z / focal;
  const y = -((a.y + b.y) / 2 * vh - vh / 2) * z / focal;

  head.x = filters.x.filter(x, now);
  head.y = filters.y.filter(y, now);
  head.z = filters.z.filter(z, now);
  head.seenAt = now;
}

// ---------- loop ----------

let last = performance.now() / 1000;

function frame(ms) {
  const now = ms / 1000;
  const dt = Math.min(0.1, now - last);
  last = now;

  track(now);
  const tracking = camOn && now - head.seenAt < 0.6;

  if (tracking) {
    target.set(
      (head.x - centre.x) * GAIN * unitsPerCm,
      (head.y - centre.y) * GAIN * unitsPerCm,
      head.z * unitsPerCm,
    );
    setStatus('head', 'Head tracking');
    recenterTip.hidden = false;
  } else {
    let x = pointer.x, y = pointer.y;
    if (!pointer.moved && !reducedMotion) {  // show the effect before anyone touches anything
      x = Math.sin(now * 0.5) * 0.45;
      y = Math.sin(now * 0.37) * 0.25;
    }
    // A tall, narrow window still gets a full sideways sweep.
    target.set(x * Math.max(W, H) * 0.5, y * H * 0.5, restZ);
    if (camOn) { setStatus('pointer', 'Looking for a face'); recenterTip.hidden = true; }
  }
  // Flatten the response near dead centre so the aligned view is easy to find
  // and hold; further out the eye follows one-to-one again.
  const off = Math.hypot(target.x, target.y);
  if (off > 0) {
    const k = soften(off, CENTRE_SLACK) / off;
    target.x *= k;
    target.y *= k;
  }
  target.z = restZ + soften(target.z - restZ, DISTANCE_SLACK);
  target.x = THREE.MathUtils.clamp(target.x, -W * 2, W * 2);
  target.y = THREE.MathUtils.clamp(target.y, -H * 2, H * 2);
  target.z = THREE.MathUtils.clamp(target.z, H * 0.8, H * 8);
  // The head is already filtered; this only softens pointer input and the
  // hand-over between the two modes.
  eye.lerp(target, 1 - Math.exp(-dt * (tracking ? 30 : 7)));
  updateCamera();


  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
buildLogo();
requestAnimationFrame(frame);

// The camera switch only exists when there is a camera. Use it straight away
// when there is one; otherwise stay on the pointer.
async function hasCamera() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).some((d) => d.kind === 'videoinput');
  } catch {
    return false;  // no camera API at all, e.g. an insecure page
  }
}
hasCamera().then((found) => {
  camButton.hidden = !found;
  if (found) startCamera(false);
});
navigator.mediaDevices?.addEventListener('devicechange', async () => {
  if (!camOn) camButton.hidden = !(await hasCamera());
});
