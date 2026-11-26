// The Stalker. Local game AI (perception, navigation, attacks); the Director only issues high-level orders.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { CFG } from './config.js';
import { clamp, damp, dampAngle, angDiff, resolveMove, lineBlocked, pick, rand } from './util.js';

export const STATES = ['DORMANT', 'PATROL', 'INVESTIGATE', 'STALK', 'AMBUSH', 'CHASE', 'ATTACK', 'RETREAT', 'HIDE'];

export class Creature {
  constructor(G, gltf) {
    this.G = G; this.pos = new THREE.Vector3(0, 0, -40); this.yaw = 0; this.state = 'DORMANT'; this.t = 0; this.path = []; this.pi = 0; this.repath = 0;
    this.goal = null; this.aware = 0; this.lastSeen = null; this.lostT = 0; this.atkT = 0; this.atkCool = 0; this.flinchCool = 0; this.expose = 0; this.sound = null; this.soundT = 0;
    this.maxHp = 520; this.hp = 520; this.alive = true; this.hurtAcc = 0; this.deadUntil = 0; this.name = 'Stalker';
    this.active = false; this.speed = 0; this.threat = 0; this.mercy = 0; this.growlT = 6; this.hideSpot = null; this.stalkAngle = 0; this.lungeDone = false; this.scratchT = 0; this.orderTag = 'none';
    this.rig = new Rig(gltf, { tint: 0x16181a, height: 2.12, rough: 0.55, metal: 0.1, emissive: 0x1a0303, emissiveI: 0.6, scaleXZ: 0.78 });
    if (this.rig.pivot) this.rig.pivot.rotation.x = 0.16;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b2a });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat); this.rig.attach('head', e, new THREE.Vector3(sx * 0.05, 1.98, 0.13)); }
    this.eyeGlow = new THREE.PointLight(0xff3020, 0.0, 3.5, 2); this.eyeGlow.position.set(0, 1.95, 0.2); this.rig.root.add(this.eyeGlow);
    this.rig.root.visible = false; G.scene.add(this.rig.root); this.rig.play('Idle_Loop');
    G.noiseBus.on('noise', (e) => this.hear(e));
  }
  damage(d, info = {}) {
    if (!this.active || !this.alive) return; const G = this.G; this.hp -= d; this.hurtAcc += d; G.audio.flesh(this.pos);
    if (this.hp <= 0) { this.die(); return; }
    if (this.hurtAcc > 120 && this.flinchCool <= 0) { this.hurtAcc = 0; this.flinchCool = 2.5; G.audio.screech(this.pos); this.rig.once('Hit_Chest', { fade: 0.05 }); this.set('RETREAT'); this.fled = true; }
    else if (!['CHASE', 'ATTACK', 'RETREAT'].includes(this.state) && this.mercy <= 0) { this.aware = 1; this.set('CHASE'); G.audio.screech(this.pos); G.events.emit('chaseStart'); }
    void info;
  }
  die() {
    const G = this.G; this.alive = false; this.hp = 0; this.state = 'DEAD'; this.rig.cancelOnce(); this.rig.play('Death01', { loop: false, fade: 0.1 }); G.audio.screech(this.pos); G.events.emit('stalkerDown', this); G.input.pattern('kill');
    setTimeout(() => { this.despawn(); this.alive = true; this.hp = this.maxHp; this.deadUntil = G.time + 150; }, 4500);
  }
  get dormant() { return this.state === 'DORMANT'; }
  set(s) { if (this.state !== s) { this.state = s; this.t = 0; this.path = []; this.repath = 0; } }

  // ---- spawning
  canSeeFromCamera(x, z) { const G = this.G, v = new THREE.Vector3(x, 1.2, z).project(G.camera); return v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15; }
  spawn(prefer) {
    const G = this.G, P = G.player; let best = null, bs = -1;
    const nodes = [...G.world.spawns, ...G.world.hide];
    for (const n of nodes) {
      const d = Math.hypot(n.x - P.pos.x, n.z - P.pos.z); if (d < 16 || G.world.inTrain(n.x, n.z)) continue;
      if (this.canSeeFromCamera(n.x, n.z) && !lineBlocked(G.world.colliders, n.x, n.z, P.pos.x, P.pos.z)) continue;
      let s = d + rand(0, 8); if (prefer) s -= Math.hypot(n.x - prefer.x, n.z - prefer.z) * 0.5; if (s > bs) { bs = s; best = n; }
    }
    if (!best) return false;
    this.pos.set(best.x, 0, best.z); this.active = true; this.rig.root.visible = true; this.set('PATROL'); this.growlT = 5; return true;
  }
  despawn() { this.active = false; this.rig.root.visible = false; this.state = 'DORMANT'; this.eyeGlow.intensity = 0; }

  // ---- director orders: {act, x, z, tag}
  order(act, a = {}) {
    const P = this.G.player; this.orderTag = act;
    if (this.G.time < this.deadUntil && act !== 'despawn') return false;
    if (act === 'despawn') { this.despawn(); return true; }
    if (!this.active) { if (!this.spawn(a.x !== undefined ? a : null)) return false; }
    if (this.state === 'CHASE' || this.state === 'ATTACK') { if (act === 'retreat') { this.set('RETREAT'); return true; } return false; }
    switch (act) {
      case 'hunt': this.goal = { x: P.pos.x, z: P.pos.z }; this.set('INVESTIGATE'); this.hunting = true; break;
      case 'investigate': this.goal = { x: a.x ?? P.pos.x, z: a.z ?? P.pos.z }; this.set('INVESTIGATE'); this.hunting = false; break;
      case 'stalk': this.set('STALK'); this.stalkAngle = rand(-1, 1); break;
      case 'ambush': { const spot = this.ambushSpot(); if (!spot) return false; this.hideSpot = spot; this.goal = spot; this.set('AMBUSH'); break; }
      case 'retreat': this.set('RETREAT'); break;
      case 'hide': this.hideSpot = this.nearestHide(); this.goal = this.hideSpot; this.set('HIDE'); break;
      case 'pressure': this.set('STALK'); this.pressure = true; this.stalkAngle = rand(-1.4, 1.4); break;
      default: return false;
    }
    return true;
  }
  nearestHide(from = this.pos) { let b = null, bd = 1e9; for (const n of this.G.world.hide) { if (this.G.world.inTrain(n.x, n.z)) continue; const d = Math.hypot(n.x - from.x, n.z - from.z); if (d < bd) { bd = d; b = n; } } return b; }
  ambushSpot() {
    const P = this.G.player, f = { x: Math.sin(P.yaw), z: Math.cos(P.yaw) }; let b = null, bs = 1e9;
    for (const n of this.G.world.hide) { const dx = n.x - P.pos.x, dz = n.z - P.pos.z, d = Math.hypot(dx, dz); if (d < 7 || d > 22 || this.G.world.inTrain(n.x, n.z)) continue; const ahead = (dx * f.x + dz * f.z) / d; const s = Math.abs(d - 12) - ahead * 6; if (s < bs) { bs = s; b = n; } }
    return b;
  }

  // ---- perception
  hear(e) {
    if (!this.active || this.state === 'CHASE' || this.state === 'ATTACK' || this.state === 'RETREAT') return;
    const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z); if (d > e.r || e.src === 'creature') return;
    this.sound = { x: e.x, z: e.z, loud: e.r }; this.soundT = 0;
    if (this.state === 'PATROL' || this.state === 'HIDE' || this.state === 'STALK' || (this.state === 'INVESTIGATE' && !this.hunting)) { this.goal = { x: e.x, z: e.z }; if (this.state !== 'STALK') this.set('INVESTIGATE'); this.G.events.emit('creatureHeard', e); }
  }
  sees() {
    const G = this.G, P = G.player; if (P.dead || P.inTrain) return false;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let range = P.flashOn ? 26 : P.crouch ? 6 : 11; if (P.sprinting) range += 6; if (G.world.powered) range += 3;
    if (d > range) return false;
    if (d > 3.2 && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) > 1.15) return false;
    return !lineBlocked(G.world.colliders, this.pos.x, this.pos.z, P.pos.x, P.pos.z, 1.2);
  }
  flareNear(r) { for (const F of this.G.flares) if (Math.hypot(F.x - this.pos.x, F.z - this.pos.z) < r) return F; return null; }

  // ---- movement along nav path
  goTo(x, z, speed, dt, opts = {}) {
    const G = this.G; this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) {
      this.path = G.nav.findPath(this.pos.x, this.pos.z, x, z, { forCreature: true, ...opts }) || []; this.pi = 0; this.repath = opts.fast ? 0.35 : 0.9;
    }
    while (this.pi < this.path.length && Math.hypot(this.path[this.pi].x - this.pos.x, this.path[this.pi].z - this.pos.z) < 0.45) this.pi++;
    const n = this.path[this.pi]; if (!n) { this.speed = damp(this.speed, 0, 8, dt); return true; }
    const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), speed > 4 ? 10 : 6, dt); this.speed = damp(this.speed, speed, 6, dt);
    const nx = this.pos.x + (dx / d) * this.speed * dt, nz = this.pos.z + (dz / d) * this.speed * dt;
    const r = resolveMove(G.world.colliders, nx, nz, 0.38); this.pos.x = r.x; this.pos.z = r.z;
    if (G.world.inTrain(this.pos.x, this.pos.z)) { const T = G.world.trainBox; this.pos.x = T.x1 + 0.6; }
    return this.pi >= this.path.length;
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (!this.active) { this.threat = damp(this.threat, 0, 2, dt); return; }
    if (!this.alive) { this.speed = 0; this.threat = damp(this.threat, 0, 2, dt); this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; this.rig.update(dt); this.eyeGlow.intensity = 0; return; }
    this.t += dt; this.atkCool -= dt; this.flinchCool -= dt; this.mercy = Math.max(0, this.mercy - dt); this.soundT += dt; this.growlT -= dt;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz), face = Math.atan2(dx, dz);
    const sees = this.sees();
    if (sees) { this.aware += dt * (dist < 7 ? 2.2 : 1.1); this.lastSeen = { x: P.pos.x, z: P.pos.z }; this.lostT = 0; } else { this.aware = Math.max(0, this.aware - dt * 0.7); this.lostT += dt; }

    // light / flare fear
    const fl = this.flareNear(7);
    let lit = false; if (P.flashOn && dist < 10 && !lineBlocked(G.world.colliders, this.pos.x, this.pos.z, P.pos.x, P.pos.z, 1.2)) lit = Math.abs(angDiff(P.camYaw, face)) < 0.38;
    this.expose = lit ? this.expose + dt : Math.max(0, this.expose - dt * 1.5);
    if ((fl || this.expose > 1.6) && this.flinchCool <= 0 && this.state !== 'RETREAT' && this.state !== 'DORMANT') { this.flinchCool = fl ? 3 : 6; this.expose = 0; G.audio.screech(this.pos); this.set('RETREAT'); this.fled = true; }

    // transitions into chase
    if (this.aware > 0.9 && !['CHASE', 'ATTACK', 'RETREAT'].includes(this.state) && this.mercy <= 0 && !fl) { this.set('CHASE'); G.audio.screech(this.pos); G.events.emit('chaseStart'); }

    switch (this.state) {
      case 'PATROL': {
        if (!this.goal || this.t > 14 || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 1) { const h = pick(G.world.hide.filter((n) => !G.world.inTrain(n.x, n.z))); this.goal = h; this.t = 0; }
        this.goTo(this.goal.x, this.goal.z, 1.3, dt); break;
      }
      case 'INVESTIGATE': {
        const g = this.goal || this.lastSeen || { x: P.pos.x, z: P.pos.z };
        if (this.hunting) { if (this.t > 1.5 && this.t % 5 < dt) this.goal = { x: P.pos.x + rand(-4, 4), z: P.pos.z + rand(-4, 4) }; }
        const arrived = this.goTo(g.x, g.z, CFG.CREATURE.investigate * (this.hunting ? 1.15 : 1), dt);
        if (arrived || this.t > 22) { if (this.hunting && this.t < 40 && this.t > 1) { this.goal = { x: P.pos.x + rand(-5, 5), z: P.pos.z + rand(-5, 5) }; this.t = Math.max(this.t, 4); this.hunting = this.t < 35; } else { this.set('PATROL'); this.hunting = false; this.goal = null; } }
        break;
      }
      case 'STALK': {
        const want = this.pressure ? 11 : 14, a = face + Math.PI + this.stalkAngle * 0.8;
        // hover at a ring around the player, preferably out of the flashlight
        const tx = P.pos.x + Math.sin(a) * want, tz = P.pos.z + Math.cos(a) * want;
        if (dist > want + 2) this.goTo(tx, tz, CFG.CREATURE.stalk * 1.15, dt); else { this.speed = damp(this.speed, 0, 4, dt); this.yaw = dampAngle(this.yaw, face, 3, dt); }
        if (this.growlT <= 0) { G.audio.breath(this.pos); this.growlT = rand(6, 11); }
        if (this.pressure && this.t > 14) { this.pressure = false; this.set('RETREAT'); }
        if (this.t > 30) { this.pressure = false; this.set('RETREAT'); }
        break;
      }
      case 'AMBUSH': {
        const h = this.hideSpot || this.goal; const dh = Math.hypot(h.x - this.pos.x, h.z - this.pos.z);
        if (dh > 1.0 && this.t < 20) this.goTo(h.x, h.z, 1.9, dt);
        else { this.speed = damp(this.speed, 0, 6, dt); this.yaw = dampAngle(this.yaw, face, 2, dt); if (dist < 5.2 || this.t > 45 || (this.aware > 0.4 && dist < 9)) { this.set('CHASE'); G.audio.screech(this.pos); G.events.emit('chaseStart'); this.aware = 1; } }
        break;
      }
      case 'CHASE': {
        if (P.inTrain) { // never enters the train: wait outside the door and scratch
          const w = G.world.trainBox, gx = w.x1 + 1.1, gz = clamp(P.pos.z, w.z0 + 1, w.z1 - 1);
          const arrived = this.goTo(gx, gz, CFG.CREATURE.chase * 0.8, dt); this.scratchT -= dt;
          if (arrived) { this.yaw = dampAngle(this.yaw, Math.PI / 2 * -1, 8, dt); if (this.scratchT <= 0) { this.scratchT = rand(1.2, 2.2); G.audio.clang(3); G.noise(this.pos.x, this.pos.z, 8, 'creature'); } }
          if (this.t > 10) this.set('RETREAT'); break;
        }
        const tgt = sees ? { x: P.pos.x, z: P.pos.z } : (this.lastSeen || { x: P.pos.x, z: P.pos.z });
        this.goTo(tgt.x, tgt.z, CFG.CREATURE.chase * (sees ? 1 : 0.85), dt, { fast: true });
        if (dist < 1.5 && sees && this.atkCool <= 0) { this.set('ATTACK'); this.lungeDone = false; this.rig.once('Punch_Cross', { fade: 0.06, timeScale: 1.1 }); G.audio.growl(this.pos, 1); }
        if (!sees && this.lostT > 6) { this.set('INVESTIGATE'); this.goal = this.lastSeen; this.hunting = false; }
        if (this.t > 38) this.set('RETREAT');
        break;
      }
      case 'ATTACK': {
        this.speed = damp(this.speed, 0, 14, dt); this.yaw = dampAngle(this.yaw, face, 14, dt);
        if (!this.lungeDone && this.t > 0.32) { this.lungeDone = true; if (dist < 2.0 && !P.inTrain) { const hit = P.hurt(CFG.CREATURE.damage, this.pos); if (hit) { this.mercy = P.hp < 35 ? 25 : 12; G.events.emit('playerHit'); } } }
        if (this.t > 0.75) { this.atkCool = 1.4; if (P.downed || P.hp < 40 || this.mercy > 0) this.set('RETREAT'); else this.set('CHASE'); }
        break;
      }
      case 'RETREAT': {
        if (!this.goal || this.t < 0.05) { let far = null, bd = -1; for (const n of [...G.world.spawns, ...G.world.hide]) { if (G.world.inTrain(n.x, n.z)) continue; const d = Math.hypot(n.x - P.pos.x, n.z - P.pos.z); const out = !lineBlocked(G.world.colliders, n.x, n.z, P.pos.x, P.pos.z); if (d > bd && d < 40 && !(out && d < 20)) { bd = d; far = n; } } this.goal = far || this.nearestHide(); }
        const arrived = this.goTo(this.goal.x, this.goal.z, CFG.CREATURE.retreat, dt);
        if (arrived || this.t > 9) { this.aware = 0; this.set('HIDE'); this.hideSpot = this.goal; }
        break;
      }
      case 'HIDE': {
        this.speed = damp(this.speed, 0, 6, dt); this.yaw = dampAngle(this.yaw, face, 1.2, dt);
        if (this.t > 12 && !this.canSeeFromCamera(this.pos.x, this.pos.z) && dist > 18 && this.orderTag !== 'ambush') { this.set('PATROL'); this.goal = null; }
        break;
      }
    }
    // animation
    const rig = this.rig; if (!rig.busy) { const s = this.speed; if (s < 0.2) rig.play('Idle_Loop', { fade: 0.3 }); else if (s < 2) rig.play('Walk_Loop', { timeScale: clamp(s / 1.45, 0.5, 1.4), fade: 0.3 }); else if (s < 4) rig.play('Jog_Fwd_Loop', { timeScale: clamp(s / 3.5, 0.7, 1.5), fade: 0.2 }); else rig.play('Sprint_Loop', { timeScale: clamp(s / 5.6, 0.8, 1.5), fade: 0.2 }); }
    rig.root.position.copy(this.pos); rig.root.rotation.y = this.yaw; rig.update(dt);
    this.eyeGlow.intensity = this.state === 'CHASE' || this.state === 'ATTACK' ? 1.6 : 0.5;
    // distance-based visibility: hide inside lit-less dark? (keep visible; darkness handles it)
    // threat for audio / HUD
    const tgt = this.state === 'CHASE' || this.state === 'ATTACK' ? 1 : clamp(1 - dist / 30, 0, 0.7) * (this.state === 'HIDE' || this.state === 'PATROL' ? 0.5 : 1);
    this.threat = damp(this.threat, tgt, 2.5, dt); G.audio.fear = clamp(this.threat + (this.state === 'CHASE' ? 0.3 : 0), 0, 1);
    // footstep sound
    if (this.speed > 0.6) { this._st = (this._st || 0) - dt * this.speed; if (this._st <= 0) { this._st = 1.7; G.audio.step('concrete', clamp(this.speed / 5, 0.2, 1), this.pos); } }
    if (this.state === 'CHASE' && this.growlT <= 0) { G.audio.growl(this.pos, 0.7); this.growlT = rand(2.5, 4); }
    if ((P.dead) && this.state === 'CHASE') this.set('RETREAT');
  }
  snapshot() {
    const P = this.G.player; const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    return { state: this.active ? this.state : 'DORMANT', dist: Math.round(d), visible: this.active && this.sees(), mercy: Math.round(this.mercy) };
  }
}
