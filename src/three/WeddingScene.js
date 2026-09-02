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
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xFDFAF7, 1);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 10);

    this.setupLights();
    this.buildRings();
    this.buildRoses();
    this.buildSparkles();
    this.setupListeners();
    this.connectTheatre();
    this.animate();
  }

  setupLights() {
    // Warm ambient
    this.scene.add(new THREE.AmbientLight(0xFFF8F0, 0.9));

    // Key light — bright warm white from upper-right
    const key = new THREE.DirectionalLight(0xFFFFFF, 3.0);
    key.position.set(5, 6, 6);
    this.scene.add(key);

    // Fill light — gold tint from left
    const fill = new THREE.DirectionalLight(0xFFD980, 2.0);
    fill.position.set(-6, 3, 3);
    this.scene.add(fill);

    // Rim light — blue tint from back-bottom for ring depth
    const rim = new THREE.DirectionalLight(0xADD8FF, 1.2);
    rim.position.set(0, -4, -3);
    this.scene.add(rim);

    // Point light near roses — warm gold glow
    const glow = new THREE.PointLight(0xFFCC66, 1.5, 12);
    glow.position.set(0, 1, 4);
    this.scene.add(glow);
  }

  buildRings() {
    this.ringsGroup = new THREE.Group();

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xC9A96E,
      metalness: 0.92,
      roughness: 0.12,
      envMapIntensity: 1.2,
    });

    const goldMatLight = new THREE.MeshStandardMaterial({
      color: 0xD4AF78,
      metalness: 0.88,
      roughness: 0.18,
      envMapIntensity: 1.0,
    });

    // Ring 1 — in XZ plane (like a halo / lying flat-ish)
    const r1Geo = new THREE.TorusGeometry(1.8, 0.04, 20, 120);
    const ring1 = new THREE.Mesh(r1Geo, goldMat);
    ring1.rotation.x = Math.PI / 2;

    // Ring 2 — interlocked: tilted 90° on Y, offset slightly on X
    const r2Geo = new THREE.TorusGeometry(1.8, 0.04, 20, 120);
    const ring2 = new THREE.Mesh(r2Geo, goldMatLight);
    ring2.position.x = 0.65;
    ring2.rotation.y = Math.PI / 2;

    this.ringsGroup.add(ring1, ring2);
    this.scene.add(this.ringsGroup);
  }

  buildRoses() {
    const positions = [
      { x: -3.4, y: 0.1, z: -0.5, ry: 0.3 },
      { x: 3.4, y: 0.1, z: -0.5, ry: -0.3 },
    ];

    positions.forEach(({ x, y, z, ry }) => {
      const rose = this.createRose();
      rose.position.set(x, y, z);
      rose.rotation.y = ry;
      rose.scale.setScalar(0.52);
      this.scene.add(rose);
      this.roses.push(rose);
    });
  }

  createRose() {
    const group = new THREE.Group();

    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xB22222,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.75,
    });
    const petalMatOuter = new THREE.MeshStandardMaterial({
      color: 0xC0392B,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.7,
    });
    const petalMatInner = new THREE.MeshStandardMaterial({
      color: 0x8B0000,
      side: THREE.DoubleSide,
      metalness: 0.0,
      roughness: 0.85,
    });

    // Helper: build one petal shape
    const makePetalShape = (w, h) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(w * 0.7, h * 0.1, w, h * 0.55, 0, h);
      s.bezierCurveTo(-w, h * 0.55, -w * 0.7, h * 0.1, 0, 0);
      return s;
    };

    const addPetalLayer = (shape, mat, count, tiltX, offsetY, scaleY) => {
      const geo = new THREE.ShapeGeometry(shape, 14);
      for (let i = 0; i < count; i++) {
        const p = new THREE.Mesh(geo, mat);
        p.rotation.y = (i / count) * Math.PI * 2;
        p.rotation.x = tiltX;
        p.position.y = offsetY;
        p.scale.y = scaleY ?? 1;
        group.add(p);
      }
    };

    // Inner tight petals
    addPetalLayer(makePetalShape(0.22, 0.55), petalMatInner, 5, 0.18, 0.05, 1);
    // Mid petals
    addPetalLayer(makePetalShape(0.3, 0.72), petalMat, 5, 0.32, 0, 1);
    // Outer open petals
    addPetalLayer(makePetalShape(0.38, 0.9), petalMatOuter, 5, 0.52, -0.05, 1);
    // Outermost wide petals
    addPetalLayer(makePetalShape(0.42, 1.0), petalMatOuter, 5, 0.68, -0.08, 0.95);

    // Gold center
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0xC9A96E,
      metalness: 0.6,
      roughness: 0.3,
    });
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), centerMat);
    center.position.y = 0.08;
    group.add(center);

    // Short green stem
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4A7C59, roughness: 0.9 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.8, 8), stemMat);
    stem.position.y = -0.5;
    group.add(stem);

    // Two small leaves
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.2, 0.05, 0.28, 0.22, 0, 0.35);
    leafShape.bezierCurveTo(-0.28, 0.22, -0.2, 0.05, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 8);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3D6B4A, side: THREE.DoubleSide, roughness: 0.9 });

    [-1, 1].forEach((side) => {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(side * 0.12, -0.22, 0);
      leaf.rotation.z = side * 0.7;
      leaf.rotation.y = side * 0.3;
      group.add(leaf);
    });

    return group;
  }

  buildSparkles() {
    // Floating gold sparkle particles
    const count = 600;
    const pos = new Float32Array(count * 3);
    this.sparkleVel = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
      this.sparkleVel[i] = 0.0002 + Math.random() * 0.0004;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xC9A96E,
      size: 0.018,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sparkles = new THREE.Points(geo, mat);
    this.scene.add(this.sparkles);
  }

  connectTheatre() {
    // Connect Theatre.js for camera control (editable via Studio in DEV)
    if (heroCameraObj) {
      this.theatreUnsub = heroCameraObj.onValuesChange((vals) => {
        // Theatre.js drives camera position when changed in Studio
        this.camera.position.x = vals.position.x + this.mouse.x * 0.5;
        this.camera.position.y = vals.position.y + this.mouse.y * 0.5;
        this.camera.position.z = vals.position.z;
      });
    }

    // Cinematic intro: GSAP zooms camera from z=10 to z=5.5
    gsap.to(this.camera.position, {
      z: 5.5,
      duration: 2.8,
      ease: 'power3.out',
      delay: 0.3,
    });
  }

  setupListeners() {
    this._onMouseMove = (e) => {
      this.targetMouse.x = (e.clientX / window.innerWidth - 0.5) * 0.7;
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

  animate() {
    this.animFrame = requestAnimationFrame(() => this.animate());

    // Rings: slow stately rotation
    this.ringsGroup.rotation.y += 0.0006;
    this.ringsGroup.rotation.x += 0.0002;

    // Roses: gentle sway
    const t = Date.now() * 0.0005;
    this.roses.forEach((rose, i) => {
      rose.rotation.y = (i === 0 ? 0.3 : -0.3) + Math.sin(t + i) * 0.08;
      rose.rotation.z = Math.sin(t * 0.7 + i * 1.3) * 0.04;
    });

    // Sparkles drift upward and wrap
    const positions = this.sparkles.geometry.attributes.position.array;
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3 + 1] += this.sparkleVel[i];
      if (positions[i * 3 + 1] > 4) positions[i * 3 + 1] = -4;
    }
    this.sparkles.geometry.attributes.position.needsUpdate = true;

    // Mouse parallax (smooth lerp) — only when Theatre.js is not overriding
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.04;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.04;
    if (!heroCameraObj) {
      this.camera.position.x = this.mouse.x * 0.5;
      this.camera.position.y = this.mouse.y * 0.5;
    }
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animFrame);
    if (this.theatreUnsub) this.theatreUnsub();
    this.renderer.dispose();
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
  }
}
