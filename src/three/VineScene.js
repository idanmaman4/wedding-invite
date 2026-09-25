import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gsap } from 'gsap';
import leafUrl from '../assets/leaf.glb?url';
import rosesUrl from '../assets/roses.glb?url';

const PAGE_BG = 0xFDFAF7;
const GREEN_TINTS = [
  new THREE.Color(0x93b47e),
  new THREE.Color(0x6f8f5e),
  new THREE.Color(0x4e6b41),
];
// Far layers drift toward a pale grey-sage (multiplied over the vertex-color
// leaf, so it can only mute, never lighten) — reinforces the fog fade.
const FAR_LEAF_TINT = new THREE.Color(0xc4cdb8);
const LEAF_STEP_PX = 22;
// 8 real leaf archetypes (ovate, palmate-lobed, cordate, serrated oval,
// narrow-lanceolate, pinnate/fern-look, deeply-lobed, small rounded).
const LEAF_TYPE_NAMES = [
  'VineLeaf1_Ovate', 'VineLeaf2_Palmate', 'VineLeaf3_Cordate', 'VineLeaf4_RoseLeaflet',
  'VineLeaf5_Olive', 'VineLeaf6_Fern', 'VineLeaf7_Oak', 'VineLeaf8_Ivy',
];
const LEAF_NATURAL_H = {
  VineLeaf1_Ovate: 0.30, VineLeaf2_Palmate: 0.22, VineLeaf3_Cordate: 0.20, VineLeaf4_RoseLeaflet: 0.27,
  VineLeaf5_Olive: 0.34, VineLeaf6_Fern: 0.32, VineLeaf7_Oak: 0.28, VineLeaf8_Ivy: 0.15,
};
// Relative weight of each type — leaflet/ovate dominate (this is nominally a
// climbing rose), the rest are rarer accents for variety.
const LEAF_TYPE_WEIGHT = {
  VineLeaf1_Ovate: 3, VineLeaf4_RoseLeaflet: 3, VineLeaf3_Cordate: 1.4, VineLeaf2_Palmate: 1.2,
  VineLeaf8_Ivy: 1.2, VineLeaf7_Oak: 0.8, VineLeaf5_Olive: 0.8, VineLeaf6_Fern: 0.6,
};
const MIN_VIEWPORT_W = 360; // below this the vine is hidden — only truly tiny screens
const MAX_LAYERS = 7;       // camera far-plane / fog budget is sized for this

// ── Edge keep-out (single source of truth: curve floor, leaf check, rose
// clamp and the CSS mask in App.jsx all agree on EDGE_PAD_PX) ────────────────
const EDGE_PAD_PX = 10;        // hard keep-out from either viewport edge
const LEAF_OFFSET_MAX_PX = 10; // max perpendicular leaf-pivot offset used below
const TUBE_R_MAX_PX = 3;       // 2.3 * node bump, rounded up
const LEAF_SWAY_RAD = 12 * Math.PI / 180; // matches the ±12° sway clamp in animate()

// ── Crown (the dense anchor "bush" at each top corner) ───────────────────────
// Defined in PIXELS from where each cane emerges below the fixed nav — never
// as a u-fraction: a cane is 4.5–7k px long and its first ~600 px is an arch
// the nav hides, so u-based thresholds all landed on invisible tube.
const NAV_FALLBACK_H = 72;
const CROWN_R = [90, 190, 300];          // px from anchor (× crownScale on phones)
const CROWN_DENSITY = [4.5, 2.8, 1.6];   // leaf-step divisor per radius

// Desktop/tablet/phone all get the vine, scaled, with a slimmer gutter and
// fewer layers on narrow screens so it never crowds the centered content.
function responsiveProfile(vw) {
  if (vw < 480) return { scale: 0.55, gutMax: 42, layers: 3, leafStepMul: 1.3, dpr: 1.5, roseTier: 0 };
  if (vw < 760) return { scale: 0.72, gutMax: 76, layers: 4, leafStepMul: 1.15, dpr: 1.5, roseTier: 1 };
  if (vw < 1100) return { scale: 0.88, gutMax: 108, layers: 5, leafStepMul: 1.0, dpr: 2, roseTier: 2 };
  return { scale: 1.0, gutMax: 130, layers: 6, leafStepMul: 1.0, dpr: 2, roseTier: 2 };
}

function crownDensity(distPx, crownScale) {
  for (let i = 0; i < CROWN_R.length; i++) {
    if (distPx < CROWN_R[i] * crownScale) return CROWN_DENSITY[i];
  }
  return 1.0;
}

// First u at which the curve reaches page-y `pageY`. Curve y is monotonic past
// the crown arch (max arch y = 58), so bisection is exact for any pageY > 58.
function uAtPageY(curve, pageY) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    if (-curve.getPointAt(mid).y < pageY) lo = mid; else hi = mid;
  }
  return lo;
}

// New growth at a vine's tip skews toward the smaller/paler archetypes
// (ivy, cordate, fern); mature growth near the base favors the bigger,
// darker ones (oak, ovate, rose leaflet) — weighted pick shifted by u.
function pickLeafType(u, rnd) {
  const youngBoost = { VineLeaf8_Ivy: 1.6, VineLeaf3_Cordate: 1.4, VineLeaf6_Fern: 1.3 };
  const matureBoost = { VineLeaf7_Oak: 1.5, VineLeaf1_Ovate: 1.2, VineLeaf5_Olive: 1.2 };
  let total = 0;
  const weights = LEAF_TYPE_NAMES.map((name) => {
    let w = LEAF_TYPE_WEIGHT[name];
    w *= 1 + (youngBoost[name] || 1) * u * 0.6 - u * 0.3;
    w *= 1 + (matureBoost[name] || 1) * (1 - u) * 0.35 - (1 - u) * 0.2;
    w = Math.max(0.05, w);
    total += w;
    return w;
  });
  let r = rnd() * total;
  for (let i = 0; i < LEAF_TYPE_NAMES.length; i++) {
    r -= weights[i];
    if (r <= 0) return LEAF_TYPE_NAMES[i];
  }
  return LEAF_TYPE_NAMES[0];
}

