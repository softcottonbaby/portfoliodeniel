import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FACES = 8;
const TILE_W = 640;
const TILE_H = 352;
const TAU = Math.PI * 2;

const loadImg = src => new Promise(res => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTile(im) {
  const c = document.createElement('canvas');
  c.width = TILE_W; c.height = TILE_H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, TILE_H);
  bg.addColorStop(0, '#dcd9d4'); bg.addColorStop(.5, '#fbfaf8'); bg.addColorStop(1, '#dcd9d4');
  g.fillStyle = bg;
  g.fillRect(0, 0, TILE_W, TILE_H);
  const px = 30, py = 26, w = TILE_W - px * 2, h = TILE_H - py * 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  roundRect(g, px, py, w, h, 18);
  g.fillStyle = '#111'; g.fill();
  g.restore();
  if (im) {
    g.save();
    roundRect(g, px, py, w, h, 18);
    g.clip();
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    g.drawImage(im, px + (w - iw) / 2, py + (h - ih) / 2, iw, ih);
    g.restore();
  }
  return c;
}

function reelCanvas(tiles) {
  const c = document.createElement('canvas');
  c.width = TILE_H * FACES; c.height = TILE_W;
  const g = c.getContext('2d');
  tiles.forEach((t, k) => {
    g.save();
    g.translate(k * TILE_H + TILE_H / 2, TILE_W / 2);
    g.rotate(Math.PI / 2);
    g.drawImage(t, -TILE_W / 2, -TILE_H / 2);
    g.restore();
  });
  return c;
}

function blurred(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  const steps = 9;
  g.globalAlpha = 1 / steps * 1.6;
  for (let i = 0; i < steps; i++) {
    const off = (i - (steps - 1) / 2) * 9;
    g.drawImage(src, off, 0);
    g.drawImage(src, off + (off < 0 ? c.width : -c.width), 0);
  }
  g.globalAlpha = 1;
  return c;
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

class Sfx {
  constructor(ctx) { this.ctx = null; this.pre = ctx || null; this.muted = false; this.lastTick = 0; }
  ready() {
    if (this.muted) return null;
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!this.pre && !C) return null;
      this.ctx = this.pre || new C();
      this.out = this.ctx.createDynamicsCompressor();
      this.out.threshold.value = -14; this.out.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.out); this.out.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  env(g, t, vol, a, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  tone(f, t, dur, { type = 'sine', vol = 0.3, a = 0.004, to = null } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, vol, a, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(t, dur, { vol = 0.3, type = 'bandpass', f = 1200, q = 1, to = null, a = 0.003 } = {}) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, vol, a, dur);
    s.connect(fl); fl.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  whoosh() {
    if (!this.ready()) return; const t = this.ctx.currentTime;
    this.noise(t, 0.85, { vol: 0.35, f: 250, to: 3800, q: 0.8, a: 0.35 });
    this.tone(55, t, 0.9, { vol: 0.25, to: 110, a: 0.4 });
  }
  land() {
    if (!this.ready()) return; const t = this.ctx.currentTime;
    this.tone(95, t, 0.55, { vol: 0.7, to: 38 });
    this.noise(t, 0.18, { vol: 0.4, type: 'lowpass', f: 900 });
    this.shimmer(t + 0.05, 14, 0.9);
  }
  shimmer(t, n = 10, span = 0.6) {
    for (let i = 0; i < n; i++) {
      const f = 2200 + Math.random() * 3200;
      this.tone(f, t + Math.random() * span, 0.35, { vol: 0.06 + Math.random() * 0.05, type: 'sine' });
    }
  }
  pull() {
    if (!this.ready()) return; const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this.noise(t + i * 0.035, 0.03, { vol: 0.25, type: 'highpass', f: 3000 });
    this.tone(160, t + 0.24, 0.22, { vol: 0.55, to: 55, type: 'triangle' });
    this.noise(t + 0.24, 0.12, { vol: 0.35, type: 'lowpass', f: 700 });
    this.noise(t + 0.26, 1.2, { vol: 0.12, f: 900, q: 0.6, a: 0.15 });
  }
  tick() {
    if (!this.ctx || this.muted) return; const t = this.ctx.currentTime;
    if (t - this.lastTick < 0.028) return; this.lastTick = t;
    this.noise(t, 0.022, { vol: 0.16, f: 2600, q: 3 });
    this.tone(1300 + Math.random() * 200, t, 0.03, { vol: 0.035, type: 'square' });
  }
  stop() {
    if (!this.ready()) return; const t = this.ctx.currentTime;
    this.tone(210, t, 0.16, { vol: 0.5, to: 80, type: 'triangle' });
    this.noise(t, 0.06, { vol: 0.35, type: 'lowpass', f: 1600 });
  }
  jackpot() {
    if (!this.ready()) return; const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((f, i) => {
      const s = t + i * 0.075;
      this.tone(f, s, 1.1, { vol: 0.16, type: 'triangle', a: 0.006 });
      this.tone(f * 2, s, 0.7, { vol: 0.05, type: 'sine', a: 0.006 });
    });
    this.tone(1046.5, t + 0.5, 1.6, { vol: 0.12, type: 'sine', a: 0.01 });
    this.tone(1318.5, t + 0.5, 1.6, { vol: 0.09, type: 'sine', a: 0.01 });
    this.tone(1567.98, t + 0.5, 1.6, { vol: 0.08, type: 'sine', a: 0.01 });
    this.shimmer(t + 0.45, 22, 1.1);
  }
}

function studioEnv(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0b0806);
  const panel = (w, h, color, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(14, 4, 0xffffff, 7, [0, 9, 2]);
  panel(3, 12, 0xfff3dc, 5, [-10, 1, 4]);
  panel(3, 12, 0xffe6b8, 4, [10, 1, 3]);
  panel(12, 2.5, 0xffffff, 3, [0, 2, 11]);
  panel(8, 8, 0xff9a1f, 2.4, [0, -8, -5]);
  panel(5, 9, 0xa86bff, 1.4, [7, 2, -9]);
  panel(4, 1.2, 0xffffff, 9, [-4, 5, 8]);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.015).texture;
  pm.dispose();
  return tex;
}

