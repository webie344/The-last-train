// Raiders: armed hostile survivors. They patrol, hear gunfire, spot you, take firing positions, burst-fire, reload, search and can be killed.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { Weapon, GUN } from './combat.js';
import { clamp, damp, dampAngle, angDiff, resolveMove, lineBlocked, rand, pick } from './util.js';

const SPOT = ['Contact!', 'There he is!', 'Over here!', 'I see him!', 'Hostile spotted!'];
const RELOAD = ['Reloading!', 'Cover me, reloading!'];
const SEARCH = ['Where did he go?', 'Find him!', 'Check the corners.', 'He is close.'];
const HURT = ['Argh!', 'He got me!', 'I am hit!'];
const HEARD = ['Did you hear that?', 'Gunfire! Move!', 'Check the noise.'];

let UID = 1;
export class Raider {
  constructor(G, gltf, rifleGltf, x, z, patrol = []) {
    this.G = G; this.id = UID++; this.pos = new THREE.Vector3(x, 0, z); this.yaw = rand(0, 6.28); this.hp = 100; this.alive = true; this.state = 'PATROL'; this.t = 0; this.name = 'Raider';
    const soldier = !!(gltf && gltf.animations && gltf.animations.some((a) => a.name === 'Idle_Gun'));
    this.rig = new Rig(gltf, { tint: soldier ? 0xa8573a : 0x8a4a38, keepTex: soldier, tintMix: 0.55, height: soldier ? 1.85 : 1.8, facing: G.modelYaw || 0 });
    G.scene.add(this.rig.root); this.weapon = new Weapon(G, this.rig, rifleGltf);
    this.patrol = patrol.length ? patrol : [{ x, z }]; this.pi = 0; this.path = []; this.ni = 0; this.repath = 0; this.goal = null; this.speed = 0; this.vel = new THREE.Vector3();
    this.mag = GUN.mag; this.reloadT = 0; this.burst = 0; this.shotT = 0; this.cool = rand(0.5, 1.2); this.react = 0; this.aware = 0; this.lostT = 0; this.last = null; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = rand(0.8, 2); this.flinchCool = 0;
    this.pitch = 0.9 + Math.random() * 0.4; this.aimPitch = 0; this._mz = new THREE.Vector3(); this.pauseT = 0; this.sawPlayer = false; this.pickup = null;
    this.rig.root.position.copy(this.pos); this.rig.play('Idle_Gun');
    G.noiseBus.on('noise', (e) => this.hear(e));
  }
  bark(list, key, cool = 5, speak = true) { const P = this.G.player, d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z); this.G.combat.say('Raider', pick(list), { cool, key: key + (key === 'rSpot' ? '' : this.id), speak: speak && d < 38, pitch: this.pitch * 0.62 }); }

  hear(e) {
    if (!this.alive || this.state === 'COMBAT') return;
    const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z); if (d > e.r * 0.85) return;
    if (e.src === 'raider' && d > 22) return;
    this.goal = { x: e.x + rand(-2, 2), z: e.z + rand(-2, 2) }; if (this.state !== 'ALERT') { this.state = 'ALERT'; this.t = 0; this.path = []; if (e.src !== 'raider') this.bark(HEARD, 'rHeard', 8); }
  }
  sees() {
    const G = this.G, P = G.player; if (P.dead || P.downed || P.inTrain) return false;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let range = P.flashOn ? 38 : P.crouch ? 9 : 17; if (P.sprinting) range += 8; if (G.world.powered) range += 8; if (G.time - P.lastShot < 1.5) range += 14;
    if (d > range) return false;
    if (d > 4 && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) > 1.25) return false;
    return !lineBlocked(G.world.colliders, this.pos.x, this.pos.z, P.pos.x, P.pos.z, 1.2);
  }
  goTo(x, z, speed, dt, fast = false) {
    const G = this.G; this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) { this.path = G.nav.findPath(this.pos.x, this.pos.z, x, z, { forCreature: true }) || []; this.ni = 0; this.repath = fast ? 0.5 : 1; }
    while (this.ni < this.path.length && Math.hypot(this.path[this.ni].x - this.pos.x, this.path[this.ni].z - this.pos.z) < 0.5) this.ni++;
    const n = this.path[this.ni]; if (!n) { this.speed = damp(this.speed, 0, 8, dt); return true; }
    this.move(n.x - this.pos.x, n.z - this.pos.z, speed, dt, true); return false;
  }
  move(dx, dz, speed, dt, face) {
    const d = Math.hypot(dx, dz) || 1; if (face) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
    this.speed = damp(this.speed, speed, 7, dt); this.vel.set(dx / d * this.speed, 0, dz / d * this.speed);
    const r = resolveMove(this.G.world.colliders, this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt, 0.38); const moved = Math.hypot(r.x - this.pos.x, r.z - this.pos.z); this.pos.x = r.x; this.pos.z = r.z;
    if (this.G.world.inTrain(this.pos.x, this.pos.z)) this.pos.x = this.G.world.trainBox.x1 + 0.6; return moved;
  }

  damage(d, info = {}) {
    if (!this.alive) return; const G = this.G; this.hp -= d; this.react = 0.25; G.audio.flesh(this.pos);
    if (info.from === G.player || this.state !== 'COMBAT') { this.state = 'COMBAT'; this.t = 0; this.aware = 1; this.last = { x: G.player.pos.x, z: G.player.pos.z }; this.sawPlayer = true; }
    if (this.hp <= 0) { this.die(info); return; }
    if ((d >= 30 || Math.random() < 0.3) && this.flinchCool <= 0 && !info.melee) { this.flinchCool = 1.2; this.rig.once(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2', { fade: 0.05 }); this.burst = 0; this.cool = Math.max(this.cool, 0.5); }
    if (info.melee) { this.rig.once('HitRecieve', { fade: 0.05 }); this.cool = 1; this.burst = 0; }
    if (Math.random() < 0.35) this.bark(HURT, 'rHurt', 3);
  }
  die(info = {}) {
    const G = this.G; this.alive = false; this.hp = 0; this.state = 'DEAD'; this.rig.cancelOnce(); this.rig.play('Death', { loop: false, fade: 0.08 }); this.weapon.root.visible = false; G.audio.hitTick(true);
    G.events.emit('enemyDown', { raider: this, head: !!info.head });
    const x = this.pos.x, z = this.pos.z, n = 30 + (Math.random() < 0.4 ? 15 : 0);
    this.pickup = G.interact.add({ id: 'ammo' + this.id, x, z, radius: 1.5, label: 'Take ammo (+' + n + ')', short: 'LOOT', icon: 'box', hold: 0.6, anim: 'PickUp_Table', once: true, onUse: () => { G.player.addAmmo(n); G.noise(x, z, 3, 'pickup'); } });
  }

  update(dt) {
    const G = this.G, P = G.player; this.t += dt; this.flinchCool -= dt; this.react = Math.max(0, this.react - dt); this.cool -= dt; this.shotT -= dt;
    if (!this.alive) { this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; this.rig.update(dt); return; }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz), face = Math.atan2(dx, dz);
    const sees = this.sees();
    if (sees) { this.aware += dt * (dist < 9 ? 2.4 : 1.3); this.last = { x: P.pos.x, z: P.pos.z }; this.lostT = 0; } else { this.aware = Math.max(0, this.aware - dt * 0.4); this.lostT += dt; }
    if (this.aware >= 0.7 && this.state !== 'COMBAT' && !P.dead) {
      this.state = 'COMBAT'; this.t = 0; this.react = 0.45; this.cool = 0.4; this.burst = 0; this.path = [];
      this.bark(SPOT, 'rSpot', 3.5); if (!this.sawPlayer) { this.sawPlayer = true; G.input.pattern('alert'); G.audio.blip?.(); G.events.emit('raiderSpotted', this); }
      for (const o of G.raiders) if (o !== this && o.alive && o.state !== 'COMBAT' && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 22) { o.goal = { x: P.pos.x, z: P.pos.z }; o.state = 'ALERT'; o.t = 0; o.path = []; }
    }
    let fwdMove = 0, rgtMove = 0;
    switch (this.state) {
      case 'PATROL': {
        if (this.pauseT > 0) { this.pauseT -= dt; this.speed = damp(this.speed, 0, 8, dt); break; }
        const w = this.patrol[this.pi % this.patrol.length]; if (this.goTo(w.x, w.z, 1.5, dt)) { this.pi++; this.pauseT = rand(1.5, 4); }
        fwdMove = 1; break;
      }
      case 'ALERT': {
        const g = this.goal || this.last; if (!g) { this.state = 'PATROL'; break; }
        const arrived = this.goTo(g.x, g.z, 3.0, dt); fwdMove = 1;
        if (arrived || this.t > 18) { this.state = 'SEARCH'; this.t = 0; this.bark(SEARCH, 'rSearch', 8, false); }
        break;
      }
      case 'SEARCH': {
        this.speed = damp(this.speed, 0, 6, dt); this.yaw += Math.sin(this.t * 1.3) * dt * 1.4;
        if (this.t > 7) { this.state = 'PATROL'; this.goal = null; }
        break;
      }
      case 'COMBAT': {
        if (P.dead || P.downed && this.t > 0) { if (P.dead) { this.state = 'PATROL'; break; } }
        const los = sees || (this.lostT < 1.2);
        if (!sees && this.lostT > 4) { this.state = 'ALERT'; this.goal = this.last; this.t = 0; this.bark(SEARCH, 'rSearch', 8); break; }
        this.yaw = dampAngle(this.yaw, sees ? face : this.yaw, 10, dt);
        if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = GUN.mag; this.speed = damp(this.speed, 0, 8, dt); break; }
        // movement: close in when far / no line, back off when close, otherwise strafe
        if (!this.last) this.last = { x: P.pos.x, z: P.pos.z };
        if (!sees || dist > 17) { this.goTo(this.last.x, this.last.z, 3.4, dt, true); fwdMove = 1; }
        else if (dist < 6.5) { const m = this.move(-dx, -dz, 2.3, dt, false); fwdMove = -1; void m; }
        else {
          this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = rand(0.9, 2.2); }
          const sx = -dz / dist * this.strafe, sz = dx / dist * this.strafe, moved = this.move(sx, sz, 1.9, dt, false); if (moved < 0.2 * dt) this.strafe = -this.strafe; rgtMove = this.strafe;
        }
        // shooting
        if (sees && this.react <= 0 && this.cool <= 0 && !this.rig.busy) {
          if (this.burst <= 0) { this.burst = 3 + Math.floor(Math.random() * 4); }
          if (this.shotT <= 0 && this.burst > 0) { if (this.mag > 0) this.fire(dist); else { this.reloadT = 2.3; this.burst = 0; this.bark(RELOAD, 'rReload', 5); G.audio.mag('out'); } }
          if (this.burst <= 0) this.cool = rand(1.1, 2.3);
        }
        break;
      }
    }
    // animation + weapon
    const sv = Math.max(this.speed, 1e-3), fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const fwd = this.state === 'COMBAT' ? (this.vel.x * fx + this.vel.z * fz) / sv : 1, rgt = this.state === 'COMBAT' ? (this.vel.x * -fz + this.vel.z * fx) / sv : 0; void fwdMove; void rgtMove;
    if (!this.rig.busy) this.rig.locomoteDir(this.speed, { fwd, rgt, armed: true, aim: this.state === 'COMBAT' });
    this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; this.rig.update(dt);
    const dd = Math.hypot(this.pos.x - P.pos.x, this.pos.z - P.pos.z);
    this.weapon.update(dt, { yaw: this.yaw, pitch: this.aimPitch, show: dd < 60 && !this.rig.busy, reloading: this.reloadT > 0, sprint: false });
    if (this.speed > 0.6) { this._st = (this._st || 0) - dt * this.speed; if (this._st <= 0) { this._st = 1.7; G.audio.step('concrete', clamp(this.speed / 4, 0.2, 0.8), this.pos); } }
  }
  fire(dist) {
    const G = this.G, P = G.player, mz = this.weapon.muzzlePos(this._mz);
    const aim = new THREE.Vector3(P.pos.x + rand(-0.12, 0.12), (P.crouch ? 0.85 : 1.25) + rand(-0.15, 0.15), P.pos.z + rand(-0.12, 0.12));
    const dir = aim.sub(mz).normalize(); this.aimPitch = Math.asin(clamp(dir.y, -0.7, 0.7));
    const spread = (0.022 + dist * 0.0017) * (P.speed > 2 ? 1.25 : 1) * (P.crouch ? 0.8 : 1) * (P.sprinting ? 1.15 : 1);
    this.mag--; this.burst--; this.shotT = 0.15; this.rig.fire(); this.weapon.kick = 0.04; G.audio.shot(this.pos, false);
    const hit = G.combat.shoot(this, mz, dir, { dmg: 6, spread, range: 60, tracerColor: 0xff9a6a, flashColor: 0xff8a50, noise: 16 });
    if (!hit.who || hit.who !== P) { const dp = Math.hypot(hit.point.x - P.pos.x, hit.point.z - P.pos.z); if (dp < 2.2) { G.audio.whiz?.({ x: hit.point.x, y: 1.4, z: hit.point.z }); if (dp < 1.2) G.input.pattern('shot'); } }
    if (this.mag <= 0) { this.burst = 0; }
  }
}
