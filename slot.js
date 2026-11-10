import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FACES = 8;
const TAU = Math.PI * 2;
const STEP = TAU / FACES;

const loadImg = src => new Promise(res => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
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

function drawTile(im, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const k = W / 640;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#d9d6d0'); bg.addColorStop(.5, '#fbfaf8'); bg.addColorStop(1, '#d9d6d0');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const px = 30 * k, py = 26 * k, w = W - px * 2, h = H - py * 2, rr = 18 * k;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 14 * k; g.shadowOffsetY = 4 * k;
  roundRect(g, px, py, w, h, rr);
  g.fillStyle = '#111'; g.fill();
  g.restore();
  if (im) {
    g.save();
    roundRect(g, px, py, w, h, rr);
    g.clip();
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    let src = im, sw = im.naturalWidth, sh = im.naturalHeight;
    while (sw * 0.5 > iw) {
      const t = document.createElement('canvas');
      t.width = Math.round(sw * 0.5); t.height = Math.round(sh * 0.5);
      const tg = t.getContext('2d');
      tg.imageSmoothingQuality = 'high';
      tg.drawImage(src, 0, 0, t.width, t.height);
      src = t; sw = t.width; sh = t.height;
    }
    g.drawImage(src, px + (w - iw) / 2, py + (h - ih) / 2, iw, ih);
    g.restore();
  }
  const r = document.createElement('canvas');
  r.width = H; r.height = W;
  const rg = r.getContext('2d');
  rg.translate(H / 2, W / 2);
  rg.rotate(Math.PI / 2);
  rg.drawImage(c, -W / 2, -H / 2);
  return r;
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const BLUR_FRAG = `
#ifdef USE_MAP
  vec4 sampledDiffuseColor;
  if (uBlur < 0.0004) {
    sampledDiffuseColor = texture2D(map, vMapUv);
  } else {
    vec4 acc = vec4(0.0);
    float ws = 0.0;
    for (int i = -7; i <= 7; i++) {
      float f = float(i) / 7.0;
      float w = 1.0 - f * f * 0.75;
      acc += texture2D(map, vMapUv + vec2(f * uBlur, 0.0)) * w;
      ws += w;
    }
    sampledDiffuseColor = acc / ws;
  }
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const SOUNDS = { whoosh: 0.9, lever: 1, spin: 0.32, stop: 0.8, win: 0.85, coins: 0.4 };
const SOUND_FILES = { stop: 'stop.m4a' };

class Sfx {
  constructor(ctx) {
    this.muted = false; this.buf = {}; this.spinNode = null;
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = ctx || (C ? new C() : null);
    if (!this.ctx) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }
  async load(base) {
    if (!this.ctx) return;
    await Promise.all(Object.keys(SOUNDS).map(async n => {
      try {
        const r = await fetch(base + (SOUND_FILES[n] || n + '.mp3'));
        this.buf[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) {}
    }));
  }
  play(n, { vol = 1, rate = 1, offset = 0, delay = 0, loop = false } = {}) {
    if (!this.ctx || this.muted || !this.buf[n]) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = this.buf[n];
    src.playbackRate.value = rate;
    if (loop) { src.loop = true; src.loopStart = 0.1; src.loopEnd = Math.min(4.2, src.buffer.duration); }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(SOUNDS[n] * vol, t + 0.02);
    src.connect(g); g.connect(this.master);
    src.start(t, offset);
    return { src, g };
  }
  intro() { this.play('whoosh'); }
  land() { this.play('coins', { vol: 0.55, rate: 1.12 }); }
  pull() {
    this.play('lever');
    this.stopSpin(0);
    this.spinNode = this.play('spin', { offset: 0.1, delay: 0.24, loop: true });
  }
  stop(i) { this.play('stop', { rate: 0.92 + i * 0.07 }); }
  stopSpin(fade = 0.35) {
    const n = this.spinNode; this.spinNode = null;
    if (!n) return;
    const t = this.ctx.currentTime;
    n.g.gain.cancelScheduledValues(t);
    n.g.gain.setValueAtTime(n.g.gain.value, t);
    n.g.gain.linearRampToValueAtTime(0, t + fade);
    n.src.stop(t + fade + 0.05);
  }
  jackpot() {
    this.stopSpin(0.25);
    this.play('win');
    this.play('coins', { delay: 0.18 });
  }
  setMuted(m) {
    this.muted = m;
    if (m) this.stopSpin(0.1);
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  const small = Math.min(screen.width, screen.height) < 700;
  const maxTex = renderer.capabilities.maxTextureSize;
  const TILE_H = !small && maxTex >= 8192 ? 512 : 352;
  const TILE_W = Math.round(TILE_H * 1.8125);
  const maxScale = Math.min(window.devicePixelRatio || 1, 2);
  let scale = maxScale;
  renderer.setPixelRatio(scale);
  renderer.setClearColor(0x050506, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 1024; bgCanvas.height = 1024;
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  let bgY = -1;
  function paintBg(cy) {
    if (Math.abs(cy - bgY) < 0.002) return;
    bgY = cy;
    const g = bgCanvas.getContext('2d'), S = 1024, x = S / 2, y = cy * S;
    g.fillStyle = '#050506'; g.fillRect(0, 0, S, S);
    const a = g.createRadialGradient(x, y, 0, x, y, 600);
    a.addColorStop(0, 'rgba(124,58,237,.20)'); a.addColorStop(1, 'rgba(124,58,237,0)');
    g.fillStyle = a; g.fillRect(0, 0, S, S);
    const b = g.createRadialGradient(x, y, 0, x, y, 380);
    b.addColorStop(0, 'rgba(245,158,11,.13)'); b.addColorStop(1, 'rgba(245,158,11,0)');
    g.fillStyle = b; g.fillRect(0, 0, S, S);
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
  const [gltf, images] = await Promise.all([
    loader.loadAsync(opts.model || './slot.glb'),
    Promise.all(items.map(it => loadImg('img/' + String(it.file).replace(/\.png$/i, '') + '.webp')))
  ]);

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

  const tiles = images.map(im => drawTile(im, TILE_W, TILE_H));
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  function makeStripTex() {
    const c = document.createElement('canvas');
    c.width = TILE_H * FACES; c.height = TILE_W;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function paintStrip(tex, list, only) {
    const g = tex.image.getContext('2d');
    list.forEach((d, k) => { if (!only || only.has(k)) g.drawImage(tiles[d], k * TILE_H, 0); });
    tex.needsUpdate = true;
  }

  const reels = [];
  const reelGeo = new THREE.CylinderGeometry(1, 1, 1.45, 192, 1, true);
  reelGeo.rotateZ(Math.PI / 2);
  for (let i = 1; i <= 3; i++) {
    const ph = machine.getObjectByName('Reel' + i);
    const x = ph ? ph.position.x : (i - 2) * 1.69;
    if (ph) ph.visible = false;
    const blur = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ color: 0xe6e4e0, roughness: 0.5, metalness: 0, envMapIntensity: 0.3 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uBlur = blur;
      sh.fragmentShader = 'uniform float uBlur;\n' + sh.fragmentShader.replace('#include <map_fragment>', BLUR_FRAG);
    };
    mat.customProgramCacheKey = () => 'reelblur';
    const mesh = new THREE.Mesh(reelGeo, mat);
    mesh.position.set(x, ph ? ph.position.y : 0, ph ? ph.position.z : 0);
    rig.add(mesh);
    reels.push({ mesh, mat, blur, tex: [makeStripTex(), makeStripTex()], cur: 0, list: [], slot: 0, angle: 0, shown: 0, from: 0, to: 0, t0: 0, dur: 0, spinning: false });
  }

  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 0.5, 0, 0);
    const rg = g.createRadialGradient(256, 256, 0, 256, 256, 200);
    rg.addColorStop(0, 'rgba(0,0,0,.7)'); rg.addColorStop(0.5, 'rgba(0,0,0,.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.45, -1.75, 0.2);
  scene.add(shadow);

  const SPARKS = 170;
  const sPos = new Float32Array(SPARKS * 3), sCol = new Float32Array(SPARKS * 3), sBase = [];
  for (let i = 0; i < SPARKS; i++) {
    sBase.push({ x: (Math.random() - 0.5) * 16, z: -4.5 + Math.random() * 5.5, y: Math.random() * 12, v: 0.25 + Math.random() * 0.55, w: Math.random() * TAU, ph: Math.random() * TAU, sp: 0.8 + Math.random() * 2.4 });
  }
  let sparkLift = 0;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sMat = new THREE.PointsMaterial({ size: 0.22, map: sparkTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const sparks = new THREE.Points(sGeo, sMat);
  sparks.position.set(0.45, -5.5, 0);
  sparks.frustumCulled = false;
  scene.add(sparks);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(scale);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.35, 0.96);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pivot = machine.getObjectByName('LeverPivot');
  const leverBase = pivot ? pivot.quaternion.clone() : null;
  let leverSign = 1, leverMax = THREE.MathUtils.degToRad(80);
  const clip = gltf.animations.find(a => /pull/i.test(a.name)) || gltf.animations[0];
  if (clip && pivot) {
    const mixer = new THREE.AnimationMixer(machine);
    const act = mixer.clipAction(clip);
    act.play();
    let peak = 0;
    for (let f = 0; f <= 20; f++) {
      mixer.setTime(f / 30);
      const q = leverBase.clone().invert().multiply(pivot.quaternion);
      const ang = 2 * Math.atan2(q.x, q.w);
      if (Math.abs(ang) > Math.abs(peak)) peak = ang;
    }
    act.stop();
    mixer.uncacheRoot(machine);
    pivot.quaternion.copy(leverBase);
    if (Math.abs(peak) > 0.2) { leverSign = Math.sign(peak); leverMax = Math.abs(peak); }
  }
  const PULL_T = 0.26, HOLD_T = 0.07, SPRING_W = 12.5, SPRING_Z = 0.52;
  const springWd = SPRING_W * Math.sqrt(1 - SPRING_Z * SPRING_Z);
  const qLever = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0);
  let leverT0 = -1;
  function leverAngle(t) {
    if (t <= PULL_T) return leverMax * (0.5 - 0.5 * Math.cos(Math.PI * t / PULL_T));
    if (t <= PULL_T + HOLD_T) return leverMax;
    const u = t - PULL_T - HOLD_T;
    const e = Math.exp(-SPRING_Z * SPRING_W * u);
    return leverMax * e * (Math.cos(springWd * u) + (SPRING_Z * SPRING_W / springWd) * Math.sin(springWd * u));
  }
  function updateLever() {
    if (!pivot || leverT0 < 0) return;
    const t = now - leverT0;
    let a = leverAngle(t);
    if (t > PULL_T + HOLD_T + 1.2 && Math.abs(a) < 0.0005) { a = 0; leverT0 = -1; }
    qLever.setFromAxisAngle(xAxis, a * leverSign);
    pivot.quaternion.copy(leverBase).multiply(qLever);
  }

  const FACE_UP = 0.26;
  const faceAngle = k => (k + 0.5) * STEP - FACE_UP;
  const visibleFace = r => ((Math.round((r.angle + FACE_UP) / STEP - 0.5) % FACES) + FACES) % FACES;
  let nextWinner = -1, prepared = false;

  function prepareNext() {
    const n = items.length;
    const shownNow = reels[0].list.length ? reels[0].list[visibleFace(reels[0])] : -1;
    let next = opts.pickNext ? opts.pickNext(shownNow) : Math.floor(Math.random() * n);
    if (!(next >= 0 && next < n)) next = Math.floor(Math.random() * n);
    if (n > 1 && next === shownNow) next = (next + 1 + Math.floor(Math.random() * (n - 1))) % n;
    reels.forEach(r => {
      const first = !r.list.length;
      const kv = first ? 0 : visibleFace(r);
      const keep = first ? new Set() : new Set([kv, (kv + 1) % FACES, (kv + FACES - 1) % FACES]);
      const list = first ? new Array(FACES).fill(0) : r.list.slice();
      const open = [...Array(FACES).keys()].filter(k => !keep.has(k) && k !== kv);
      const slot = open[Math.floor(Math.random() * open.length)];
      const kept = new Set([...keep].map(k => list[k]));
      const pool = shuffle([...Array(n).keys()].filter(d => d !== next && !kept.has(d)));
      for (let k = 0; k < FACES; k++) {
        if (keep.has(k)) continue;
        if (k === slot) list[k] = next;
        else list[k] = pool.length ? pool.pop() : Math.floor(Math.random() * n);
      }
      r.list = list;
      r.slot = slot;
      const back = 1 - r.cur;
      paintStrip(r.tex[back], list);
      renderer.initTexture(r.tex[back]);
      r.cur = back;
      r.mat.map = r.tex[back];
      r.mat.needsUpdate = first;
    });
    nextWinner = next;
    prepared = true;
  }
  reels.forEach(r => { r.angle = r.shown = faceAngle(0); r.mesh.rotation.x = r.angle; });
  prepareNext();

  let dropY = 9;
  function resize() {
    const rect = stage.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    renderer.setPixelRatio(scale);
    composer.setPixelRatio(scale);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const boxW = Math.max(120, Math.min(fr.width * 0.94, 1080));
    const boxH = Math.max(120, fr.height);
    const needW = 9.9 * w / (boxW * 2 * half * camera.aspect);
    const needH = 4.6 * h / (boxH * 2 * half);
    const dist = Math.max(needW, needH);
    dropY = dist * half * 1.15 + 3.5;
    camera.position.set(target.x + 0.2, target.y + dist * 0.16, dist);
    camera.lookAt(target);
    const cy = fr.top - rect.top + fr.height / 2;
    camera.setViewOffset(w, h, 0, h / 2 - cy, w, h);
    camera.updateProjectionMatrix();
    paintBg(cy / h);
  }
  resize();
  let resizeQueued = false;
  const ro = new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  });
  ro.observe(stage);
  ro.observe(frame);

  let px = 0, py = 0, tx = 0, ty = 0;
  let busy = false, raf = 0, flash = 0, intro = null, landed = false, queued = false;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = e => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(rig, true).length > 0;
  };
  let hoverCheck = 0;
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    const t = performance.now();
    if (t - hoverCheck > 80) { hoverCheck = t; canvas.style.cursor = !busy && !intro && hit(e) ? 'pointer' : 'default'; }
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
  canvas.addEventListener('pointerdown', e => { if (hit(e)) api.pull(); });

  const sfx = new Sfx(opts.audio);
  sfx.setMuted(!!opts.muted);
  await sfx.load(opts.sounds || './sfx/');

  let last = 0, now = 0, perfAcc = 0, perfN = 0, goodWindows = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INTRO = reduce ? 0.6 : 2.1;

  function spinTo(r, i, t) {
    const base = faceAngle(r.slot);
    const turns = (reduce ? 1 : 3) + i * (reduce ? 0.5 : 1.25);
    let to = base;
    while (to < r.angle + turns * TAU) to += TAU;
    r.from = r.angle; r.to = to; r.t0 = t + i * 0.06; r.dur = (reduce ? 0.9 : 1.75) + i * (reduce ? 0.25 : 0.55);
    r.spinning = true;
  }

  function startIntro() {
    intro = { t0: now + 0.15 };
    landed = false;
    reels.forEach(r => { r.introFrom = r.angle - TAU * (1.5 + Math.random()); });
    if (opts.onIntro) opts.onIntro();
    setTimeout(() => sfx.intro(), 150);
  }

  function adapt(raw) {
    if (intro || raw > 0.25) return;
    perfAcc += raw; perfN++;
    if (perfN < 40) return;
    const avg = perfAcc / perfN;
    perfAcc = 0; perfN = 0;
    if (avg > 1 / 48 && scale > 1) { scale = Math.max(1, +(scale - 0.25).toFixed(2)); goodWindows = 0; resize(); }
    else if (avg < 1 / 58 && scale < maxScale) { if (++goodWindows >= 4) { goodWindows = 0; scale = Math.min(maxScale, +(scale + 0.25).toFixed(2)); resize(); } }
    else goodWindows = 0;
  }

  let resolveSpin = null, spinEnd = 0;
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    const t = ts / 1000;
    const raw = last ? t - last : 1 / 60;
    last = t;
    const dt = Math.min(raw, 1 / 20);
    now += dt;
    adapt(raw);
    updateLever();
    const k = 1 - Math.exp(-dt * 4);
    px += (tx - px) * k;
    py += (ty - py) * k;

    let ip = 1;
    if (intro) {
      ip = clamp01((now - intro.t0) / INTRO);
      if (now < intro.t0) ip = 0;
      if (!landed && ip > 0.5) {
        landed = true; flash = 1;
        sfx.land();
        if (opts.onLand) opts.onLand();
      }
      if (ip >= 1) { intro = null; if (queued) { queued = false; api.pull(); } }
    }
    const rise = easeOutBack(clamp01(ip / 0.62), 0.9);
    const ec = easeOutCubic(ip);
    const eq = 1 - Math.pow(1 - ip, 4);
    rig.scale.setScalar(0.92 + 0.08 * ec);
    shadow.material.opacity = 0.85 * clamp01((ip - 0.42) / 0.3);
    rig.rotation.y = -0.22 + px * 0.2 - (1 - eq) * TAU * 1.25;
    rig.rotation.x = 0.05 + py * 0.08 + (1 - ec) * 0.75;
    rig.rotation.z = (1 - ec) * -0.3;
    rig.position.y = (reduce ? 0 : Math.sin(now * 1.3) * 0.06) - (1 - rise) * dropY;

    flash = Math.max(0, flash - dt * 1.6);
    key.intensity = 2.0 + flash * 4;
    bloom.strength = 0.16 + flash * 0.5;
    glint.position.set(0.45 + Math.sin(now * 0.7) * 5.5, 2.6 + Math.cos(now * 0.45) * 0.6, 4.2);

    sparkLift += dt * (1 + (1 - ec) * 9 + flash * 3);
    for (let i = 0; i < SPARKS; i++) {
      const b = sBase[i];
      const y = (b.y + sparkLift * b.v) % 12;
      sPos[i * 3] = b.x + Math.sin(now * 0.6 + b.w) * 0.35;
      sPos[i * 3 + 1] = y;
      sPos[i * 3 + 2] = b.z;
      const life = Math.sin(Math.PI * y / 12);
      const tw = (0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(now * b.sp + b.ph), 4)) * life * (0.45 + 0.55 * ec) + flash * 0.6 * life;
      sCol[i * 3] = tw; sCol[i * 3 + 1] = tw * 0.8; sCol[i * 3 + 2] = tw * 0.42;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;

    let still = true;
    for (let i = 0; i < reels.length; i++) {
      const r = reels[i];
      let shown = r.angle;
      if (r.spinning) {
        still = false;
        const p = clamp01((now - r.t0) / r.dur);
        r.angle = r.from + (r.to - r.from) * easeOutBack(p, 1.25);
        shown = r.angle;
        if (p >= 1) {
          r.spinning = false;
          r.angle = r.to % TAU;
          shown = r.angle;
          sfx.stop(i);
          flash = Math.max(flash, 0.35);
          if (opts.onReelStop) opts.onReelStop(i);
        }
      } else if (intro) {
        shown = r.introFrom + (r.angle - r.introFrom) * easeOutCubic(clamp01((now - intro.t0) / (INTRO * 0.95)));
      }
      const speed = Math.abs(shown - r.shown) / Math.max(dt, 1e-3);
      const target = Math.min(0.045, speed / TAU / 55);
      r.blur.value += (target - r.blur.value) * (target > r.blur.value ? 0.6 : 0.35);
      if (r.blur.value < 0.0004) r.blur.value = 0;
      r.shown = shown;
      r.mesh.rotation.x = shown;
    }
    if (busy && still && resolveSpin && now > spinEnd) {
      const done = resolveSpin; resolveSpin = null;
      flash = 1;
      sfx.jackpot();
      done();
    }
    composer.render(dt);
  }

  function schedulePrepare() {
    prepared = false;
    const run = () => { if (!busy && !prepared) prepareNext(); };
    setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 600 }) : run()), 1500);
  }

  const api = {
    pull() {
      if (intro) { queued = true; return null; }
      if (busy || !items.length) return null;
      if (!prepared) prepareNext();
      busy = true;
      if (opts.onStart) opts.onStart();
      sfx.pull();
      const winner = nextWinner;
      leverT0 = now;
      const delay = pivot ? PULL_T : 0;
      const t0 = now + delay;
      reels.forEach((r, i) => spinTo(r, i, t0));
      spinEnd = t0 + 0.5;
      return new Promise(res => {
        resolveSpin = () => {
          busy = false;
          res(items[winner]);
          if (opts.onResult) opts.onResult(items[winner]);
          schedulePrepare();
        };
      });
    },
    setActive(on, withIntro = true) {
      cancelAnimationFrame(raf);
      last = 0;
      if (on) {
        resize();
        if (withIntro && !busy) startIntro();
        raf = requestAnimationFrame(tick);
      }
    },
    setMuted(m) { sfx.setMuted(m); },
    play(n, o) { sfx.play(n, o); },
    get busy() { return busy; }
  };

  renderer.compile(scene, camera);
  composer.render(0);
  api.setActive(true);
  return api;
}
