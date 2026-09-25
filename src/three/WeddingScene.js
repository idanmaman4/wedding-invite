import * as THREE from 'three';
import { scrollToRSVP } from '../scrollToRSVP';
import { gsap } from 'gsap';

// ── GPU particle motion ───────────────────────────────────────────────────────
// All per-particle math (orbit spin, tangential surge, in/out wobble, burst
// scatter, sparkle rise + wander) runs in the vertex shader. Each particle
// carries static attributes (base angle/radius/spin/phases/burst jitter) that
// are uploaded once; the CPU only bumps a handful of uniforms per frame.
//
// Clocks: `uTime` is seconds (shimmer sines), `uFrames` is a 60fps-equivalent
// frame counter (orbit spin + sparkle rise were per-frame increments), so the
// motion is identical to the old CPU loop at 60Hz and keeps its speed when the
// loop runs at 30fps on phones.

const RING_VERTEX_HEAD = /* glsl */`
  attribute vec4 aParam;  // x: base angle, y: ring radius, z: spin (rad/frame), w: burst jitter
  attribute vec3 aPhase;  // x: wobble phase, y: wobble phase 2, z: tangent phase
  uniform float uTime;
  uniform float uFrames;
  uniform float uBurst;   // 0 = intact ring, 1 = fully dissolved
  uniform float uRing;    // 0 = ring 1 (XZ plane), 1 = ring 2 (YZ plane, +0.75 on X)
`;

const RING_VERTEX_BODY = /* glsl */`
  float ringR = aParam.y + uBurst * aParam.w * 3.0;
  // Cheap hand-rolled "curl-ish" drift: 2-3 overlaid sine terms at
  // non-matching frequencies/phases per particle, standing in for a real
  // divergence-free noise field without pulling in a noise library.
  // Tangential term — a gentle forward/backward surge along the orbit path.
  float tangent = sin(uTime * 0.31 + aPhase.z) * 0.014
                + sin(uTime * 0.87 + aPhase.z * 1.7) * 0.007;
  float ang = aParam.x + aParam.z * uFrames + tangent;
  // Normal-axis term — the in/out bob, a turbulent sum instead of one clean sine.
  float wobble = (sin(uTime * 1.3 + aPhase.x) * 0.026
                + sin(uTime * 0.53 + aPhase.y) * 0.013
                + sin(uTime * 2.3 + aPhase.x * 1.3) * 0.006)
                * (1.0 + uBurst * 3.0);
  vec3 transformed = (uRing < 0.5)
    ? vec3(cos(ang) * ringR, wobble, sin(ang) * ringR)
    : vec3(0.75 + wobble, sin(ang) * ringR, cos(ang) * ringR);
`;

const SPARKLE_VERTEX_HEAD = /* glsl */`
  attribute float aVel;   // rise per frame
  attribute vec2 aPhase;  // wander phases A, B
  uniform float uTime;
  uniform float uFrames;
`;

// `position` holds each mote's base (x, y0, z): it rises at aVel per frame and
// wraps 4.5 -> -4.5, with a small sideways curl-ish wander so motes read as
// dust suspended in still air rather than riding a straight conveyor belt.
const SPARKLE_VERTEX_BODY = /* glsl */`
  vec3 transformed = vec3(
    position.x + sin(uTime * 0.22 + aPhase.x) * 0.22 + sin(uTime * 0.61 + aPhase.y) * 0.10,
    mod(position.y + aVel * uFrames + 4.5, 9.0) - 4.5,
    position.z + sin(uTime * 0.19 + aPhase.y) * 0.18 + sin(uTime * 0.73 + aPhase.x) * 0.08
  );
`;

function patchPointsVertex(material, uniforms, head, body, cacheKey) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', head + '\n#include <common>')
      .replace('#include <begin_vertex>', body);
  };
  // Both rings share one compiled program (uRing is a uniform, not a define).
  material.customProgramCacheKey = () => cacheKey;
}

const PHONE_MAX_WIDTH = 768;
const PHONE_FRAME_INTERVAL = 1000 / 30;
const FRAME_MS = 1000 / 60;
// Adaptive frame rate: every device starts at the display's native rate; one
// whose frames average slower than this (it cannot hold ~45fps) over a
// one-second window drops to a steady 30fps, which reads smoother than an
// uneven 35-45.
const SLOW_FRAME_MS = 22;
const SLOW_WINDOW = 60;

