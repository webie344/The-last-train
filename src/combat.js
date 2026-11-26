// Weapons: rifle model + two-hand IK (ported from the Compound Clash soldier), hitscan, tracers, muzzle flash, barks (voice call-outs).
import * as THREE from 'three';
import { clamp, rand, pick, seg3HitsBox } from './util.js';

export const GUN = { dmg: 22, rate: 0.115, mag: 30, reload: 1.75, range: 70, spread: 0.012, headMul: 2.2, noise: 26 };
export const RIFLE = { LEN: 0.95, STOCK_FWD: 0.06, STOCK_SIDE: 0.1, STOCK_DOWN: 0.1, GRIP_R: 0.3, GRIP_L: 0.56 };
const MODEL_FLIP = new URLSearchParams(location.search).get('rflip');

const _fwd = new THREE.Vector3(), _hf = new THREE.Vector3(), _rt = new THREE.Vector3(), _up = new THREE.Vector3(), _want = new THREE.Vector3(), _cr = new THREE.Vector3(), _S = new THREE.Vector3(), _gp = new THREE.Vector3(), _pole = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _B2 = new THREE.Vector3(), _T = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _ax = new THREE.Vector3();
const findBone = (root, re) => { let f = null; root.traverse((o) => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };

function rotBone(bone, from, to) {
  _dq.setFromUnitVectors(from, to); bone.getWorldQuaternion(_wq); _wq.premultiply(_dq);
  bone.parent.getWorldQuaternion(_pq); _pq.invert(); bone.quaternion.copy(_pq.multiply(_wq)); bone.updateMatrixWorld(true);
}
function solveArm(arm, target, pole, w) {
  if (!arm || w < 0.01) return;
  const { u, l, w: wr } = arm, qu = u.quaternion.clone(), ql = l.quaternion.clone();
  u.getWorldPosition(_A); l.getWorldPosition(_B); wr.getWorldPosition(_C);
  const L1 = _A.distanceTo(_B), L2 = _B.distanceTo(_C); if (L1 < 1e-4 || L2 < 1e-4) return;
  _T.copy(target).sub(_A); const D0 = _T.length() || 1e-4, D = clamp(D0, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3); _ax.copy(_T).divideScalar(D0);
  const x = (L1 * L1 - L2 * L2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  _pole.copy(pole).addScaledVector(_ax, -pole.dot(_ax)); if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0); _pole.normalize();
  _B2.copy(_A).addScaledVector(_ax, x).addScaledVector(_pole, h);
  _d1.copy(_B).sub(_A).normalize(); _d2.copy(_B2).sub(_A).normalize(); rotBone(u, _d1, _d2);
  l.getWorldPosition(_B); wr.getWorldPosition(_C); _d1.copy(_C).sub(_B).normalize(); _d2.copy(_A).addScaledVector(_ax, D).sub(_B).normalize(); rotBone(l, _d1, _d2);
  if (w < 0.999) { const nu = u.quaternion.clone(), nl = l.quaternion.clone(); u.quaternion.copy(qu).slerp(nu, w); l.quaternion.copy(ql).slerp(nl, w); }
  u.updateMatrixWorld(true);
}

function procRifle() {
  const g = new THREE.Group(), mat = (c, m = 0.6, r = 0.45) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
  const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.055, 0.085, 0.36), mat('#23262b'), 0, 0, 0.32);              // receiver
  add(new THREE.BoxGeometry(0.05, 0.06, 0.28), mat('#5a3d22', 0.1, 0.8), 0, -0.005, 0.62);  // handguard
  const barrel = add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), mat('#15171a'), 0, 0.012, 0.79, Math.PI / 2); barrel.name = 'barrel';
  add(new THREE.BoxGeometry(0.05, 0.075, 0.26), mat('#5a3d22', 0.1, 0.8), 0, -0.02, 0.06, 0.12);  // stock
  add(new THREE.BoxGeometry(0.036, 0.17, 0.07), mat('#1c1e22'), 0, -0.12, 0.38, 0.28);  // magazine
  add(new THREE.BoxGeometry(0.03, 0.08, 0.05), mat('#1c1e22'), 0, -0.07, 0.2, -0.3);      // grip
  add(new THREE.BoxGeometry(0.012, 0.03, 0.012), mat('#111'), 0, 0.06, 0.92);               // front sight
  add(new THREE.BoxGeometry(0.03, 0.025, 0.03), mat('#111'), 0, 0.058, 0.17);               // rear sight
  return g;
}