// Deterministic per-layer PRNG so each cane's curvature stays stable across a
// single build() but differs meaningfully layer to layer — real climbing-rose
// canes from one crown vary in path, not parallel echoes of each other.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Vine curve construction (page-pixel space, three-Y = -pageY) ──────────────
// `layer` 0 is the primary cane; higher layers start from a different point in
// the crown, swing through the gutter on their own home line, and sit further
// back in Z. `t` (0 front → 1 farthest) spreads the layers evenly no matter
// how many the viewport gets.
//
// Descent model (below the crown arch, y >= 120). ALL variation is smooth and
// low-frequency: TubeGeometry derives its cross-section frames from the curve
// tangent (Frenet frames), and point-to-point jitter flips those frames, which
// twists the tube and culls whole segments as back-facing. So there is NO
// per-point randomness here — every seeded parameter is drawn ONCE per cane
// and the path is a closed-form C¹ function of page-y:
//
//   d(y)   = d0 + w(y)·(dSig(y) − d0)                 distance from the page edge
//   dSig   = home(y) + R·tanh(Ab·E(y)·S(y) / R)       sway, smoothly saturated to the lane
//   S(y)   = Σ a_k·sin(2π y / P_k + φ_k),  k = 1..3   three incommensurate periods
//   E(y)   = 0.725 + 0.275·sin(2π y / Pe + φe)        slow amplitude envelope
//   home   = c + hd·sin(2π y / Ph + φh) + hs·s·tanh((y − yFlip) / Lflip)
//   w(y)   = smoothstep((y − 120) / Lb)                C¹ blend out of the crown
//   z(y)   = zBack − 4 + w(y)·(Z(y) + 4),  Z = z1·sin(2π y/Pz1 + ψ1) + z2·sin(2π y/Pz2 + ψ2)
//
// Ab is fitted once per cane so the cane fills its lane AND the analytic
// slope |d'(y)| never exceeds 0.715 (< 0.75, the Frenet rule of thumb) — see
// the "amplitude fit" block for the argument.
function buildWaypoints(side, fullW, docH, gut, layer, layerCount) {
  const sign = side === 'left' ? -1 : 1;
  const cx = fullW / 2;
  const t = layer / Math.max(1, layerCount - 1);
  const lc = Math.min(layer, 4); // crown geometry frozen at the layer-4 shape
  const rnd = mulberry32(0xC0FFEE + layer * 977 + (side === 'left' ? 0 : 131071));
  const zBack = -layer * 85 - rnd() * 20;
  const gutSpread = 0.16 + t * 0.34;                          // how wide THIS cane swings
  const gutCenter = 0.30 + t * 0.60 + (rnd() - 0.5) * 0.10;   // its own home line
  const wobbleAmp = gut * 0.05;
  // Absolute pixel floor: keep-out pad + outward leaf pivot + tube radius +
  // sine wobble, so the centreline AND every leaf pivot stay on-screen. The
  // old gutter-fraction floor was 6.7px on phones — smaller than a leaf offset.
  const edgeMinPx = EDGE_PAD_PX + LEAF_OFFSET_MAX_PX + TUBE_R_MAX_PX + wobbleAmp;
  const edgeDist = Math.max(edgeMinPx, gut * Math.max(0.16, gutCenter - gutSpread));
  const innerDist = Math.max(edgeDist + gut * 0.18, gut * Math.min(0.95, gutCenter + gutSpread));

  // Crown arch — unchanged (tuned for the corner bush + hidden-nav geometry).
  // These consume rnd() in the same order as before; every new per-cane
  // parameter below is drawn AFTER them, so the crown stays byte-identical.
  const pts = [
    [cx + sign * (rnd() - 0.5) * 10, 20 + lc * 10 + rnd() * 10, zBack],
    [cx + sign * fullW * (0.16 - lc * 0.025 + (rnd() - 0.5) * 0.02), 12 + rnd() * 8, zBack + 8],
    [cx + sign * fullW * (0.34 - lc * 0.035), 22 + rnd() * 10, zBack - 6],
    [cx + sign * (fullW / 2 - Math.max(innerDist, gut * (0.78 - lc * 0.10))), 58, zBack + 7],
    [cx + sign * (fullW / 2 - Math.max(innerDist, gut * (0.58 - lc * 0.08))), 120, zBack - 4],
  ];

  // ── Descending cane ────────────────────────────────────────────────────────
  const TAU = Math.PI * 2;
  const STEP = 85;            // y sample spacing. Shortest period is >= 340px,
                              // so STEP <= P/4: >= 4 waypoints per wavelength.
  const SIG_SLOPE = 0.58;     // budget for |dSig'| (px of x per px of y)
  const BLEND_SLOPE = 0.30;   // budget for the crown blend-out term. Combined
                              // through the smoothstep weights the total is
                              // max_u [0.30·4u(1−u) + 0.58·u²(3−2u)] = 0.715.

  // Horizontal lane, as distance from THIS page edge (mirrored for 'right').
  // dMin/dMax are exactly the safety limits: [edgeDist, max(innerDist, 0.95·gut)].
  const dMin = edgeDist;
  const dMax = Math.max(innerDist, gut * 0.95);
  const span = dMax - dMin;

  // Per-cane sub-lane. The thick primary hugs the edge (reaches only half of
  // the gutter); thinner canes reach progressively further toward the inner
  // gutter edge, and from layer 2 up some are lifted off the edge (inset) so
  // one or two visibly wander inward instead of all sharing one lane.
  const reach = layer === 0 ? 0.5 : Math.min(1, 0.75 + 0.25 * t + (rnd() - 0.5) * 0.15);
  const insetR = rnd();
  const inset = layer >= 2 ? insetR * 0.25 * t : 0;
  const dHi = dMin + reach * span;
  const dLo = Math.min(dMin + inset * span, dHi - 0.5 * span); // lane >= 50% of gutter
  const c = (dLo + dHi) / 2;   // cane's home centre
  const H = (dHi - dLo) / 2;   // cane's half-lane

  // Three incommensurate sine periods (340 / 560 / 930 px base; ratios
  // 1 : 1.647 : 2.735 never realign, so the sway never repeats down the page
  // and no two canes share a wavelength). The primary gets the longest,
  // laziest arcs (pScale up to ~1.47); the thinnest canes keep tighter curls
  // (pScale >= 1.0, so P1 >= 340 = 4·STEP).
  const pScale = 1 + 0.35 * (1 - t) + rnd() * 0.12;
  const P1 = 340 * pScale, P2 = 560 * pScale, P3 = 930 * pScale;
  const ph1 = rnd() * TAU, ph2 = rnd() * TAU, ph3 = rnd() * TAU;
  // Weight mix: primary leans on the long period (lazy arcs), thin canes on
  // the short one (tighter curls). Normalised so |S| <= 1.
  let a1 = 0.40 + 0.20 * t + rnd() * 0.15;
  let a2 = 0.30 + rnd() * 0.10;
  let a3 = 0.30 - 0.15 * t + rnd() * 0.10;
  const aSum = a1 + a2 + a3;
  a1 /= aSum; a2 /= aSum; a3 /= aSum;

  // Slow amplitude envelope E ∈ [0.45, 1]: where it is low the cane runs
  // noticeably straighter for a few hundred px (calm stretch), then sways.
  const ENV_MID = 0.725, ENV_DEPTH = 0.275;
  const Pe = 900 + rnd() * 600, phe = rnd() * TAU;

  // Home-line drift (very long period) + ONE "lean flip": the cane leans to
  // one side of its lane, crosses over once around yFlip (tanh, ~500px wide),
  // then keeps to the other side. Two neighbouring canes therefore cross once
  // and then run roughly parallel, instead of braiding every half period.
  const Ph = 1400 + rnd() * 800, phh = rnd() * TAU;
  const yFlip = 500 + rnd() * 1300;
  const flipSign = rnd() < 0.5 ? -1 : 1;
  const Lflip = 260;                                  // |tanh'| <= 1/Lflip
  const hd = 0.05 * H, hs = 0.20 * H;
  const homeSlope = hd * TAU / Ph + hs / Lflip;       // analytic max |home'|

  // Depth: two slow sines, |Z| <= 22 < 24, blended from the crown's −4.
  const z1 = 11 + rnd() * 3, z2 = 5 + rnd() * 3;
  const Pz1 = 800 + rnd() * 300, Pz2 = 1400 + rnd() * 500;
  const pz1 = rnd() * TAU, pz2 = rnd() * TAU;

  // Some thin canes (layer >= 3) stop partway down the page: on a real climber
  // not every cane reaches the ground. Layer 0 always runs the full page
  // (build() bisects it with uAtPageY). Decided once, seeded.
  let yStop = docH + 60;
  const endsEarly = layer >= 4 && rnd() < 0.5;
  const endFrac = 0.5 + rnd() * 0.35;
  if (endsEarly) {
    const yEnd = Math.max(1600, docH * Math.max(0.85, endFrac));       // never inside the hero
    if (yEnd < docH - 300) yStop = yEnd;                // a stub near the bottom looks broken
  }

  // Amplitude fit (once per cane, no randomness). A sum of three sines has a
  // high crest factor — its rare peaks are ~2x its typical excursion — so
  // sizing it to the lane by its peak leaves the cane looking timid. Instead
  // the sway is passed through a smooth saturator, R·tanh(v/R), which keeps
  // |sway| < R (lane guarantee) and |sway'| <= |v'| (slope guarantee), and Ab
  // is chosen from the analytic derivative: scan g(y) = E(y)·S(y) and g'(y)
  // over the cane's whole y range at 2px spacing, then
  //   slope:  homeSlope + Ab·max|g'| <= SIG_SLOPE / 1.03    → |dSig'| <= 0.58
  //   shape:  Ab·max|g| <= 1.5·R  (peaks reach ~tanh(1.5)=0.9 of the lane,
  //           so the saturator only rounds the extremes, never flattens)
  // The 2px scan is exact for practical purposes: at the maximum of g' its
  // own derivative g'' vanishes, so the sampled max undershoots by at most
  // (δ/2)²·max|g'''|/2 ≈ 3e-6 px/px (all periods >= 340px) — the 3% margin
  // absorbs that thousands of times over.
  const R = 0.97 * H - hd - hs;                       // lane room left for the sway
  let gMax = 0, dgMax = 0;
  for (let yy = 120; yy <= yStop + STEP; yy += 2) {
    const s1 = TAU * yy / P1 + ph1, s2 = TAU * yy / P2 + ph2, s3 = TAU * yy / P3 + ph3;
    const S = a1 * Math.sin(s1) + a2 * Math.sin(s2) + a3 * Math.sin(s3);
    const dS = TAU * (a1 * Math.cos(s1) / P1 + a2 * Math.cos(s2) / P2 + a3 * Math.cos(s3) / P3);
    const se = TAU * yy / Pe + phe;
    const E = ENV_MID + ENV_DEPTH * Math.sin(se);
    const dE = ENV_DEPTH * TAU * Math.cos(se) / Pe;
    gMax = Math.max(gMax, Math.abs(E * S));
    dgMax = Math.max(dgMax, Math.abs(dE * S + E * dS));
  }
  const Ab = Math.min(
    (SIG_SLOPE - homeSlope) / (Math.max(dgMax, 1e-6) * 1.03),
    1.5 * R / Math.max(gMax, 1e-6),
  );

  // Blend out of the crown: the last crown point sits at distance d0 from the
  // edge; d(y) eases from d0 into dSig over Lb px with a C¹ smoothstep whose
  // derivative is 6u(1−u)/Lb <= 1.5/Lb. Lb is sized so 1.5·maxDiff/Lb <=
  // BLEND_SLOPE, hence for every y:
  //   |d'| <= BLEND_SLOPE·4u(1−u) + SIG_SLOPE·u²(3−2u) <= 0.715   (max at u≈0.76)
  const d0 = Math.max(innerDist, gut * (0.58 - lc * 0.08)); // == pts[4] distance
  const maxDiff = Math.max(dHi - d0, d0 - dLo, 1);
  const Lb = Math.max(300, 1.5 * maxDiff / BLEND_SLOPE);

  let y = 120;
  while (y < yStop) {
    y += STEP;                                          // strictly monotonic page-y
    const u = Math.min(1, (y - 120) / Lb);
    const w = u * u * (3 - 2 * u);                      // smoothstep, C¹
    const S = a1 * Math.sin(TAU * y / P1 + ph1)
            + a2 * Math.sin(TAU * y / P2 + ph2)
            + a3 * Math.sin(TAU * y / P3 + ph3);
    const E = ENV_MID + ENV_DEPTH * Math.sin(TAU * y / Pe + phe);
    const home = c
      + hd * Math.sin(TAU * y / Ph + phh)
      + hs * flipSign * Math.tanh((y - yFlip) / Lflip);
    const sway = R * Math.tanh(Ab * E * S / R);         // |sway| < R, |sway'| <= Ab|g'|
    const dSig = home + sway;                           // ∈ [dLo, dHi]
    const d = d0 + w * (dSig - d0);                     // convex mix ⇒ inside [dMin, dMax]
    const Z = z1 * Math.sin(TAU * y / Pz1 + pz1) + z2 * Math.sin(TAU * y / Pz2 + pz2);
    const z = zBack - 4 + w * (Z + 4);                  // |z − zBack| <= 22
    pts.push([side === 'left' ? d : fullW - d, y, z]);
  }
  return pts.map(([x, y, z]) => new THREE.Vector3(x, -y, z));
}

