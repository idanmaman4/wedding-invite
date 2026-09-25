import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// The GLB is produced by a separate pipeline and may not exist yet. A static
// `?url` import would fail `vite build` while it is absent, so resolve it
// through import.meta.glob: an empty map when missing (the scene then renders
// nothing), the bundled URL once the file lands.
const GLB_MATCHES = import.meta.glob('../assets/procession.glb', {
  eager: true,
  query: '?url',
  import: 'default',
});
const PROCESSION_URL = Object.values(GLB_MATCHES)[0] || null;

const GOLD = 0xC9A96E;

// ── Walk choreography ────────────────────────────────────────────────────────
const X_START = 2.3;        // metres from centre where each figure enters
const X_END = 0.32;         // where they stop, facing each other
const WALK_END = 0.85;      // progress at which the walk finishes; 0.85–1 = arrival
const STEPS = 4;            // strides over the 2.28 m walk (~0.57 m each — unhurried)
const LEG_AMP = 28 * Math.PI / 180;
const ARM_AMP = 14 * Math.PI / 180;      // groom arms, opposite to legs
const BRIDE_ARM_AMP = 5 * Math.PI / 180; // bride holds the bouquet, arms barely swing
const BOB = 0.02;
const DRESS_SWAY = 3 * Math.PI / 180;
const WALK_YAW = Math.PI / 2 - 0.55;     // three-quarter toward the camera while walking
const FACE_YAW = 1.02; // three-quarter turn: they face each other but keep their fronts to the camera
const LEAN_IN = 0.045;                   // radians, forward tilt on arrival

// Photo maps attached by material name (the glTF exporter drops image links).
// Materials with a colour map get a white base so the photo carries the hue
// rather than double-multiplying with whatever colour the exporter wrote.
const MAP_SETS = {
  mat_dress: { map: 'dress_color.jpg', normalMap: 'dress_normal.jpg', roughnessMap: 'dress_rough.jpg', repeat: 2.5, normalScale: 0.6, white: true },
  mat_suit:  { map: 'suit_color.jpg',  normalMap: 'suit_normal.jpg',  roughnessMap: 'suit_rough.jpg',  repeat: 3.0, normalScale: 0.5, white: true },
  mat_drape: { map: 'drape_color.jpg', normalMap: 'drape_normal.jpg', repeat: 2.0, normalScale: 0.7, white: true },
  mat_floor: { map: 'marble_color.jpg', roughnessMap: 'marble_rough.jpg', repeat: 2.0, white: true },
  mat_gold:  { roughnessMap: 'gold_rough.jpg', repeat: 2.0 },
  // Rose clusters on the front posts reuse the vine's photo maps (keyed by mesh name below).
  rose_petal: { map: 'petal_color.jpg', normalMap: 'petal_normal.jpg', roughnessMap: 'petal_rough.jpg', repeat: 1.0, normalScale: 0.55 },
  rose_sepal: { map: 'leaf_color.jpg', normalMap: 'leaf_normal.jpg', roughnessMap: 'leaf_rough.jpg', repeat: 1.0, normalScale: 0.8 },
  // Garden hall: wooden posts/beams + climbing vines, and the leaf garland.
  wood: { map: 'bark_color.jpg', bumpMap: 'bark_bump.jpg', repeat: 2.0 },
  leaves: { map: 'leaf_color.jpg', normalMap: 'leaf_normal.jpg', roughnessMap: 'leaf_rough.jpg', repeat: 1.0, normalScale: 0.8 },
};

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Per-step ease: mostly smoothstep with a little linear so the scrubbed walk
// never feels like it stalls between strides.
const stepEase = (f) => 0.65 * smooth(f) + 0.35 * f;

function makeContactShadowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(26,10,10,0.55)');
  g.addColorStop(0.45, 'rgba(26,10,10,0.22)');
  g.addColorStop(1, 'rgba(26,10,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ProcessionScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.available = !!PROCESSION_URL;
    this.loaded = false;
    this.disposed = false;
    this.progress = 0;
    this.inView = false;
    this.animFrame = null;
    this.hallH = 3.0; // refined from the Hall bbox after load
    this.w = 0; this.h = 0;
    this.clock = new THREE.Clock(false);
    this.figures = {};
    this.textures = [];
    this.ready = new Promise((res) => { this._resolveReady = res; });

    if (!this.available) { this._resolveReady(false); return; }
    try {
      this.init();
    } catch (e) {
      console.warn('[procession] WebGL init failed', e);
      this.available = false;
      this._resolveReady(false);
      return;
    }
    this.load();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    // Phones render the card at 1.5x (same cap as the vine): the canvas is a
    // few hundred CSS px wide, and PCF-soft shadows + sheen materials are
    // per-pixel work, so 2-3x DPR was the single biggest cost there.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // fallback scene only; the clip carries the phone case
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The shadow map is re-rendered only when the walk progress changes
    // (see applyProgress); the idle breathing after arrival is sub-pixel.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this._shadowProgress = -1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 2.2, 0.1, 50);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.9;

    // Soft warm key from upper-left-front; ivory sky / warm floor bounce.
    const key = new THREE.DirectionalLight(0xfff4e4, 1.7);
    key.position.set(-2.6, 4.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4.5; key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 14;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);
    // Cool rim from behind-right separates the figures from the ivory page.
    const rim = new THREE.DirectionalLight(0xdfe9ff, 0.9);
    rim.position.set(2.8, 3.2, -3.5);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0xd9c7b0, 0.45));

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Shadow catcher: invisible ground that only shows the cast shadows, so
    // the figures and posts read as standing on the card itself.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 8),
      new THREE.ShadowMaterial({ opacity: 0.14, transparent: true, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    ground.renderOrder = -2;
    this.scene.add(ground);
    this.ground = ground;

    this.makeDust();

    this.shadowTex = makeContactShadowTexture();
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex, transparent: true, depthWrite: false, toneMapped: false,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.resize();

    // Only tick while on screen; the scrubbed walk still updates via setProgress.
    this.intersection = new IntersectionObserver((entries) => {
      this.inView = entries.some((e) => e.isIntersecting);
      if (this.inView) { this.start(); this.onInView?.(); } else this.stop();
    }, { rootMargin: '80px 0px' });
    this.intersection.observe(this.canvas);
  }

  resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.frame();
    this.renderOnce();
  }

  // Fit the walk (±X_START plus body width) and the hall height at z = 0 with
  // the floor a little above the bottom edge, camera slightly elevated so we
  // look gently down at the canopy.
  frame() {
    const aspect = this.w / this.h;
    const dist = 8.6;   // pulled back so the whole arch, roof and both figures fit
    const halfW = Math.max(4.1, (this.hallHalfW || 0) + 0.55);
    // Half-height needed so the whole hall (ground to roof ridge) plus a
    // margin fits, and so the walk's full width fits at this aspect.
    const hv = Math.max(halfW / aspect, (this.hallH * 1.10 + 0.25) / 2);
    const cy = hv - 0.10; // y = 0 sits just above the stage hairline
    this.camera.aspect = aspect;
    this.camera.fov = 2 * Math.atan(hv / dist) * 180 / Math.PI;
    // Orbit rig: the camera rides a slow circle around the arch (see aimCamera).
    this.camDist = dist;
    this.camY = cy + 0.7;
    this.camLookY = cy;
    this.aimCamera(0);
    this.camera.updateProjectionMatrix();
  }

  // Slow, shallow orbit — a gentle drift around the couple, never a spin.
  aimCamera(t) {
    const a = Math.sin(t * 0.34) * 0.17;          // ±10° around the arch
    const lift = Math.sin(t * 0.23 + 1.1) * 0.12; // a touch of rise and fall
    this.camera.position.set(
      Math.sin(a) * this.camDist,
      this.camY + lift,
      Math.cos(a) * this.camDist,
    );
    this.camera.lookAt(0, this.camLookY, 0);
  }

  load() {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(
      PROCESSION_URL,
      (gltf) => {
        draco.dispose();
        if (this.disposed) return;
        try {
          const texturesReady = this.setup(gltf.scene);
          // Every photo map is attached before the first real render (with a
          // cap so a slow network can never hold the walk hostage), then all
          // programs are compiled once — instead of a recompile + hitch each
          // time a texture landed, typically right as the walk started.
          const cap = new Promise((res) => setTimeout(res, 8000));
          Promise.race([texturesReady, cap]).then(() => {
            if (this.disposed) return;
            try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* non-fatal */ }
            this.loaded = true;
            this._resolveReady(true);
            this.applyProgress();
            this.renderOnce();
          });
        } catch (e) {
          console.warn('[procession] setup failed', e);
          this._resolveReady(false);
        }
      },
      undefined,
      (err) => { console.warn('[procession] GLB load failed', err); draco.dispose(); this._resolveReady(false); },
    );
  }

  setup(root) {
    const bride = root.getObjectByName('Bride');
    const groom = root.getObjectByName('Groom');
    if (!bride || !groom) throw new Error('procession.glb: Bride/Groom roots missing');
    const hall = root.getObjectByName('Hall');
    if (hall) {
      const box = new THREE.Box3().setFromObject(hall);
      if (isFinite(box.max.y) && box.max.y > 1) this.hallH = box.max.y;
      if (isFinite(box.max.x)) this.hallHalfW = Math.max(box.max.x, -box.min.x);
      this.frame();
    }

    this.group.add(root);
    const texturesReady = this.tuneMaterials(root);
    const floor = root.getObjectByName('hall_floor');
    if (floor) floor.visible = false; // the card is the floor
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !/veil|canopy|valance|beam|petal|sepal|calyx|anther|hall_leaves|hall_vine/i.test(o.name); // posts + figures only in the shadow pass // posts + figures only: a canopy slab shadow reads as a grey box
      o.receiveShadow = /canopy|valance|dress|torso/i.test(o.name);
    });

    // Animated parts keep their exported pose: swings are added to the base
    // Euler, never assigned over it (the arms ship with a resting rotation).
    const part = (parent, name) => {
      const o = parent.getObjectByName(name);
      if (!o) return null;
      o.userData.baseRot = o.rotation.clone();
      return o;
    };
    // Dress and veil are exported with their origin at the feet; re-pivot so
    // the hem swings about the waist and the veil trails from the crown.
    const repivot = (o, y) => {
      if (!o) return null;
      const g = new THREE.Group();
      g.name = o.name + '_pivot';
      o.parent.add(g);
      g.position.set(o.position.x, o.position.y + y, o.position.z);
      g.attach(o);
      g.userData.baseRot = g.rotation.clone();
      return g;
    };
    this.figures.bride = {
      root: bride, dir: 1,
      legL: null, legR: null,
      armL: part(bride, 'bride_arm_L'), armR: part(bride, 'bride_arm_R'),
      dress: repivot(part(bride, 'bride_dress'), 1.0),
      veil: repivot(part(bride, 'bride_veil'), 1.68),
      head: part(bride, 'bride_head'),
      armAmp: BRIDE_ARM_AMP,
      shadow: this.makeShadow(1.1, 0.6),
    };
    this.figures.groom = {
      root: groom, dir: -1,
      legL: part(groom, 'groom_leg_L'), legR: part(groom, 'groom_leg_R'),
      armL: part(groom, 'groom_arm_L'), armR: part(groom, 'groom_arm_R'),
      dress: null, veil: null,
      head: part(groom, 'groom_head'),
      armAmp: ARM_AMP,
      shadow: this.makeShadow(0.8, 0.5),
    };
    this.figureList = [this.figures.bride, this.figures.groom];
    return texturesReady;
  }

  makeDust() {
    const N = 160;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5.2;
      pos[i * 3 + 1] = 0.15 + Math.random() * 3.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.6;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustSeed = seed;
    this.dustBase = pos.slice();
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,205,1)'); g.addColorStop(0.35, 'rgba(201,169,110,0.8)'); g.addColorStop(1, 'rgba(201,169,110,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    const mat = new THREE.PointsMaterial({ map: tex, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true, toneMapped: false });
    this.dust = new THREE.Points(geo, mat);
    this.dust.visible = false; // no floating sparkle: reads as stars on a dark/opaque background
    this.scene.add(this.dust);
  }

  updateDust(t) {
    if (!this.dust) return;
    const a = this.dust.geometry.attributes.position.array;
    const b = this.dustBase, sd = this.dustSeed;
    for (let i = 0; i < sd.length; i++) {
      const k = sd[i];
      a[i * 3] = b[i * 3] + 0.12 * Math.sin(t * 0.25 + k);
      a[i * 3 + 1] = b[i * 3 + 1] + 0.10 * Math.sin(t * 0.35 + k * 1.7) + ((t * 0.05 + k) % 0.6) - 0.3;
      a[i * 3 + 2] = b[i * 3 + 2] + 0.08 * Math.cos(t * 0.3 + k * 0.9);
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.material.opacity = 0.7 + 0.15 * Math.sin(t * 0.8);
  }

  makeShadow(w, d) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.shadowMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.006;
    mesh.renderOrder = -1;
    mesh.visible = false; // superseded by real shadow-mapped shadows
    this.group.add(mesh);
    return mesh;
  }

  tuneMaterials(root) {
    const byName = new Map();
    // The exporter wrote one material per rose petal (34 per bloom x 9 blooms,
    // all with identical parameters): collapse petals and sepals to a single
    // shared material each, so consecutive draws skip the uniform re-upload.
    const sharedByKey = { rose_petal: null, rose_sepal: null };
    root.traverse((o) => {
      if (!o.isMesh) return;
      // Mesh-name roles override the material name; everything else is keyed
      // per material (multi-material meshes like leg = suit + tie keep both).
      const roleKey = /^petal_L\d+_/.test(o.name) ? 'rose_petal'
        : /^(sepal|calyx)/.test(o.name) ? 'rose_sepal'
        : /^anther/.test(o.name) ? 'mat_gold'
        : /^hall_(post|beam|vine)/.test(o.name) ? 'wood'
        : /^hall_leaves/.test(o.name) ? 'leaves' : null;
      if (roleKey && roleKey in sharedByKey && !Array.isArray(o.material)) {
        if (sharedByKey[roleKey]) { o.material = sharedByKey[roleKey]; return; }
        sharedByKey[roleKey] = o.material;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        const key = roleKey || (m.name || '').replace(/\.\d+$/, '');
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(m);
      });
      if (/veil/i.test(o.name)) o.renderOrder = 2;
    });

    const texLoader = new THREE.TextureLoader();
    const pending = [];
    const attach = (mats, slot, file, repeat, srgb) => {
      pending.push(new Promise((resolve) => {
        texLoader.load('/textures/' + file, (t) => {
          if (this.disposed) { t.dispose(); resolve(); return; }
          t.flipY = false;
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(repeat, repeat);
          t.anisotropy = 4;
          this.textures.push(t);
          mats.forEach((m) => { m[slot] = t; m.needsUpdate = true; });
          resolve();
        }, undefined, () => resolve()); // a missing map is cosmetic, never blocking
      }));
    };

    Object.entries(MAP_SETS).forEach(([name, set]) => {
      const mats = byName.get(name);
      if (!mats) return;
      mats.forEach((m) => {
        if (set.white && m.color) m.color.set(0xffffff);
        if (set.normalScale != null && m.normalScale) m.normalScale.set(set.normalScale, set.normalScale);
        m.envMapIntensity = 0.8;
      });
      if (set.map) attach(mats, 'map', set.map, set.repeat, true);
      if (set.normalMap) attach(mats, 'normalMap', set.normalMap, set.repeat, false);
      if (set.roughnessMap) attach(mats, 'roughnessMap', set.roughnessMap, set.repeat, false);
      if (set.bumpMap) attach(mats, 'bumpMap', set.bumpMap, set.repeat, false);
    });

    (byName.get('mat_gold') || []).forEach((m) => {
      m.color.set(GOLD);
      m.metalness = 1;
      m.roughness = 0.35;
      m.envMapIntensity = 1.0;
    });
    (byName.get('mat_veil') || []).forEach((m) => {
      m.transparent = true;
      m.opacity = 0.45;
      m.side = THREE.DoubleSide;
      m.depthWrite = false;
      m.roughness = 0.6;
    });
    (byName.get('mat_skin') || []).forEach((m) => { m.roughness = 0.65; });
    (byName.get('mat_eye') || []).forEach((m) => { m.roughness = 0.35; m.envMapIntensity = 0.4; });
    (byName.get('rose_petal') || []).forEach((m) => {
      m.color.setRGB(1.12, 0.58, 0.62); // same crimson pull as the vine roses
      m.roughness = 0.95; m.side = THREE.DoubleSide;
      if ('sheen' in m) { m.sheen = 0.8; m.sheenRoughness = 0.5; }
    });
    (byName.get('rose_sepal') || []).forEach((m) => { m.roughness = 0.9; m.side = THREE.DoubleSide; });
    (byName.get('wood') || []).forEach((m) => {
      m.color.setRGB(0.62, 0.50, 0.36); m.roughness = 0.85; m.metalness = 0; m.bumpScale = 0.6;
    });
    (byName.get('leaves') || []).forEach((m) => {
      // Deep garden green: the leaf photo is a bright spring green and this stage
      // is lit far harder than the vine scene, so pull it down a lot.
      m.color.setRGB(0.30, 0.46, 0.27, THREE.SRGBColorSpace); m.roughness = 1.0; m.side = THREE.DoubleSide; m.vertexColors = true;
      m.envMapIntensity = 0.35;
      if ('sheen' in m) { m.sheen = 0.0; }
    });
    (byName.get('mat_hair_bride') || []).concat(byName.get('mat_hair_groom') || []).forEach((m) => {
      m.roughness = 0.5;
    });
    return Promise.all(pending);
  }

  // ── Scroll-driven choreography ───────────────────────────────────────────
  setProgress(p) {
    this.progress = clamp01(p);
    if (!this.loaded) return;
    this.applyProgress();
    if (!this.animFrame) this.renderOnce();
  }

  applyProgress(time = this.clock.getElapsedTime()) {
    const p = this.progress;
    const s = clamp01(p / WALK_END);
    const arrive = smooth(clamp01((p - WALK_END) / (1 - WALK_END)));

    const phase = s * STEPS;              // strides completed (fractional)
    const stepI = Math.floor(phase);
    const frac = Math.min(1, phase - stepI);
    const stride = (X_START - X_END) / STEPS;
    const dist = Math.min(X_START - X_END, (stepI + stepEase(frac)) * stride);
    const swing = Math.sin(Math.PI * phase);          // alternates sign each stride
    const bob = BOB * (1 - Math.abs(Math.cos(Math.PI * phase)));
    const stepSpeed = 4 * frac * (1 - frac);           // 0 at foot-plant, 1 mid-stride
    const moving = s > 0 && s < 1 ? 0.5 + 0.5 * stepSpeed : 0;

    if (p !== this._shadowProgress) {
      this._shadowProgress = p;
      this.renderer.shadowMap.needsUpdate = true;
    }

    const figures = this.figureList || [];
    for (let i = 0; i < figures.length; i++) {
      const f = figures[i];
      const dir = f.dir;
      const x = -dir * (X_START - dist);                 // bride from −X, groom from +X
      const breathe = 0.003 * Math.sin(time * 1.15 + i * 1.9);
      const settle = 1 - arrive;

      f.root.position.x = x;
      const zf = (X_START - dist) / (X_START - X_END); // 1 at entry, 0 on arrival
      f.root.position.z = 0.9 * zf * zf;
      f.root.position.y = bob * settle + breathe;
      f.root.rotation.y = dir * (WALK_YAW + (FACE_YAW - WALK_YAW) * arrive);
      f.root.rotation.x = LEAN_IN * arrive;

      const base = (o) => o.userData.baseRot;
      const legA = LEG_AMP * swing * settle;
      if (f.legL) f.legL.rotation.x = base(f.legL).x + legA;
      if (f.legR) f.legR.rotation.x = base(f.legR).x - legA;
      const armA = f.armAmp * swing * settle;
      if (f.armL) f.armL.rotation.x = base(f.armL).x - armA + 0.01 * Math.sin(time * 0.9 + i);
      if (f.armR) f.armR.rotation.x = base(f.armR).x + armA + 0.01 * Math.sin(time * 0.9 + i + 1.3);
      if (f.dress) {
        f.dress.rotation.z = DRESS_SWAY * swing * settle + 0.006 * Math.sin(time * 0.8);
      }
      if (f.veil) {
        // Trails behind (−local Z) while walking, settles into a soft sway.
        f.veil.rotation.x = -0.14 * moving * settle + 0.012 * Math.sin(time * 0.7);
        f.veil.rotation.z = 0.03 * Math.sin(time * 0.95 + 0.4);
      }
      if (f.head) {
        f.head.rotation.x = base(f.head).x + 0.03 * arrive + 0.008 * Math.sin(time * 1.1 + i);
      }

      f.shadow.position.x = x;
      f.shadow.material.opacity = 0.9 - (bob / BOB) * 0.25 * settle;
    }
  }

  // Offline frame render (used by the pre-render capture script): pose at
  // progress p / time t, force a shadow update, draw once.
  renderFrame(p, t) {
    if (!this.loaded) return false;
    this.progress = clamp01(p);
    this.applyProgress(t);
    this.aimCamera(t);
    this.updateDust(t);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  // ── Render loop (in view only) ───────────────────────────────────────────
  start() {
    if (this.animFrame || this.disposed) return;
    this.clock.start();
    const tick = () => {
      this.animFrame = requestAnimationFrame(tick);
      if (!this.loaded) return;
      this.applyProgress();
      const t = this.clock.getElapsedTime();
      this.aimCamera(t);
      this.updateDust(t);
      this.renderer.render(this.scene, this.camera);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
    this.clock.stop();
  }

  renderOnce() {
    if (!this.renderer || this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    if (!this.renderer) return;
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      }
    });
    this.textures.forEach((t) => t.dispose());
    this.shadowTex?.dispose();
    this.shadowMat?.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