export class Weapon {
  constructor(G, rig, rifleGltf) {
    this.G = G; this.rig = rig; this.root = new THREE.Group(); this.muzzle = new THREE.Object3D(); this.axis = new THREE.Vector3(0, 0, 1); this.up = new THREE.Vector3(0, 1, 0);
    this.armR = null; this.armL = null; this.hand = null; this.ikW = 0; this.kick = 0; this._pit = 0; this.visible = true; this.world = false;
    let r;
    if (rifleGltf) {
      r = rifleGltf.scene.clone(true); r.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const rb = new THREE.Box3().setFromObject(r), sz = rb.getSize(new THREE.Vector3()), ctr = rb.getCenter(new THREE.Vector3()), mx = Math.max(sz.x, sz.y, sz.z, 1e-3), s = RIFLE.LEN / mx;
      const ai = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z'; let sign = Math.abs(rb.max[ai]) >= Math.abs(rb.min[ai]) ? 1 : -1; if (MODEL_FLIP) sign = -sign;
      const dims = ['x', 'y', 'z'].filter((k) => k !== ai).sort((a, b) => sz[b] - sz[a]); this.up = new THREE.Vector3(); this.up[dims[0]] = 1;
      const back = sign > 0 ? rb.min[ai] : rb.max[ai], front = sign > 0 ? rb.max[ai] : rb.min[ai], grip = ctr.clone(); grip[ai] = back;
      const tip = ctr.clone(); tip[ai] = front; this.muzzle.position.copy(tip); r.add(this.muzzle); r.scale.setScalar(s); r.position.copy(grip).multiplyScalar(-s); this.root.add(r);
      this.axis = new THREE.Vector3(); this.axis[ai] = sign;
    } else { r = procRifle(); this.muzzle.position.set(0, 0.012, 0.98); r.add(this.muzzle); this.root.add(r); }
    G.scene.add(this.root);
    const model = rig.model;
    if (model) {
      this.hand = findBone(model, /^wrist.?r$/i) || findBone(model, /wrist.?r|hand.?r|right.?hand|palm.?r/i);
      const wL = findBone(model, /^wrist.?l$/i) || findBone(model, /wrist.?l|hand.?l|left.?hand|palm.?l/i);
      const chain = (w) => { const l = w && w.parent && w.parent.isBone ? w.parent : null, u = l && l.parent && l.parent.isBone ? l.parent : null; return u && l ? { u, l, w } : null; };
      this.armR = chain(this.hand); this.armL = chain(wL); this.world = !!this.hand;
    }
    if (!this.world) { rig.root.add(this.root); this.root.position.set(0.22, 1.28, 0.1); }   // blocky fallback character: carry it at the hip
  }
  muzzlePos(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.muzzle.getWorldPosition(out); }
  // s: {yaw, pitch, show, reloading, sprint}
  update(dt, s) {
    const show = s.show; this.root.visible = show;
    this.kick = Math.max(0, this.kick - dt * 0.9);
    if (!this.world) return;
    this.ikW += (((show ? 1 : 0) - this.ikW) * (1 - Math.exp(-16 * dt)));
    if (!show) return;
    this.rig.root.updateMatrixWorld(true);
    let p = s.pitch || 0; if (s.reloading) p = -0.4; else if (s.sprint) p = -0.5;
    this._pit += (p - this._pit) * (1 - Math.exp(-12 * dt)); p = this._pit;
    const cp = Math.cos(p), sy = Math.sin(s.yaw), cyw = Math.cos(s.yaw);
    _fwd.set(sy * cp, Math.sin(p), cyw * cp); _hf.set(sy, 0, cyw); _rt.set(-cyw, 0, sy);
    _rq.setFromUnitVectors(this.axis, _fwd);
    _up.copy(this.up).applyQuaternion(_rq); _want.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();
    _cr.crossVectors(_up, _want); _rq2.setFromAxisAngle(_fwd, Math.atan2(_fwd.dot(_cr), _up.dot(_want))); _rq.premultiply(_rq2);
    this.root.quaternion.copy(_rq); _up.copy(this.up).applyQuaternion(_rq);
    (this.armR ? this.armR.u : this.hand).getWorldPosition(_S);
    this.root.position.copy(_S).addScaledVector(_hf, RIFLE.STOCK_FWD).addScaledVector(_rt, -RIFLE.STOCK_SIDE).addScaledVector(_fwd, -this.kick); this.root.position.y -= RIFLE.STOCK_DOWN;
    this.root.updateMatrixWorld(true);
    const L = RIFLE.LEN, rp = this.root.position;
    if (this.armR) { _gp.copy(rp).addScaledVector(_fwd, L * RIFLE.GRIP_R).addScaledVector(_up, -0.07); _pole.copy(_rt).multiplyScalar(0.6).y -= 1; solveArm(this.armR, _gp, _pole, this.ikW); }
    if (this.armL) {
      if (s.reloading) _gp.copy(rp).addScaledVector(_fwd, L * 0.36).addScaledVector(_up, -(0.26 + Math.sin(this.G.time * 16) * 0.04));
      else _gp.copy(rp).addScaledVector(_fwd, L * RIFLE.GRIP_L).addScaledVector(_up, -0.03);
      _pole.copy(_rt).multiplyScalar(-0.6).y -= 1; solveArm(this.armL, _gp, _pole, this.ikW);
    }
  }
  dispose() { this.G.scene.remove(this.root); }
}

