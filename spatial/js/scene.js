import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as P from './props.js';

// Critically damped spring (same response curve as Unity's SmoothDamp).
class Spring {
  constructor(value) {
    this.value = value;
    this.velocity = 0;
  }
  step(target, smoothTime, dt) {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * k;
    this.value = target + (change + temp) * k;
    return this.value;
  }
}

class Spring3 {
  constructor(v) {
    this.x = new Spring(v.x);
    this.y = new Spring(v.y);
    this.z = new Spring(v.z);
    this.value = v.clone();
  }
  step(target, smoothTime, dt) {
    this.value.set(
      this.x.step(target.x, smoothTime, dt),
      this.y.step(target.y, smoothTime, dt),
      this.z.step(target.z, smoothTime, dt)
    );
    return this.value;
  }
}

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float v = smoothstep(0.95, 0.25, length(p * vec2(1.0, 1.2)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      float g = hash(vUv * vec2(1931.0, 1173.0) + fract(uTime * 7.31)) - 0.5;
      c.rgb += g * uGrain * (1.0 - c.rgb * 0.6);
      gl_FragColor = c;
    }
  `
};

const LOOK = {
  day: {
    env: 0.9, bg: 0.7, sun: 3.2, lamp: 0, exposure: 1.0, screen: 0.85,
    sunColor: new THREE.Color(0xfff0dc)
  },
  night: {
    env: 0.09, bg: 0.035, sun: 0.12, lamp: 5.0, exposure: 1.08, screen: 1.25,
    sunColor: new THREE.Color(0x9fb4ff)
  }
};

// Camera framings: orbit around `target` at yaw/pitch (radians) and distance (m).
const OVERVIEW = { target: new THREE.Vector3(0.0, 0.0, -0.12), yaw: 0.0, pitch: 0.74, dist: 1.98 };
// tall screens: look further down so the table's far edge never enters the frame
const OVERVIEW_TALL = { target: new THREE.Vector3(0.02, 0.0, -0.1), yaw: 0.0, pitch: 0.86, dist: 1.85 };

function sphericalToPosition(target, yaw, pitch, dist, out) {
  return out.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    target.z + dist * Math.cos(yaw) * Math.cos(pitch)
  );
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Desk {
  constructor(canvas, { video, onHover, onSelect, onFrame, reducedMotion = false }) {
    this.canvas = canvas;
    this.video = video;
    this.onHover = onHover || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onFrame = onFrame || (() => {});
    this.reducedMotion = reducedMotion;

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 820;
    this.quality = coarse && small
      ? { dpr: 1.5, shadow: 1024, dof: false, samples: 2 }
      : { dpr: 1.6, shadow: 2048, dof: true, samples: 4 };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 30);

    this.hotspots = {};
    this.focus = null;
    this.hovered = null;
    this.night = 0;
    this.nightSpring = new Spring(0);
    this.nightTarget = 0;
    this.inset = { x: 0, y: 0 };
    this.insetX = new Spring(0);
    this.insetY = new Spring(0);

    this.pointer = new THREE.Vector2(0, 0);
    this.pointerNdc = new THREE.Vector2(10, 10);
    this.parallaxX = new Spring(0);
    this.parallaxY = new Spring(0);
    this.drag = { active: false, moved: false, x: 0, y: 0, yaw: 0, pitch: 0 };
    this.dragYaw = new Spring(0);
    this.dragPitch = new Spring(0);
    this.raycaster = new THREE.Raycaster();

    // intro: start high and wide, then settle into the overview
    this.cam = {
      target: new Spring3(new THREE.Vector3(0, 0.05, -0.2)),
      yaw: new Spring(-0.42),
      pitch: new Spring(1.12),
      dist: new Spring(2.5),
      aperture: new Spring(0.002)
    };
    this.travel = 1.7;
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.perf = { frames: 0, time: 0, settled: false };
  }

  async load(onProgress = () => {}) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_, loaded, total) => onProgress(loaded / total);
    const texLoader = new THREE.TextureLoader(manager);
    const imgLoader = new THREE.ImageLoader(manager);
    const hdrLoader = new RGBELoader(manager);

    const tex = (name, srgb) => texLoader.loadAsync(`assets/tex/${name}.jpg`).then(t => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    });
    const set = name => Promise.all([tex(`${name}_diff`, true), tex(`${name}_nor`), tex(`${name}_rough`)])
      .then(([diff, nor, rough]) => ({ diff, nor, rough }));

    const [hdr, dark, oak, rose, fusion, mano, portrait, page] = await Promise.all([
      hdrLoader.loadAsync('assets/hdri/brown_photostudio_02_1k.hdr'),
      set('dark_wood'),
      set('oak_veneer_01'),
      set('rosewood_veneer1'),
      imgLoader.loadAsync('../images/fusionsense/fusionsense_before.jpg'),
      imgLoader.loadAsync('assets/img/mano-screen.jpg'),
      imgLoader.loadAsync('../images/Kairui%20Shi.jpg'),
      imgLoader.loadAsync('assets/img/fusionsense-page1.jpg')
    ]);

    this.setupEnvironment(hdr);
    this.setupLights();
    this.build({
      renderer: this.renderer,
      tex: { dark, oak, rose },
      images: { fusion, mano, portrait, page }
    });
    this.setupComposer();
    this.bindEvents();
    this.resize();
    // compile everything up front so the first camera move doesn't hitch
    this.renderer.compile(this.scene, this.camera);
  }

  setupEnvironment(hdr) {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.background = hdr;
    this.scene.backgroundBlurriness = 0.55;
    // swing the studio's big window round to the left, matching the key light
    this.scene.environmentRotation.y = 2.2;
    this.scene.backgroundRotation.y = 2.2;
  }

  setupLights() {
    const sun = new THREE.DirectionalLight(0xfff0dc, LOOK.day.sun);
    // low, raking window light so everything throws a readable shadow
    sun.position.set(-1.55, 0.95, -0.45);
    sun.target.position.set(0, 0, -0.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    const s = sun.shadow.camera;
    s.left = -1.1; s.right = 1.1; s.top = 1.1; s.bottom = -1.1;
    s.near = 0.5; s.far = 4.5;
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.0015;
    this.scene.add(sun, sun.target);

    const lamp = new THREE.SpotLight(0xffc387, 0, 0, 0.78, 1, 2);
    lamp.position.set(-0.78, 0.82, 0.05);
    lamp.target.position.set(-0.05, 0, -0.12);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    lamp.shadow.bias = -0.0002;
    lamp.shadow.normalBias = 0.002;
    lamp.shadow.camera.near = 0.2;
    lamp.shadow.camera.far = 3;
    this.scene.add(lamp, lamp.target);

    this.lights = { sun, lamp };
  }

  build(ctx) {
    this.scene.add(P.table(ctx));

    const go = P.goSet(ctx);
    go.group.position.set(0.02, 0, -0.13);
    const frame = P.photoFrame(ctx);
    frame.group.position.set(-0.4, 0, -0.17);
    frame.group.rotation.y = 0.42;
    const books = P.books(ctx);
    books.group.position.set(-0.56, 0, 0.12);
    books.group.rotation.y = 0.28;
    const research = P.researchStack(ctx);
    research.group.position.set(0.42, 0, 0.26);
    research.group.rotation.y = -0.2;
    const laptop = P.laptop(ctx);
    laptop.group.position.set(0.5, 0, -0.62);
    laptop.group.rotation.y = -0.4;
    this.scene.add(go.group, frame.group, books.group, research.group, laptop.group);
    this.scene.updateMatrixWorld(true);

    this.photo = research.photo;
    this.screen = laptop.screen;

    const world = (prop, local) => prop.group.localToWorld(local.clone());
    const screenCenter = world(laptop, laptop.focusPoint);

    const shots = {
      about: { target: world(frame, frame.focusPoint), yaw: frame.group.rotation.y - 0.06, pitch: 0.22, dist: 0.52 },
      research: { target: world(research, research.focusPoint), yaw: -0.25, pitch: 1.02, dist: 0.5 },
      tools: { target: screenCenter, yaw: laptop.group.rotation.y + 0.12, pitch: 0.24, dist: 0.72 },
      beyond: { target: world(go, new THREE.Vector3(0.04, 0.07, -0.02)), yaw: 0.5, pitch: 0.8, dist: 0.78 }
    };

    for (const [key, prop] of Object.entries({ about: frame, research, tools: laptop, beyond: go })) {
      prop.hit.userData.key = key;
      this.hotspots[key] = {
        group: prop.group,
        hit: prop.hit,
        anchor: prop.anchor,
        baseY: prop.group.position.y,
        lift: new Spring(0),
        shot: shots[key]
      };
    }
    this.hitList = Object.values(this.hotspots).map(h => h.hit);
  }

  setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality.samples
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality.dof) {
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 1.6, aperture: 0.002, maxblur: 0.0065 });
      this.composer.addPass(this.bokeh);
    }
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
  }

  bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointermove', e => {
      this.pointer.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.pointerNdc.copy(this.pointer);
      if (this.drag.active) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > 5) {
          this.drag.moved = true;
          c.classList.add('dragging');
        }
        if (this.drag.moved) {
          const range = this.focus ? 0.28 : 0.6;
          this.drag.yaw = THREE.MathUtils.clamp(this.drag.yaw - dx * 0.0035, -range, range);
          this.drag.pitch = THREE.MathUtils.clamp(this.drag.pitch + dy * 0.0025, -0.25, 0.22);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      }
    });
    c.addEventListener('pointerdown', e => {
      this.drag.active = true;
      this.drag.moved = false;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.pointerNdc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      c.setPointerCapture(e.pointerId);
    });
    const end = e => {
      if (!this.drag.active) return;
      this.drag.active = false;
      c.classList.remove('dragging');
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (!this.drag.moved) this.onSelect(this.pick());
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', e => {
      this.drag.active = false;
      c.classList.remove('dragging');
    });
    c.addEventListener('pointerleave', () => {
      if (!this.drag.active) this.pointerNdc.set(10, 10);
    });
    window.addEventListener('resize', () => this.resize());
  }

  pick() {
    if (this.pointerNdc.x > 2) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitList, false)[0];
    return hit ? hit.object.userData.key : null;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    // keep roughly the same horizontal field of view on tall screens
    this.camera.fov = this.aspect >= 1.35 ? 30 : Math.min(46, 30 * Math.pow(1.35 / this.aspect, 0.6));
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr));
      this.composer.setSize(w, h);
    }
  }

  setFocus(key) {
    if (key === this.focus) return;
    const prev = this.focus;
    this.focus = key;
    this.drag.yaw = 0;
    this.drag.pitch = 0;
    this.travel = this.reducedMotion ? 0.35 : 1.05;
    if (key === 'research') this.playPhoto();
    if (prev === 'research') this.stopPhoto();
  }

  // Watch the first few seconds; step quality down once if frames are slow.
  adaptQuality(frameTime) {
    const p = this.perf;
    if (p.settled || this.elapsed < 1.5) return;
    p.frames++;
    p.time += frameTime;
    if (p.time < 2.5) return;
    const avg = p.time / p.frames;
    if (avg > 1 / 40) {
      if (this.bokeh) {
        this.composer.removePass(this.bokeh);
        this.bokeh = null;
      }
      this.quality.dpr = avg > 1 / 25 ? 1 : 1.25;
      this.resize();
    }
    p.settled = true;
  }

  setInset(x, y) {
    this.inset.x = x;
    this.inset.y = y;
  }

  // Hover driven from outside the canvas (the HTML labels).
  setHover(key) {
    this.forcedHover = key;
  }

  setNight(on, immediate = false) {
    this.nightTarget = on ? 1 : 0;
    if (immediate) this.nightSpring.value = this.nightTarget;
  }

  playPhoto() {
    const v = this.video;
    if (!v) return;
    if (!this.videoTex) {
      this.videoTex = new THREE.VideoTexture(v);
      this.videoTex.colorSpace = THREE.SRGBColorSpace;
    }
    const swap = () => {
      if (this.focus === 'research') this.photo.material.map = this.videoTex;
    };
    if (v.readyState >= 2 && !v.paused) swap();
    else v.addEventListener('playing', swap, { once: true });
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  stopPhoto() {
    clearTimeout(this.photoTimer);
    // let the camera pull away before the print goes still again
    this.photoTimer = setTimeout(() => {
      if (this.focus === 'research') return;
      this.video.pause();
      this.photo.material.map = this.photo.image;
    }, 700);
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    this.elapsed += dt;
    this.adaptQuality(raw);
    const t = this.elapsed;

    // ---- day / night
    const n = this.nightSpring.step(this.nightTarget, 0.55, dt);
    const lerp = (a, b) => a + (b - a) * n;
    const D = LOOK.day, N = LOOK.night;
    this.scene.environmentIntensity = lerp(D.env, N.env);
    this.scene.backgroundIntensity = lerp(D.bg, N.bg);
    this.lights.sun.intensity = lerp(D.sun, N.sun);
    this.lights.sun.color.copy(D.sunColor).lerp(N.sunColor, n);
    this.lights.lamp.intensity = lerp(D.lamp, N.lamp);
    // never toggle castShadow at runtime: it forces every material to recompile
    this.lights.lamp.shadow.autoUpdate = n > 0.02;
    this.renderer.toneMappingExposure = lerp(D.exposure, N.exposure);
    this.screen.emissiveIntensity = lerp(D.screen, N.screen);

    // ---- hover
    if (!this.drag.active) {
      const key = this.forcedHover || this.pick();
      if (key !== this.hovered) {
        this.hovered = key;
        this.onHover(key);
      }
    }
    for (const [key, h] of Object.entries(this.hotspots)) {
      const up = key === this.hovered && key !== this.focus ? 0.006 : 0;
      h.group.position.y = h.baseY + h.lift.step(up, 0.18, dt);
    }

    // ---- camera
    const tall = this.aspect < 1;
    const shot = this.focus ? this.hotspots[this.focus].shot : (tall ? OVERVIEW_TALL : OVERVIEW);
    const distScale = tall && this.focus ? 1.2 : 1;
    const travel = this.travel;
    this.travel += (1.05 - this.travel) * Math.min(1, dt * 0.6);

    const motion = this.reducedMotion ? 0 : 1;
    const px = this.parallaxX.step(this.drag.active ? this.parallaxX.value : this.pointer.x, 0.8, dt);
    const py = this.parallaxY.step(this.drag.active ? this.parallaxY.value : this.pointer.y, 0.8, dt);
    const dyaw = this.dragYaw.step(this.drag.yaw, 0.35, dt);
    const dpitch = this.dragPitch.step(this.drag.pitch, 0.35, dt);

    const yawTarget = this.cam.yaw.value + wrapAngle(shot.yaw - this.cam.yaw.value);
    const yaw = this.cam.yaw.step(yawTarget, travel, dt);
    const pitch = this.cam.pitch.step(shot.pitch, travel, dt);
    const dist = this.cam.dist.step(shot.dist * distScale, travel * 1.05, dt);
    const target = this.cam.target.step(shot.target, travel, dt);

    const breathe = motion * Math.sin(t * 0.21) * 0.012;
    const finalYaw = yaw + dyaw + motion * (px * 0.045 + breathe);
    const finalPitch = THREE.MathUtils.clamp(pitch + dpitch + motion * (py * 0.028 + Math.sin(t * 0.17) * 0.006), 0.08, 1.4);
    sphericalToPosition(target, finalYaw, finalPitch, dist, this.camera.position);
    this.camera.lookAt(target);

    // shift the frame so the subject sits in the space the panel leaves free
    const ix = this.insetX.step(this.inset.x, 0.7, dt);
    const iy = this.insetY.step(this.inset.y, 0.7, dt);
    if (Math.abs(ix) > 0.5 || Math.abs(iy) > 0.5) {
      this.camera.setViewOffset(this.width, this.height, -ix, iy, this.width, this.height);
    } else if (this.camera.view && this.camera.view.enabled) {
      this.camera.clearViewOffset();
    }


    // ---- depth of field
    if (this.bokeh) {
      const camDist = this.camera.position.distanceTo(target);
      const u = this.bokeh.uniforms;
      u.focus.value = camDist;
      u.aperture.value = this.cam.aperture.step(this.focus ? 0.0075 : 0.0032, 0.8, dt);
      u.maxblur.value = this.focus ? 0.009 : 0.0065;
    }
    this.film.uniforms.uTime.value = t;

    this.composer.render(dt);

    // ---- screen-space anchors for the hover labels
    const tags = {};
    for (const [key, h] of Object.entries(this.hotspots)) {
      const p = h.group.localToWorld(h.anchor.clone()).project(this.camera);
      tags[key] = {
        x: (p.x * 0.5 + 0.5) * this.width,
        y: (-p.y * 0.5 + 0.5) * this.height,
        visible: p.z < 1
      };
    }
    this.onFrame(tags);
  }
}
