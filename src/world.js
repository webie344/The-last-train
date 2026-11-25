// The Kessler Street station (platform hall, generator room, maintenance corridor, locker room, ticket hall,
// security office) and the train TR-09. Everything is procedural; every solid registers a collider.
import * as THREE from 'three';
import { makeMaterials, signTexture, posterTexture, glowTexture } from './textures.js';
import { mulberry32, clamp, damp } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const BOUNDS = { x0: -6, x1: 34, z0: -54, z1: 38 };
export const TRAIN = { x0: -5.4, x1: -2.0, z0: -18, z1: 18 };

function scaleBoxUV(geo, w, h, d, tw, th) {
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tw, uv.getY(k) * dims[f][1] / (th || tw)); }
  uv.needsUpdate = true;
}

export function buildWorld(G) {
  const rnd = mulberry32(2041);
  const M = makeMaterials(G.renderer.capabilities.getMaxAnisotropy ? Math.min(8, G.renderer.capabilities.getMaxAnisotropy()) : 4);
  const W = {
    group: new THREE.Group(), hall: new THREE.Group(), train: new THREE.Group(), colliders: [], lamps: [], doors: [], anchors: {}, hide: [], spawns: [],
    bounds: BOUNDS, trainBox: TRAIN, mats: M, rooms: [], powered: false, moving: false, flickerT: 0, interiorWindowFX: null,
  };
  W.group.add(W.hall, W.train);
  const shadowOn = G.settings.quality !== 'low';

  // ------------------------------------------------------------------ box helper
  function box({ x, z, w, d, y = 0, h, mat, tile = 2.4, tileV = null, collide = true, cast = true, recv = true, parent = W.hall, noMap = false, id = null, rotY = 0 }) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, tile, tileV || tile);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y + h / 2, z); mesh.rotation.y = rotY; mesh.castShadow = cast && shadowOn; mesh.receiveShadow = recv;
    parent.add(mesh);
    let c = null;
    if (collide) {
      if (rotY) { const ex = (Math.abs(Math.cos(rotY)) * w + Math.abs(Math.sin(rotY)) * d) / 2, ez = (Math.abs(Math.sin(rotY)) * w + Math.abs(Math.cos(rotY)) * d) / 2; c = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez, y0: y, y1: y + h, active: true, id, noMap }; }
      else c = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y, y1: y + h, active: true, id, noMap };
      W.colliders.push(c);
    }
    return { mesh, c };
  }
  const cyl = ({ x, z, r, h, y = 0, mat, seg = 14, collide = false, parent = W.hall, rx = 0, rz = 0, cast = true }) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.set(x, y + h / 2, z); m.rotation.x = rx; m.rotation.z = rz; m.castShadow = cast && shadowOn; m.receiveShadow = true; parent.add(m);
    if (collide) W.colliders.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y, y1: y + h, active: true });
    return m;
  };
  const plane = (w, h, mat, x, y, z, ry = 0, rx = 0, parent = W.hall) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); parent.add(m); return m; };

  // Wall running along Z (axis 'z', plane x=fixed) or along X (axis 'x', plane z=fixed), with door openings and tiled lower / concrete upper.
  function wall(axis, fixed, a0, a1, h, thick, openings = [], { low = M.wallTile, high = M.concrete, lowH = 2.5, parent = W.hall, lintelMat = M.concrete, collide = true, noMap = false } = {}) {
    const segs = []; let cur = a0;
    const ops = [...openings].sort((p, q) => p.c - q.c);
    for (const o of ops) { segs.push([cur, o.c - o.w / 2]); cur = o.c + o.w / 2; }
    segs.push([cur, a1]);
    const mk = (s0, s1, y, hh, mat, col, tile) => {
      if (s1 - s0 < 0.02 || hh < 0.02) return;
      const mid = (s0 + s1) / 2, len = s1 - s0;
      if (axis === 'z') box({ x: fixed, z: mid, w: thick, d: len, y, h: hh, mat, tile, collide: col, parent, noMap });
      else box({ x: mid, z: fixed, w: len, d: thick, y, h: hh, mat, tile, collide: col, parent, noMap });
    };
    for (const [s0, s1] of segs) {
      if (h > lowH) { mk(s0, s1, 0, lowH, low, collide, 2.4); mk(s0, s1, lowH, h - lowH, high, false, 3); if (collide) { const mid = (s0 + s1) / 2, len = s1 - s0; if (len > 0.02) W.colliders.push(axis === 'z' ? { x0: fixed - thick / 2, x1: fixed + thick / 2, z0: s0, z1: s1, y0: lowH, y1: h, active: true, noMap: true } : { x0: s0, x1: s1, z0: fixed - thick / 2, z1: fixed + thick / 2, y0: lowH, y1: h, active: true, noMap: true }); void mid; } }
      else mk(s0, s1, 0, h, low, collide, 2.4);
    }
    for (const o of ops) mk(o.c - o.w / 2, o.c + o.w / 2, o.h, h - o.h, lintelMat, collide && o.h < 2.9 ? false : false, 3);
  }

  // ------------------------------------------------------------------ lamps (emissive tubes; a small pool of real lights follows the player)
  function lamp({ x, y, z, kind = 'white', len = 1.4, dir = 'z', parent = W.hall, zone = 'hall', on = false, size = 1 }) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: kind === 'red' ? 0xff2a1c : kind === 'warm' ? 0xffc98a : 0xdfeaff, emissiveIntensity: 0, roughness: 0.4 });
    const housing = new THREE.Mesh(new THREE.BoxGeometry(dir === 'z' ? 0.22 : len + 0.1, 0.08, dir === 'z' ? len + 0.1 : 0.22), M.black); housing.position.set(x, y + 0.04, z); parent.add(housing);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(dir === 'z' ? 0.1 : len, 0.05, dir === 'z' ? len : 0.1), mat); tube.position.set(x, y - 0.02, z); parent.add(tube);
    const L = { pos: V(x, y - 0.3, z), kind, mat, on, level: 0, broken: false, flicker: 0, base: kind === 'red' ? 2.2 : kind === 'warm' ? 3.2 : 4.2, zone, phase: rnd() * 10, size };
    W.lamps.push(L); return L;
  }
  W.setLamp = (L, on) => { L.on = on; };

  // ------------------------------------------------------------------ doors
  function door({ id, axis, x, z, w, h = 2.4, thick = 0.14, mat = M.metal, type = 'manual', locked = false, slide = 1, y = 0 }) {
    const geo = new THREE.BoxGeometry(axis === 'z' ? thick : w, h, axis === 'z' ? w : thick); scaleBoxUV(geo, axis === 'z' ? thick : w, h, axis === 'z' ? w : thick, 2, 2);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y + h / 2, z); mesh.castShadow = shadowOn; mesh.receiveShadow = true; W.hall.add(mesh);
    const c = { x0: x - (axis === 'z' ? thick / 2 : w / 2), x1: x + (axis === 'z' ? thick / 2 : w / 2), z0: z - (axis === 'z' ? w / 2 : thick / 2), z1: z + (axis === 'z' ? w / 2 : thick / 2), y0: y, y1: y + h, active: true, id, noMap: false };
    W.colliders.push(c);
    const D = { id, axis, mesh, c, w, h, type, locked, open: 0, target: 0, x, z, y, slide, home: V(x, y + h / 2, z), parent: W.hall, sfx: true };
    W.doors.push(D); return D;
  }

  // ================================================================== HALL SHELL
  const HX0 = -10.5, HX1 = 10, HZ0 = -52, HZ1 = 36, CEIL = 6.3;
  // platform slab (concrete sides, tile top) and pit
  box({ x: 4, z: (HZ0 + HZ1) / 2, w: 12, d: HZ1 - HZ0, y: -1.2, h: 1.2, mat: [M.concrete, M.concrete, M.floor, M.concrete, M.concrete, M.concrete], tile: 2, collide: false, noMap: true });
  box({ x: (HX0 - 2) / 2, z: (HZ0 + HZ1) / 2, w: -2 - HX0, d: HZ1 - HZ0, y: -1.5, h: 0.4, mat: M.gravel, tile: 3, collide: false });
  // blockers: you cannot step into the pit (train walls handle the middle section)
  W.colliders.push({ x0: HX0, x1: -2, z0: HZ0, z1: TRAIN.z0, y0: -2, y1: 1.2, active: true }, { x0: HX0, x1: -2, z0: TRAIN.z1, z1: HZ1, y0: -2, y1: 1.2, active: true });
  // yellow safety edge
  box({ x: -1.75, z: (HZ0 + HZ1) / 2, w: 0.5, d: HZ1 - HZ0, y: 0, h: 0.012, mat: M.yellow, collide: false, tile: 1, recv: true });
  // rails + sleepers
  const sleepGeo = new THREE.BoxGeometry(2.3, 0.14, 0.3);
  for (const tx of [-3.7, -7.9]) {
    for (const o of [-0.72, 0.72]) box({ x: tx + o, z: (HZ0 + HZ1) / 2, w: 0.08, d: HZ1 - HZ0, y: -1.36, h: 0.17, mat: M.steel, collide: false, tile: 1, cast: false });
    const inst = new THREE.InstancedMesh(sleepGeo, M.wood, 120), m4 = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) { m4.makeTranslation(tx, -1.42, HZ0 + 0.5 + i * 0.73); inst.setMatrixAt(i, m4); } inst.receiveShadow = true; W.hall.add(inst);
  }
  // outer walls + ceiling
  wall('z', HX0, HZ0, HZ1, CEIL, 0.5);
  wall('z', HX1, HZ0, HZ1, CEIL, 0.5, [{ c: 15, w: 2.2, h: 2.5 }, { c: -14, w: 2.2, h: 2.5 }, { c: -45, w: 2.2, h: 2.5 }]);
  wall('x', HZ1, HX0, HX1, CEIL, 0.5, [{ c: -3.7, w: 4.4, h: 4.8 }, { c: -7.9, w: 4.4, h: 4.8 }]);   // south, tunnel mouths
  wall('x', HZ0, HX0, HX1, CEIL, 0.5);                                                                // north (collapsed)
  box({ x: (HX0 + HX1) / 2, z: (HZ0 + HZ1) / 2, w: HX1 - HX0 + 0.5, d: HZ1 - HZ0 + 0.5, y: CEIL, h: 0.4, mat: M.ceiling, tile: 3, collide: false });
  for (let z = HZ0 + 3; z < HZ1; z += 6) box({ x: (HX0 + HX1) / 2, z, w: HX1 - HX0, d: 0.5, y: CEIL - 0.7, h: 0.7, mat: M.concrete, tile: 2, collide: false });
  // black tunnel voids at the south end and a collapsed pile at the north
  box({ x: -3.7, z: HZ1 + 10, w: 4.4, d: 20, y: -1.4, h: 6.2, mat: M.black, collide: false, cast: false, recv: false });
  box({ x: -7.9, z: HZ1 + 10, w: 4.4, d: 20, y: -1.4, h: 6.2, mat: M.black, collide: false, cast: false, recv: false });
  // main pillars + hanging signs
  const pillarZ = []; for (let z = -44; z <= 32; z += 8) pillarZ.push(z);
  for (const z of pillarZ) {
    box({ x: 3.5, z, w: 0.9, d: 0.9, y: 0, h: 2.5, mat: M.wallTile, tile: 2.4 });
    box({ x: 3.5, z, w: 0.9, d: 0.9, y: 2.5, h: CEIL - 2.5, mat: M.concrete, tile: 3, collide: false });
    W.hide.push(V(3.5 + 1.0, 0, z + 0.2), V(3.5 - 1.0, 0, z - 0.2));
  }
  // lamps: hall tubes (dead until the generator runs, a few flicker), red emergency strips
  for (let z = -46; z <= 34; z += 8) { lamp({ x: 1.5, y: 5.2, z: z + 4, kind: 'white', len: 1.5 }); lamp({ x: 7, y: 5.2, z: z + 4, kind: 'white', len: 1.5 }); }
  for (let z = -40; z <= 32; z += 12) lamp({ x: 9.6, y: 3.2, z, kind: 'red', len: 0.5, dir: 'x' });
  // signs
  const signMat = (t, o) => new THREE.MeshStandardMaterial({ map: signTexture(t, o), roughness: 0.5, emissive: 0x111111 });
  for (const z of [-36, -12, 12, 30]) { plane(3.2, 0.8, signMat('KESSLER ST', { sub: 'PLATFORM 2' }), 3.5, 4.4, z, Math.PI / 2 * 0, 0); plane(3.2, 0.8, signMat('KESSLER ST', { sub: 'PLATFORM 2' }), 3.5, 4.4, z + 0.01, Math.PI, 0); }
  plane(2.4, 0.6, signMat('EXIT', { bg: '#1c4a2a', size: 56 }), 9.7, 2.9, -46 + 4.5, -Math.PI / 2);
  plane(2.6, 0.6, signMat('GENERATOR', { bg: '#4a3a12', size: 52 }), 9.72, 3.0, 15, -Math.PI / 2);
  plane(2.6, 0.6, signMat('MAINTENANCE', { bg: '#3a2412', size: 48 }), 9.72, 3.0, -14, -Math.PI / 2);
  plane(2.6, 0.6, signMat('SECURITY', { bg: '#12304a', size: 52 }), 9.72, 3.0, -45, -Math.PI / 2);
  plane(2.2, 0.5, signMat('NO ENTRY', { bg: '#4a1212', size: 50 }), -10.23, 3.2, 10, Math.PI / 2);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshStandardMaterial({ map: signTexture('3:12', { bg: '#cfcabb', fg: '#201c14', w: 128, h: 128, size: 40, border: true }), roughness: 0.5 })); clock.position.set(9.72, 3.9, 6); clock.rotation.y = -Math.PI / 2; W.hall.add(clock);
  // posters
  const posters = [['MISSING', ['Last seen near', 'Line 4 tunnel', 'Call 0-77-31']], ['STAY CALM', ['Follow staff', 'to shelter B', 'Do not run']], ['PROJECT', ['EXODUS', 'Board TR-09', 'Platform 2']], ['SILENCE', ['Do not', 'make noise', 'underground']]];
  posters.forEach((p, i) => plane(1.0, 1.4, new THREE.MeshStandardMaterial({ map: posterTexture(p[0], p[1], i + 5), roughness: 0.9 }), 9.72, 1.6, 22 - i * 4.5, -Math.PI / 2));
  // puddles
  for (const [x, z, s] of [[5, 6, 2.2], [7.5, -8, 1.8], [1, -20, 2.6], [6, 28, 2], [4, -33, 1.6], [-0.6, 24, 1.2]]) { const p = new THREE.Mesh(new THREE.CircleGeometry(s, 20), M.puddle); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.012, z); W.hall.add(p); }

  // ---------------------------------------------------------------- platform dressing
  const bench = (x, z, ry = 0, over = false) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; W.hall.add(g);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.5), M.wood), back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), M.wood);
    seat.position.y = 0.46; back.position.set(0, 0.78, -0.22); [-0.8, 0.8].forEach((lx) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.46), M.steel); leg.position.set(lx, 0.23, 0); g.add(leg); });
    g.add(seat, back); g.traverse((o) => { if (o.isMesh) { o.castShadow = shadowOn; o.receiveShadow = true; } });
    if (over) { g.rotation.z = Math.PI / 2.4; g.position.y = 0.3; }
    const e = ry ? { x: 0.3, z: 0.9 } : { x: 0.9, z: 0.3 }; W.colliders.push({ x0: x - e.x, x1: x + e.x, z0: z - e.z, z1: z + e.z, y0: 0, y1: 0.9, active: true });
  };
  [-38, -24, -8, 6, 20, 30].forEach((z) => bench(8.6, z, Math.PI / 2));
  bench(5.2, -17, 0.4, true);
  const bin = (x, z) => { cyl({ x, z, r: 0.28, h: 0.8, mat: M.metal, collide: true }); };
  [[9.4, -30], [9.4, 0], [9.4, 26], [-1, -26]].forEach(([x, z]) => bin(x, z));
  const vend = (x, z) => {
    box({ x, z, w: 0.9, d: 0.8, h: 1.9, mat: M.red, tile: 1 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x4fa3b8, emissiveIntensity: 0.0, roughness: 0.3 })); scr.position.set(x - 0.41, 1.0, z); scr.rotation.y = -Math.PI / 2; W.hall.add(scr); W.vendScreens = (W.vendScreens || []).concat(scr);
  };
  vend(9.4, -20); vend(9.4, 12);
  // crates, barrels, luggage, rubble
  const crate = (x, z, s = 0.8, ry = 0, stack = 1) => { for (let i = 0; i < stack; i++) box({ x: x + (i ? 0.05 : 0), z, w: s, d: s, y: i * s, h: s, mat: M.wood, tile: s, rotY: ry + i * 0.2 }); };
  crate(8.8, -40, 0.9, 0.2, 2); crate(8.2, -41.4, 0.7, 0.5); crate(8.6, 33, 0.9, 0.1, 2); crate(1.2, 34, 0.8, 0.3); crate(7.8, -2.5, 0.7, 0.3);
  const barrel = (x, z) => cyl({ x, z, r: 0.3, h: 0.9, mat: M.rust, collide: true, seg: 12 });
  [[8.9, -36], [8.3, -35.2], [9.2, 31], [0.5, -27.5]].forEach(([x, z]) => barrel(x, z));
  const bag = (x, z, ry) => { box({ x, z, w: 0.7, d: 0.35, h: 0.5, mat: M.cloth, tile: 0.7, rotY: ry }); box({ x, z, w: 0.4, d: 0.3, y: 0.5, h: 0.25, mat: M.black, tile: 0.5, collide: false, rotY: ry }); };
  bag(7.4, 1.5, 0.6); bag(6.2, 26, 1.1); bag(2.2, -3.8, 0.2); bag(-0.3, 9.4, 1.4);
  // collapsed ceiling slab and rubble pile at the north end
  box({ x: 5.4, z: -26.5, w: 3.4, d: 2.2, y: 0, h: 0.9, mat: M.concrete, tile: 1.5, rotY: 0.25 });
  for (let i = 0; i < 26; i++) { const s = 0.3 + rnd() * 0.9; box({ x: -1 + rnd() * 10, z: -51.4 + rnd() * 3.2, w: s, d: s * (0.6 + rnd() * 0.8), y: 0, h: s * (0.5 + rnd() * 0.9), mat: rnd() > 0.5 ? M.concrete : M.rust, tile: 1.2, rotY: rnd() * 3, collide: s > 0.7 }); }
  box({ x: 4, z: -50.8, w: 12, d: 2, y: 0, h: 1.3, mat: M.concrete, tile: 1.4, collide: true });
  // hanging pipes + cables
  for (const x of [-6.4, 6.4]) cyl({ x, z: (HZ0 + HZ1) / 2, r: 0.17, h: HZ1 - HZ0, y: 5.4, mat: M.rust, rx: Math.PI / 2, seg: 10, cast: false });
  cyl({ x: 0, z: (HZ0 + HZ1) / 2, r: 0.06, h: HZ1 - HZ0, y: 5.8, mat: M.black, rx: Math.PI / 2, seg: 6, cast: false });
  // fallen pipe across the platform (low obstacle)
  cyl({ x: 5.5, z: 8.5, r: 0.13, h: 5.5, y: 0.14, mat: M.rust, rz: Math.PI / 2, seg: 10 }); W.colliders.push({ x0: 2.8, x1: 8.2, z0: 8.3, z1: 8.7, y0: 0, y1: 0.4, active: true, low: true });
  // kiosk (fuel cell 1)
  box({ x: 6.8, z: 24, w: 3.2, d: 2.4, h: 2.7, mat: M.trainPaint, tile: 3 }); box({ x: 6.8, z: 24, w: 3.8, d: 3, y: 2.7, h: 0.2, mat: M.metal, tile: 1.5, collide: false });
  box({ x: 6.8, z: 22.7, w: 2.6, d: 0.2, y: 0.9, h: 0.08, mat: M.wood, collide: false, tile: 1 });
  plane(2.2, 0.5, signMat('NEWS & COFFEE', { bg: '#3a2a12', size: 40 }), 6.8, 2.2, 22.79, Math.PI);
  W.hide.push(V(8.9, 0, 25.6), V(4.6, 0, 22.6));
  // ticket hall: turnstiles + booth (fuel cell 3)
  [0, 2.2, 4.4].forEach((x) => { box({ x, z: -38.5, w: 0.3, d: 1.3, h: 1.0, mat: M.steel, tile: 1 }); });
  box({ x: 2.2, z: -38.5, w: 0.04, d: 1.0, y: 0.5, h: 0.5, mat: M.glass, collide: false });
  box({ x: 6.4, z: -44.5, w: 2.4, d: 1.4, h: 2.4, mat: M.wood, tile: 1.5 }); box({ x: 6.4, z: -43.45, w: 1.8, d: 0.5, h: 1.0, mat: M.wood, tile: 1 }); box({ x: 6.4, z: -43.76, w: 2.0, d: 0.1, y: 1.1, h: 0.9, mat: M.glass, collide: false });
  plane(1.8, 0.4, signMat('TICKETS', { bg: '#1c3a2a', size: 44 }), 6.4, 2.25, -43.78, 0);
  W.hide.push(V(1.4, 0, -45.6), V(5.2, 0, -41.5));

  // ================================================================== GENERATOR ROOM (x 10..22, z 8..22)
  const GR = { x0: 10, x1: 22, z0: 8, z1: 22, h: 3.8 };
  W.rooms.push({ ...GR, name: 'Generator room' });
  box({ x: 16, z: 15, w: 12, d: 14, y: -0.2, h: 0.2, mat: M.floor, tile: 2, collide: false, recv: true });
  wall('x', GR.z0, GR.x0, GR.x1, GR.h, 0.4); wall('x', GR.z1, GR.x0, GR.x1, GR.h, 0.4); wall('z', GR.x1, GR.z0, GR.z1, GR.h, 0.4);
  box({ x: 16, z: 15, w: 12.4, d: 14.4, y: GR.h, h: 0.3, mat: M.ceiling, tile: 3, collide: false });
  box({ x: 17.2, z: 15.2, w: 3.6, d: 1.9, h: 1.5, mat: M.metal, tile: 1.5 }); box({ x: 17.2, z: 15.2, w: 3.8, d: 2.1, y: 1.5, h: 0.12, mat: M.black, collide: false });
  [-1.2, 0, 1.2].forEach((o) => cyl({ x: 17.2 + o, z: 15.2, r: 0.32, h: 0.7, y: 1.62, mat: M.steel, collide: false }));
  cyl({ x: 19.3, z: 15.2, r: 0.12, h: 3.2, y: 0.6, mat: M.rust, collide: false });
  W.genScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x030606, emissive: 0xff4630, emissiveIntensity: 0, roughness: 0.3 })); W.genScreen.position.set(17.2, 1.05, 14.24); W.genScreen.rotation.y = Math.PI; W.hall.add(W.genScreen);
  const sockets = []; [-1, 0, 1].forEach((o) => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0xff2a1c, emissiveIntensity: 0.6 })); s.position.set(17.2 + o * 0.9, 0.55, 14.2); W.hall.add(s); sockets.push(s); }); W.genSockets = sockets;
  box({ x: 12, z: 9.4, w: 1.6, d: 0.7, h: 1.6, mat: M.metal, tile: 1.5 }); barrel(20.6, 10); barrel(21, 11); barrel(20.5, 20.7); crate(11.4, 20.6, 0.9, 0.2); crate(14.5, 9.5, 0.8, 0.1, 2);
  cyl({ x: 12.8, z: 15, r: 0.05, h: 8, y: 0.07, mat: M.black, rx: Math.PI / 2, rz: 0, seg: 6, cast: false }).rotation.z = Math.PI / 2;
  lamp({ x: 16, y: 3.6, z: 15, kind: 'warm', len: 1.6, dir: 'x', zone: 'room' }); lamp({ x: 13, y: 3.6, z: 20, kind: 'red', len: 0.6, dir: 'x', zone: 'room' });
  W.hide.push(V(20.6, 0, 19), V(11.4, 0, 10.8));
  W.doorGR = door({ id: 'gr', axis: 'z', x: 10, z: 15, w: 2.2, h: 2.5, mat: M.metal, type: 'manual', slide: 1 });

  // ================================================================== MAINTENANCE CORRIDOR (x 10..22, z -16..-12) + LOCKER ROOM (x 22..32, z -22..-6)
  const LR = { x0: 22, x1: 32, z0: -22, z1: -6, h: 3.4 };
  W.rooms.push({ x0: 10, x1: 22, z0: -16, z1: -12, name: 'Maintenance' }, { ...LR, name: 'Locker room' });
  box({ x: 16, z: -14, w: 12, d: 4, y: -0.2, h: 0.2, mat: M.floor, tile: 2, collide: false }); box({ x: 27, z: -14, w: 10, d: 16, y: -0.2, h: 0.2, mat: M.floor, tile: 2, collide: false });
  wall('x', -16, 10, 22, 3.0, 0.4); wall('x', -12, 10, 22, 3.0, 0.4);
  box({ x: 16, z: -14, w: 12.4, d: 4.4, y: 3.0, h: 0.3, mat: M.ceiling, tile: 3, collide: false });
  wall('z', 22, LR.z0, LR.z1, LR.h, 0.4, [{ c: -14, w: 4, h: 2.8 }]); wall('x', LR.z0, 22, LR.x1, LR.h, 0.4); wall('x', LR.z1, 22, LR.x1, LR.h, 0.4); wall('z', LR.x1, LR.z0, LR.z1, LR.h, 0.4);
  box({ x: 27, z: -14, w: 10.4, d: 16.4, y: LR.h, h: 0.3, mat: M.ceiling, tile: 3, collide: false });
  for (let i = 0; i < 5; i++) box({ x: 30.8, z: -20 + i * 2.1, w: 0.7, d: 1.0, h: 2.0, mat: M.metal, tile: 1.2 });
  for (let i = 0; i < 3; i++) box({ x: 24.2 + i * 2.2, z: -7.2, w: 1.0, d: 0.7, h: 2.0, mat: M.metal, tile: 1.2 });
  box({ x: 27, z: -14, w: 2.6, d: 1.0, h: 0.9, mat: M.wood, tile: 1.5 }); box({ x: 26, z: -20, w: 1.8, d: 0.6, h: 1.8, mat: M.metal, tile: 1.4 });
  box({ x: 31.2, z: -14, w: 1.2, d: 2.4, h: 1.1, mat: M.metal, tile: 1.4 }); crate(24, -20.4, 0.8, 0.1, 2); barrel(23.2, -8.4);
  for (const x of [13, 18]) cyl({ x, z: -12.4, r: 0.1, h: 0.0001, mat: M.rust, collide: false });
  cyl({ x: 16, z: -12.45, r: 0.11, h: 12, y: 2.5, mat: M.rust, rx: 0, rz: Math.PI / 2, seg: 8, cast: false }); cyl({ x: 16, z: -15.55, r: 0.07, h: 12, y: 2.7, mat: M.black, rz: Math.PI / 2, seg: 6, cast: false });
  lamp({ x: 14, y: 2.9, z: -14, kind: 'white', len: 1.2, dir: 'x', zone: 'room' }); lamp({ x: 19, y: 2.9, z: -14, kind: 'red', len: 0.6, dir: 'x', zone: 'room' }); lamp({ x: 27, y: 3.2, z: -14, kind: 'white', len: 1.4, dir: 'x', zone: 'room' });
  W.hide.push(V(24.8, 0, -20.6), V(30, 0, -8));
  W.doorMC = door({ id: 'mc', axis: 'z', x: 10, z: -14, w: 2.2, h: 2.5, mat: M.metal, type: 'manual', slide: 1 });

  // ================================================================== SECURITY OFFICE (x 10..20, z -51..-39) with powered door
  const SO = { x0: 10, x1: 20, z0: -51, z1: -39, h: 3.2 };
  W.rooms.push({ ...SO, name: 'Security office' });
  box({ x: 15, z: -45, w: 10, d: 12, y: -0.2, h: 0.2, mat: M.floor, tile: 2, collide: false });
  wall('x', SO.z0, SO.x0, SO.x1, SO.h, 0.4); wall('x', SO.z1, SO.x0, SO.x1, SO.h, 0.4); wall('z', SO.x1, SO.z0, SO.z1, SO.h, 0.4);
  box({ x: 15, z: -45, w: 10.4, d: 12.4, y: SO.h, h: 0.3, mat: M.ceiling, tile: 3, collide: false });
  box({ x: 15.5, z: -49.4, w: 3.2, d: 1.1, h: 0.85, mat: M.wood, tile: 1.5 }); box({ x: 12, z: -49.5, w: 1.0, d: 0.5, h: 1.6, mat: M.metal, tile: 1.2 }); box({ x: 13.1, z: -49.5, w: 1.0, d: 0.5, h: 1.6, mat: M.metal, tile: 1.2 });
  W.monitors = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.36), new THREE.MeshStandardMaterial({ color: 0x030505, emissive: 0x4fd0a0, emissiveIntensity: 0, roughness: 0.3 })); m.position.set(14.6 + i * 1.3, 1.25, -49.0); m.rotation.y = 0; W.hall.add(m); return m; });
  box({ x: 18.6, z: -42, w: 1.0, d: 2.0, h: 0.5, mat: M.cloth, tile: 1.2 }); box({ x: 18.2, z: -45.5, w: 1.6, d: 0.7, h: 0.9, mat: M.metal, tile: 1.4 });
  lamp({ x: 15, y: 3.0, z: -45, kind: 'white', len: 1.6, dir: 'x', zone: 'room' });
  W.hide.push(V(12, 0, -40.6));
  W.doorSO = door({ id: 'so', axis: 'z', x: 10, z: -45, w: 2.2, h: 2.5, mat: M.steel, type: 'powered', locked: true, slide: -1 });

  // ================================================================== TRAIN TR-09
  const TG = W.train, trainCtr = (TRAIN.x0 + TRAIN.x1) / 2, innerPaint = [M.trainPaint, M.trainInterior, M.trainPaint, M.trainPaint, M.trainPaint, M.trainPaint];
  box({ x: trainCtr, z: 0, w: 3.4, d: 36, y: -0.22, h: 0.22, mat: M.trainFloor, tile: 1.5, collide: false, parent: TG });
  box({ x: trainCtr, z: 0, w: 3.4, d: 36, y: 2.7, h: 0.4, mat: M.trainPaint, tile: 3, collide: false, parent: TG, cast: false });
  box({ x: trainCtr, z: 0, w: 2.6, d: 35, y: -0.8, h: 0.6, mat: M.black, collide: false, parent: TG, cast: false });
  for (const z of [-14, -6, 6, 14]) for (const x of [-4.8, -2.6]) { cyl({ x, z, r: 0.3, h: 0.14, y: -1.25, mat: M.steel, rz: Math.PI / 2, collide: false, parent: TG, cast: false }); }
  // doors on the platform side + windows
  const doorZ = [13.5, 4.5, -4.5, -13.5];
  const sideWall = (x, outwardPositive, doors) => {
    const cuts = []; for (const dz of doorZ) { if (doors) cuts.push({ c: dz, w: 1.7, y0: 0, y1: 2.3, door: true }); for (const o of [-3, 3]) cuts.push({ c: dz + o, w: 1.5, y0: 0.95, y1: 2.2 }); if (!doors) cuts.push({ c: dz, w: 1.5, y0: 0.95, y1: 2.2 }); }
    cuts.sort((a, b) => a.c - b.c);
    let cur = TRAIN.z0; const pieces = [], mats = outwardPositive ? [M.trainPaint, M.trainInterior, M.trainPaint, M.trainPaint, M.trainPaint, M.trainPaint] : [M.trainInterior, M.trainPaint, M.trainPaint, M.trainPaint, M.trainPaint, M.trainPaint];
    const piece = (z0, z1, y0, y1) => { if (z1 - z0 > 0.02 && y1 - y0 > 0.02) box({ x, z: (z0 + z1) / 2, w: 0.12, d: z1 - z0, y: y0, h: y1 - y0, mat: mats, tile: 3.1, tileV: 3.1, collide: false, parent: TG }); };
    for (const c of cuts) { piece(cur, c.c - c.w / 2, 0, 2.7); piece(c.c - c.w / 2, c.c + c.w / 2, 0, c.y0); piece(c.c - c.w / 2, c.c + c.w / 2, c.y1, 2.7); if (!c.door) { const g = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.y1 - c.y0), M.glass); g.position.set(x, (c.y0 + c.y1) / 2, c.c); g.rotation.y = Math.PI / 2; TG.add(g); } cur = c.c + c.w / 2; }
    piece(cur, TRAIN.z1, 0, 2.7);
    // colliders: full wall except door gaps
    let z = TRAIN.z0; const gaps = doors ? [...doorZ].sort((a, b) => a - b).map((d) => [d - 0.85, d + 0.85]) : [];
    for (const [g0, g1] of gaps) { W.colliders.push({ x0: x - 0.06, x1: x + 0.06, z0: z, z1: g0, y0: 0, y1: 2.7, active: true, noMap: false }); z = g1; }
    W.colliders.push({ x0: x - 0.06, x1: x + 0.06, z0: z, z1: TRAIN.z1, y0: 0, y1: 2.7, active: true });
  };
  sideWall(TRAIN.x1 - 0.06, true, true); sideWall(TRAIN.x0 + 0.06, false, false);
  // train side doors (sliding leaves, locked until arrival)
  W.trainDoors = doorZ.map((dz, i) => { const d = door({ id: 'td' + i, axis: 'z', x: TRAIN.x1 - 0.06, z: dz, w: 1.7, h: 2.3, thick: 0.08, mat: M.trainPaint, type: 'train', locked: true, slide: i % 2 ? 1 : -1 }); return d; });
  // end walls and partitions
  const endWall = (z, windshield) => {
    if (windshield) {
      box({ x: -5.0, z, w: 0.8, d: 0.12, h: 2.7, mat: M.trainInterior, collide: false, parent: TG }); box({ x: -2.4, z, w: 0.8, d: 0.12, h: 2.7, mat: M.trainInterior, collide: false, parent: TG });
      box({ x: -3.7, z, w: 1.8, d: 0.12, h: 0.9, mat: M.trainInterior, collide: false, parent: TG }); box({ x: -3.7, z, w: 1.8, d: 0.12, y: 2.3, h: 0.4, mat: M.trainInterior, collide: false, parent: TG });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), M.glass); g.position.set(-3.7, 1.6, z + 0.07); TG.add(g);
    } else box({ x: trainCtr, z, w: 3.3, d: 0.12, h: 2.7, mat: M.trainInterior, collide: false, parent: TG });
    W.colliders.push({ x0: TRAIN.x0, x1: TRAIN.x1, z0: z - 0.07, z1: z + 0.07, y0: 0, y1: 2.7, active: true });
  };
  endWall(TRAIN.z0, true); endWall(TRAIN.z1, false);
  for (const z of [9, 0, -9]) {
    box({ x: -4.9, z, w: 0.8, d: 0.12, h: 2.7, mat: M.trainInterior, collide: true, parent: TG }); box({ x: -2.5, z, w: 0.8, d: 0.12, h: 2.7, mat: M.trainInterior, collide: true, parent: TG });
    box({ x: -3.7, z, w: 1.6, d: 0.12, y: 2.2, h: 0.5, mat: M.trainInterior, collide: false, parent: TG });
  }
  // lamps inside
  for (const z of doorZ) lamp({ x: trainCtr, y: 2.66, z, kind: 'warm', len: 1.8, parent: TG, zone: 'train', on: true, size: 0.9 });
  // passenger compartment
  const seat = (z, x = -5.0) => { box({ x, z, w: 0.6, d: 1.7, h: 0.46, mat: M.seat, tile: 0.8, parent: TG }); box({ x: x - 0.22, z, w: 0.1, d: 1.7, y: 0.46, h: 0.62, mat: M.seat, tile: 0.8, collide: false, parent: TG }); };
  seat(16.2); seat(11.3); seat(7.6); seat(2.6); seat(-1.4, -5.0);
  for (const [x, z] of [[-3.7, 13.5], [-3.7, 4.5], [-3.7, -4.5]]) cyl({ x, z, r: 0.03, h: 2.7, mat: M.steel, collide: false, parent: TG });
  box({ x: -4.4, z: 17.2, w: 0.7, d: 0.7, h: 0.75, mat: M.wood, tile: 0.7, parent: TG }); cyl({ x: -4.4, z: 17.2, r: 0.06, h: 0.18, y: 0.75, mat: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb060, emissiveIntensity: 1.4 }), collide: false, parent: TG });
  box({ x: -2.5, z: 17.2, w: 0.5, d: 1.0, h: 1.6, mat: M.metal, tile: 1.2, parent: TG });
  // medical compartment
  const cot = (z) => { box({ x: -5.0, z, w: 0.8, d: 1.9, y: 0.0, h: 0.5, mat: M.steel, tile: 1.2, parent: TG }); box({ x: -5.0, z, w: 0.74, d: 1.8, y: 0.5, h: 0.14, mat: M.paper, tile: 1, collide: false, parent: TG }); };
  cot(7.9); cot(5.0);
  box({ x: -2.55, z: 1.7, w: 0.5, d: 1.5, h: 1.9, mat: M.metal, tile: 1.2, parent: TG });
  plane(0.4, 0.4, new THREE.MeshStandardMaterial({ map: signTexture('+', { bg: '#7a1414', fg: '#e8e6da', w: 128, h: 128, size: 100, border: false }), roughness: 0.6 }), -2.79, 1.6, 1.7, -Math.PI / 2, 0, TG);
  // storage / workshop
  for (const z of [-2.2, -6.0]) { box({ x: -5.0, z, w: 0.5, d: 2.2, h: 2.0, mat: M.metal, tile: 1.4, parent: TG }); }
  crate(-5.0, -2.2, 0.5, 0, 2); box({ x: -2.55, z: -7.9, w: 0.7, d: 1.8, h: 0.95, mat: M.wood, tile: 1.4, parent: TG }); box({ x: -2.55, z: -1.4, w: 0.6, d: 1.0, h: 1.6, mat: M.metal, tile: 1.2, parent: TG });
  // control compartment
  box({ x: -3.7, z: -16.7, w: 2.2, d: 0.7, h: 0.95, mat: M.black, tile: 1, parent: TG });
  W.consoleScreens = [-4.3, -3.7, -3.1].map((x) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ color: 0x030a0a, emissive: 0x38c9a0, emissiveIntensity: 0.9, roughness: 0.3 })); s.position.set(x, 1.12, -16.34); s.rotation.set(-0.4, 0, 0); TG.add(s); return s; });
  box({ x: -3.7, z: -15.5, w: 0.5, d: 0.5, h: 0.5, mat: M.seat, tile: 0.5, parent: TG });
  plane(1.6, 1.0, new THREE.MeshStandardMaterial({ map: signTexture('ROUTE', { bg: '#0f2a26', fg: '#8be0c6', w: 256, h: 160, sub: 'KESSLER ST - CH.1', size: 56 }), emissive: 0x143b33, emissiveIntensity: 0.6 }), -5.28, 1.6, -12.5, Math.PI / 2, 0, TG);
  box({ x: -2.5, z: -11, w: 0.4, d: 0.9, h: 1.5, mat: M.metal, tile: 1.2, parent: TG });
  // outside windows streaks (visible while moving)
  W.streaks = new THREE.Group(); TG.add(W.streaks);
  const stMat = new THREE.MeshBasicMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  W.streakMeshes = []; for (let i = 0; i < 90; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + rnd() * 3, 0.06), stMat); const side = rnd() > 0.5 ? 1 : -1; s.position.set(side > 0 ? -1.2 : -6.2, 0.6 + rnd() * 1.8, -18 + rnd() * 36); s.rotation.y = Math.PI / 2; s.userData.sp = 14 + rnd() * 18; W.streaks.add(s); W.streakMeshes.push(s); }
  W.streaks.visible = false;
  // spawn / anchors
  Object.assign(W.anchors, {
    trainSpawn: V(-4.0, 0, 15.2), maraStart: V(-4.7, 0, 16.6), console: V(-3.7, 0, -15.1), medical: V(-3.1, 0, 1.7), workshop: V(-3.3, 0, -7.8), storage: V(-3.2, 0, -1.4),
    arrive: V(1.0, 0, 13.5), kiosk: V(6.8, 0, 21.2), booth: V(6.4, 0, -42.3), lockerShelf: V(29.6, 0, -14), generator: V(17.2, 0, 13.5), securityDoor: V(10, 0, -45), cot: V(17.4, 0, -42), radio: V(15.5, 0, -48.4),
    doorGR: V(10, 0, 15), doorMC: V(10, 0, -14),
  });
  W.spawns.push(V(4, 0, 34.3), V(0.5, 0, -47.5), V(29, 0, -20.8), V(8.5, 0, -48));
  W.enterAnchors = [V(1, 0, 13.5), V(1, 0, 4.5), V(1, 0, -4.5), V(1, 0, -13.5)];

  // ------------------------------------------------------------------ dust motes around the player
  const dN = 260, dg = new THREE.BufferGeometry(), dp = new Float32Array(dN * 3); for (let i = 0; i < dN; i++) { dp[i * 3] = (rnd() - 0.5) * 14; dp[i * 3 + 1] = rnd() * 4; dp[i * 3 + 2] = (rnd() - 0.5) * 14; }
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  W.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, color: 0xcfd6e0, transparent: true, opacity: 0.35, depthWrite: false, map: glowTexture(), blending: THREE.AdditiveBlending }));
  W.dust.frustumCulled = false; W.group.add(W.dust);

  // ------------------------------------------------------------------ real light pool
  W.pool = [];
  W.initLights = (n) => { W.pool.forEach((l) => W.group.remove(l)); W.pool = []; for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffffff, 0, 15, 2); l.castShadow = false; W.group.add(l); W.pool.push(l); } };
  W.initLights(G.settings.quality === 'high' ? 7 : G.settings.quality === 'medium' ? 5 : 3);

  // ------------------------------------------------------------------ queries
  W.zoneAt = (x, z) => {
    if (x > TRAIN.x0 && x < TRAIN.x1 && z > TRAIN.z0 && z < TRAIN.z1) return 'train';
    for (const r of W.rooms) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return 'room';
    return 'hall';
  };
  W.inTrain = (x, z) => x > TRAIN.x0 + 0.1 && x < TRAIN.x1 - 0.1 && z > TRAIN.z0 + 0.1 && z < TRAIN.z1 - 0.1;

  W.setPower = (on) => {
    W.powered = on;
    for (const L of W.lamps) { if (L.zone === 'train') continue; L.on = L.kind === 'red' ? on : (on ? (L.pos.x === 1.5 || L.pos.x === 7 ? (Math.abs(Math.round(L.pos.z)) % 3 !== 0) : true) : false); }
    W.vendScreens?.forEach((s) => { s.material.emissiveIntensity = on ? 0.8 : 0; });
    W.monitors.forEach((m) => { m.material.emissiveIntensity = on ? 0.9 : 0; });
    W.genScreen.material.emissive.setHex(on ? 0x3bd16f : 0xff4630); W.genScreen.material.emissiveIntensity = on ? 1.2 : 0.0;
    W.genSockets.forEach((s) => { s.material.emissive.setHex(on ? 0x3bd16f : 0xff2a1c); });
  };
  W.setMoving = (on) => { W.moving = on; W.streaks.visible = on; W.hall.visible = !on; };

  // ------------------------------------------------------------------ per-frame
  W.update = (dt, t, actors, focus) => {
    // doors
    for (const D of W.doors) {
      if (D.type === 'train') { D.target = !D.locked && actors.some((a) => Math.abs(a.x - D.x) < 2.2 && Math.abs(a.z - D.z) < 1.8) ? 1 : 0; }
      else if (D.type === 'powered') { D.target = !D.locked && D.want ? 1 : D.target; }
      const was = D.open; D.open = damp(D.open, D.target, D.type === 'manual' ? 5 : 6, dt); if (Math.abs(D.open - D.target) < 0.01) D.open = D.target;
      const off = D.open * (D.w - 0.15) * D.slide;
      if (D.axis === 'z') D.mesh.position.z = D.z + off; else D.mesh.position.x = D.x + off;
      D.c.active = D.open < 0.55;
      if ((was < 0.5) !== (D.open < 0.5)) { if (D.type !== 'train') G.nav?.setDoor(D.id, D.c, D.open < 0.5); if (D.sfx) { if (D.type === 'train') G.audio?.slide({ x: D.x, y: 1, z: D.z }); else G.audio?.door(D.type === 'powered', { x: D.x, y: 1, z: D.z }); } }
    }
    // lamps
    W.flickerT += dt;
    for (const L of W.lamps) {
      let target = L.on ? 1 : 0;
      if (L.on) { const f = Math.sin(t * 17 + L.phase * 7) * Math.sin(t * 5.3 + L.phase); if (L.kind === 'white' && f > 0.82) target = 0.15; if (L.flicker > 0) { L.flicker -= dt; target = Math.random() > 0.5 ? 1 : 0.1; } else if (Math.random() < 0.0008) L.flicker = 0.4 + Math.random() * 0.6; }
      if (!L.on && !W.powered && L.kind === 'white' && (Math.sin(t * 0.7 + L.phase) > 0.995)) target = 0.5;
      L.level = damp(L.level, target, 18, dt); L.mat.emissiveIntensity = L.level * (L.kind === 'red' ? 1.5 : 2.2);
    }
    // light pool follows the player
    const fx = focus.x, fz = focus.z, lit = W.lamps.filter((l) => l.level > 0.05).map((l) => ({ l, d: (l.pos.x - fx) ** 2 + (l.pos.z - fz) ** 2 + (l.zone === 'train' && !G.player.inTrain ? 400 : 0) })).sort((a, b) => a.d - b.d);
    W.pool.forEach((pl, i) => {
      const e = lit[i]; if (!e) { pl.intensity = damp(pl.intensity, 0, 10, dt); return; }
      pl.position.lerp(e.l.pos, 1 - Math.exp(-8 * dt)); pl.color.setHex(e.l.kind === 'red' ? 0xff3a22 : e.l.kind === 'warm' ? 0xffc27a : 0xcfe0ff);
      pl.distance = e.l.zone === 'train' ? 9 : 15; pl.intensity = damp(pl.intensity, e.l.level * e.l.base * 7 * (e.l.size || 1), 10, dt);
    });
    // streaks outside train windows
    if (W.moving) for (const s of W.streakMeshes) { s.position.z += s.userData.sp * dt * (s.userData.sp > 0 ? 1 : 1); if (s.position.z > 18) s.position.z = -18; }
    // dust
    if (W.dust) { W.dust.position.set(focus.x, 0.2, focus.z); const a = W.dust.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let y = a.getY(i) + Math.sin(t * 0.3 + i) * 0.0008 + 0.0025 * Math.sin(i * 12.9); if (y > 4) y = 0; a.setY(i, y); } a.needsUpdate = true; }
    if (W.consoleScreens) W.consoleScreens.forEach((s, i) => { s.material.emissiveIntensity = 0.7 + Math.sin(t * 2 + i) * 0.15; });
  };
  return W;
}