// ---------------------------------------------------------------- combat system
export class Combat {
  constructor(G) {
    this.G = G; this.tracers = []; this.sparks = []; this.flash = new THREE.PointLight(0xffc27a, 0, 9, 2); this.flash.position.set(0, -50, 0); G.scene.add(this.flash); this.flashT = 0; this.noiseT = 0; this.sprites = [];
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 1), tm); m.visible = false; G.scene.add(m); this.tracers.push({ m, t: 0, life: 0 }); }
    for (let i = 0; i < 10; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.glowTex, color: 0xffcf8a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.visible = false; G.scene.add(sp); this.sprites.push({ sp, life: 0, max: 0.06, size: 0.6 }); }
    G.events.on('bullet', (e) => {   // feedback when the PLAYER's bullet lands: hit marker, tick, haptics, call-outs
      if (e.shooter !== G.player || !e.who || e.who === G.player) return;
      G.ui.hitMarker(e.killed); G.audio.hitTick(e.killed); G.input.pattern(e.killed ? 'kill' : e.head ? 'headshot' : 'hit');
      if (e.killed) { this.say('You', pick(['Target down.', 'One less.', 'Got him.']), { cool: 4, key: 'youKill', speak: Math.random() < 0.7 }); this.say('Mara', pick(['Nice shot!', 'Good kill!', 'That is one!']), { cool: 7, key: 'maraKill' }); }
      else if (e.head) this.say('Mara', 'Headshot!', { cool: 8, key: 'maraHead', speak: false });
    });
    this.sparkI = 0; this.tI = 0; this.barkT = {}; this.barkGlobal = 0; this.voice = { Mara: { rate: 1.06, pitch: 1.3 }, You: { rate: 1, pitch: 0.75 }, Raider: { rate: 1.08, pitch: 0.55 } };
  }
  // ---- voice call-outs (subtitle + optional speech), rate limited
  say(who, text, { speak = true, cool = 3, key = who + text, ms = 2400, pitch = null } = {}) {
    const G = this.G, now = G.time; if ((this.barkT[key] || 0) > now) return false; if (speak && this.barkGlobal > now && who !== 'You') speak = false;
    this.barkT[key] = now + cool; G.ui.subtitle(who, text, ms);
    if (speak) { this.barkGlobal = now + 1.6; const v = this.voice[who] || this.voice.Raider; G.audio.speak(text, { rate: v.rate, pitch: pitch ?? v.pitch }); }
    return true;
  }
  dirWord(from) { const P = this.G.player, a = Math.atan2(from.x - P.pos.x, from.z - P.pos.z), rel = ((P.camYaw - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; const ab = Math.abs(rel); return ab < 0.6 ? 'ahead' : ab > 2.4 ? 'behind you' : rel > 0 ? 'on your right' : 'on your left'; }

  // ---- visuals
  tracer(a, b, color = 0xffe2a8) {
    const T = this.tracers[this.tI++ % this.tracers.length], d = a.distanceTo(b); if (d < 0.2) return;
    T.m.position.copy(a).lerp(b, 0.5); T.m.lookAt(b); T.m.scale.set(1, 1, d); T.m.material.color.setHex(color); T.m.visible = true; T.life = 0.07;
  }
  glow(p, size = 0.6, color = 0xffcf8a, life = 0.06) { const S = this.sprites[this.sparkI++ % this.sprites.length]; S.sp.position.copy(p); S.sp.scale.setScalar(size); S.sp.material.color.setHex(color); S.sp.material.opacity = 1; S.sp.visible = true; S.life = life; S.max = life; S.size = size; }
  muzzleFlash(p, color = 0xffc27a, power = 9) { this.flash.position.copy(p); this.flash.color.setHex(color); this.flash.intensity = power; this.flashT = 0.05; this.glow(p, 0.7, color, 0.05); }
  update(dt) {
    for (const T of this.tracers) if (T.m.visible) { T.life -= dt; if (T.life <= 0) T.m.visible = false; }
    for (const S of this.sprites) if (S.sp.visible) { S.life -= dt; S.sp.material.opacity = clamp(S.life / S.max, 0, 1); if (S.life <= 0) S.sp.visible = false; }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; } }
    this.noiseT -= dt;
  }

  // ---- hitscan: nearest of world geometry / enemies / the player
  targets(shooter) {
    const G = this.G, out = [];
    for (const r of G.raiders || []) if (r.alive && r !== shooter) out.push({ who: r, x: r.pos.x, z: r.pos.z, r: 0.4, y0: 0, y1: 1.85 });
    if (G.creature.active && G.creature.alive !== false && G.creature !== shooter) out.push({ who: G.creature, x: G.creature.pos.x, z: G.creature.pos.z, r: 0.5, y0: 0, y1: 2.1 });
    const P = G.player; if (P !== shooter && !(shooter && shooter.friendly) && !P.dead && !P.downed) out.push({ who: P, x: P.pos.x, z: P.pos.z, r: 0.36, y0: 0, y1: P.crouch ? 1.25 : 1.8 });
    return out;
  }
  hitscan(o, d, range, shooter) {
    const G = this.G; let best = { t: range, who: null, head: false };
    const ex = o.x + d.x * range, ey = o.y + d.y * range, ez = o.z + d.z * range;
    for (const c of G.world.colliders) { if (c.active === false || c.y1 < 0.05) continue; const t = seg3HitsBox(o.x, o.y, o.z, ex, ey, ez, c); if (t !== null && t * range < best.t) best = { t: t * range, who: null, head: false, wall: true }; }
    if (d.y < 0 && o.y + d.y * best.t < 0) best = { t: Math.min(best.t, -o.y / d.y), who: null, head: false, wall: true };
    for (const tg of this.targets(shooter)) {
      const ox = o.x - tg.x, oz = o.z - tg.z, h2 = d.x * d.x + d.z * d.z; if (h2 < 1e-6) continue;
      const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - tg.r * tg.r, disc = b * b - 4 * h2 * c; if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * h2); if (t < 0 || t > best.t) continue;
      const y = o.y + d.y * t; if (y < tg.y0 || y > tg.y1) continue;
      best = { t, who: tg.who, head: y > tg.y1 - 0.28, wall: false };
    }
    best.point = new THREE.Vector3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t); return best;
  }
  /** fire one bullet. origin: Vector3 (muzzle), dir: unit Vector3, opts {dmg, spread, range, noise, tracerColor} */
  shoot(shooter, origin, dir, o = {}) {
    const G = this.G, sp = o.spread ?? GUN.spread, d = dir.clone();
    d.x += rand(-sp, sp); d.y += rand(-sp, sp); d.z += rand(-sp, sp); d.normalize();
    const hit = this.hitscan(origin, d, o.range ?? GUN.range, shooter);
    this.tracer(origin, hit.point, o.tracerColor); this.muzzleFlash(origin, o.flashColor);
    if (hit.who) {
      const dmg = (o.dmg ?? GUN.dmg) * (hit.head ? GUN.headMul : 1);
      let killed = false;
      if (hit.who === G.player) G.player.hurt(dmg, shooter.pos || origin, { bullet: true });
      else { const was = hit.who.alive !== false; hit.who.damage?.(dmg, { head: hit.head, from: shooter, point: hit.point }); killed = was && hit.who.alive === false; }
      G.events.emit('bullet', { shooter, who: hit.who, head: hit.head, killed });
      this.glow(hit.point, 0.7, hit.who === G.player ? 0xff4040 : 0xff3030, 0.09);
    } else this.glow(hit.point, 0.5, 0xffd28a, 0.1);
    if (this.noiseT <= 0 || o.noise) { this.noiseT = 0.3; G.noise(origin.x, origin.z, o.noise ?? GUN.noise, shooter === G.player ? 'player' : 'raider'); }
    return hit;
  }
}