export class WeddingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouse = { x: 0, y: 0 };
    this.targetMouse = { x: 0, y: 0 };
    this.animFrame = null;
    this._onMouseMove = null;
    this._onResize = null;
    this.init();
  }

  init() {
    // Transparent so the full-page vine (rendered on its own canvas just
    // behind this one) shows through the hero everywhere the rings/roses/
    // sparkles don't actually draw a pixel.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatioCap());
    this.renderer.setClearColor(0xFDFAF7, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 11);

    // Shared per-frame uniforms (see the GLSL at the top of the file).
    this.uTime = { value: 0 };
    this.uFrames = { value: 0 };
    this.uBurst = { value: 0 };
    this._clock0 = performance.now();
    this._frames = 0;
    this._lastTick = 0;
    this._frameInterval = this.frameIntervalFor();

    this.setupLights();
    this.buildRings();
    this.buildSparkles();
    this.setupListeners();
    this.setupAnimations();
    this.setupVisibility();
    this.start();
  }

  // Soft-gradient point sprites are fill-bound and never crisp-edged, so a
  // phone renders them at 1.5x (same cap the vine uses) instead of 2-3x.
  pixelRatioCap() {
    // The rings animate entirely in the vertex shader now, so phones can
    // afford full density — 1.5x was visibly soft next to the desktop.
    // 2.5 still left DPR-3 phones resampling a 975px buffer up to 1170px
    // (1.2x), which smeared the ring particles; phones now render 1:1.
    // Anything wider keeps the old 2.5 cap, so desktop is untouched.
    const cap = window.innerWidth < PHONE_MAX_WIDTH ? 3 : 2.5;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  // Native rate everywhere (modern phones hold 60-120Hz with the rings in the
  // vertex shader); see watchFrameRate() for the step down on slow devices.
  // Once stepped down, a device stays at 30fps for the session.
  frameIntervalFor() {
    return this._throttled ? PHONE_FRAME_INTERVAL : 0;
  }

  // Called once per rendered frame with the time since the previous one.
  // Averages a window of frames and, if the device is falling behind, locks
  // it to 30fps — an even cadence instead of a stuttering one.
  watchFrameRate(dt) {
    if (this._throttled || document.hidden) return;
    this._rateSum = (this._rateSum || 0) + dt;
    this._rateN = (this._rateN || 0) + 1;
    if (this._rateN < SLOW_WINDOW) return;
    const avg = this._rateSum / this._rateN;
    this._rateSum = 0;
    this._rateN = 0;
    if (avg > SLOW_FRAME_MS) {
      this._throttled = true;
      this._frameInterval = PHONE_FRAME_INTERVAL;
    }
  }

  // The hero is a normal-flow section: once it scrolls out of view nothing
  // this canvas draws can be seen, so the loop (a full-screen transparent
  // render) stops until it comes back.
  setupVisibility() {
    this._inView = true;
    if (typeof IntersectionObserver === 'undefined') return;
    this._io = new IntersectionObserver((entries) => {
      this._inView = entries.some((e) => e.isIntersecting);
      if (this._inView) this.start(); else this.stop();
    }, { rootMargin: '40px 0px' });
    this._io.observe(this.canvas);
  }

  start() {
    if (this.animFrame != null) return;
    this.animate();
  }

  stop() {
    if (this.animFrame != null) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  }

  // ── Lights ───────────────────────────────────────────────────────────────────
  setupLights() {
    this.scene.add(new THREE.AmbientLight(0xFFF5E0, 2.2));

    const key = new THREE.DirectionalLight(0xFFFFFF, 5.0);
    key.position.set(4, 7, 8);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xFFE08A, 3.5);
    fill.position.set(-7, 2, 5);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xCCE8FF, 2.0);
    rim.position.set(0, -5, -4);
    this.scene.add(rim);

    const ringGlow = new THREE.PointLight(0xFFD060, 4.0, 12);
    ringGlow.position.set(0.4, 1.5, 5);
    this.scene.add(ringGlow);

    const sideGlow = new THREE.PointLight(0xFFCC44, 2.8, 9);
    sideGlow.position.set(3, 0, 3);
    this.scene.add(sideGlow);
  }

  // ── Shared particle texture ──────────────────────────────────────────────────
  makeGlowTex(innerColor, outerColor) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const r = size / 2;
    const grd = ctx.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0.0,  innerColor);
    grd.addColorStop(0.4,  innerColor.replace(/, *1\)/, ', 0.85)').replace(/^(.*)\)$/, '$1)'));
    grd.addColorStop(0.75, outerColor);
    grd.addColorStop(1.0,  'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  // ── Gold particle rings ──────────────────────────────────────────────────────
  buildRings() {
    this.ringsGroup = new THREE.Group();

    const tex = this.makeGlowTex('rgba(255,230,150,1)', 'rgba(180,130,60,0.3)');
    const count = 1100;

    const makeMat = (sz, ringIndex) => {
      const mat = new THREE.PointsMaterial({
        map: tex,
        color: 0xC9A96E,
        size: sz,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.NormalBlending,
      });
      patchPointsVertex(mat, {
        uTime: this.uTime, uFrames: this.uFrames, uBurst: this.uBurst,
        uRing: { value: ringIndex },
      }, RING_VERTEX_HEAD, RING_VERTEX_BODY, 'wedding-ring-gpu');
      return mat;
    };

    // Mean ring radius — used as the reference for Kepler-like angular-velocity scaling
    // (3rd law: omega ~ r^-1.5, so particles sitting a touch closer to the center
    // sweep a touch faster than ones a touch farther out — a real orbital relationship
    // instead of arbitrary per-particle randomness).
    const meanR = 2.2;
    const baseSpin = 0.00105;

    // Static per-particle attributes: the formed-ring position is only a
    // placeholder for the bounding sphere; the shader computes the live one.
    const makeRingGeometry = (ringIndex) => {
      const pos = new Float32Array(count * 3);
      const param = new Float32Array(count * 4);
      const phase = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const r = 2.2 + (Math.random() - 0.5) * 0.04;
        const jitter = (Math.random() - 0.5) * 0.03; // in-plane thickness seed
        if (ringIndex === 0) {
          // Ring 1 — lies in XZ plane
          pos[i * 3] = Math.cos(a) * r;
          pos[i * 3 + 1] = jitter;
          pos[i * 3 + 2] = Math.sin(a) * r;
        } else {
          // Ring 2 — interlocked in YZ plane, offset +0.75 on X
          pos[i * 3] = jitter + 0.75;
          pos[i * 3 + 1] = Math.sin(a) * r;
          pos[i * 3 + 2] = Math.cos(a) * r;
        }
        param[i * 4] = a;
        param[i * 4 + 1] = r;
        // Keplerian-ish: smaller radius -> faster angular velocity, plus a light
        // per-particle scatter so it reads as "orbits", not a rigid disk.
        param[i * 4 + 2] = baseSpin * Math.pow(meanR / r, 1.5) * (0.85 + Math.random() * 0.3);
        phase[i * 3] = Math.random() * Math.PI * 2;      // wobble phase
        phase[i * 3 + 1] = Math.random() * Math.PI * 2;  // wobble phase 2
        phase[i * 3 + 2] = Math.random() * Math.PI * 2;  // tangent phase
        param[i * 4 + 3] = 0.6 + Math.random() * 1.8;    // burst jitter
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aParam', new THREE.BufferAttribute(param, 4));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 3));
      return g;
    };

    const ring1 = new THREE.Points(makeRingGeometry(0), makeMat(0.058, 0));
    ring1.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Points(makeRingGeometry(1), makeMat(0.048, 1));
    // Positions live in the shader (and scatter far past the formed ring on
    // burst), so the static bounding sphere must not drive culling.
    ring1.frustumCulled = false;
    ring2.frustumCulled = false;

    // Intermediate group: viewport-fit base scale, independent of the
    // breathing tween that animates ringsGroup.scale.
    this.ringsFit = new THREE.Group();
    this.ringsFit.add(ring1, ring2);
    this.ringsGroup.add(this.ringsFit);
    this.scene.add(this.ringsGroup);

    this.ring1 = ring1;
    this.ring2 = ring2;

    this.fitRingsToViewport();
  }

  // Shrink the rings on narrow (portrait) viewports so they stay inside the frame.
  // Desktop (aspect >= 1.15) stays at 1.0; a 390x844 phone (~0.46) lands at ~0.5.
  fitRingsToViewport() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const aspect = vw / vh;
    const base = Math.min(1, Math.max(0.5, aspect / 1.15));
    // Smaller rings: ~18% on desktop, ~10% on phones.
    this.ringsFit.scale.setScalar(base * (aspect >= 1 ? 0.82 : 0.9));
    // Centre the rings in the space below the fixed top bar (not the full
    // viewport): shift down by half the bar height, in world units at z = 0.
    const navH = document.querySelector('nav')?.offsetHeight || 72;
    const camZ = 5.5; // resting camera distance after the entrance zoom
    const worldH = 2 * camZ * Math.tan((this.camera.fov * Math.PI / 180) / 2);
    this.ringsFit.position.y = -(navH / 2) * (worldH / vh);
  }

  // ── Gold sparkle dust ────────────────────────────────────────────────────────
  buildSparkles() {
    const count = 70;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    const phase = new Float32Array(count * 2);
    // `pos` is the base each mote drifts around — dust in still air wanders
    // sideways as it rises, it doesn't ride a straight vertical conveyor belt.
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
      vel[i] = 0.00015 + Math.random() * 0.00025;
      phase[i * 2] = Math.random() * Math.PI * 2;
      phase[i * 2 + 1] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 2));
    const tex = this.makeGlowTex('rgba(201,169,110,0.9)', 'rgba(180,140,80,0.1)');
    const mat = new THREE.PointsMaterial({
      map: tex, color: 0xB8981A, size: 0.022,
      transparent: true, alphaTest: 0.01,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    patchPointsVertex(mat, { uTime: this.uTime, uFrames: this.uFrames },
      SPARKLE_VERTEX_HEAD, SPARKLE_VERTEX_BODY, 'wedding-sparkle-gpu');
    this.sparkles = new THREE.Points(geo, mat);
    this.sparkles.frustumCulled = false;
    this.scene.add(this.sparkles);
  }

  // ── GSAP Animations ──────────────────────────────────────────────────────────
  setupAnimations() {
    this.ringBurst = { t: 0 };
    this.ringBurstFired = false;
    this._ready = false;

    // The entrance is gated on the app's `wedding:ready` event (fired once the
    // loading overlay lifts) so the camera zoom, breathing and burst timer
    // don't play — and stutter — under the loader. Until then the camera stays
    // parked at z: 11.
    const start = () => {
      if (this._ready) return;
      this._ready = true;

      // Cinematic camera zoom in — dramatic ease
      gsap.fromTo(this.camera.position, { z: 11 }, {
        z: 5.5,
        duration: 3.5,
        ease: 'power4.out',
        delay: 0.1,
      });

      // Rings: slow breathing pulse (killed once the burst-into-dust kicks in)
      this.startRingBreathing();

      // Rings dissolve outward into the ambient sparkle dust, then — if the
      // visitor hasn't touched anything — the page eases down toward RSVP.
      // Trigger is whichever comes first: the visitor scrolling past ~18vh,
      // clicking the nav's RSVP link, or (for an idle visitor) a fallback timer.
      this._burstTimer = setTimeout(() => this.burstIfStillAtTop(), 5000);
    };
    this._onReady = start;

    if (window.__weddingReady === true) {
      start();
    } else {
      window.addEventListener('wedding:ready', this._onReady, { once: true });
    }
  }

  startRingBreathing() {
    this.ringBreathTween = gsap.to(this.ringsGroup.scale, {
      x: 1.07, y: 1.07, z: 1.07,
      duration: 4.0,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  }

  // ── Ring burst / regather ───────────────────────────────────────────────────
  explodeRing() {
    if (!this._ready) return;
    if (this.ringBurstFired) return;
    this.ringBurstFired = true;
    clearTimeout(this._burstTimer);
    this.ringBreathTween.kill();
    gsap.killTweensOf(this.ringBurst);
    gsap.to(this.ringBurst, {
      t: 1,
      duration: 1.8,
      ease: 'power2.out',
      onComplete: () => {
        this.ringsGroup.visible = false;
        this.nudgeScrollToRSVP();
      },
    });
  }

  // The burst is the cue for the nudge-scroll, so it should only play while the
  // hero is still what the visitor is looking at. If they have already scrolled
  // on, stay gathered; regatherRing() re-arms the timer when they come back.
  burstIfStillAtTop() {
    if (this.userInteracted || window.scrollY > 40) return;
    this.explodeRing();
  }

  regatherRing() {
    if (!this._ready) return;
    if (!this.ringBurstFired) return;
    this.ringBurstFired = false;
    clearTimeout(this._burstTimer);
    gsap.killTweensOf(this.ringBurst);
    this.ringBurst.t = 0;
    this.ringsGroup.visible = true;
    this.startRingBreathing();
    this._burstTimer = setTimeout(() => this.burstIfStillAtTop(), 5000);
  }

  // ── Gentle nudge-scroll to RSVP — never fights the visitor ────────────────────
  nudgeScrollToRSVP() {
    if (this.userInteracted || window.scrollY > 40) return;
    scrollToRSVP('smooth');
  }

  // ── Listeners ────────────────────────────────────────────────────────────────
  setupListeners() {
    this._onMouseMove = (e) => {
      this.targetMouse.x = (e.clientX / window.innerWidth  - 0.5) * 0.7;
      this.targetMouse.y = -(e.clientY / window.innerHeight - 0.5) * 0.7;
    };
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(this.pixelRatioCap());
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.fitRingsToViewport();
      this._frameInterval = this.frameIntervalFor();
      if (this.animFrame == null) this.renderer.render(this.scene, this.camera);
    };
    // Any deliberate scroll/touch/key input cancels the gentle nudge-scroll —
    // it should never fight a visitor who's already navigating on their own.
    this.userInteracted = false;
    this._onUserInteract = () => { this.userInteracted = true; };
    // Burst trigger + regather, scroll-driven (crossing ~18vh bursts; back
    // near the top rebuilds the ring), matching the reference sketch.
    this._onBurstScroll = () => {
      if (!this._ready) return;
      if (window.scrollY > window.innerHeight * 0.18) this.explodeRing();
      else if (window.scrollY < 40) this.regatherRing();
    };
    // The nav's RSVP link fires this so the ring bursts immediately on click,
    // before the smooth-scroll it also triggers.
    this._onRsvpNavClick = () => this.explodeRing();
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('wheel', this._onUserInteract, { passive: true });
    window.addEventListener('touchstart', this._onUserInteract, { passive: true });
    window.addEventListener('keydown', this._onUserInteract);
    window.addEventListener('scroll', this._onBurstScroll, { passive: true });
    window.addEventListener('wedding:rsvp-nav-click', this._onRsvpNavClick);
  }

  // ── Render loop ──────────────────────────────────────────────────────────────
  animate() {
    this.animFrame = requestAnimationFrame(() => this.animate());

    // Nothing is visible in a hidden tab; keep the loop armed but idle.
    if (document.hidden) return;

    const now = performance.now();
    // Phones: skip vsyncs to hold ~30fps (see frameIntervalFor).
    if (this._frameInterval && now - this._lastTick < this._frameInterval - 1.5) return;

    // Elapsed time in 60fps-equivalent frames, clamped so a stopped loop
    // (hidden tab, scrolled away) resumes without a jump.
    const dt = this._lastTick ? Math.min(now - this._lastTick, 100) : FRAME_MS;
    const fd = dt / FRAME_MS;
    // A resume after a pause (hidden tab, scrolled away) is not a slow frame.
    if (this._lastTick && dt < 100) this.watchFrameRate(dt);
    this._lastTick = now;
    this._frames += fd;

    // Rings: slow stately rotation
    this.ringsGroup.rotation.y += 0.00055 * fd;
    this.ringsGroup.rotation.x += 0.00020 * fd;

    // Burst-into-dust progress (0 = intact ring, 1 = fully dissolved) — driven
    // by the one-shot GSAP tween started in setupAnimations().
    const burstT = this.ringBurst.t;
    this.ring1.material.opacity = 1 - burstT;
    this.ring2.material.opacity = 1 - burstT;

    // Per-particle drift/shimmer, orbit spin, burst scatter and the sparkle
    // rise all run in the vertex shaders — just feed them the clocks.
    this.uTime.value = (now - this._clock0) * 0.001;
    this.uFrames.value = this._frames;
    this.uBurst.value = burstT;

    // Smooth mouse parallax (0.04/frame easing, frame-rate independent)
    const ease = 1 - Math.pow(0.96, fd);
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * ease;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * ease;
    this.camera.position.x = this.mouse.x * 0.45;
    this.camera.position.y = this.mouse.y * 0.45;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this._io?.disconnect();
    clearTimeout(this._burstTimer);
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.ringsGroup.scale);
    gsap.killTweensOf(this.ringBurst);
    [this.ring1, this.ring2, this.sparkles].forEach((pts) => {
      pts.geometry.dispose();
      pts.material.map?.dispose();
      pts.material.dispose();
    });
    this.renderer.dispose();
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('wheel', this._onUserInteract);
    window.removeEventListener('touchstart', this._onUserInteract);
    window.removeEventListener('keydown', this._onUserInteract);
    window.removeEventListener('scroll', this._onBurstScroll);
    window.removeEventListener('wedding:rsvp-nav-click', this._onRsvpNavClick);
    window.removeEventListener('wedding:ready', this._onReady);
  }
}
