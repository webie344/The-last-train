// Third-person player: movement, camera, stamina, flashlight, noise, items, health.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { CFG } from './config.js';
import { clamp, damp, dampAngle, angDiff, resolveMove, seg3HitsBox, blocksActor } from './util.js';

const ORDER = ['flare', 'medkit', 'battery', 'bottle'];

export class Player {
  constructor(G, gltf) {
    this.G = G; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.camYaw = 0; this.camPitch = 0.28;
    this.hp = CFG.PLAYER.hp; this.stamina = CFG.PLAYER.stamina; this.exhausted = false; this.staminaDelay = 0;
    this.crouch = false; this.sprinting = false; this.flashOn = false; this.battery = 100; this.rolling = 0; this.rollDir = new THREE.Vector3();
    this.inv = { fuel: 0, medkit: 1, battery: 1, flare: 2, bottle: 2, keycard: 0, scrap: 0 }; this.selected = 'flare';
    this.downed = false; this.dead = false; this.downT = 0; this.busy = false; this.inTrain = true; this.stepT = 0; this.noiseLevel = 0; this.noiseRadius = 0; this.hurtCool = 0;
    this.lastHit = -99; this.speed = 0; this.camDist = 3.1; this.shake = 0; this.tmpV = new THREE.Vector3(); this.docs = []; this.stats = { steps: 0, hits: 0, flares: 0, noise: 0 };
    this.rig = new Rig(gltf, { tint: 0x5f6d5a, height: CFG.PLAYER.height, rough: 0.8 });
    G.scene.add(this.rig.root);
    // flashlight
    this.light = new THREE.SpotLight(0xfff0d0, 0, 26, 0.52, 0.55, 1.5); this.light.castShadow = G.settings.quality !== 'low'; this.light.shadow.mapSize.set(G.settings.quality === 'high' ? 1024 : 512, G.settings.quality === 'high' ? 1024 : 512); this.light.shadow.bias = -0.0004; this.light.shadow.camera.near = 0.3; this.light.shadow.camera.far = 26;
    G.scene.add(this.light, this.light.target);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 12, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.cone.geometry.translate(0, -6, 0); this.cone.geometry.rotateX(Math.PI / 2); G.scene.add(this.cone);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.6, roughness: 0.4 })); torch.rotation.x = Math.PI / 2; torch.position.set(-0.22, 1.18, 0.28); this.rig.root.add(torch);
    this.flares = G.flares = []; this.thrown = [];
    this.rig.play('Idle_Loop');
  }
  get forward() { return this.tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  teleport(p, yaw = 0) { this.pos.copy(p); this.yaw = yaw; this.camYaw = yaw; this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; }

  noise(r, tag = 'player') { this.G.noise(this.pos.x, this.pos.z, r, tag); this.noiseLevel = Math.max(this.noiseLevel, clamp(r / 14, 0, 1)); this.stats.noise++; }

  setFlash(on, silent) {
    if (on && this.battery <= 0) { this.G.ui.notify('Battery dead', 'battery'); on = false; }
    this.flashOn = on; this.G.ui.toggleState('btnFlash', on); if (!silent) this.G.audio.flashlight(on);
  }
  toggleFlash() { if (!this.dead && !this.downed) this.setFlash(!this.flashOn); }
  toggleCrouch() { if (this.busy || this.rolling > 0 || this.downed) return; this.crouch = !this.crouch; this.G.ui.toggleState('btnCrouch', this.crouch); }
  roll() {
    if (this.busy || this.rolling > 0 || this.downed || this.dead || this.stamina < 18) return;
    const f = this.forward.clone(), i = this.G.input.poll ? this._lastMove : null;
    if (i && i.mag > 0.2) { const s = Math.sin(this.camYaw), c = Math.cos(this.camYaw); this.rollDir.set(s * i.my + -c * i.mx, 0, c * i.my + s * i.mx).normalize(); } else this.rollDir.copy(f);
    this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z); this.stamina -= 18; this.staminaDelay = 1; this.rolling = 0.62; this.crouch = false; this.G.ui.toggleState('btnCrouch', false);
    this.rig.once('Roll', { fade: 0.08, timeScale: 1.15 }); this.G.audio.roll(); this.noise(CFG.NOISE.roll);
  }
  interactAnim(name = 'Interact') { if (this._ia !== name) { this._ia = name; this.rig.play(name, { fade: 0.15 }); } this.busy = true; this._iaT = 0.25; }
  cancelInteractAnim() { this._ia = null; this.busy = false; }

  select(k) { if (ORDER.includes(k)) { this.selected = k; this.G.ui.setSlots(this.inv, this.selected); } }
  selectIndex(i) { this.select(ORDER[i]); }
  useItem(k = this.selected) {
    if (this.dead || this.downed || this.busy) return;
    if (!(this.inv[k] > 0)) { this.G.audio.beep(false); return; }
    if (k === 'medkit') { if (this.hp >= 99) { this.G.ui.notify('Already healthy', 'check'); return; } this.inv.medkit--; this.busy = true; this.G.ui.notify('Treating wounds...', 'medkit'); this.rig.once('Fixing_Kneeling', { timeScale: 1.4 }); setTimeout(() => { this.heal(55); this.busy = false; }, 1500); }
    else if (k === 'battery') { if (this.battery > 85) { this.G.ui.notify('Battery is full', 'check'); return; } this.inv.battery--; this.battery = clamp(this.battery + 65, 0, 100); this.G.audio.pickup(); this.G.ui.notify('Battery swapped', 'battery'); }
    else if (k === 'flare') { this.inv.flare--; this.throwItem('flare'); this.stats.flares++; }
    else if (k === 'bottle') { this.inv.bottle--; this.throwItem('bottle'); }
    this.G.ui.setSlots(this.inv, this.selected); this.G.save?.();
  }
  add(k, n = 1) { this.inv[k] = (this.inv[k] || 0) + n; this.G.ui.setSlots(this.inv, this.selected); }
  heal(n) { this.hp = clamp(this.hp + n, 0, 100); this.G.audio.heal(); this.G.ui.setHealth(this.hp); }

  throwItem(kind) {
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)), p = new THREE.Vector3(this.pos.x + f.x * 0.4, 1.4, this.pos.z + f.z * 0.4);
    const mesh = new THREE.Mesh(kind === 'flare' ? new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8) : new THREE.CylinderGeometry(0.04, 0.05, 0.22, 8), new THREE.MeshStandardMaterial({ color: kind === 'flare' ? 0xd23a22 : 0x3a6a4a, roughness: 0.5, emissive: kind === 'flare' ? 0xff5522 : 0, emissiveIntensity: 1 }));
    mesh.position.copy(p); this.G.scene.add(mesh);
    this.rig.once('Interact', { timeScale: 2.2 });
    this.thrown.push({ kind, mesh, p, v: f.multiplyScalar(kind === 'flare' ? 6.5 : 8).setY(kind === 'flare' ? 2.6 : 3.4), t: 0 });
    this.G.audio.roll();
  }
  updateThrown(dt) {
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const T = this.thrown[i]; T.t += dt; T.v.y -= 9.8 * dt;
      const np = T.p.clone().addScaledVector(T.v, dt); let hit = false;
      for (const b of this.G.world.colliders) { if (b.active === false || b.low) continue; if (seg3HitsBox(T.p.x, T.p.y, T.p.z, np.x, np.y, np.z, b) !== null) { hit = true; break; } }
      if (hit) { T.v.x *= -0.2; T.v.z *= -0.2; T.v.y = Math.abs(T.v.y) * 0.2; } else T.p.copy(np);
      if (T.p.y < 0.06) { T.p.y = 0.06; T.v.multiplyScalar(0.35); if (T.v.length() < 0.8 || T.t > 3) { this.landed(T); this.thrown.splice(i, 1); continue; } T.v.y = Math.abs(T.v.y) * 0.4; }
      T.mesh.position.copy(T.p); T.mesh.rotation.x += dt * 9;
    }
  }
  landed(T) {
    this.G.scene.remove(T.mesh);
    if (T.kind === 'bottle') { this.G.audio.bottle(T.p); this.G.noise(T.p.x, T.p.z, CFG.NOISE.bottle, 'bottle'); T.mesh.geometry.dispose(); }
    else {
      const light = new THREE.PointLight(0xff5a2a, 0, 16, 1.6); light.position.set(T.p.x, 0.5, T.p.z); this.G.scene.add(light);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.G.glowTex, color: 0xff6a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sprite.scale.setScalar(1.8); sprite.position.set(T.p.x, 0.35, T.p.z); this.G.scene.add(sprite);
      T.mesh.position.set(T.p.x, 0.06, T.p.z); T.mesh.rotation.set(0, 0, Math.PI / 2); this.G.scene.add(T.mesh);
      this.flares.push({ x: T.p.x, z: T.p.z, life: 40, light, sprite, mesh: T.mesh, r: 7 }); this.G.audio.flare(); this.G.noise(T.p.x, T.p.z, 6, 'flare');
    }
  }
  updateFlares(dt) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const F = this.flares[i]; F.life -= dt; const k = clamp(F.life / 4, 0, 1), fl = 0.85 + Math.random() * 0.3;
      F.light.intensity = 38 * k * fl; F.sprite.material.opacity = k; F.sprite.scale.setScalar((1.6 + Math.random() * 0.4) * (0.5 + k * 0.5));
      if (F.life <= 0) { [F.light, F.sprite, F.mesh].forEach((o) => this.G.scene.remove(o)); this.flares.splice(i, 1); }
    }
  }

  hurt(amount, from) {
    if (this.dead || this.downed || this.rolling > 0.3) return false;
    this.hp = Math.max(0, this.hp - amount); this.lastHit = this.G.time; this.stats.hits++; this.shake = 0.5;
    this.G.ui.hurt(clamp(amount / 40, 0.35, 0.9)); this.G.audio.hurt(); this.G.input.buzz(40); this.G.ui.setHealth(this.hp); this.noise(CFG.NOISE.hurt, 'hurt');
    this.busy = false; this.cancelInteractAnim(); this.rig.once('Hit_Chest', { fade: 0.06 });
    if (from) { const d = Math.atan2(from.x - this.pos.x, from.z - this.pos.z); this.vel.x -= Math.sin(d) * 3; this.vel.z -= Math.cos(d) * 3; }
    if (this.hp <= 0) this.down();
    return true;
  }
  down() {
    this.downed = true; this.downT = 15; this.setFlash(false, true); this.rig.cancelOnce(); this.rig.play('Death01', { loop: false, fade: 0.1 });
    this.G.ui.setDowned(true, 1, 'You are down. Mara is coming...'); this.G.events.emit('downed');
  }
  revive(hp = 40) { if (!this.downed) return; this.downed = false; this.hp = hp; this.G.ui.setDowned(false); this.G.ui.setHealth(hp); this.rig.cancelOnce(); this.rig.play('Idle_Loop', { fade: 0.4 }); this.G.audio.heal(); this.G.ui.notify('Back on your feet', 'heart'); this.G.events.emit('revived'); }
  die() { this.dead = true; this.G.ui.setDowned(false); this.G.events.emit('died'); }

  update(dt) {
    const G = this.G, inp = G.input.poll(); this._lastMove = inp;
    if (inp.lookX || inp.lookY) { this.camYaw -= inp.lookX; this.camPitch = clamp(this.camPitch + inp.lookY, -0.35, 1.0); }
    this.updateThrown(dt); this.updateFlares(dt);
    this.noiseLevel = damp(this.noiseLevel, 0, 1.4, dt);
    if (this._iaT !== undefined) { this._iaT -= dt; if (this._iaT <= 0 && this._ia) { this._ia = null; this.busy = false; this._iaT = undefined; } }
    if (this.downed) {
      this.downT -= dt; G.ui.setDowned(true, this.downT / 15); this.vel.set(0, 0, 0);
      if (this.downT <= 0) { this.downed = false; this.die(); }
    } else if (!this.dead) this.move(dt, inp);
    this.vel.multiplyScalar(Math.exp(-6 * dt)); this.hurtCool -= dt;
    // flashlight battery
    if (this.flashOn) { this.battery -= dt * 0.9; if (this.battery <= 8 && Math.random() < dt * (10 - this.battery)) this._fl = 0.12; if (this.battery <= 0) { this.battery = 0; this.setFlash(false); G.ui.notify('Flashlight died. Use a battery.', 'battery'); } }
    this._fl = Math.max(0, (this._fl || 0) - dt);
    this.updateLight(dt); this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; this.rig.update(dt);
    this.inTrain = G.world.inTrain(this.pos.x, this.pos.z);
    G.ui.setHealth(this.hp); G.ui.setStamina(this.stamina);
  }

  move(dt, inp) {
    const G = this.G, busy = this.busy;
    let sp = 0, wish = this.tmpV.set(0, 0, 0);
    if (this.rolling > 0) { this.rolling -= dt; wish.copy(this.rollDir); sp = 5.8 * clamp(this.rolling / 0.62 + 0.3, 0.3, 1); }
    else if (!busy && inp.mag > 0.08) {
      const s = Math.sin(this.camYaw), c = Math.cos(this.camYaw); wish.set(s * inp.my + -c * inp.mx, 0, c * inp.my + s * inp.mx); if (wish.lengthSq() > 0) wish.normalize();
      const m = clamp(inp.mag, 0, 1), P = CFG.PLAYER;
      this.sprinting = inp.sprint && !this.crouch && this.stamina > 4 && !this.exhausted && m > 0.5;
      sp = this.crouch ? P.crouch * m : this.sprinting ? P.sprint : m < 0.55 ? P.walk * (m / 0.55 + 0.25) : P.jog * (0.8 + 0.2 * (m - 0.55) / 0.45);
      if (this.flashOn && !this.sprinting && !this.crouch) sp *= 0.95;
    } else this.sprinting = false;
    // stamina
    if (this.sprinting) { this.stamina -= 17 * dt; this.staminaDelay = 0.9; if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; G.ui.notify('Out of breath', 'run'); } }
    else { this.staminaDelay -= dt; if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + 15 * dt); if (this.exhausted && this.stamina > 28) this.exhausted = false; }
    const tvx = wish.x * sp, tvz = wish.z * sp, k = this.rolling > 0 ? 30 : 10;
    this.vel.x = damp(this.vel.x, tvx, k, dt); this.vel.z = damp(this.vel.z, tvz, k, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const B = G.world.bounds; nx = clamp(nx, B.x0, B.x1); nz = clamp(nz, B.z0, B.z1);
    const r = resolveMove(G.world.colliders, nx, nz, CFG.PLAYER.radius, (b) => b.low && this.rolling <= 0 && false);
    this.speed = Math.hypot(r.x - this.pos.x, r.z - this.pos.z) / Math.max(dt, 1e-4); this.pos.x = r.x; this.pos.z = r.z; this.pos.y = 0;
    // facing
    if (!busy) { if (this.rolling > 0) { /* locked */ } else if (this.speed > 0.2 && wish.lengthSq() > 0) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 12, dt); else if (this.flashOn && Math.abs(angDiff(this.yaw, this.camYaw)) > 0.6) this.yaw = dampAngle(this.yaw, this.camYaw, 5, dt); }
    else if (this._ia && G.interact?.current) { const o = G.interact.current; this.yaw = dampAngle(this.yaw, Math.atan2(o.x - this.pos.x, o.z - this.pos.z), 8, dt); }
    // animation
    if (this.rolling <= 0 && !this.busy) this.rig.locomote(this.speed, { crouch: this.crouch, torch: this.flashOn, sprint: this.sprinting });
    // footsteps + noise
    if (this.speed > 0.4 && this.rolling <= 0) {
      this.stepT -= dt * this.speed; if (this.stepT <= 0) {
        this.stepT = 1.45; const N = CFG.NOISE, r2 = this.crouch ? N.crouch : this.sprinting ? N.sprint : this.speed > 2.9 ? N.jog : N.walk;
        G.audio.step(G.world.zoneAt(this.pos.x, this.pos.z) === 'train' ? 'metal' : 'concrete', this.crouch ? 0.35 : this.sprinting ? 1 : 0.65, this.pos); this.noise(r2); this.stats.steps++;
      }
    }
  }

  updateLight(dt) {
    const L = this.light, on = this.flashOn && !this.dead && !this.downed, fl = this._fl > 0 ? 0.15 : 1;
    L.intensity = damp(L.intensity, on ? 70 * fl * (0.55 + 0.45 * clamp(this.battery / 25, 0, 1)) : 0, 24, dt);
    this.cone.material.opacity = damp(this.cone.material.opacity, on ? 0.055 * fl : 0, 20, dt); this.cone.visible = this.cone.material.opacity > 0.002;
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)), pitch = -(this.camPitch - 0.3) * 0.9;
    const o = new THREE.Vector3(this.pos.x - f.z * 0.25 + f.x * 0.2, this.crouch ? 0.95 : 1.4, this.pos.z + f.x * 0.25 + f.z * 0.2);
    L.position.copy(o); L.target.position.set(o.x + f.x * 8, o.y + pitch * 8 - 0.4, o.z + f.z * 8); L.target.updateMatrixWorld();
    this.cone.position.copy(o); this.cone.lookAt(L.target.position);
  }

  // camera: over-the-shoulder with collision pull-in
  updateCamera(dt) {
    const G = this.G, cam = G.camera, h = this.crouch ? 1.15 : 1.5;
    const tgt = new THREE.Vector3(this.pos.x, h, this.pos.z); const side = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw)); tgt.addScaledVector(side, 0.55);
    const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), -Math.cos(this.camYaw) * Math.cos(this.camPitch));
    let dist = 3.1 + (this.sprinting ? 0.4 : 0);
    const end = tgt.clone().addScaledVector(dir, dist + 0.25);
    for (const b of G.world.colliders) { if (b.active === false || b.y0 > 3.6) continue; const t = seg3HitsBox(tgt.x, tgt.y, tgt.z, end.x, end.y, end.z, b); if (t !== null) dist = Math.min(dist, Math.max(0.5, t * (dist + 0.25) - 0.2)); }
    if (end.y < 0.25) dist = Math.min(dist, (tgt.y - 0.25) / Math.max(0.01, -dir.y));
    this.camDist = damp(this.camDist, dist, dist < this.camDist ? 22 : 4, dt);
    const pos = tgt.clone().addScaledVector(dir, this.camDist);
    if (this.shake > 0) { this.shake -= dt; pos.x += (Math.random() - 0.5) * this.shake * 0.12; pos.y += (Math.random() - 0.5) * this.shake * 0.12; }
    if (this.dead) { /* hold */ }
    cam.position.copy(pos); cam.lookAt(tgt.x, tgt.y + 0.05, tgt.z);
    const fov = 62 + (this.sprinting ? 6 : 0) + (this.downed ? -8 : 0); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 6, dt); cam.updateProjectionMatrix(); }
  }
}
export { ORDER as ITEM_ORDER, blocksActor };
