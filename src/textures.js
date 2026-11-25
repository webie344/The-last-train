// Procedural PBR-ish textures (colour + normal from height) so the game needs no image files.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function noiseFill(ctx, w, h, amt, rnd) {
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(id, 0, 0);
}
function blotches(ctx, w, h, n, r0, r1, rgb, a0, a1, rnd) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, r = r0 + rnd() * (r1 - r0), a = a0 + rnd() * (a1 - a0);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function streaks(ctx, w, h, n, rgb, a, rnd, len = 0.5) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h * 0.6, l = h * (0.1 + rnd() * len);
    const g = ctx.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.3, `rgba(${rgb},${a * (0.4 + rnd() * 0.6)})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x, y, 1 + rnd() * 3, l);
  }
}
function cracks(ctx, w, h, n, rnd) {
  ctx.strokeStyle = 'rgba(12,12,12,0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = rnd() * w, y = rnd() * h; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += (rnd() - 0.5) * 26; y += rnd() * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}
// Height (luma of canvas) -> tangent-space normal map
function toNormal(src, strength = 2.2) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = mk(w, h), octx = out.getContext('2d'), o = octx.createImageData(w, h), od = o.data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (s[i * 4] * 0.3 + s[i * 4 + 1] * 0.59 + s[i * 4 + 2] * 0.11) / 255;
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    od[i] = (-dx * inv * 0.5 + 0.5) * 255; od[i + 1] = (dy * inv * 0.5 + 0.5) * 255; od[i + 2] = (inv * 0.5 + 0.5) * 255; od[i + 3] = 255;
  }
  octx.putImageData(o, 0, 0); return out;
}
const T = (canvas, aniso, srgb = true) => {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

function makeSet(aniso, painter, { rough = 0.85, metal = 0.0, nStrength = 2.2, size = 512, extra = {} } = {}) {
  const c = mk(size, size), ctx = c.getContext('2d');
  painter(ctx, size, size);
  const nm = toNormal(c, nStrength);
  return new THREE.MeshStandardMaterial({ map: T(c, aniso), normalMap: T(nm, aniso, false), roughness: rough, metalness: metal, ...extra });
}

export function makeMaterials(aniso = 4) {
  const r = mulberry32(1337);
  const M = {};

  M.concrete = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#6a6c6b'; ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, 46, r); blotches(ctx, w, h, 30, 40, 150, '30,30,30', 0.08, 0.22, r); blotches(ctx, w, h, 14, 30, 90, '150,150,145', 0.05, 0.12, r);
    streaks(ctx, w, h, 40, '15,15,12', 0.35, r); cracks(ctx, w, h, 5, r); noiseFill(ctx, w, h, 20, r);
  }, { rough: 0.92, nStrength: 3 });

  M.floor = makeSet(aniso, (ctx, w, h) => {
    const n = 4, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 118 + r() * 26; ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`; ctx.fillRect(x * s, y * s, s, s); }
    noiseFill(ctx, w, h, 34, r); blotches(ctx, w, h, 36, 30, 120, '25,22,18', 0.1, 0.3, r);
    ctx.strokeStyle = '#1a1a19'; ctx.lineWidth = 5;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke(); }
    for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(200,200,190,${0.05 + r() * 0.1})`; ctx.lineWidth = 1; const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60); ctx.stroke(); }
  }, { rough: 0.55, nStrength: 2.6 });

  M.wallTile = makeSet(aniso, (ctx, w, h) => {
    const tw = 64, th = 32;
    for (let y = 0; y < h / th; y++) for (let x = -1; x < w / tw + 1; x++) {
      const v = 168 + r() * 22, off = (y % 2) * (tw / 2); ctx.fillStyle = `rgb(${v},${v + 2},${v - 6})`; ctx.fillRect(x * tw + off, y * th, tw, th);
      ctx.strokeStyle = '#33342f'; ctx.lineWidth = 3; ctx.strokeRect(x * tw + off, y * th, tw, th);
    }
    ctx.fillStyle = 'rgba(32,86,82,0.9)'; ctx.fillRect(0, h * 0.42, w, th * 1.3);
    const g = ctx.createLinearGradient(0, h * 0.45, 0, h); g.addColorStop(0, 'rgba(20,16,10,0)'); g.addColorStop(1, 'rgba(20,16,10,0.65)'); ctx.fillStyle = g; ctx.fillRect(0, h * 0.45, w, h * 0.55);
    noiseFill(ctx, w, h, 30, r); streaks(ctx, w, h, 36, '30,22,12', 0.45, r, 0.7); blotches(ctx, w, h, 18, 20, 80, '20,18,12', 0.1, 0.3, r);
  }, { rough: 0.35, nStrength: 2.4 });

  M.metal = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#4d5256'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const y = r() * h, v = 60 + r() * 60; ctx.fillStyle = `rgba(${v},${v + 3},${v + 6},0.14)`; ctx.fillRect(0, y, w, 1 + r() * 1.5); }
    blotches(ctx, w, h, 22, 15, 70, '110,56,24', 0.2, 0.55, r); blotches(ctx, w, h, 12, 15, 60, '20,18,16', 0.2, 0.4, r); streaks(ctx, w, h, 30, '95,48,20', 0.5, r);
    ctx.fillStyle = 'rgba(15,15,15,0.5)'; for (let y = 24; y < h; y += 64) for (let x = 24; x < w; x += 64) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    noiseFill(ctx, w, h, 22, r);
  }, { rough: 0.48, metal: 0.75, nStrength: 1.6 });

  M.rust = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#5b3a24'; ctx.fillRect(0, 0, w, h); blotches(ctx, w, h, 60, 15, 80, '120,60,22', 0.2, 0.6, r); blotches(ctx, w, h, 40, 10, 50, '25,15,10', 0.2, 0.5, r); noiseFill(ctx, w, h, 50, r);
  }, { rough: 0.8, metal: 0.4, nStrength: 3.2 });

  M.trainPaint = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#3d4b55'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9d4b25'; ctx.fillRect(0, h * 0.60, w, h * 0.07); ctx.fillStyle = '#d6d2c4'; ctx.fillRect(0, h * 0.69, w, h * 0.02);
    noiseFill(ctx, w, h, 28, r); streaks(ctx, w, h, 80, '18,14,10', 0.5, r, 0.9); blotches(ctx, w, h, 22, 20, 80, '90,50,25', 0.1, 0.3, r);
    const g = ctx.createLinearGradient(0, h * 0.7, 0, h); g.addColorStop(0, 'rgba(10,8,6,0)'); g.addColorStop(1, 'rgba(10,8,6,0.7)'); ctx.fillStyle = g; ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }, { rough: 0.5, metal: 0.45, nStrength: 1.6 });

  M.trainInterior = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#7d7968'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#43553f'; ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.fillStyle = '#272620'; ctx.fillRect(0, h * 0.5 - 3, w, 6);
    noiseFill(ctx, w, h, 28, r); streaks(ctx, w, h, 40, '30,24,14', 0.4, r, 0.8); blotches(ctx, w, h, 16, 20, 80, '30,24,14', 0.1, 0.25, r);
  }, { rough: 0.7, nStrength: 1.8 });

  M.trainFloor = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#25272a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#35383b'; for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 8, h);
    noiseFill(ctx, w, h, 30, r); blotches(ctx, w, h, 22, 20, 90, '14,12,10', 0.2, 0.5, r);
  }, { rough: 0.6, nStrength: 3 });

  M.seat = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#6b2b28'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { ctx.fillStyle = `rgba(0,0,0,${0.08 + ((x + y) / 8 % 2) * 0.08})`; ctx.fillRect(x, y, 4, 4); }
    noiseFill(ctx, w, h, 36, r); blotches(ctx, w, h, 14, 20, 60, '10,8,6', 0.15, 0.35, r);
  }, { rough: 0.95, nStrength: 2 });

  M.ceiling = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#3c3d3e'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = 6;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
    noiseFill(ctx, w, h, 36, r); blotches(ctx, w, h, 34, 30, 110, '10,10,10', 0.15, 0.45, r); streaks(ctx, w, h, 30, '90,70,40', 0.25, r);
  }, { rough: 0.95, nStrength: 2.4 });

  M.wood = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#5a4128'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { const y = r() * h, v = 40 + r() * 40; ctx.fillStyle = `rgba(${v + 25},${v + 10},${v - 10},0.25)`; ctx.fillRect(0, y, w, 1 + r() * 2); }
    noiseFill(ctx, w, h, 30, r); blotches(ctx, w, h, 14, 20, 70, '20,12,8', 0.15, 0.4, r);
  }, { rough: 0.8, nStrength: 2.6 });

  M.gravel = makeSet(aniso, (ctx, w, h) => {
    ctx.fillStyle = '#2d2c2a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 40 + r() * 70; ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 2 + r() * 5, 1.5 + r() * 3.5, r() * 3, 0, 7); ctx.fill(); }
  }, { rough: 1, nStrength: 4 });

  // Plain materials
  const std = (color, rough = 0.8, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  M.black = std(0x0e0e10, 0.5, 0.2);
  M.rubber = std(0x151515, 0.95);
  M.steel = std(0x7a7f84, 0.4, 0.9);
  M.yellow = std(0xb99a1c, 0.7, 0.1);
  M.glass = new THREE.MeshStandardMaterial({ color: 0x1c2a32, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
  M.puddle = new THREE.MeshStandardMaterial({ color: 0x050709, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.7 });
  M.cloth = std(0x3a3d34, 0.95);
  M.paper = std(0xc9c4b1, 0.95, 0, { side: THREE.DoubleSide });
  M.screenOff = std(0x050606, 0.2, 0.3);
  M.warn = std(0xc08a12, 0.6);
  M.red = std(0x7b1414, 0.6);
  M.green = std(0x153d1a, 0.6);
  M.battery = std(0xbfae1c, 0.5, 0.4);
  M.emitWhite = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffeed0, emissiveIntensity: 0.0, roughness: 0.4 });

  M.all = Object.values(M).filter((m) => m && m.isMaterial);
  return M;
}

export function signTexture(text, { bg = '#14333a', fg = '#e8e6da', w = 512, h = 128, sub = '', border = true, size = 64 } = {}) {
  const c = mk(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.strokeRect(8, 8, w - 16, h - 16); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${size}px Rajdhani, Arial, sans-serif`;
  ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
  if (sub) { ctx.font = `500 ${Math.round(size * 0.4)}px Rajdhani, Arial, sans-serif`; ctx.fillText(sub, w / 2, h * 0.76); }
  const r = mulberry32(text.length * 77);
  noiseFill(ctx, w, h, 36, r); blotches(ctx, w, h, 10, 20, 70, '15,12,8', 0.15, 0.4, r); streaks(ctx, w, h, 14, '20,12,6', 0.4, r);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function posterTexture(title, lines, seed = 1) {
  const w = 256, h = 360, c = mk(w, h), ctx = c.getContext('2d'), r = mulberry32(seed);
  ctx.fillStyle = '#c9c2a8'; ctx.fillRect(0, 0, w, h); noiseFill(ctx, w, h, 30, r);
  ctx.fillStyle = '#1c1c1a'; ctx.textAlign = 'center'; ctx.font = '700 44px Rajdhani, Arial'; ctx.fillText(title, w / 2, 56);
  ctx.fillStyle = '#6b1a14'; ctx.fillRect(24, 76, w - 48, 120); ctx.fillStyle = '#2b2b28'; ctx.fillRect(34, 86, w - 68, 100);
  ctx.fillStyle = '#1c1c1a'; ctx.font = '500 20px Rajdhani, Arial'; lines.forEach((l, i) => ctx.fillText(l, w / 2, 232 + i * 28));
  blotches(ctx, w, h, 12, 20, 80, '30,22,10', 0.15, 0.4, r); streaks(ctx, w, h, 10, '40,30,12', 0.4, r);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = mk(128, 128), ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function coneTexture() {
  const c = mk(64, 256), ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); return t;
}