export class VineScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.leafMeshItems = []; // { u, index, inst, baseScale, basePos, baseRotZ, progress }
    this.vineRoses = [];
    this.scrollY = window.scrollY;
    this.lastScrollY = this.scrollY;
    this.sway = 0;
    this.lag = 0;
    this.animFrame = null;
    this._onScroll = null;
    this._onResize = null;
    this.built = false;
    this.growth = 0;
    this.docH = 0;
    this.layerCount = 1;
    this.layerGroups = [];
    this._dummy = new THREE.Object3D();
    this._touched = new Set();
    this.ready = new Promise((res) => { this._resolveReady = res; });
    this.init();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    // Hue-preserving (Khronos PBR Neutral) roll-off: highlights stop clipping
    // to hard white, but red petals keep their hue (ACES skews reds orange).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    // Far plane sized for MAX_LAYERS at 85px/layer of Z separation — the old
    // far=100 clipped every layer past the first (that was the "vanishing").
    this.camera = new THREE.OrthographicCamera(0, window.innerWidth, 0, -window.innerHeight, -100, 800);
    this.camera.position.z = 10;

    // Image-based lighting without an HDR file: PMREM a procedural studio
    // room once. scene.environment feeds every PBR material's indirect
    // diffuse + specular; without it the only specular is punctual-light
    // hotspots — the "plastic" look. Environment only, never background:
    // the canvas must stay transparent.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 1.0;

    // Atmospheric perspective: far layers lose contrast toward the page
    // colour, uniformly for tubes, leaves and roses. Fog mixes rgb only, so
    // the transparent canvas is unaffected (page bg is the solid ivory).
    this.scene.fog = new THREE.Fog(PAGE_BG, 60, 700);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Three-point rig + sky/ground hemisphere; IBL carries the ambient.
    // Key from upper-left-front at a real angle so cupped petals and curled
    // leaves get a lit side and a shadow side (a flat frontal key is what
    // makes foliage look like stickers).
    const key = new THREE.DirectionalLight(0xfff6e6, 2.3);
    key.position.set(-3.5, 4.5, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd9e6ff, 0.55);
    fill.position.set(4, -1, 3.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe2b8, 1.1);
    rim.position.set(1.5, -3, -4);
    this.scene.add(rim);
    // Sky above / leaf-green bounce below — reads as an outdoor garden.
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8aa070, 0.55));
    this.scene.add(new THREE.AmbientLight(0xfff5e0, 0.2));

    // Wind: one global gust envelope + per-instance phase, evaluated in the
    // leaf vertex shader (zero per-frame CPU) and as a nod on the roses.
    this.uTime = { value: 0 };
    this.uWind = { value: 2.3 }; // leaf flap/sway + rose nod scale: present but unhurried
    // Growth reveal scalar shared by every cane shader (one uniform object,
    // no per-frame scene traversal to push it).
    this.uGrowth = { value: 0 };

    this.resize();
    this.loadBarkTextures();
    this.loadPhotoMaps();

    Promise.all([this.loadLeaves(), this.loadVineRoses()]).then(() => {
      this.build();
      this.setupListeners();
      this.animate();
    });
  }

  // Real bark photo (Wikimedia CC0, processed into public/textures/),
  // recolored toward the rose-cane palette. Loaded once; buildTube() clones
  // + retiles it per cane.
  loadBarkTextures() {
    const loader = new THREE.TextureLoader();
    this.barkColorTex = loader.load('/textures/bark_color.jpg');
    this.barkBumpTex = loader.load('/textures/bark_bump.jpg');
    [this.barkColorTex, this.barkBumpTex].forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    });
    this.barkColorTex.colorSpace = THREE.SRGBColorSpace;
    this.barkBumpTex.colorSpace = THREE.NoColorSpace;
  }

  // Photo-derived PBR maps (from the CC0 reference photos: leaf macro with
  // real vein network, rose-petal velvet folds) — attached at runtime rather
  // than embedded in the GLB, so the vertex-color gradients (COLOR_0) survive
  // export and the GLB stays small. three multiplies map × vertex colour.
  // glTF UVs assume flipY = false.
  loadPhotoMaps() {
    const loader = new THREE.TextureLoader();
    const mk = (path, srgb) => {
      const t = loader.load(path);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      return t;
    };
    this.leafMaps = {
      map: mk('/textures/leaf_color.jpg', true),
      normalMap: mk('/textures/leaf_normal.jpg', false),
      roughnessMap: mk('/textures/leaf_rough.jpg', false),
    };
    this.petalMaps = {
      map: mk('/textures/petal_color.jpg', true),
      normalMap: mk('/textures/petal_normal.jpg', false),
      roughnessMap: mk('/textures/petal_rough.jpg', false),
    };
  }

  applyMaps(m, maps, normalScale) {
    m.map = maps.map;
    m.normalMap = maps.normalMap;
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
    m.roughnessMap = maps.roughnessMap;
    m.needsUpdate = true;
  }

  loadLeaves() {
    return new Promise((resolve) => {
      new GLTFLoader().load(leafUrl, (gltf) => {
        this.leafTypes = {};
        LEAF_TYPE_NAMES.forEach((name) => {
          const obj = gltf.scene.getObjectByName(name);
          if (!obj) return;
          // glTF sheen promotes these to MeshPhysicalMaterial with a white
          // full-strength sheen at roughness 0.4 — shiny plastic. Leaf cuticle
          // is satin: tune once here, scatterLeaves() clones this material.
          const m = obj.material;
          m.vertexColors = true;
          m.roughness = 0.9; // multiplied by the roughness map (~0.6)
          if ('specularIntensity' in m) m.specularIntensity = 0.55;
          if ('sheen' in m) {
            m.sheen = 0.35;
            m.sheenColor.setRGB(0.62, 0.78, 0.45);
            m.sheenRoughness = 0.65;
          }
          m.envMapIntensity = 0.45;
          // The photo is a saturated backlit lime; the vertex greens carry the
          // real hue, so pull the map toward neutral before the multiply.
          m.color.setRGB(1.25, 1.15, 1.2);
          this.applyMaps(m, this.leafMaps, 0.8);
          obj.geometry.computeBoundingBox();
          this.leafTypes[name] = { geometry: obj.geometry, material: m };
        });
        resolve();
      });
    });
  }

  loadVineRoses() {
    return new Promise((resolve) => {
      const draco = new DRACOLoader();
      draco.setDecoderPath('/draco/');
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      loader.load(rosesUrl, (gltf) => {
        // Tune ONCE here: the merged templates below bake from these material
        // objects. The GLB ships one material per petal (identical parameters,
        // ~45 per bloom): collapse each role to a single shared material —
        // buildRoseTemplates() then merges every petal of a variant into ONE
        // geometry, so all of a bloom's petals are a single draw.
        const shared = { petal: null, sepal: null, stamen: null };
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          const role = /^petal_L\d+_/.test(child.name) ? 'petal'
            : /^(sepal|calyx|stem)/.test(child.name) ? 'sepal' : 'stamen';
          if (shared[role]) { child.material = shared[role]; return; }
          const m = shared[role] = child.material;
          if (role === 'petal') {
            m.roughness = 0.95; // multiplied by the petal roughness map (~0.55)
            if ('specularIntensity' in m) m.specularIntensity = 0.45; // kills the hard plastic hotspot
            if ('sheen' in m) { m.sheen = 0.8; m.sheenRoughness = 0.5; }
            m.envMapIntensity = 0.5;
            // The petal photo is hot pink; warm it toward crimson before it
            // multiplies with the deep-red vertex gradient.
            m.color.setRGB(1.12, 0.58, 0.62);
            this.applyMaps(m, this.petalMaps, 0.55);
          } else if (role === 'sepal') {
            // Green sepals/calyx on the buds — same leaf photo maps as foliage.
            m.vertexColors = true;
            m.roughness = 0.9;
            if ('sheen' in m) { m.sheen = 0.3; m.sheenRoughness = 0.6; }
            m.envMapIntensity = 0.4;
            m.color.setRGB(1.2, 1.1, 1.15);
            this.applyMaps(m, this.leafMaps, 0.7);
          } else {
            // Gold stamens: metallic reads as black without an env map; now
            // that one exists, soften it toward warm satin gold.
            m.metalness = 0.85;
            m.roughness = 0.38;
            m.envMapIntensity = 0.7;
          }
        });
        this.roseMats = Object.values(shared).filter(Boolean);
        this.roseSourceScene = gltf.scene;
        this.buildRoseTemplates();
        resolve();
      });
    });
  }

  // A rose clone used to be 45–73 meshes (one draw per petal; the 28 stamen
  // parts alone were 88% of the geometry but <10px on screen). Each variant is
  // now baked ONCE into three merged geometries — petals, green parts (sepals +
  // calyx + stem), stamens — so a bloom is 2–3 draw calls instead of ~50.
  // The petal tilt (closedness + breathing) used to be a per-frame CPU write
  // to petal.rotation.x; that rotation is the ONLY part of the petal transform
  // not baked: every petal vertex carries its pivot, tilt axis and animation
  // params and the petal vertex shader applies the rotation (makePetalMaterial).
  // Three Blender-modelled variants: Rose_A (open spiral), Rose_Half
  // (half-open, flaring), Rose_Bud (tight cone with green sepals); *_lo =
  // decimated twins (~40% of the verts) for back layers / low tiers.
  buildRoseTemplates() {
    this.roseTemplates = {};
    const isPetal = (c) => c.isMesh && /^petal_L\d+_/.test(c.name);
    const isExtra = (c) => c.isMesh && /^(anther|stamen|Sphere|Cylinder)/.test(c.name);
    ['Rose_A', 'Rose_Half', 'Rose_Bud', 'Rose_A_lo', 'Rose_Half_lo', 'Rose_Bud_lo'].forEach((name) => {
      const source = this.roseSourceScene.getObjectByName(name);
      if (!source) return;
      const meshes = [];
      source.traverse((c) => { if (c.isMesh) meshes.push(c); });
      const petals = meshes.filter(isPetal);
      const extras = meshes.filter(isExtra);
      const greens = meshes.filter((c) => !isPetal(c) && !isExtra(c));
      if (!petals.length) return;
      const tpl = {
        petalGeo: null, sepalGeo: null, stamenGeo: null,
        petalMat: petals[0].material, sepalMat: greens[0]?.material || null, stamenMat: extras[0]?.material || null,
      };
      try {
        tpl.petalGeo = this.mergePetals(source, petals);
        // Calyx/stem ship without COLOR_0 (the shader's default vertex colour
        // is white), so the merge fills white — identical pixels.
        if (greens.length) tpl.sepalGeo = this.mergeRoseParts(source, greens, ['position', 'normal', 'uv', 'color']);
        // Stamens: plain gold metal, no maps — position + normal is enough.
        if (extras.length) tpl.stamenGeo = this.mergeRoseParts(source, extras, ['position', 'normal']);
      } catch (e) {
        console.warn('VineScene: rose template merge failed for', name, e);
        return;
      }
      this.roseTemplates[name] = tpl;
    });
  }

  // Local → rose-root matrix of `obj`'s PARENT (identity for the direct
  // children the GLB ships, but stays right if a future export nests petals).
  roseParentMatrix(root, obj) {
    const m = new THREE.Matrix4();
    for (let p = obj.parent; p && p !== root; p = p.parent) { p.updateMatrix(); m.premultiply(p.matrix); }
    return m;
  }

  // Float32 copy of one attribute (Draco decodes colours as normalised ints
  // and mergeGeometries needs one array type per attribute), or a constant-1
  // filler when the part has none.
  roseFloatAttr(geo, name, itemSize) {
    const attr = geo.attributes[name];
    const n = geo.attributes.position.count;
    const size = attr ? attr.itemSize : itemSize;
    const out = new Float32Array(n * size);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr ? attr.getComponent(i, k) : 1;
    return new THREE.BufferAttribute(out, size);
  }

  // Copy of `part`'s geometry restricted to `attrNames`, in rose-root space
  // (parent chain × the part's own TRS applied; normals via the normal matrix).
  bakeRosePart(root, part, attrNames, sizes, matrix = null) {
    const g = new THREE.BufferGeometry();
    attrNames.forEach((a) => g.setAttribute(a, this.roseFloatAttr(part.geometry, a, sizes[a])));
    if (part.geometry.index) g.setIndex(part.geometry.index.clone());
    part.updateMatrix();
    g.applyMatrix4(matrix || this.roseParentMatrix(root, part).multiply(part.matrix));
    return g;
  }

  roseAttrSizes(parts, attrNames) {
    const sizes = {};
    attrNames.forEach((a) => {
      const found = parts.find((c) => c.geometry.attributes[a]);
      sizes[a] = found ? found.geometry.attributes[a].itemSize : (a === 'uv' ? 2 : 3);
    });
    return sizes;
  }

  // Static parts (sepals + calyx + stem, or the stamen spheres) → one geometry.
  mergeRoseParts(root, parts, attrNames) {
    const sizes = this.roseAttrSizes(parts, attrNames);
    const merged = mergeGeometries(parts.map((c) => this.bakeRosePart(root, c, attrNames, sizes)), false);
    if (!merged) throw new Error('mergeGeometries returned null');
    return merged;
  }

  // Petals → one geometry whose vertices sit at the REST pose (the clone's
  // full transform, i.e. rotation.x = baseTilt) plus, per vertex:
  //   aPivot  petal origin in rose space
  //   aAxis   unit tilt axis in rose space — the parent-frame X axis. Euler
  //           XYZ composes as Rx·Ry·Rz, so `petal.rotation.x = baseTilt + δ`
  //           equals Rx(δ) applied in the parent frame about the petal origin
  //           on top of the rest pose: that Rx(δ) is what the shader applies.
  //   aParam  (petal layer, breathing freq, breathing phase) — the layer
  //           drives closedness pull + breathing amplitude exactly as the old
  //           per-petal CPU loop did; freq/phase were per petal there too.
  mergePetals(root, petals) {
    const attrNames = ['position', 'normal', 'uv', 'color'];
    const sizes = this.roseAttrSizes(petals, attrNames);
    const geos = petals.map((c) => {
      const layerIdx = parseInt(c.name.match(/^petal_L(\d+)_/)[1], 10);
      const parentM = this.roseParentMatrix(root, c);
      c.updateMatrix();
      const g = this.bakeRosePart(root, c, attrNames, sizes, parentM.clone().multiply(c.matrix));
      const pivot = c.position.clone().applyMatrix4(parentM);
      const axis = new THREE.Vector3(1, 0, 0).transformDirection(parentM);
      const freq = 2 * Math.PI / (4.0 + Math.random() * 2.8);
      const phase = Math.random() * Math.PI * 2;
      const n = g.attributes.position.count;
      const aPivot = new Float32Array(n * 3), aAxis = new Float32Array(n * 3), aParam = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        aPivot[i * 3] = pivot.x; aPivot[i * 3 + 1] = pivot.y; aPivot[i * 3 + 2] = pivot.z;
        aAxis[i * 3] = axis.x; aAxis[i * 3 + 1] = axis.y; aAxis[i * 3 + 2] = axis.z;
        aParam[i * 3] = layerIdx; aParam[i * 3 + 1] = freq; aParam[i * 3 + 2] = phase;
      }
      g.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
      g.setAttribute('aAxis', new THREE.BufferAttribute(aAxis, 3));
      g.setAttribute('aParam', new THREE.BufferAttribute(aParam, 3));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) throw new Error('mergeGeometries returned null');
    // Rest-pose sphere, padded for the ≤ ~0.45 rad the shader tilts petals by.
    merged.computeBoundingSphere();
    merged.boundingSphere.radius *= 1.5;
    return merged;
  }

  // Per-bloom petal material: a clone of the shared petal material (same
  // textures; customProgramCacheKey pins ONE shader program for every bloom)
  // carrying this bloom's closedness + breathing phase as uniforms. Custom
  // uniforms are only re-uploaded on a material switch, so a shared material
  // + onBeforeRender could not carry per-bloom values; a clone per bloom can.
  // One warm family only — red through pink through orange — at full chroma,
  // so the garland reads as vivid roses rather than a pastel mix. Ordered
  // deep to bright; the spread of value is what keeps it from going flat.
  // sRGB petal colours. The photo map is desaturated per bloom (uDesat) so
  // these read as the real hue instead of tinting a pink photograph.
  static PETAL_TINTS = [
    [0.86, 0.06, 0.16],  // crimson
    [0.95, 0.11, 0.20],  // true red
    [1.00, 0.20, 0.26],  // scarlet
    [1.00, 0.28, 0.42],  // raspberry
    [1.00, 0.36, 0.55],  // hot pink
    [1.00, 0.45, 0.62],  // rose pink
    [1.00, 0.30, 0.18],  // vermilion
    [1.00, 0.42, 0.14],  // orange
    [1.00, 0.55, 0.20],  // tangerine
    [1.00, 0.24, 0.34],  // cherry
    [0.99, 0.16, 0.42],  // fuchsia accent
    [1.00, 0.63, 0.36],  // coral highlight
  ];

  makePetalMaterial(base, tint) {
    const uniforms = {
      uClosed: { value: 0 },
      uPhase: { value: Math.random() * Math.PI * 2 },
      // How far to pull the petal photo toward pure luminance before the
      // bloom's own colour multiplies it.
      uDesat: { value: tint ? 0.96 : 0 },
    };
    const mat = base.clone();
    if (tint) {
      // The desaturated photo sits around mid-grey, so lift the tint to keep
      // the bloom as bright as the colour it is meant to be.
      mat.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
      mat.color.multiplyScalar(1.16); // enough to survive the desaturated map, not enough to wash the hue out
    }
    mat.userData.petalUniforms = uniforms;
    mat.customProgramCacheKey = () => 'vinePetalTilt';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uClosed = uniforms.uClosed;
      shader.uniforms.uPhase = uniforms.uPhase;
      shader.uniforms.uDesat = uniforms.uDesat;
      // Keep the photo's veining and shading, drop its hue, so a yellow or a
      // white rose is actually yellow or white rather than tinted pink.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>' + String.fromCharCode(10) + 'uniform float uDesat;')
        .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 vinePetalTex = texture2D( map, vMapUv );
  float vinePetalLum = dot( vinePetalTex.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vinePetalTex.rgb = mix( vinePetalTex.rgb, vec3( vinePetalLum ), uDesat );
  // The photo sits around mid-grey once desaturated; lift it so the bloom's
  // own colour comes through at full strength instead of half-lit.
  vinePetalTex.rgb = mix( vinePetalTex.rgb, vinePetalTex.rgb * 1.75, uDesat );
  diffuseColor *= vinePetalTex;
#endif
`)
        // The GLB bakes a deep-red gradient into the petal vertex colours; it
        // has to lose its hue too, or every bloom comes out the same pink.
        .replace('#include <color_fragment>', `
#ifdef USE_COLOR_ALPHA
  vec3 vineVc = vColor.rgb;
#elif defined( USE_COLOR )
  vec3 vineVc = vColor;
#endif
#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )
  float vineVcLum = dot( vineVc, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb *= mix( vineVc, vec3( min( 1.0, vineVcLum * 1.9 ) ), uDesat );
#endif
#ifdef USE_COLOR_ALPHA
  diffuseColor.a *= vColor.a;
#endif
`);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uClosed;
uniform float uPhase;
attribute vec3 aPivot;
attribute vec3 aAxis;
attribute vec3 aParam;
// Tilt delta from the baked rest pose — the same terms the CPU loop used to
// write to petal.rotation.x: closedness pulls every petal toward closed by an
// amount that grows with layer; breathing is one sin per petal (amplitude
// grows with layer, damped by closedness), phase-shifted per bloom.
float vinePetalDelta() {
  float layer = aParam.x;
  float closedPull = uClosed * (0.30 + layer * 0.11);
  float amp = (0.02 + layer * 0.01) * (1.0 - uClosed * 0.5);
  return amp * sin(uTime * aParam.y + aParam.z + uPhase) - closedPull;
}
vec3 vinePetalRotate(vec3 v, float a) { // Rodrigues rotation about aAxis
  float c = cos(a), s = sin(a);
  return v * c + cross(aAxis, v) * s + aAxis * dot(aAxis, v) * (1.0 - c);
}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float vinePetalA = vinePetalDelta();
objectNormal = vinePetalRotate(objectNormal, vinePetalA);
#ifdef USE_TANGENT
objectTangent = vinePetalRotate(objectTangent, vinePetalA);
#endif`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = aPivot + vinePetalRotate(transformed - aPivot, vinePetalA);`);
    };
    return mat;
  }

  // ── Build vine geometry + leaf instances + mini roses ────────────────────────
  disposeBuilt() {
    this.vineRoses.forEach((r) => {
      gsap.killTweensOf(r.root.scale);
      gsap.killTweensOf(r.root.rotation);
      r.tweens = null;
      r.root.userData.petalMat?.dispose(); // per-bloom clone; geometries are shared templates
    });
    this.group.traverse((o) => {
      if (o.userData.isTube) {
        o.geometry.dispose();
        o.material.map?.dispose();
        o.material.bumpMap?.dispose();
        o.material.dispose();
      } else if (o.isInstancedMesh) {
        o.dispose(); // material is shared per leaf type (disposed in dispose())
      }
    });
    this.group.clear();
    this.layerGroups = [];
    this.leafMeshItems = [];
    this.vineRoses = [];
  }

  build() {
    const fullW = document.documentElement.clientWidth;
    if (fullW < MIN_VIEWPORT_W) {
      this.canvas.style.display = 'none';
      this.built = false;
      this._resolveReady?.(); this._resolveReady = null;
      return;
    }
    this.canvas.style.display = 'block';
    this.disposeBuilt();

    this.docH = document.documentElement.scrollHeight;
    const profile = responsiveProfile(fullW);
    this.respScale = profile.scale;
    this.leafStepMul = profile.leafStepMul;
    this.roseTier = profile.roseTier;
    this.layerCount = Math.min(MAX_LAYERS, profile.layers);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.dpr));
    const gut = Math.min(profile.gutMax, (fullW / 2) * 0.38);
    this.gut = gut;
    this.fullW = fullW;
    this.navH = document.querySelector('nav')?.offsetHeight || NAV_FALLBACK_H;
    this.crownScale = 0.5 + 0.5 * this.respScale; // 1.0 desktop → 0.775 phone
    this.scene.fog.far = 60 + (85 * (this.layerCount - 1) + 40) / 0.6;
    this._lastW = fullW;
    this.leafSpaceReset();
    this._lastDocH = this.docH;

    // One group per layer so scroll lag can be applied per depth (parallax).
    for (let l = 0; l < this.layerCount; l++) {
      const g = new THREE.Group();
      g.userData.layer = l;
      this.group.add(g);
      this.layerGroups.push(g);
    }

    const sides = ['left', 'right'];
    const curves = [];
    sides.forEach((side) => {
      for (let layer = 0; layer < this.layerCount; layer++) {
        const pts = buildWaypoints(side, fullW, this.docH, gut, layer, this.layerCount);
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
        curve.tag = 'main';
        const length = curve.getLength();
        const heroFrac = uAtPageY(curve, window.innerHeight);
        // Crown anchor: where this cane first shows below the nav.
        const anchorU = uAtPageY(curve, this.navH + 6);
        const crown = { anchorU, anchorP: curve.getPointAt(anchorU), length };
        curves.push({ side, layer, curve, length, crown });

        const placements = this.newPlacements();
        this.buildTube(curve, side, layer, { crown });
        this.scatterLeaves(curve, length, side, layer, crown, placements);
        this.plantVineRoses(curve, heroFrac, side, layer, crown);
        if (layer <= 2) this.buildOffshoots(curve, side, layer, crown, placements);
        if (layer <= 1) this.buildGarland(curve, side, layer, crown, placements);
        this.commitLeaves(placements, side, layer);
      }
    });
    this.curves = curves;

    this.built = true;
    this.growth = 0;
    this.updateGrowthTarget(true);
    // Compile every program now — including the (still hidden) rose petal /
    // sepal / stamen shaders — while the loading overlay is still up, so the
    // first bloom reveal never stalls a frame on a shader compile.
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* non-fatal */ }
    this._resolveReady?.(); this._resolveReady = null;
  }

  buildTube(curve, side, layer, opts = {}) {
    const { radiusMul = 1, minSeg = 120, uStart = 0, uSpan = 1, crown = null, taperEnd = 0.30 } = opts;
    const t = layer / Math.max(1, this.layerCount - 1);
    const segments = Math.max(minSeg, Math.round(curve.getLength() / 20));
    const radialSegments = 8;
    // Front cane thickest; farthest ~45% — never below ~1px.
    const baseRadius = 2.3 * Math.max(0.65, this.respScale) * (1 - t * 0.55) * radiusMul;
    const geo = new THREE.TubeGeometry(curve, segments, baseRadius, radialSegments, false);

    // ── Real-cane anatomy pass ────────────────────────────────────────────────
    // Non-linear taper (parallel woody 65%, then a faster taper into the soft
    // tip; ~3:1 base:tip per real climbing-rose cane data), a radius bump at
    // each leaf node, a woody bulge at the crown anchor, and fixed per-column
    // ridge jitter so the cross-section reads as slightly irregular — plus a
    // tan-brown (woody base) -> olive -> bronze-red -> fresh green vertex-color
    // gradient. Pure per-ring radial scaling: never touches the curve/frames.
    const ringCount = segments + 1;
    const colCount = radialSegments + 1;
    const ridgeJitter = new Array(colCount).fill(0).map((_, j) => {
      const seed = Math.sin(j * 12.9898 + (side === 'left' ? 3.1 : 7.7)) * 43758.5453;
      return 1 + ((seed - Math.floor(seed)) - 0.5) * 0.12;
    });
    // Radius floor ~1.4px: below that a cane tip antialiases to nothing on a
    // real GPU and any bloom sitting on it reads as floating.
    const minFrac = Math.min(0.9, 1.4 / baseRadius);
    const taperAt = (u) => {
      if (u < 0.65) return Math.max(minFrac, 1.0 - (u / 0.65) * 0.18);
      const tt = (u - 0.65) / 0.35;
      return Math.max(minFrac, 0.82 - Math.pow(tt, 1.6) * taperEnd);
    };
    const NODE_SPACING_U = 26 / Math.max(1, curve.getLength());
    const nodeBumpAt = (u) => {
      const phase = (u / NODE_SPACING_U) % 1;
      const d = Math.min(phase, 1 - phase);
      return d < 0.06 ? (1 - d / 0.06) * 0.16 : 0;
    };
    const crownBulgeAt = (center) => {
      if (!crown) return 1;
      const d = Math.hypot(center.x - crown.anchorP.x, center.y - crown.anchorP.y);
      return 1 + 0.9 * Math.max(0, 1 - d / (120 * this.crownScale));
    };
    const barkColors = [
      { stop: 0.00, col: [0.42, 0.33, 0.22] },
      { stop: 0.55, col: [0.34, 0.38, 0.20] },
      { stop: 0.78, col: [0.45, 0.24, 0.16] },
      { stop: 1.00, col: [0.42, 0.62, 0.30] },
    ];
    const colorAt = (u) => {
      for (let s = 0; s < barkColors.length - 1; s++) {
        const a = barkColors[s], b = barkColors[s + 1];
        if (u >= a.stop && u <= b.stop) {
          const tt = (u - a.stop) / (b.stop - a.stop || 1);
          return [0, 1, 2].map((k) => a.col[k] + (b.col[k] - a.col[k]) * tt);
        }
      }
      return barkColors[barkColors.length - 1].col;
    };

    const pos = geo.attributes.position;
    const colorAttr = new Float32Array(pos.count * 3);
    for (let i = 0; i < ringCount; i++) {
      const u = i / segments;
      const gu = uStart + u * uSpan; // u on the parent cane (colour gradient)
      const center = curve.getPointAt(Math.min(0.999, u));
      const taper = taperAt(gu) * (1 + nodeBumpAt(u)) * crownBulgeAt(center);
      const [r, g, b] = colorAt(gu);
      for (let j = 0; j < colCount; j++) {
        const k = i * colCount + j;
        if (k >= pos.count) continue;
        const vx = pos.getX(k), vy = pos.getY(k), vz = pos.getZ(k);
        const dx = vx - center.x, dy = vy - center.y, dz = vz - center.z;
        const mul = taper * ridgeJitter[j];
        pos.setXYZ(k, center.x + dx * mul, center.y + dy * mul, center.z + dz * mul);
        colorAttr[k * 3] = r; colorAttr[k * 3 + 1] = g; colorAttr[k * 3 + 2] = b;
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));

    // Real bark photo tiled along the cane. TubeGeometry: uv.x runs ALONG
    // the tube, uv.y AROUND it (three/src/geometries/TubeGeometry.js:153).
    const barkMap = this.barkColorTex.clone();
    barkMap.needsUpdate = true;
    const lenRepeat = Math.max(1, curve.getLength() / 190);
    barkMap.repeat.set(lenRepeat, 2);
    const barkBump = this.barkBumpTex.clone();
    barkBump.needsUpdate = true;
    barkBump.repeat.set(lenRepeat, 2);

    // The front cane is fully opaque: keep it out of the sorted transparent
    // pass (identical pixels, depth-tested like everything else).
    const opacity = 1 - t * 0.30;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: barkMap,
      bumpMap: barkBump,
      bumpScale: 0.45,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.3,
      transparent: opacity < 0.999,
      opacity,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGrowth = this.uGrowth;
      shader.uniforms.uStart = { value: uStart };
      shader.uniforms.uSpan = { value: uSpan };
      // Growth reveal sweeps along the LENGTH (uv.x). Stubs map their own
      // 0..1 onto the parent cane's u so the shared growth scalar reveals them
      // in lockstep with where they sprout.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vProgress;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvProgress = uv.x;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vProgress;\nuniform float uGrowth;\nuniform float uStart;\nuniform float uSpan;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uStart + vProgress * uSpan > uGrowth) discard;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.side = side;
    mesh.userData.isTube = true;
    mesh.renderOrder = -layer; // back-to-front for the semi-transparent canes
    this.layerGroups[layer].add(mesh);
  }

  newPlacements() {
    const placements = {};
    LEAF_TYPE_NAMES.forEach((name) => { placements[name] = []; });
    return placements;
  }

  // ── Rose footprints (plain list) so blooms nestle into clusters, like a
  // real climbing rose, but never sit one on top of another ──
  roseSpaceFree(x, y, r) {
    for (const o of this._roseSpots || []) {
      const dx = o.x - x, dy = o.y - y, minD = (o.r + r) * 0.68;
      if (dx * dx + dy * dy < minD * minD) return false;
    }
    return true;
  }
  roseSpaceClaim(x, y, r) { (this._roseSpots ||= []).push({ x, y, r }); }

  // ── Leaf spatial hash (40px cells) so leaves never stack blade-on-blade ──
  leafSpaceReset() { this._leafCells = new Map(); this._roseSpots = []; }
  _cellKey(cx, cy) { return ((cx / 40) | 0) + ',' + ((cy / 40) | 0); }
  leafSpaceFree(x, y, r) {
    const cells = this._leafCells;
    if (!cells) return true;
    const cx0 = ((x - r) / 40) | 0, cx1 = ((x + r) / 40) | 0;
    const cy0 = ((y - r) / 40) | 0, cy1 = ((y + r) / 40) | 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = cells.get(cx + ',' + cy);
        if (!bucket) continue;
        for (const o of bucket) {
          const dx = o.x - x, dy = o.y - y;
          const minD = (o.r + r) * 0.55;
          if (dx * dx + dy * dy < minD * minD) return false;
        }
      }
    }
    return true;
  }
  leafSpaceClaim(x, y, r) {
    const key = this._cellKey(x, y);
    let bucket = this._leafCells.get(key);
    if (!bucket) { bucket = []; this._leafCells.set(key, bucket); }
    bucket.push({ x, y, r });
  }

  // Exact 2D x-extent of a Z-rotated, uniformly scaled leaf bbox pivoted at px,
  // evaluated at rot and at the ±sway tilt animate() applies around the pivot.
  leafXExtent(bb, px, scale, rot) {
    let lo = Infinity, hi = -Infinity;
    for (const dr of [-LEAF_SWAY_RAD, 0, LEAF_SWAY_RAD]) {
      const c = Math.cos(rot + dr), s = Math.sin(rot + dr);
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) {
        const wx = px + (x * c - y * s) * scale;
        if (wx < lo) lo = wx;
        if (wx > hi) hi = wx;
      }
    }
    return [lo, hi];
  }

  // Walk one curve (main cane or crown stub) and append leaf placements.
  // Density is decided by PIXEL distance from the crown anchor; nothing is
  // placed under the fixed nav (that tube is never on screen). Real vine
  // anatomy: a tangled, leaf-dense crown at the anchor, thinning into sparser
  // mature growth, with small pale young leaves toward the tip.
  scatterLeaves(curve, length, side, layer, crown, placements, opts = {}) {
    const { uStart = 0, uSpan = 1, stepMul = 1 } = opts;
    const rnd = Math.random;
    const cs = this.crownScale;
    const t = layer / Math.max(1, this.layerCount - 1);
    // Far layers: denser-but-smaller foliage (foreshortening), not bare sticks.
    const layerStep = LEAF_STEP_PX * this.leafStepMul * (1 + layer * 0.22) * stepMul;
    const layerScaleMul = 1 - t * 0.5;
    const minSafeX = EDGE_PAD_PX, maxSafeX = this.fullW - EDGE_PAD_PX;
    let u = 0, i = 0;
    while (u < 0.999) {
      const p = curve.getPointAt(u);
      const d = Math.hypot(p.x - crown.anchorP.x, p.y - crown.anchorP.y);
      const mult = crownDensity(d, cs);
      const stepU = (layerStep / length) / mult;
      if (-p.y < this.navH - 10) { u += stepU; i++; continue; } // hidden by the nav
      const crownT = Math.max(0, 1 - d / (CROWN_R[1] * cs)); // 1 at anchor → 0 at 150px
      const gu = uStart + u * uSpan;                          // u on the PARENT cane
      const type = pickLeafType(gu, rnd);
      const bb = this.leafTypes[type]?.geometry.boundingBox;
      const tangent = curve.getTangentAt(u).normalize();
      const angle = Math.atan2(tangent.y, tangent.x);
      const naturalH = LEAF_NATURAL_H[type];
      // Phones: crown leaves never shrink below 0.7×.
      const rs = this.respScale + crownT * Math.max(0, 0.7 - this.respScale);
      const targetPx = (17 + rnd() * 13) * (1 + crownT * 0.45) * rs * layerScaleMul;
      const scale = targetPx / naturalH;
      const firstSign = i % 2 === 0 ? 1 : -1;
      let placed = null;
      // Natural side first, then mirror inward; if even the mirrored blade
      // would cross the keep-out pad or bump an already-placed leaf, drop it.
      // Leaves are budgeted by footprint: no two leaf centres closer than
      // ~55% of their combined lengths (a real spray overlaps at the base,
      // never blade-on-blade), tracked in a 40px spatial hash across layers.
      const footprint = targetPx * 0.5;
      for (const ss of [firstSign, -firstSign]) {
        const perp = angle + (Math.PI / 2) * ss;
        // Crown leaves fan 6–26px off the cane — a bush has spread, not a fringe.
        const offset = 3 + rnd() * 2 + crownT * (2 + rnd() * 6); // base on the cane, never floating
        const px = p.x + Math.cos(perp) * offset;
        const py = p.y + Math.sin(perp) * offset;
        const rot = angle + ss * (0.75 + rnd() * 0.3) + (rnd() - 0.5) * (0.4 + crownT * 0.9);
        const [lo, hi] = bb ? this.leafXExtent(bb, px, scale, rot) : [px, px];
        if (lo < minSafeX || hi > maxSafeX) continue;
        // centre of the blade (pivot is at the base; blade runs along +z rotated by rot)
        const cx = px + Math.cos(rot + Math.PI / 2) * targetPx * 0.5;
        const cy = py + Math.sin(rot + Math.PI / 2) * targetPx * 0.5;
        if (!this.leafSpaceFree(cx, cy, footprint)) continue;
        this.leafSpaceClaim(cx, cy, footprint);
        placed = { px, py, rot };
        break;
      }
      if (placed) {
        placements[type].push({
          u: gu,
          px: placed.px, py: placed.py,
          pz: p.z + 3 + (rnd() - 0.5) * (2 + crownT * 12), // follows the cane's depth
          scale, rot: placed.rot,
          tint: crownT > 0.35 ? 1 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3),
          t,
        });
      }
      u += stepU; i++;
    }
  }

  // One wind material per leaf archetype, shared by every layer/side/rebuild
  // (they were byte-identical clones — 8 materials instead of up to 96).
  leafMaterial(type, source) {
    this.leafMats ||= {};
    if (this.leafMats[type]) return this.leafMats[type];
    const mat = source.clone();
    mat.transparent = false;
    // Wind in the vertex shader: each instance flaps about its base (local
    // X axis, blade lifts) and sways (local Z), phased by its page position
    // so a gust visibly travels across the foliage. Leaf local frame after
    // glTF import: X = width, Y = length (base at origin), Z = curl.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uWind = this.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uWind;
vec2 vineWindAngles() {
  #ifdef USE_INSTANCING
    vec2 ip = instanceMatrix[3].xy;
  #else
    vec2 ip = vec2(0.0);
  #endif
  float ph = ip.x * 0.017 - ip.y * 0.011;
  // Elegant breeze: a calm baseline with slow, soft gusts rolling through
  // (low frequencies; the amplitude lives mostly in the gust term).
  float gust = 0.5 + 0.5 * sin(uTime * 0.16 + ph * 0.3) * sin(uTime * 0.065 + 1.3);
  float flap = (sin(uTime * 1.05 + ph) * 0.6 + sin(uTime * 1.8 + ph * 1.7) * 0.4) * (0.025 + 0.11 * gust);
  float sway = sin(uTime * 0.7 + ph * 0.8) * (0.015 + 0.07 * gust);
  return vec2(flap, sway) * uWind;
}
mat3 vineWindRot() {
  vec2 a = vineWindAngles();
  float c1 = cos(a.x), s1 = sin(a.x), c2 = cos(a.y), s2 = sin(a.y);
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, c1, s1,  0.0, -s1, c1);
  mat3 rz = mat3(c2, s2, 0.0,  -s2, c2, 0.0,  0.0, 0.0, 1.0);
  return rz * rx;
}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = vineWindRot() * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = vineWindRot() * transformed;`);
    };
    this.leafMats[type] = mat;
    return mat;
  }

  commitLeaves(placements, side, layer) {
    const tmpColor = new THREE.Color();
    LEAF_TYPE_NAMES.forEach((type) => {
      const items = placements[type];
      const leafType = this.leafTypes[type];
      if (!items.length || !leafType) return;
      const mat = this.leafMaterial(type, leafType.material);
      const inst = new THREE.InstancedMesh(leafType.geometry, mat, items.length);
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      inst.userData.side = side;
      inst.frustumCulled = false; // bounding sphere is computed at scale 0.0001 — useless
      const dummy = this._dummy;
      items.forEach((it, idx) => {
        dummy.position.set(it.px, it.py, it.pz);
        dummy.rotation.set(0, 0, it.rot);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
        tmpColor.copy(GREEN_TINTS[it.tint]).lerp(FAR_LEAF_TINT, it.t * 0.45);
        inst.setColorAt(idx, tmpColor);
        this.leafMeshItems.push({
          u: it.u, index: idx, inst,
          baseScale: it.scale,
          basePos: [it.px, it.py, it.pz],
          baseRotZ: it.rot,
          progress: 0,
        });
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
      this.layerGroups[layer].add(inst);
    });
  }

  // Crown stubs: short secondary canes radiating from the anchor — the tangle
  // a climbing rose throws from its woody base. Each stub is a constant-
  // curvature arc (heading changes monotonically by ≤0.7 rad) so Frenet
  // frames cannot flip; all variation is seeded per STUB, never per point.
  buildOffshoots(mainCurve, side, layer, crown, placements) {
    const sign = side === 'left' ? 1 : -1; // +x is "into the page" for the left cane
    const rnd = mulberry32(0xB0551E + layer * 613 + (side === 'left' ? 0 : 7919));
    const cs = this.crownScale;
    const phone = this.fullW < 700;
    const gutScale = phone ? 0.9 : 0.35 + 0.65 * Math.min(1, this.gut / 130);
    // [heading°, base offset px down the main cane]. Negative headings climb
    // back UP toward the corner so the crown fills the whole corner box, not
    // just the strip below the anchor — a bush spreads in every direction.
    let stubs = layer === 0
      ? [[-22, 2], [14, 0], [44, 30], [76, 12], [-58, 26], [5, 16]]
      : layer === 1 ? [[-34, 6], [26, 8], [62, 36], [1, 12]]
      : [[48, 20], [-12, 34]];
    if (this.gut < 60 && !phone) stubs = stubs.slice(0, 3);
    const roseCap = 2;
    stubs.forEach(([deg, baseD], k) => {
      const a0 = (deg + (rnd() - 0.5) * 12) * Math.PI / 180;
      const bend = 0.25 + rnd() * 0.45; // droops downward along its length
      const len = (95 + rnd() * 70) * cs * gutScale * (1 - layer * 0.15);
      const baseU = Math.min(0.999, crown.anchorU + (baseD * cs) / crown.length);
      const origin = mainCurve.getPointAt(baseU);
      const N = 6, ds = len / (N - 1);
      const pts = [];
      let x = origin.x, y = origin.y;
      for (let i = 0; i < N; i++) {
        const a = a0 + bend * (i / (N - 1));
        pts.push(new THREE.Vector3(x, y, origin.z + 3 + i * 0.6));
        x += sign * Math.cos(a) * ds;
        y -= Math.sin(a) * ds; // page-y down == three-y negative
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmillrom'.replace('mill','mull'), 0.5);
      curve.tag = 'stub' + k;
      const length = curve.getLength();
      const uStart = baseU, uSpan = length / crown.length;
      this.buildTube(curve, side, layer, { radiusMul: 0.62 - k * 0.07, minSeg: 24, uStart, uSpan, crown });
      this.scatterLeaves(curve, length, side, layer, crown, placements, { uStart, uSpan, stepMul: 0.85 });
      if (k < roseCap && layer <= 1) {
        const tipU = Math.max(0, 1 - 10 / length);
        this.addRose(curve, tipU, side, layer, { bud: layer > 0 || k === 1, uReveal: uStart + tipU * uSpan });
      }
    });
  }

  // A lateral cane trained along the underside of the top bar: it leaves the
  // crown at the corner and runs toward the centre with a gentle swag, so the
  // foliage frames the bar from below (the bar itself stays clean).
  buildGarland(mainCurve, side, layer, crown, placements) {
    const sign = side === 'left' ? 1 : -1;
    const rnd = mulberry32(0x6A21A + layer * 101 + (side === 'left' ? 0 : 331));
    const cs = this.crownScale;
    const phone = this.fullW < 700;
    // On phones the two garlands must meet: the top band is the whole frame.
    const reach = this.fullW * (phone ? 0.56 : 0.46) - layer * (phone ? 14 : 70);
    const origin = crown.anchorP;
    const N = 10, ds = reach / (N - 1);
    const sag = (phone ? 16 : 30) * (1 + layer * 0.4);
    const pts = [];
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const x = origin.x + sign * ds * i;
      const y = -(this.navH + 10 + layer * 7) - sag * Math.sin(Math.PI * f) - 6 * Math.sin(f * 9.4 + layer * 1.3);
      pts.push(new THREE.Vector3(x, y, origin.z + 4 + layer * 0.5 + 3 * Math.sin(f * 5.3 + layer)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    curve.tag = 'garland';
    const length = curve.getLength();
    // Compressed u-span: the garland is fully grown as soon as the tip clears the crown.
    const uStart = crown.anchorU, uSpan = 0.02;
    this.buildTube(curve, side, layer, { radiusMul: 0.86 - layer * 0.1, minSeg: 48, uStart, uSpan, crown, taperEnd: 0.14 });
    this.scatterLeaves(curve, length, side, layer, crown, placements, { uStart, uSpan, stepMul: phone ? 0.85 : 0.72 });
    const roseN = phone ? (layer === 0 ? 4 : 3) : (layer === 0 ? 5 : 3);
    for (let k = 0; k < roseN; k++) {
      const u = Math.min(0.74, 0.14 + k * (0.66 / roseN) + rnd() * 0.07); // never on the thin tip
      this.addRose(curve, u, side, layer, {
        bud: k % 2 === 1, off: (k % 2 ? -1 : 1) * (4 + rnd() * 3) * cs,
        sizeMul: (layer === 0 ? 1.45 : 1.25) * (phone ? 1.12 : 1), uReveal: uStart + u * uSpan,
      });
    }
  }

  plantVineRoses(curve, heroFrac, side, layer, crown) {
    const cs = this.crownScale;
    // Roses are 2–3 draws each (merged petals / greens / stamens) but still
    // the bulk of the triangles, so the count is tiered by viewport and layer:
    // the crown clump and a couple of hero blooms on the front cane, thinning
    // fast behind it.
    let crownSpots, heroSpots;
    if (layer === 0) {
      crownSpots = [{ d: 4, bud: true, off: 9 }, { d: 22, bud: true, off: -13 }, { d: 46, off: 11 }, { d: 92, bud: true, off: -8 }, { d: 138, off: 14 }];
      heroSpots = side === 'left' ? [0.48, 0.72] : [0.55, 0.85];
      // Phones keep the full crown clump: the corners are what frames the
      // invitation, so they carry the most blooms at every width.
    } else if (layer === 1) {
      crownSpots = [{ d: 12, bud: true, off: -10 }, { d: 60, off: 12 }];
      heroSpots = this.roseTier >= 2 ? (side === 'left' ? [0.62] : [0.97]) : [];
    } else if (layer === 2 && this.roseTier >= 2) {
      crownSpots = [{ d: 30, bud: true, off: 8 }];
      heroSpots = [];
    } else {
      return;
    }
    crownSpots.forEach(({ d, bud, off }) => {
      const u = Math.min(0.999, crown.anchorU + (d * cs) / crown.length);
      this.addRose(curve, u, side, layer, { bud, off: off * cs, sizeMul: layer === 0 ? 1.15 : 1, zLift: 6 });
    });
    heroSpots.forEach((f) => this.addRose(curve, Math.min(0.999, heroFrac * f), side, layer, {}));

    // Blooms all the way down the page (a climbing rose flowers along its
    // whole length, not just at the crown): every ~300-460px on the front
    // two canes, alternating buds / half-open / open, with a seeded offset
    // so the two sides and the two canes never line up.
    // Small blooms all the way down every cane (user: "small roses along all
    // the vine — small ones only"): buds and half-open heads at ~55% size,
    // every ~150–260px depending on depth, seeded so sides/canes never line up.
    if (layer <= 2) {
      const vh = window.innerHeight;
      const spacing = [28, 40, 52][layer]; // a bloom every few centimetres of cane
      const seedRnd = mulberry32(0xA5E5 + layer * 31 + (side === 'left' ? 0 : 977));
      let y = vh * 0.55 + seedRnd() * spacing;
      let k = 0;
      while (y < this.docH - 200) {
        const u = uAtPageY(curve, y);
        const bud = seedRnd() < 0.30; // mostly open blooms so the colour reads
        const off = (k % 2 === 0 ? 1 : -1) * (2 + seedRnd() * 3) * cs;
        // Phones draw at ~0.55x scale, so their blooms get a boost to stay
        // readable as roses rather than pink dots.
        const phoneBoost = this.roseTier === 0 ? 1.3 : 1;
        this.addRose(curve, Math.min(0.999, u), side, layer, { bud, off, sizeMul: [0.8, 0.7, 0.6][layer] * phoneBoost }); // big enough for the colour to read at a glance
        y += spacing * (0.75 + seedRnd() * 0.5);
        k++;
      }
    }
  }

  addRose(curve, u, side, layer, { bud = false, off = 0, sizeMul = 1, zLift = 0, uReveal = u } = {}) {
    // Buds use the closed Blender variant; open spots mix full spirals with
    // half-open blooms — a real cane carries every stage at once.
    const r = Math.random();
    const variant = bud ? (r < 0.8 ? 'Rose_Bud' : 'Rose_Half') : (r < 0.6 ? 'Rose_A' : 'Rose_Half');
    const t = layer / Math.max(1, this.layerCount - 1);
    const layerScale = 1 - t * 0.5;
    const p = curve.getPointAt(u);
    const tg = curve.getTangentAt(u);
    // Pick the bloom's on-screen diameter now so its footprint can be clamped
    // inside the keep-out pad; +10% covers the back.out overshoot.
    const targetPx = (bud ? 20 + Math.random() * 14 : 55 + Math.random() * 30) * this.respScale * layerScale * sizeMul;
    const reach = (targetPx / 2) * 1.1;
    // Tiny back-layer buds read as floating dots next to a hairline cane — skip.
    if (reach < 5) return;
    // A bloom must overlap its cane: cap the sideways offset so at least ~55%
    // of the bloom radius still covers the stem (crown spots asked for more).
    off = Math.sign(off || 1) * Math.min(Math.abs(off), reach * 0.45);
    const rawX = p.x - tg.y * off;
    const x = Math.min(this.fullW - EDGE_PAD_PX - reach, Math.max(EDGE_PAD_PX + reach, rawX));
    // Never let a bloom's top edge slide under the fixed nav (it read as
    // "cut off"): page-y of the bloom centre must be >= navH + reach.
    const rawY = p.y + tg.x * off;
    // Buds may tuck up behind the translucent top bar (reads as the bush
    // wrapping the bar); an open bloom's centre stays below the bar's midline.
    const y = Math.min(rawY, -(this.navH + 6 + reach));
    // Two blooms never overlap: skip the spot if another rose's footprint
    // already covers it (checked across sides/layers). Also keep the bloom
    // attached: if the edge/nav clamps moved it more than half its radius
    // off the cane, drop it rather than leave a floating flower.
    if (!this.roseSpaceFree(x, y, reach)) return;
    if (Math.hypot(x - rawX, y - rawY) > reach * 0.35) return;
    const root = this.instantiateRose(layer, variant);
    if (!root) return;
    root.userData.variant = variant;
    this.roseSpaceClaim(x, y, reach);
    root.position.set(x, y, p.z + (bud ? 2 : 3) + zLift);
    // The bloom axis is local +Y (Blender Z-up → glTF Y-up). Tilt it toward
    // the viewer so we look INTO the spiral — the view that instantly reads
    // as a rose — with a random spin around the axis and a ±20° nod so no two
    // blooms sit identically. Euler XYZ applies Z, then Y (spin), then X (tilt).
    const faceOn = Math.random() < 0.7;
    const tilt = faceOn ? (Math.random() - 0.5) * 0.7 : (Math.random() < 0.5 ? 0.75 : -0.75) + (Math.random() - 0.5) * 0.4;
    root.rotation.set(Math.PI / 2 + tilt, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5);
    const baseRx = root.rotation.x;
    root.scale.setScalar(0.0001);
    root.visible = false; // no draw calls until revealed
    this.layerGroups[layer].add(root);
    // Openness variety on top of the modelled variants: the closed variant
    // is already a bud, so it only gets a whisper of pull; open blooms vary.
    const closedness = variant === 'Rose_Bud' ? Math.random() * 0.15
      : variant === 'Rose_Half' ? 0.15 + Math.random() * 0.3
      : Math.random() * 0.4;
    root.userData.petalUniforms.uClosed.value = closedness;
    this.vineRoses.push({ root, u: uReveal, side, layer, revealed: false, bud, closedness, targetPx, baseRx, curve, uLocal: u, reach, rawX, rawY });
  }

  // One bloom = a Group of 2–3 meshes over the shared per-variant merged
  // geometries: petals (own material clone → per-bloom uniforms), greens,
  // and — front layer, tier >= 1 only — the merged stamens.
  instantiateRose(layer, variant = 'Rose_A') {
    const useStamen = layer === 0 && this.roseTier >= 1;
    const wantLo = layer >= 1 || this.roseTier === 0;
    const tpl = (wantLo && this.roseTemplates?.[variant + '_lo']) || this.roseTemplates?.[variant] || this.roseTemplates?.Rose_A;
    if (!tpl) return null;
    const root = new THREE.Group();
    const tints = VineScene.PETAL_TINTS;
    const petalMat = this.makePetalMaterial(tpl.petalMat, tints[(Math.random() * tints.length) | 0]);
    root.userData.petalMat = petalMat;
    root.userData.petalUniforms = petalMat.userData.petalUniforms;
    const petals = new THREE.Mesh(tpl.petalGeo, petalMat);
    petals.name = 'petals_merged';
    petals.frustumCulled = false; // animate() already hides off-screen blooms; the tilt moves the bounds
    root.add(petals);
    if (tpl.sepalGeo) {
      const greens = new THREE.Mesh(tpl.sepalGeo, tpl.sepalMat);
      greens.name = 'sepals_merged';
      root.add(greens);
    }
    if (useStamen && tpl.stamenGeo) {
      const stamens = new THREE.Mesh(tpl.stamenGeo, tpl.stamenMat);
      stamens.name = 'stamen_merged';
      root.add(stamens);
    }
    return root;
  }

  revealVineRose(vr) {
    vr.revealed = true;
    vr.root.visible = true;
    const targetScale = vr.targetPx / 2.3; // rose GLB is ~2.3 units across
    vr.root.scale.setScalar(targetScale); // blooms pre-exist with the canes: no pop-in
    // Petal breathing + closedness run in the petal vertex shader (uTime +
    // per-bloom uniforms set in addRose) — zero per-frame CPU per petal.
    // Gentle idle sway so the bloom feels alive, not a static decal.
    // The two infinite sway tweens are paused while the bloom is scrolled off
    // screen (animate() hides it anyway) so only visible roses tick.
    const baseY = vr.root.rotation.y;
    vr.tweens = [
      gsap.to(vr.root.rotation, {
        y: baseY + 0.1 + Math.random() * 0.06,
        duration: 3.2 + Math.random() * 2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: Math.random() * 2,
      }),
      gsap.to(vr.root.rotation, {
        z: (Math.random() - 0.5) * 0.09,
        duration: 4.0 + Math.random() * 2.2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: Math.random() * 2,
      }),
    ];
    vr.onScreen = true;
  }

  // ── Scroll-driven growth ───────────────────────────────────────────────────
  updateGrowthTarget(first) {
    if (!this.built || !this.curves?.length) return;
    const ref = this.curves[0].curve;
    const vh = window.innerHeight;
    const heroFrac = uAtPageY(ref, vh);
    // Map the frontier PAGE-Y (0.82 viewports below the scroll top, so the
    // growing tip stays just below the fold) through the real curve — dividing
    // by page height assumed u is linear in y, but the crown arch and the
    // zigzag consume extra arc length, which left the reveal front trailing
    // ~250px inside the viewport as a hard cut-off.
    // The vines pre-exist along the whole page (no grow-in): growth is always
    // complete. Scroll only drives the parallax lag / sway.
    void heroFrac; void vh;
    this.growth = 1;
    this._growthTarget = 1;
  }

  setupListeners() {
    this._onScroll = () => {
      const y = window.scrollY;
      this.sway = Math.max(-12, Math.min(12, this.sway + (y - this.lastScrollY) * 0.1));
      this.lag = Math.max(-40, Math.min(40, this.lag + (y - this.lastScrollY) * 0.35));
      this.lastScrollY = y;
      this.scrollY = y;
      this.updateGrowthTarget(false);
    };
    this._onResize = () => {
      this.resize();
      // Mobile address-bar show/hide only changes innerHeight; the curve
      // depends on clientWidth + scrollHeight, so don't rebuild for that.
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.scrollHeight;
      if (w === this._lastW && h === this._lastDocH) return;
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.build(), 250);
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    // clientWidth (not innerWidth) so canvas, camera and the CSS mask agree
    // even with a classic scrollbar.
    const w = document.documentElement.clientWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.right = w;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    this.animFrame = requestAnimationFrame(() => this.animate());
    if (!this.built) { this.renderer.render(this.scene, this.camera); return; }

    // Frame-rate independent easing (a 20fps phone converges as fast as a
    // 120Hz desktop). dt is clamped so a background-tab pause doesn't jump.
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - (this._lastFrame ?? nowMs)) / 1000);
    this._lastFrame = nowMs;
    const easeGrowth = 1 - Math.exp(-5.0 * dt); // ≈0.15/frame at 60fps
    const easeLeaf = 1 - Math.exp(-6.3 * dt);    // ≈0.10/frame at 60fps
    const decaySway = Math.exp(-5.0 * dt);       // ≈0.92/frame at 60fps
    const decayLag = Math.exp(-9.05 * dt);       // ≈0.86/frame at 60fps

    // Growth eases toward its scroll-derived target.
    if (this._growthTarget != null) {
      // Growth is monotonic: a cane never retracts on scroll-up (a bloom that
      // opened stays open, so a retracting cane would leave it floating).
      if (this._growthTarget > this.growth) {
        this.growth += (this._growthTarget - this.growth) * easeGrowth;
        if (this._growthTarget - this.growth < 0.0005) this.growth = this._growthTarget;
      }
    }

    // Sway/lag decay, snapped to 0 so the scene can go fully idle.
    this.sway *= decaySway; if (Math.abs(this.sway) < 0.02) this.sway = 0;
    this.lag *= decayLag; if (Math.abs(this.lag) < 0.05) this.lag = 0;

    // Camera tracks scroll; scroll lag is applied per layer (front gets the
    // full ±40px, farthest 25%) — motion parallax, the strongest depth cue an
    // orthographic camera can give.
    this.group.position.y = this.scrollY;
    const nL = Math.max(1, this.layerCount - 1);
    this.layerGroups.forEach((g, l) => { g.position.y = this.lag * (1 - (l / nL) * 0.75); });

    this.uGrowth.value = this.growth;

    // Leaves: ease each instance's reveal progress toward its target; settled
    // items are skipped entirely when there's no sway, so idle frames are free.
    const dummy = this._dummy;
    const touched = this._touched;
    touched.clear();
    const swayActive = this.sway !== 0;
    const swayRad = this.sway * Math.PI / 180;
    for (const item of this.leafMeshItems) {
      const target = item.u <= this.growth ? 1 : 0;
      if (!swayActive && item.progress === target) continue;
      item.progress += (target - item.progress) * easeLeaf;
      if (Math.abs(item.progress - target) < 0.002) item.progress = target;
      const s = item.baseScale * item.progress;
      dummy.position.set(item.basePos[0], item.basePos[1], item.basePos[2]);
      dummy.rotation.set(0, 0, item.baseRotZ + swayRad * (item.index % 2 ? 1 : -1));
      dummy.scale.setScalar(Math.max(0.0001, s));
      dummy.updateMatrix();
      item.inst.setMatrixAt(item.index, dummy.matrix);
      touched.add(item.inst);
    }
    touched.forEach((inst) => { inst.instanceMatrix.needsUpdate = true; });

    // Vine roses: reveal (once) as growth passes them; nod in the wind only
    // while on screen (petal breathing is in the shader, driven by uTime).
    const now = performance.now() * 0.001;
    this.uTime.value = now;
    const vh = window.innerHeight;
    for (const vr of this.vineRoses) {
      if (!vr.revealed) {
        if (vr.u + 0.006 <= this.growth) this.revealVineRose(vr);
        continue;
      }
      const screenY = -vr.root.position.y - this.scrollY; // page px from viewport top
      const onScreen = screenY > -160 && screenY < vh + 160;
      vr.root.visible = onScreen;
      if (onScreen !== vr.onScreen) {
        vr.onScreen = onScreen;
        if (vr.tweens) for (const tw of vr.tweens) onScreen ? tw.play() : tw.pause();
      }
      if (!onScreen) continue;
      // Wind nod: same gust field as the leaves, phased by position, so the
      // bloom leans with the foliage around it.
      const ph = vr.root.position.x * 0.017 - vr.root.position.y * 0.011;
      const gust = 0.5 + 0.5 * Math.sin(now * 0.16 + ph * 0.3) * Math.sin(now * 0.065 + 1.3);
      const nod = (Math.sin(now * 0.85 + ph) * 0.6 + Math.sin(now * 1.5 + ph * 1.7) * 0.4) * (0.012 + 0.05 * gust) * this.uWind.value;
      vr.root.rotation.x = vr.baseRx + nod;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animFrame);
    this.disposeBuilt();
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._resizeTimer);
    this.envTex?.dispose();
    this.barkColorTex?.dispose();
    this.barkBumpTex?.dispose();
    Object.values(this.leafMats || {}).forEach((m) => m.dispose());
    (this.roseMats || []).forEach((m) => m.dispose());
    [this.leafMaps, this.petalMaps].forEach((maps) => Object.values(maps || {}).forEach((t) => t.dispose()));
    Object.values(this.leafTypes || {}).forEach((lt) => lt.geometry.dispose());
    Object.values(this.roseTemplates || {}).forEach((t) => [t.petalGeo, t.sepalGeo, t.stamenGeo].forEach((g) => g?.dispose()));
    this.roseSourceScene?.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.renderer.dispose();
  }
}
