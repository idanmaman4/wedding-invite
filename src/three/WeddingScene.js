import * as THREE from 'three';

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
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xFDFAF7, 1);

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.z = 5.5;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.1);
    this.scene.add(ambient);

    const pointLight = new THREE.PointLight(0xB22222, 1.0);
    pointLight.position.set(0, 3, 3);
    this.scene.add(pointLight);

    this.buildRings();
    this.buildPetals();
    this.setupListeners();
    this.animate();
  }

  buildRings() {
    this.ringsGroup = new THREE.Group();

    const count = 2500;

    // Ring 1 — XZ plane (horizontal), rose red (#B22222)
    const pos1 = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 2.0 + (Math.random() - 0.5) * 0.08;
      const scatter = (Math.random() - 0.5) * 0.04;
      pos1[i * 3 + 0] = Math.cos(angle) * r + scatter;
      pos1[i * 3 + 1] = scatter;
      pos1[i * 3 + 2] = Math.sin(angle) * r + scatter;
    }
    const geo1 = new THREE.BufferGeometry();
    geo1.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
    const mat1 = new THREE.PointsMaterial({
      color: 0xB22222,
      size: 0.02,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.ring1 = new THREE.Points(geo1, mat1);

    // Ring 2 — YZ plane (vertical), lighter rose (#D4394A), offset +0.6 on X
    const pos2 = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 2.0 + (Math.random() - 0.5) * 0.08;
      const scatter = (Math.random() - 0.5) * 0.04;
      pos2[i * 3 + 0] = scatter + 0.6;
      pos2[i * 3 + 1] = Math.sin(angle) * r + scatter;
      pos2[i * 3 + 2] = Math.cos(angle) * r + scatter;
    }
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    const mat2 = new THREE.PointsMaterial({
      color: 0xD4394A,
      size: 0.018,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.ring2 = new THREE.Points(geo2, mat2);

    this.ringsGroup.add(this.ring1, this.ring2);
    this.scene.add(this.ringsGroup);
  }

  buildPetals() {
    // Ambient floating petals — 800 particles in 3D space
    const count = 800;
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.petalVelocity = new Float32Array(count);

    // Two colors: light pink (#E8A0A0) and rose red (#B22222)
    const lightPink = new THREE.Color(0xE8A0A0);
    const roseRed = new THREE.Color(0xB22222);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      this.petalVelocity[i] = 0.0003 + Math.random() * 0.0005;

      // Mix between light pink and rose red
      const c = Math.random() < 0.5 ? lightPink : roseRed;
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.015,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.petals = new THREE.Points(geo, mat);
    this.scene.add(this.petals);
  }

  setupListeners() {
    this._onMouseMove = (e) => {
      this.targetMouse.x = (e.clientX / window.innerWidth - 0.5) * 0.6;
      this.targetMouse.y = -(e.clientY / window.innerHeight - 0.5) * 0.6;
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

    // Rotate rings group
    this.ringsGroup.rotation.y += 0.0008;
    this.ringsGroup.rotation.x += 0.0003;

    // Drift petals upward and wrap
    const positions = this.petals.geometry.attributes.position.array;
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3 + 1] += this.petalVelocity[i];
      if (positions[i * 3 + 1] > 5) positions[i * 3 + 1] = -5;
    }
    this.petals.geometry.attributes.position.needsUpdate = true;

    // Mouse parallax (lerp)
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.05;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.05;
    this.camera.position.x = this.mouse.x * 0.5;
    this.camera.position.y = this.mouse.y * 0.5;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animFrame);
    this.renderer.dispose();
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
  }
}
