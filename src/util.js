// Small shared helpers: math, geometry tests, event emitter.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const dampAngle = (a, b, l, dt) => a + angDiff(a, b) * (1 - Math.exp(-l * dt));
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const smooth = (t) => t * t * (3 - 2 * t);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); }
  emit(ev, ...a) { (this._h[ev] || []).slice().forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
}

// Collider boxes: { x0,x1,z0,z1,y0,y1, active, id }
export const blocksActor = (b) => b.active !== false && b.y0 < 1.7 && b.y1 > 0.25;

// 2D segment vs box (XZ). Returns t in [0,1] or null.
export function segHitsBoxXZ(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q, lo, hi] of [[dx, ax, b.x0, b.x1], [dz, az, b.z0, b.z1]]) {
    if (Math.abs(p) < 1e-9) { if (q < lo || q > hi) return null; }
    else {
      let u0 = (lo - q) / p, u1 = (hi - q) / p;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

// 3D segment vs box. Returns t or null.
export function seg3HitsBox(ax, ay, az, bx, by, bz, b) {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az], lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; }
    else {
      let u0 = (lo[i] - o[i]) / d[i], u1 = (hi[i] - o[i]) / d[i];
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

// Push a circle out of a box (XZ). Returns {x,z} correction or null.
export function circleVsBox(px, pz, r, b) {
  const cx = Math.max(b.x0, Math.min(px, b.x1)), cz = Math.max(b.z0, Math.min(pz, b.z1));
  let dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; return { x: dx * k, z: dz * k }; }
  // centre inside box: push out via the nearest face
  const l = px - b.x0, rr = b.x1 - px, t = pz - b.z0, bt = b.z1 - pz, m = Math.min(l, rr, t, bt);
  if (m === l) return { x: -(l + r), z: 0 };
  if (m === rr) return { x: rr + r, z: 0 };
  if (m === t) return { x: 0, z: -(t + r) };
  return { x: 0, z: bt + r };
}

// Does anything solid (height >= minH) block the line between two ground points?
export function lineBlocked(colliders, ax, az, bx, bz, minTop = 1.2) {
  for (const c of colliders) {
    if (c.active === false || c.y1 < minTop || c.y0 > 1.6) continue;
    if (segHitsBoxXZ(ax, az, bx, bz, c) !== null) return true;
  }
  return false;
}

// Push a circle out of every blocking collider (a few passes handle corners). Returns the corrected {x,z}.
export function resolveMove(colliders, x, z, r, ignore = null) {
  for (let pass = 0; pass < 3; pass++) {
    let hit = false;
    for (const b of colliders) {
      if (!blocksActor(b) || (ignore && ignore(b))) continue;
      const p = circleVsBox(x, z, r, b); if (p) { x += p.x; z += p.z; hit = true; }
    }
    if (!hit) break;
  }
  return { x, z };
}
