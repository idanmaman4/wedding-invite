import * as THREE from 'three';
import { gsap } from 'gsap';
import { heroCameraObj } from '../theatre/project';

export class WeddingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouse = { x: 0, y: 0 };
    this.targetMouse = { x: 0, y: 0 };
    this.animFrame = null;
    this._onMouseMove = null;
    this._onResize = null;
    this.theatreUnsub = null;
    this.roses = [];
    this.init();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xFDFAF7, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 11);

    this.setupLights();
    this.buildRings();
    this.buildRoses();
    this.buildSparkles();
    this.setupListeners();
    this.setupAnimations();
    this.animate();
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
    const count = 4000;

    const makeMat = (sz) => new THREE.PointsMaterial({
      map: tex,
      color: 0xC9A96E,
      size: sz,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });

    // Ring 1 — lies in XZ plane
    const p1 = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 2.2 + (Math.random() - 0.5) * 0.04;
      p1[i * 3] = Math.cos(a) * r;
      p1[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
      p1[i * 3 + 2] = Math.sin(a) * r;
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(p1, 3));
    const ring1 = new THREE.Points(g1, makeMat(0.058));
    ring1.rotation.x = Math.PI / 2;

    // Ring 2 — interlocked in YZ plane, offset +0.75 on X
    const p2 = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 2.2 + (Math.random() - 0.5) * 0.04;
      p2[i * 3] = (Math.random() - 0.5) * 0.03 + 0.75;
      p2[i * 3 + 1] = Math.sin(a) * r;
      p2[i * 3 + 2] = Math.cos(a) * r;
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    const ring2 = new THREE.Points(g2, makeMat(0.048));

    this.ringsGroup.add(ring1, ring2);
    this.scene.add(this.ringsGroup);
  }

  // ── 3D Roses ─────────────────────────────────────────────────────────────────
  buildRoses() {
    const defs = [
      { x: -3.1, y: 0.2, z: -0.3, ry: 0.45 },
      { x:  3.1, y: 0.2, z: -0.3, ry: -0.45 },
    ];
    defs.forEach(({ x, y, z, ry }) => {
      const rose = this.createRose();
      rose.userData.homeY = y;
      rose.position.set(x, y - 1.2, z);
      rose.rotation.y = ry;
      rose.scale.setScalar(0.01);
      this.scene.add(rose);
      this.roses.push(rose);
    });
  }

  createRose() {
    const group = new THREE.Group();
    group.userData.petals = [];

    // Natural petal shape — wide belly, pointed base, rounded tip
    const makePetalShape = (w, h) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(-w * 0.22, h * 0.06, -w * 1.08, h * 0.42, -w * 0.80, h * 0.76);
      s.quadraticCurveTo(-w * 0.25, h * 1.08, 0, h);
      s.quadraticCurveTo( w * 0.25, h * 1.08,  w * 0.80, h * 0.76);
      s.bezierCurveTo(  w * 1.08, h * 0.42,   w * 0.22, h * 0.06, 0, 0);
      return s;
    };

    const extrOpts = (depth) => ({
      steps: 2,
      depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.65,
      bevelSize: depth * 0.55,
      bevelSegments: 5,
    });

    const layers = [
      { n: 5, w: 0.14, h: 0.48, tilt: 0.07, r: 0.000, y:  0.17, d: 0.030, color: 0x750000 },
      { n: 5, w: 0.20, h: 0.64, tilt: 0.21, r: 0.045, y:  0.11, d: 0.027, color: 0x9B1010 },
      { n: 6, w: 0.27, h: 0.82, tilt: 0.37, r: 0.095, y:  0.04, d: 0.024, color: 0xB22222 },
      { n: 6, w: 0.34, h: 0.99, tilt: 0.56, r: 0.155, y: -0.03, d: 0.020, color: 0xBF3030 },
      { n: 7, w: 0.42, h: 1.17, tilt: 0.75, r: 0.215, y: -0.10, d: 0.016, color: 0xCC5555 },
    ];

    layers.forEach((ld, li) => {
      const geo = new THREE.ExtrudeGeometry(makePetalShape(ld.w, ld.h), extrOpts(ld.d));
      const mat = new THREE.MeshPhongMaterial({
        color: ld.color,
        specular: 0x881111,
        shininess: 55 - li * 8,
        side: THREE.DoubleSide,
      });

      for (let i = 0; i < ld.n; i++) {
        const angle = (i / ld.n) * Math.PI * 2 + li * (Math.PI * 0.21);
        const petal = new THREE.Mesh(geo, mat);
        petal.rotation.y = angle;
        petal.rotation.x = ld.tilt;
        petal.position.set(Math.sin(angle) * ld.r, ld.y, Math.cos(angle) * ld.r);
        petal.userData.baseTilt = ld.tilt;
        petal.userData.phase    = i * (Math.PI * 2 / ld.n) + li * 0.88;
        petal.userData.layerIdx = li;
        group.userData.petals.push(petal);
        group.add(petal);
      }
    });

    // Gold stamen
    const stamenMat = new THREE.MeshPhongMaterial({
      color: 0xC9A96E, specular: 0xFFEE88, shininess: 240,
      emissive: 0x5A3A10, emissiveIntensity: 0.4,
    });
    const stamen = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
      stamenMat
    );
    stamen.position.y = 0.18;
    group.add(stamen);

    // 5 extruded sepals
    const sepalMat = new THREE.MeshPhongMaterial({ color: 0x2D5A27, side: THREE.DoubleSide, shininess: 22 });
    for (let i = 0; i < 5; i++) {
      const ss = new THREE.Shape();
      ss.moveTo(0, 0);
      ss.bezierCurveTo(0.078, 0.08, 0.055, 0.28, 0, 0.44);
      ss.bezierCurveTo(-0.055, 0.28, -0.078, 0.08, 0, 0);
      const sepal = new THREE.Mesh(
        new THREE.ExtrudeGeometry(ss, { depth: 0.010, bevelEnabled: false }),
        sepalMat
      );
      sepal.rotation.y = (i / 5) * Math.PI * 2;
      sepal.rotation.x = 0.95;
      sepal.position.y = -0.04;
      group.add(sepal);
    }

    // Tapered stem
    const stemMat = new THREE.MeshPhongMaterial({ color: 0x3D6B3A, shininess: 16 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.038, 1.55, 10), stemMat);
    stem.position.y = -0.90;
    group.add(stem);

    // 4 compound leaves — extruded
    const leafMat = new THREE.MeshPhongMaterial({ color: 0x3A6B37, side: THREE.DoubleSide, shininess: 48 });
    const makeLeafGeo = (w, h) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(-w * 0.15, h * 0.10, -w, h * 0.50, -w * 0.46, h * 0.84);
      s.quadraticCurveTo(-w * 0.10, h * 1.06, 0, h);
      s.quadraticCurveTo( w * 0.10, h * 1.06,  w * 0.46, h * 0.84);
      s.bezierCurveTo(  w, h * 0.50,  w * 0.15, h * 0.10, 0, 0);
      return new THREE.ExtrudeGeometry(s, {
        depth: 0.008, bevelEnabled: true,
        bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2,
      });
    };
    [
      { x: -0.12, y: -0.30, rz:  0.62, rx:  0.09 },
      { x:  0.12, y: -0.30, rz: -0.62, rx: -0.09 },
      { x: -0.08, y: -0.58, rz:  0.43, rx:  0.05 },
      { x:  0.08, y: -0.58, rz: -0.43, rx: -0.05 },
    ].forEach(({ x, y, rz, rx }) => {
      const leaf = new THREE.Mesh(makeLeafGeo(0.27, 0.53), leafMat);
      leaf.position.set(x, y, 0);
      leaf.rotation.set(rx, 0, rz);
      group.add(leaf);
    });

    return group;
  }

  // ── Gold sparkle dust ────────────────────────────────────────────────────────
  buildSparkles() {
    const count = 500;
    const pos = new Float32Array(count * 3);
    this.sparkleVel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
      this.sparkleVel[i] = 0.00015 + Math.random() * 0.00025;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = this.makeGlowTex('rgba(201,169,110,0.9)', 'rgba(180,140,80,0.1)');
    const mat = new THREE.PointsMaterial({
      map: tex, color: 0xB8981A, size: 0.022,
      transparent: true, alphaTest: 0.01,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    this.sparkles = new THREE.Points(geo, mat);
    this.scene.add(this.sparkles);
  }

  // ── GSAP Animations ──────────────────────────────────────────────────────────
  setupAnimations() {
    // Theatre.js camera connection (for Studio editing in DEV)
    if (heroCameraObj) {
      this.theatreUnsub = heroCameraObj.onValuesChange((vals) => {
        this.camera.position.z = vals.position.z;
      });
    }

    // Cinematic camera zoom in — dramatic ease
    gsap.fromTo(this.camera.position, { z: 11 }, {
      z: 5.5,
      duration: 3.5,
      ease: 'power4.out',
      delay: 0.1,
    });

    // Rings: slow breathing pulse
    gsap.to(this.ringsGroup.scale, {
      x: 1.07, y: 1.07, z: 1.07,
      duration: 4.0,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    // Roses: entrance + petal breathing
    this.roses.forEach((rose, ri) => {
      const delay = 2.2 + ri * 0.45;

      // Dramatic entrance: rise up from below + scale in
      const tl = gsap.timeline({ delay });
      tl.to(rose.position, { y: rose.userData.homeY, duration: 1.8, ease: 'power3.out' }, 0);
      tl.to(rose.scale, { x: 0.58, y: 0.58, z: 0.58, duration: 1.8, ease: 'back.out(1.6)' }, 0);

      // Petal breathing — each petal independently, outer ones more
      rose.userData.petals.forEach((petal) => {
        const amplitude = 0.018 + petal.userData.layerIdx * 0.011;
        const dur       = 2.2 + Math.random() * 1.6 + petal.userData.layerIdx * 0.25;
        gsap.to(petal.rotation, {
          x: petal.userData.baseTilt + amplitude,
          duration: dur,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
          delay: delay + Math.random() * 2.5,
        });
      });
    });
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
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('resize', this._onResize);
  }

  // ── Render loop ──────────────────────────────────────────────────────────────
  animate() {
    this.animFrame = requestAnimationFrame(() => this.animate());

    // Rings: slow stately rotation
    this.ringsGroup.rotation.y += 0.00055;
    this.ringsGroup.rotation.x += 0.00020;

    // Roses: gentle organic sway
    const t = Date.now() * 0.00038;
    this.roses.forEach((rose, i) => {
      if (rose.scale.x < 0.05) return;
      rose.rotation.y = (i === 0 ? 0.45 : -0.45) + Math.sin(t * 0.75 + i * 2.1) * 0.13;
      rose.rotation.z = Math.sin(t * 0.52 + i * 1.4) * 0.03;
    });

    // Sparkle drift upward
    const sp = this.sparkles.geometry.attributes.position.array;
    for (let i = 0; i < sp.length / 3; i++) {
      sp[i * 3 + 1] += this.sparkleVel[i];
      if (sp[i * 3 + 1] > 4.5) sp[i * 3 + 1] = -4.5;
    }
    this.sparkles.geometry.attributes.position.needsUpdate = true;

    // Smooth mouse parallax
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.04;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.04;
    this.camera.position.x = this.mouse.x * 0.45;
    this.camera.position.y = this.mouse.y * 0.45;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animFrame);
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.ringsGroup.scale);
    if (this.theatreUnsub) this.theatreUnsub();
    this.renderer.dispose();
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('resize', this._onResize);
  }
}