function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(255,236,170,.9)');
  rg.addColorStop(0.45, 'rgba(255,190,60,.25)');
  rg.addColorStop(1, 'rgba(255,160,20,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,245,210,.85)';
  g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const clamp01 = v => Math.min(1, Math.max(0, v));
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t, s = 1.4) => { const p = t - 1; return 1 + (s + 1) * p * p * p + s * p * p; };

export async function mount(stage, items, opts = {}) {
  const canvas = stage.querySelector('canvas');
  const frame = opts.frame || stage;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x050506, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 512; bgCanvas.height = 512;
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  function paintBg(cx, cy) {
    const g = bgCanvas.getContext('2d');
    g.fillStyle = '#050506'; g.fillRect(0, 0, 512, 512);
    const a = g.createRadialGradient(cx * 512, cy * 512, 0, cx * 512, cy * 512, 300);
    a.addColorStop(0, 'rgba(124,58,237,.20)'); a.addColorStop(1, 'rgba(124,58,237,0)');
    g.fillStyle = a; g.fillRect(0, 0, 512, 512);
    const b = g.createRadialGradient(cx * 512, cy * 512, 0, cx * 512, cy * 512, 190);
    b.addColorStop(0, 'rgba(245,158,11,.13)'); b.addColorStop(1, 'rgba(245,158,11,0)');
    g.fillStyle = b; g.fillRect(0, 0, 512, 512);
    bgTex.needsUpdate = true;
  }

  const key = new THREE.DirectionalLight(0xfff0d0, 2.0);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc084fc, 1.8);
  rim.position.set(5, 3, -6);
  scene.add(rim);
  const glint = new THREE.PointLight(0xfff4d6, 28, 0, 2);
  scene.add(glint);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const target = new THREE.Vector3(0.45, 0.45, 0);

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(opts.model || './slot.glb');

  const rig = new THREE.Group();
  scene.add(rig);
  const machine = gltf.scene;
  rig.add(machine);

  const gold = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(1.0, 0.64, 0.14),
    metalness: 1, roughness: 0.16, envMapIntensity: 1.15,
    clearcoat: 0.35, clearcoatRoughness: 0.08
  });
  machine.traverse(o => {
    if (o.isMesh && o.material && /gold/i.test(o.material.name)) o.material = gold;
    if (o.isMesh && o.material && /knob/i.test(o.material.name)) { o.material.envMapIntensity = 1.4; o.material.color.setRGB(0.75, 0.01, 0.02); }
  });

  const reels = [];
  const reelGeo = new THREE.CylinderGeometry(1, 1, 1.45, 160, 1, true);
  reelGeo.rotateZ(Math.PI / 2);
  for (let i = 1; i <= 3; i++) {
    const ph = machine.getObjectByName('Reel' + i);
    const x = ph ? ph.position.x : (i - 2) * 1.69;
    if (ph) ph.visible = false;
    const mat = new THREE.MeshStandardMaterial({ color: 0xe6e4e0, roughness: 0.5, metalness: 0, envMapIntensity: 0.3 });
    const mesh = new THREE.Mesh(reelGeo, mat);
    mesh.position.set(x, ph ? ph.position.y : 0, ph ? ph.position.z : 0);
    rig.add(mesh);
    reels.push({ mesh, mat, list: [], sharp: null, blur: null, angle: 0, from: 0, to: 0, t0: 0, dur: 0, spinning: false, face: 0 });
  }

  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(128, 32, 0, 128, 32, 128);
    rg.addColorStop(0, 'rgba(0,0,0,.75)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.setTransform(1, 0, 0, 0.25, 0, 24); g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.45, -1.75, 0.2);
  scene.add(shadow);

  const SPARKS = 150;
  const sPos = new Float32Array(SPARKS * 3), sCol = new Float32Array(SPARKS * 3), sBase = [];
  for (let i = 0; i < SPARKS; i++) {
    const a = Math.random() * TAU, r = 3.2 + Math.random() * 2.4, y = (Math.random() - 0.4) * 4.2;
    sBase.push({ a, r, y, ph: Math.random() * TAU, sp: 0.6 + Math.random() * 2.2 });
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const sMat = new THREE.PointsMaterial({ size: 0.22, map: sparkTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const sparks = new THREE.Points(sGeo, sMat);
  sparks.position.x = 0.45;
  scene.add(sparks);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace }));
  composer.setPixelRatio(Math.min(dpr, 1.5));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.35, 0.96);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pivot = machine.getObjectByName('LeverPivot');
  const leverParts = [];
  if (pivot) pivot.traverse(o => { if (o.isMesh) leverParts.push(o); });
  const mixer = new THREE.AnimationMixer(machine);
  const clip = gltf.animations.find(a => /pull/i.test(a.name)) || gltf.animations[0];
  const pullAction = clip ? mixer.clipAction(clip) : null;
  if (pullAction) { pullAction.setLoop(THREE.LoopOnce, 1); pullAction.clampWhenFinished = false; }

  const images = await Promise.all(items.map(it => loadImg('./' + it.file)));
  const tiles = images.map(drawTile);

  function buildReel(r, winner) {
    const others = shuffle(items.map((_, i) => i).filter(i => i !== winner));
    const list = others.slice(0, FACES - 1);
    const slot = Math.floor(Math.random() * FACES);
    list.splice(slot, 0, winner);
    r.list = list;
    const c = reelCanvas(list.map(i => tiles[i]));
    if (r.sharp) { r.sharp.dispose(); r.blur.dispose(); }
    r.sharp = new THREE.CanvasTexture(c);
    r.blur = new THREE.CanvasTexture(blurred(c));
    for (const t of [r.sharp, r.blur]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.wrapS = THREE.RepeatWrapping;
    }
    r.mat.map = r.sharp;
    r.mat.needsUpdate = true;
    return slot;
  }

  const faceAngle = k => (k + 0.5) * TAU / FACES;
  const first = Math.floor(Math.random() * items.length);
  reels.forEach(r => {
    const k = buildReel(r, first);
    r.angle = faceAngle(k);
    r.mesh.rotation.x = r.angle;
  });

  function resize() {
    const rect = stage.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const boxW = Math.max(120, Math.min(fr.width * 0.94, 1080));
    const boxH = Math.max(120, fr.height);
    const needW = 9.9 * w / (boxW * 2 * half * camera.aspect);
    const needH = 4.6 * h / (boxH * 2 * half);
    const dist = Math.max(needW, needH);
    camera.position.set(target.x + 0.2, target.y + dist * 0.16, dist);
    camera.lookAt(target);
    const cy = fr.top - rect.top + fr.height / 2;
    camera.setViewOffset(w, h, 0, h / 2 - cy, w, h);
    camera.updateProjectionMatrix();
    paintBg(0.5, cy / h);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  ro.observe(frame);

  let px = 0, py = 0, tx = 0, ty = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = (e, list, deep) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(list, deep).length > 0;
  };
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    canvas.style.cursor = !busy && !intro && hit(e, [rig], true) ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
  canvas.addEventListener('pointerdown', e => { if (hit(e, [rig], true)) api.pull(); });

  const sfx = new Sfx(opts.audio);
  sfx.muted = !!opts.muted;
  let busy = false, raf = 0, flash = 0, intro = null, landed = false, queued = false;
  const clock = new THREE.Clock();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INTRO = reduce ? 0.6 : 1.7;

  function spinTo(r, winnerSlot, i, now) {
    const base = faceAngle(winnerSlot);
    const turns = (reduce ? 1 : 3) + i * (reduce ? 0.5 : 1.25);
    let to = base;
    while (to < r.angle + turns * TAU) to += TAU;
    r.from = r.angle; r.to = to; r.t0 = now + i * 0.06; r.dur = (reduce ? 0.9 : 1.75) + i * (reduce ? 0.25 : 0.55);
    r.spinning = true;
  }

  function startIntro() {
    intro = { t0: clock.elapsedTime };
    landed = false;
    reels.forEach(r => { r.introFrom = r.angle - TAU * (1.5 + Math.random()); r.face = Math.floor(r.introFrom / (TAU / FACES)); });
    if (opts.onIntro) opts.onIntro();
    sfx.whoosh();
  }

  let resolveSpin = null, spinEnd = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;
    mixer.update(dt);
    px += (tx - px) * Math.min(1, dt * 3);
    py += (ty - py) * Math.min(1, dt * 3);

    let ip = 1;
    if (intro) {
      ip = clamp01((now - intro.t0) / INTRO);
      if (!landed && ip > 0.55) {
        landed = true; flash = 1;
        sfx.land();
        if (opts.onLand) opts.onLand();
      }
      if (ip >= 1) { intro = null; if (queued) { queued = false; api.pull(); } }
    }
    const e = easeOutBack(ip, 1.2);
    const ec = easeOutCubic(ip);
    rig.scale.setScalar(0.25 + 0.75 * e);
    rig.rotation.y = -0.22 + px * 0.2 - (1 - ec) * TAU * 0.75;
    rig.rotation.x = 0.05 + py * 0.08;
    rig.rotation.z = (1 - ec) * 0.35;
    rig.position.y = (reduce ? 0 : Math.sin(now * 1.3) * 0.06) - (1 - ec) * 4.5;

    flash = Math.max(0, flash - dt * 1.6);
    key.intensity = 2.0 + flash * 4;
    bloom.strength = 0.16 + flash * 0.5;
    glint.position.set(0.45 + Math.sin(now * 0.7) * 5.5, 2.6 + Math.cos(now * 0.45) * 0.6, 4.2);

    const sp = (1 - ec) * 2.2;
    sparks.rotation.y = now * 0.08 + sp;
    for (let i = 0; i < SPARKS; i++) {
      const b = sBase[i];
      const rr = b.r * (1 + sp);
      sPos[i * 3] = Math.cos(b.a) * rr;
      sPos[i * 3 + 1] = b.y + Math.sin(now * 0.5 + b.ph) * 0.25;
      sPos[i * 3 + 2] = Math.sin(b.a) * rr * 0.55 - 0.5;
      const tw = Math.pow(0.5 + 0.5 * Math.sin(now * b.sp + b.ph), 6) * (0.35 + ec * 0.9) + flash * 0.8;
      sCol[i * 3] = tw; sCol[i * 3 + 1] = tw * 0.82; sCol[i * 3 + 2] = tw * 0.45;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;

    let still = true;
    reels.forEach(r => {
      let shown = r.angle;
      if (r.spinning) {
        still = false;
        const t = clamp01((now - r.t0) / r.dur);
        const prev = r.angle;
        r.angle = r.from + (r.to - r.from) * easeOutBack(t, 1.25);
        const speed = Math.abs(r.angle - prev) / Math.max(dt, 1e-3);
        const want = speed > 9 ? r.blur : r.sharp;
        if (r.mat.map !== want) { r.mat.map = want; r.mat.needsUpdate = true; }
        shown = r.angle;
        if (t >= 1) {
          r.spinning = false;
          r.angle = r.to % TAU;
          shown = r.angle;
          if (r.mat.map !== r.sharp) { r.mat.map = r.sharp; r.mat.needsUpdate = true; }
          sfx.stop();
          flash = Math.max(flash, 0.35);
          if (opts.onReelStop) opts.onReelStop(reels.indexOf(r));
        }
      } else if (intro || ip < 1) {
        shown = r.introFrom + (r.angle - r.introFrom) * easeOutCubic(clamp01((now - (intro ? intro.t0 : 0)) / (INTRO * 0.95)));
      }
      const f = Math.floor(shown / (TAU / FACES));
      if (f !== r.face) { r.face = f; if (r.spinning || intro) sfx.tick(); }
      r.mesh.rotation.x = shown;
    });
    if (busy && still && resolveSpin && now > spinEnd) {
      const done = resolveSpin; resolveSpin = null;
      flash = 1;
      sfx.jackpot();
      done();
    }
    composer.render(dt);
  }

  const api = {
    pull() {
      if (intro) { queued = true; return null; }
      if (busy || !items.length) return null;
      busy = true;
      if (opts.onStart) opts.onStart();
      sfx.pull();
      const winner = Math.floor(Math.random() * items.length);
      if (pullAction) { pullAction.reset(); pullAction.play(); }
      const now = clock.elapsedTime;
      const delay = pullAction ? 0.26 : 0;
      reels.forEach((r, i) => {
        const slot = buildReel(r, winner);
        r.mat.map = r.blur; r.mat.needsUpdate = true;
        setTimeout(() => spinTo(r, slot, i, clock.elapsedTime), delay * 1000);
      });
      spinEnd = now + delay + 0.5;
      return new Promise(res => {
        resolveSpin = () => { busy = false; res(items[winner]); if (opts.onResult) opts.onResult(items[winner]); };
      });
    },
    setActive(on, withIntro = true) {
      cancelAnimationFrame(raf);
      if (on) {
        clock.getDelta(); resize();
        if (withIntro && !busy) startIntro();
        tick();
      }
    },
    setMuted(m) { sfx.muted = m; if (m && sfx.ctx) sfx.ctx.suspend(); else if (!m && sfx.ctx) sfx.ctx.resume(); },
    unlockAudio() { sfx.ready(); },
    get busy() { return busy; }
  };
  api.setActive(true);
  return api;
}
