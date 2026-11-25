// Grid navigation shared by the creature and companions (A* + line-of-sight smoothing).
import { blocksActor } from './util.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n, p) { const a = this.a; a.push([n, p]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][1] <= a[i][1]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][1] < a[m][1]) m = l; if (r < a.length && a[r][1] < a[m][1]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top[0]; }
}

export class Nav {
  constructor(b, cell = 0.5, radius = 0.42) {
    this.b = b; this.c = cell; this.r = radius;
    this.w = Math.ceil((b.x1 - b.x0) / cell); this.h = Math.ceil((b.z1 - b.z0) / cell);
    this.block = new Uint8Array(this.w * this.h);   // >0 = solid for everyone
    this.safe = new Uint8Array(this.w * this.h);    // >0 = off-limits for the creature (the train)
    this.dyn = new Map();                            // id -> box currently rasterised (doors)
  }
  ix(x) { return Math.floor((x - this.b.x0) / this.c); }
  iz(z) { return Math.floor((z - this.b.z0) / this.c); }
  cx(i) { return this.b.x0 + (i + 0.5) * this.c; }
  cz(i) { return this.b.z0 + (i + 0.5) * this.c; }
  inb(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  _raster(arr, box, d, inflate) {
    // rasterise by cell centre so a 1.7 m doorway stays passable after inflating for the actor radius
    const c = this.c, ix0 = this.b.x0, iz0 = this.b.z0;
    const i0 = Math.max(0, Math.ceil((box.x0 - inflate - ix0) / c - 0.5)), i1 = Math.min(this.w - 1, Math.floor((box.x1 + inflate - ix0) / c - 0.5));
    const j0 = Math.max(0, Math.ceil((box.z0 - inflate - iz0) / c - 0.5)), j1 = Math.min(this.h - 1, Math.floor((box.z1 + inflate - iz0) / c - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) arr[j * this.w + i] = Math.max(0, arr[j * this.w + i] + d);
  }
  addStatic(box) { if (blocksActor(box)) this._raster(this.block, box, 1, this.r); }
  addSafe(box) { this._raster(this.safe, box, 1, 0); }
  setDoor(id, box, closed) {
    const was = this.dyn.get(id);
    if (was && closed) return;
    if (!was && !closed) return;
    if (closed) { this._raster(this.block, box, 1, this.r); this.dyn.set(id, box); }
    else { this._raster(this.block, was, -1, this.r); this.dyn.delete(id); }
  }
  blockedAt(i, j, forCreature) { if (!this.inb(i, j)) return true; const k = j * this.w + i; return this.block[k] > 0 || (forCreature && this.safe[k] > 0); }
  nearestFree(x, z, forCreature = false) {
    let i = this.ix(x), j = this.iz(z);
    if (!this.blockedAt(i, j, forCreature)) return { x, z };
    for (let r = 1; r < 14; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (!this.blockedAt(i + di, j + dj, forCreature)) return { x: this.cx(i + di), z: this.cz(j + dj) };
    }
    return null;
  }
  los(ax, az, bx, bz, forCreature = false) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (this.c * 0.5)));
    for (let k = 0; k <= n; k++) { const t = k / n; if (this.blockedAt(this.ix(ax + (bx - ax) * t), this.iz(az + (bz - az) * t), forCreature)) return false; }
    return true;
  }
  // avoid: optional (x,z)=>extra cost (>=0) used by the creature to prefer shadows
  findPath(ax, az, bx, bz, { forCreature = false, avoid = null, maxNodes = 9000 } = {}) {
    const s = this.nearestFree(ax, az, forCreature), g = this.nearestFree(bx, bz, forCreature);
    if (!s || !g) return null;
    const si = this.ix(s.x), sj = this.iz(s.z), gi = this.ix(g.x), gj = this.iz(g.z);
    if (si === gi && sj === gj) return [{ x: g.x, z: g.z }];
    const W = this.w, N = W * this.h, gs = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = new Heap(), idx = (i, j) => j * W + i, start = idx(si, sj), goal = idx(gi, gj);
    gs[start] = 0; open.push(start, 0);
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let expanded = 0;
    while (open.size && expanded++ < maxNodes) {
      const cur = open.pop(); if (closed[cur]) continue; closed[cur] = 1;
      if (cur === goal) break;
      const ci = cur % W, cj = (cur / W) | 0;
      for (const [di, dj, c] of D) {
        const ni = ci + di, nj = cj + dj; if (this.blockedAt(ni, nj, forCreature)) continue;
        if (di && dj && (this.blockedAt(ci + di, cj, forCreature) || this.blockedAt(ci, cj + dj, forCreature))) continue;
        const n = idx(ni, nj); if (closed[n]) continue;
        const extra = avoid ? avoid(this.cx(ni), this.cz(nj)) : 0, ng = gs[cur] + c + extra;
        if (ng < gs[n]) { gs[n] = ng; from[n] = cur; open.push(n, ng + Math.hypot(gi - ni, gj - nj)); }
      }
    }
    if (from[goal] < 0) return null;
    const raw = []; for (let n = goal; n !== -1; n = from[n]) raw.push({ x: this.cx(n % W), z: this.cz((n / W) | 0) });
    raw.reverse();
    // string-pull
    const out = []; let a = 0;
    while (a < raw.length - 1) {
      let b = raw.length - 1;
      while (b > a + 1 && !this.los(raw[a].x, raw[a].z, raw[b].x, raw[b].z, forCreature)) b--;
      out.push(raw[b]); a = b;
    }
    return out;
  }
}
