import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

export async function mount(stage, items, opts = {}) {
  const canvas = stage.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc084fc, 1.6);
  rim.position.set(5, 3, -6);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const target = new THREE.Vector3(0.45, 0.35, 0);

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(opts.model || './slot.glb');

  const rig = new THREE.Group();
  scene.add(rig);
  const machine = gltf.scene;
  rig.add(machine);

  const reels = [];
  const reelGeo = new THREE.CylinderGeometry(1, 1, 1.45, 160, 1, true);
  reelGeo.rotateZ(Math.PI / 2);
  for (let i = 1; i <= 3; i++) {
    const ph = machine.getObjectByName('Reel' + i);
    const x = ph ? ph.position.x : (i - 2) * 1.69;
    if (ph) ph.visible = false;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0, envMapIntensity: 0.55 });
    const mesh = new THREE.Mesh(reelGeo, mat);
    mesh.position.set(x, ph ? ph.position.y : 0, ph ? ph.position.z : 0);
    rig.add(mesh);
    reels.push({ mesh, mat, list: [], sharp: null, blur: null, angle: 0, from: 0, to: 0, t0: 0, dur: 0, spinning: false, last: 0 });
  }

  machine.traverse(o => {
    if (o.isMesh && o.material && /gold/i.test(o.material.name)) {
      o.material.envMapIntensity = 1.35;
    }
  });

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

  let w = 0, h = 0;
  function resize() {
    const rect = stage.getBoundingClientRect();
    w = Math.max(1, rect.width); h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needW = 9.9 / (2 * half * camera.aspect);
    const needH = 4.9 / (2 * half);
    const dist = Math.max(needW, needH);
    camera.position.set(target.x + 0.2, target.y + dist * 0.16, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  let px = 0, py = 0, tx = 0, ty = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function toNdc(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
  function overLever(e) {
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(leverParts, false).length > 0;
  }
  function overMachine(e) {
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(rig, true).length > 0;
  }
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    canvas.style.cursor = !busy && (overLever(e) || overMachine(e)) ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
  canvas.addEventListener('pointerdown', e => { if (overMachine(e)) api.pull(); });

  let busy = false, raf = 0;
  const clock = new THREE.Clock();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const easeSpin = t => {
    const s = 1.25;
    const p = t - 1;
    return 1 + (s + 1) * p * p * p + s * p * p;
  };

  function spinTo(r, winnerSlot, i, now) {
    const base = faceAngle(winnerSlot);
    const turns = (reduce ? 1 : 3) + i * (reduce ? 0.5 : 1.25);
    let to = base;
    while (to < r.angle + turns * TAU) to += TAU;
    r.from = r.angle; r.to = to; r.t0 = now + i * 0.06; r.dur = (reduce ? 0.9 : 1.75) + i * (reduce ? 0.25 : 0.55);
    r.spinning = true;
  }

  let resolveSpin = null;
  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;
    mixer.update(dt);
    px += (tx - px) * Math.min(1, dt * 3);
    py += (ty - py) * Math.min(1, dt * 3);
    rig.rotation.y = -0.22 + px * 0.2;
    rig.rotation.x = 0.05 + py * 0.08;
    rig.position.y = reduce ? 0 : Math.sin(now * 1.3) * 0.06;
    let still = true;
    reels.forEach(r => {
      if (!r.spinning) return;
      still = false;
      const t = Math.min(1, Math.max(0, (now - r.t0) / r.dur));
      const prev = r.angle;
      r.angle = r.from + (r.to - r.from) * easeSpin(t);
      const speed = Math.abs(r.angle - prev) / Math.max(dt, 1e-3);
      const want = speed > 9 ? r.blur : r.sharp;
      if (r.mat.map !== want) { r.mat.map = want; r.mat.needsUpdate = true; }
      r.mesh.rotation.x = r.angle;
      if (t >= 1) {
        r.spinning = false;
        r.angle = r.to % TAU;
        r.mesh.rotation.x = r.angle;
        if (r.mat.map !== r.sharp) { r.mat.map = r.sharp; r.mat.needsUpdate = true; }
        if (opts.onReelStop) opts.onReelStop(reels.indexOf(r));
      }
    });
    if (busy && still && resolveSpin && now > spinEnd) { const f = resolveSpin; resolveSpin = null; f(); }
    renderer.render(scene, camera);
  }
  let spinEnd = 0;

  const api = {
    pull() {
      if (busy || !items.length) return null;
      busy = true;
      if (opts.onStart) opts.onStart();
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
    setActive(on) {
      cancelAnimationFrame(raf);
      if (on) { clock.getDelta(); resize(); tick(); }
    },
    get busy() { return busy; }
  };
  api.setActive(true);
  return api;
}
