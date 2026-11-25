// Mara, the AI companion. Nav-based follow/stay/interact/defend, warns about the creature, revives the player,
// and occasionally makes human mistakes.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { clamp, damp, dampAngle, resolveMove, rand, pick } from './util.js';

export class Companion {
  constructor(G, gltf) {
    this.G = G; this.pos = new THREE.Vector3(); this.yaw = 0; this.mode = 'follow'; this.down = false; this.speed = 0; this.path = []; this.pi = 0; this.repath = 0; this.stayAt = null;
    this.task = null; this.taskT = 0; this.warnCool = 0; this.flareCool = 12; this.mistakeT = rand(50, 90); this.reviveT = 0; this.talkCool = 0; this.freeze = 0; this.flares = 2; this.visible = true; this.idleLine = rand(40, 70);
    this.rig = new Rig(gltf, { tint: 0x8a4a3c, height: 1.68, rough: 0.8 });
    G.scene.add(this.rig.root); this.rig.play('Idle_Loop');
    const lamp = new THREE.PointLight(0xffd9a0, 0, 5, 2); lamp.position.set(0, 1.4, 0.3); this.rig.root.add(lamp); this.lamp = lamp;
  }
  say(text, speak = false, cool = 2.5) { if (this.talkCool > 0) return; this.talkCool = cool; this.G.ui.subtitle('Mara', text); if (speak) this.G.audio.speak(text, { rate: 1.02, pitch: 1.25 }); }
  command(c) {
    const G = this.G, P = G.player; this.mode = c; this.task = null; G.ui.showWheel(false, c);
    const lines = { follow: ['On your six.', 'Right behind you.'], stay: ['Holding here. Be quick.', 'I will wait. Do not be long.'], interact: ['I will see what I can find.', 'Checking around.'], defend: ['I have your back.', 'Eyes open. I am watching.'] };
    this.talkCool = 0; this.say(pick(lines[c]), true, 1);
    if (c === 'stay') this.stayAt = { x: this.pos.x, z: this.pos.z };
    G.events.emit('command', c); G.ui.notify('Mara: ' + c.toUpperCase(), c === 'stay' ? 'stay' : c === 'defend' ? 'shield' : c === 'interact' ? 'gear' : 'follow');
  }
  teleportTo(x, z) { this.pos.set(x, 0, z); this.path = []; this.rig.root.position.copy(this.pos); }
  goTo(x, z, speed, dt) {
    const G = this.G; this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) { this.path = G.nav.findPath(this.pos.x, this.pos.z, x, z) || []; this.pi = 0; this.repath = 0.7; }
    while (this.pi < this.path.length && Math.hypot(this.path[this.pi].x - this.pos.x, this.path[this.pi].z - this.pos.z) < 0.4) this.pi++;
    const n = this.path[this.pi]; if (!n) { this.speed = damp(this.speed, 0, 8, dt); return true; }
    const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 9, dt); this.speed = damp(this.speed, speed, 7, dt);
    const r = resolveMove(G.world.colliders, this.pos.x + dx / d * this.speed * dt, this.pos.z + dz / d * this.speed * dt, 0.34); this.pos.x = r.x; this.pos.z = r.z; return false;
  }
  update(dt) {
    const G = this.G, P = G.player, C = G.creature; this.talkCool -= dt; this.warnCool -= dt; this.flareCool -= dt; this.mistakeT -= dt; this.idleLine -= dt;
    const dP = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    const creatureD = C.active ? Math.hypot(C.pos.x - this.pos.x, C.pos.z - this.pos.z) : 999, creatureP = C.active ? Math.hypot(C.pos.x - P.pos.x, C.pos.z - P.pos.z) : 999;
    let want = null, sp = 0;
    // warnings
    if (C.active && this.warnCool <= 0 && ['CHASE', 'STALK', 'AMBUSH'].includes(C.state) && creatureD < 16) { this.warnCool = 14; this.say(C.state === 'CHASE' ? 'It is coming! Run!' : pick(['Something is watching us.', 'I heard it. Close.']), true, 0); }
    // freeze mistake: panics when creature is close
    if (this.freeze > 0) { this.freeze -= dt; this.speed = damp(this.speed, 0, 10, dt); }
    else if (P.downed && !P.dead) {
      if (creatureD < 5) { want = { x: this.pos.x, z: this.pos.z }; this.maybeFlare(); }
      else { const near = dP < 1.2; if (!near) { want = { x: P.pos.x, z: P.pos.z }; sp = 4.6; } else { this.reviveT += dt; this.rig.play('Fixing_Kneeling', { fade: 0.2 }); this.speed = 0; this.yaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z); G.ui.setDowned(true, P.downT / 15, 'Mara is helping you up...'); if (this.reviveT > 3.2) { this.reviveT = 0; P.revive(45); this.say('Got you. Move!', true, 0); } } }
    } else {
      this.reviveT = 0;
      if (this.mode === 'follow') { const behind = { x: P.pos.x - Math.sin(P.yaw) * 2.4 + Math.cos(P.yaw) * 0.9, z: P.pos.z - Math.cos(P.yaw) * 2.4 - Math.sin(P.yaw) * 0.9 }; if (dP > 3.2) { want = behind; sp = dP > 9 ? 5.2 : dP > 5.5 ? 3.7 : 1.9; } }
      else if (this.mode === 'stay') { const s = this.stayAt || this.pos; if (Math.hypot(s.x - this.pos.x, s.z - this.pos.z) > 0.6) { want = s; sp = 2; } }
      else if (this.mode === 'defend') {
        if (C.active && creatureP < 22) { const t = { x: P.pos.x + (C.pos.x - P.pos.x) * 0.22, z: P.pos.z + (C.pos.z - P.pos.z) * 0.22 }; if (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 1) { want = t; sp = 3.4; } this.maybeFlare(); }
        else if (dP > 4) { want = { x: P.pos.x, z: P.pos.z }; sp = dP > 8 ? 4.5 : 2.2; }
      } else if (this.mode === 'interact') this.runTask(dt, (x, z, s) => { want = { x, z }; sp = s; });
      // mistake
      if (this.mistakeT <= 0 && this.speed > 1.5 && G.mission.threatOn && !G.world.inTrain(this.pos.x, this.pos.z)) { this.mistakeT = rand(70, 130); if (Math.random() < 0.7) { G.noise(this.pos.x, this.pos.z, 10, 'mara'); G.audio.clang(4); this.say('Sorry! Tripped on something.', true, 0); } else { this.freeze = rand(1.2, 2); this.say('I... I cannot move. Give me a second.', true, 0); } }
      if (!want && this.idleLine <= 0 && !C.active && dP < 6) { this.idleLine = rand(60, 110); this.say(pick(['Do you ever think about the surface?', 'It is too quiet down here.', 'My dad worked on these lines. Before.', 'Keep the light low. It hates light.']), true); }
    }
    if (want && sp > 0 && this.freeze <= 0) {
      if (this.goTo(want.x, want.z, sp, dt)) { this.speed = damp(this.speed, 0, 8, dt); }
      if (sp > 4.8 && Math.random() < dt * 0.4) G.noise(this.pos.x, this.pos.z, 5, 'mara');
    } else if (this.freeze <= 0) this.speed = damp(this.speed, 0, 8, dt);
    if (!this.rig.busy && this.reviveT === 0 && !(this.mode === 'interact' && this.task && this.taskT > 0)) this.rig.locomote(this.speed);
    this.lamp.intensity = G.world.inTrain(this.pos.x, this.pos.z) || G.world.powered ? 0 : 1.6;
    this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = this.yaw; this.rig.update(dt);
  }
  maybeFlare() {
    const G = this.G, C = G.creature; if (this.flareCool > 0 || this.flares <= 0 || !C.active) return;
    const d = Math.hypot(C.pos.x - this.pos.x, C.pos.z - this.pos.z); if (d > 14 || d < 3) return;
    this.flares--; this.flareCool = 30; this.say('Back off!', true, 0); G.audio.flare();
    const f = { x: this.pos.x + (C.pos.x - this.pos.x) * 0.6, z: this.pos.z + (C.pos.z - this.pos.z) * 0.6 };
    G.player.landed({ kind: 'flare', mesh: new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 6), new THREE.MeshBasicMaterial({ color: 0xd23a22 })), p: new THREE.Vector3(f.x, 0.06, f.z) });
  }
  runTask(dt, go) {
    const G = this.G; if (!this.task) { this.task = G.mission.nextHelp(this.pos); this.taskT = 0; if (!this.task) { this.say('Nothing left here to search.', false, 6); this.mode = 'follow'; return; } this.say('I will check the ' + this.task.name + '.', true, 1); }
    const t = this.task, d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
    if (d > 1.1 && this.taskT === 0) { go(t.x, t.z, 2.6); return; }
    this.taskT += dt; this.speed = damp(this.speed, 0, 10, dt); this.yaw = dampAngle(this.yaw, Math.atan2(t.x - this.pos.x, t.z - this.pos.z), 8, dt); this.rig.play('PickUp_Table', { fade: 0.2, timeScale: 0.8 });
    if (this.taskT > 3.2) { t.done = true; this.task = null; this.taskT = 0; t.onDone?.(); this.rig.play('Idle_Loop'); }
  }
}
