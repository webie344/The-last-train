// Chapter 1: The Abandoned Station. Objectives, pickups, generator, survivor, recording, departure and arrival.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { CFG } from './config.js';
import { clamp, pick } from './util.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Mission {
  constructor(G) {
    this.G = G; this.phase = 'boot'; this.threatOn = false; this.fuel = 0; this.generatorOn = false; this.survivorFound = false; this.recording = false; this.started = 0; this.helps = [];
    this.scareDone = false; this.travelT = 0; this.cells = []; this.ending = false; this.departReady = false; this.survivor = null; this.deaths = 0;
  }
  progress() { return { fuel: this.fuel + '/3', generator: this.generatorOn, survivor: this.survivorFound, recording: this.recording }; }
  nextHelp(pos) { let b = null, bd = 1e9; for (const h of this.helps) { if (h.done) continue; const d = Math.hypot(h.x - pos.x, h.z - pos.z); if (d < bd) { bd = d; b = h; } } return b; }
  say(who, text, speak = false) { this.G.ui.subtitle(who, text, Math.max(3200, text.length * 55)); if (speak) this.G.audio.speak(text, who === 'Mara' ? { rate: 1.02, pitch: 1.25 } : who === 'Radio' ? { rate: 0.85, pitch: 0.7 } : { rate: 0.88, pitch: 0.8 }); }
  async script(lines, gap = 400) { for (const [who, text, speak] of lines) { this.say(who, text, speak); await wait(Math.max(2600, text.length * 62) + gap); } }

  // ------------------------------------------------------------------ objectives
  refresh(announce = true) {
    const ph = this.phase; let title = 'Objectives', list = [];
    if (ph === 'prologue') { title = 'Departure'; list = [{ text: 'Reach the control compartment and start TR-09', done: false }]; }
    else if (ph === 'travel') { title = 'In transit'; list = [{ text: 'Wait for arrival at Kessler Street', done: false }]; }
    else if (['explore', 'generator', 'rescue', 'return'].includes(ph)) {
      title = 'Kessler Street';
      list = [{ text: 'Find fuel cells', count: 3, have: this.fuel, done: this.fuel >= 3 || this.generatorOn }, { text: 'Restore the generator', done: this.generatorOn }, { text: 'Search for survivors (security office)', done: this.survivorFound }, { text: 'Return to TR-09 and depart', done: ph === 'done' }];
    }
    this.G.ui.setObjective(title, list); this.list = list; void announce;
  }

  // ------------------------------------------------------------------ setup
  init() {
    const G = this.G, W = G.world, A = W.anchors, I = G.interact;
    // control console / departure
    I.add({ id: 'console', x: A.console.x, z: A.console.z, radius: 1.5, label: 'Start TR-09', short: 'DRIVE', icon: 'train', hold: 1.2, anim: 'Interact',
      enabled: () => this.phase === 'prologue' || (this.phase === 'return' && this.departReady), hidden: () => !(this.phase === 'prologue' || this.phase === 'return'),
      note: () => (this.phase === 'return' ? 'Leave Kessler Street' : ''), onUse: () => (this.phase === 'prologue' ? this.depart() : this.finish()) });
    // train utilities
    I.add({ id: 'medical', x: A.medical.x, z: A.medical.z, radius: 1.5, label: 'Treat wounds', short: 'HEAL', icon: 'medkit', hold: 2.4, anim: 'Fixing_Kneeling', enabled: () => G.player.hp < 99, note: () => (G.player.hp >= 99 ? 'You are fine' : 'Free in the medical bay'), onUse: () => { G.player.heal(100); G.ui.notify('Wounds treated', 'medkit'); G.save(); } });
    I.add({ id: 'workshop', x: A.workshop.x, z: A.workshop.z, radius: 1.6, label: 'Craft flare (2 scrap)', short: 'CRAFT', icon: 'wrench', hold: 2, anim: 'Fixing_Kneeling', enabled: () => G.player.inv.scrap >= 2, note: () => `Scrap ${G.player.inv.scrap}/2`, onUse: () => { G.player.inv.scrap -= 2; G.player.add('flare'); G.ui.notify('Crafted 1 flare', 'flare'); G.audio.pickup(); G.save(); } });
    I.add({ id: 'storage', x: A.storage.x, z: A.storage.z, radius: 1.5, label: 'Restock supplies', short: 'STOCK', icon: 'box', hold: 1.4, enabled: () => !this.stocked && this.phase !== 'prologue', hidden: () => this.stocked || this.phase === 'prologue' || this.phase === 'travel', onUse: () => { this.stocked = true; G.player.add('battery'); G.player.add('bottle'); G.ui.notify('Took battery and bottle', 'box'); G.audio.pickup(); } });
    // manual doors
    for (const D of [W.doorGR, W.doorMC]) I.add({ id: 'door_' + D.id, x: D.x, z: D.z, radius: 1.9, label: 'Open door', short: 'DOOR', icon: 'door', enabled: () => true, hidden: () => false, note: () => '', onUse: () => { D.target = D.target ? 0 : 1; G.noise(D.x, D.z, CFG.NOISE.door, 'door'); }, get label2() { return D.target ? 'Close door' : 'Open door'; } });
    I.list.filter((o) => o.id.startsWith('door_')).forEach((o) => { const D = W.doors.find((d) => 'door_' + d.id === o.id); Object.defineProperty(o, 'label', { get: () => (D.target ? 'Close door' : 'Open door') }); });
    // fuel cells
    const cellMat = new THREE.MeshStandardMaterial({ color: 0x143a22, emissive: 0x3bd16f, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.5 });
    [[A.kiosk.x, 1.0, 22.9, 'Kiosk'], [31.2, 1.27, A.lockerShelf.z, 'Locker room'], [A.booth.x, 1.18, -43.45, 'Ticket booth']].forEach(([x, y, z, where], i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.2), cellMat); m.position.set(x, y, z); G.scene.add(m);
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.glowTex, color: 0x3bd16f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); g.scale.setScalar(1.3); g.position.copy(m.position); G.scene.add(g);
      const pos = i === 0 ? A.kiosk : i === 1 ? A.lockerShelf : A.booth; const L = new THREE.PointLight(0x3bd16f, 0, 4, 2); L.position.set(x, y + 0.2, z); G.scene.add(L); L.intensity = 1.1;
      const c = { mesh: m, glow: g, light: L };
      this.cells.push(c);
      I.add({ id: 'cell' + i, x: pos.x, z: pos.z, radius: 1.6, label: 'Take fuel cell', short: 'TAKE', icon: 'cell', hold: 1.0, anim: 'PickUp_Table', once: true, enabled: () => this.phase !== 'prologue' && this.phase !== 'travel',
        onUse: () => { [m, g].forEach((o) => G.scene.remove(o)); G.scene.remove(L); this.fuel++; G.player.inv.fuel = this.fuel; G.audio.pickup(); G.noise(pos.x, pos.z, CFG.NOISE.pickup, 'pickup'); G.ui.notify(`Fuel cell ${this.fuel}/3 (${where})`, 'cell'); this.afterFuel(); } });
    });
    // generator
    const gen = A.generator;
    I.add({ id: 'generator', x: gen.x, z: gen.z, radius: 2, label: 'Insert fuel cells', short: 'START', icon: 'power', hold: 4, anim: 'Fixing_Kneeling', enabled: () => this.fuel >= 3 && !this.generatorOn, hidden: () => this.generatorOn || this.phase === 'prologue' || this.phase === 'travel',
      note: () => (this.fuel >= 3 ? 'This will be LOUD' : `Need 3 fuel cells (have ${this.fuel})`), onHold: (dt, p) => { this._gt = (this._gt || 0) - dt; if (this._gt <= 0) { this._gt = 0.7; G.noise(gen.x, gen.z, 22 + p * 10, 'generator'); G.audio.generator('crank'); } }, onUse: () => this.startGenerator() });
    // optional searchables (Mara can fetch these too)
    const search = [
      ['Locker', 24.4, -8.2, () => { G.player.add('medkit'); return 'Medkit'; }], ['Locker', 28.8, -8.2, () => { G.player.add('battery'); return 'Battery'; }], ['Locker', 29.7, -20, () => { G.player.add('flare', 2); return '2 flares'; }],
      ['Cabinet', 12.4, 10.6, () => { G.player.add('scrap', 3); return '3 scrap'; }], ['Vending machine', 8.4, 12, () => { G.player.add('bottle', 2); return '2 bottles'; }], ['Ticket drawer', 7.7, -42.4, () => { G.player.add('scrap', 2); return '2 scrap'; }], ['Bench bag', 6.2, 26.8, () => { G.player.add('flare'); return 'Flare'; }],
    ];
    search.forEach(([name, x, z, give], i) => {
      const h = { id: 'srch' + i, name: name.toLowerCase(), x, z, done: false, onDone: null }; this.helps.push(h);
      const take = () => { if (h.done && h.taken) return; h.done = true; h.taken = true; const got = give(); G.audio.pickup(); G.noise(x, z, CFG.NOISE.pickup, 'pickup'); G.ui.notify(`${name}: ${got}`, 'search'); I.remove(h.id); };
      h.onDone = () => { take(); this.say('Mara', 'Found something. It is yours.', false); };
      I.add({ id: h.id, x, z, radius: 1.4, label: 'Search ' + name.toLowerCase(), short: 'SEARCH', icon: 'search', hold: 1.1, anim: 'PickUp_Table', enabled: () => this.phase !== 'prologue' && this.phase !== 'travel', hidden: () => this.phase === 'prologue' || this.phase === 'travel', onUse: take });
    });
    // security door (powered)
    this.so = W.doorSO;
    // survivor
    const sv = A.cot; this.survivor = new Rig(G.gltf, { tint: 0x6d7580, height: 1.72, rough: 0.85 }); this.survivor.root.position.set(18.6, 0.45, sv.z); this.survivor.root.rotation.y = -Math.PI / 2; G.scene.add(this.survivor.root); this.survivor.play('Sitting_Idle_Loop');
    I.add({ id: 'survivor', x: sv.x, z: sv.z, radius: 2.2, label: 'Talk to survivor', short: 'TALK', icon: 'hand', once: true, enabled: () => this.phase !== 'prologue' && this.phase !== 'travel', hidden: () => !this.generatorOn || this.survivorFound, note: () => '', onUse: () => this.talkSurvivor() });
    I.add({ id: 'recording', x: A.radio.x, z: A.radio.z, radius: 1.8, label: 'Play recording', short: 'PLAY', icon: 'note', once: true, hidden: () => !this.generatorOn || this.recording, enabled: () => true, onUse: () => this.playRecording() });
    // first scare trigger near ticket hall
    G.events.on('died', () => { this.deaths++; });
  }

  afterFuel() {
    if (this.fuel === 1) this.say('Mara', 'One cell. We need two more. Stay quiet.', true);
    if (this.fuel === 3) { this.say('Mara', 'That is all three. The generator room is east of the platform.', true); this.G.ui.notify('Go to the generator room', 'power'); }
    this.refresh();
  }

  // ------------------------------------------------------------------ flow
  async begin(fresh = true) {
    const G = this.G, A = G.world.anchors; this.started = G.time; this.phase = 'prologue'; this.threatOn = false; G.director.enabled = false;
    G.world.setPower(false); G.audio.setPower(false); G.world.setMoving(false);
    G.world.trainDoors.forEach((d) => { d.locked = true; d.target = 0; });
    G.player.teleport(A.trainSpawn, Math.PI); G.companion.teleportTo(A.maraStart.x, A.maraStart.z); G.player.camYaw = Math.PI; this.refresh();
    if (fresh) { await wait(900); await this.script([['Mara', 'Hey. You awake? We are almost out of fuel.', true], ['Mara', 'Kessler Street still has a generator. Take us in from the control car.', true]]); G.ui.notify('Walk forward to the control compartment', 'train'); }
  }
  async depart() {
    const G = this.G; this.phase = 'travel'; this.refresh(); G.audio.trainDepart(); G.input.buzz(30);
    await G.ui.fade(1, 700); G.world.setMoving(true); G.audio.setMoving(true); G.audio.setZone('train'); await G.ui.fade(0, 900); G.player.shake = 1.2;
    await this.script([['Mara', 'Brakes are cold. Hold on.', true], ['Radio', '...all stations... Kessler Street... do not stop...', true], ['Mara', 'We have no choice. Fuel gauge is red.', true]], 300);
    await wait(2500); G.audio.brakes(); G.player.shake = 0.8; G.ui.notify('Arriving at Kessler Street', 'train'); await wait(3500);
    G.audio.setMoving(false); G.world.setMoving(false); G.world.trainDoors.forEach((d) => { d.locked = false; });
    this.phase = 'explore'; this.threatOn = true; G.director.enabled = true; G.director.budget = 25; this.refresh();
    await this.script([['Mara', 'Lights are dead. Find the fuel cells. I will be right behind you.', true], ['Mara', 'Use the wheel button for commands. Crouch if you hear anything.', false]]);
  }
  async startGenerator() {
    const G = this.G; this.generatorOn = true; this.phase = 'rescue'; G.audio.generator('start'); G.noise(G.world.anchors.generator.x, G.world.anchors.generator.z, CFG.NOISE.generator, 'generator'); G.input.buzz(50); G.player.shake = 0.8;
    await wait(900); G.world.setPower(true); G.audio.setPower(true); G.audio.alarm(true); this.so.locked = false; this.so.want = true; this.refresh();
    await wait(1200); G.audio.stinger(); setTimeout(() => G.audio.alarm(false), 7000);
    this.say('Mara', 'Power is on... and that sound carried. It heard us. Move!', true);
    await wait(4500); G.director.budget = 50; G.creature.order('hunt'); G.events.emit('chaseHint');
    await wait(2500); this.say('Mara', 'The security office door is live. Survivors would hide there.', true);
  }
  async talkSurvivor() {
    const G = this.G; this.phase = 'rescue'; this.survivorFound = true; this.refresh();
    await this.script([['Elias', 'You... you came. Thank God. Keep your voice down.', true], ['Elias', 'It stalks by sound. Light scares it, but only for a while.', true], ['Elias', 'Take the keycard. Then play the log on that radio. You need to know what the train is really for.', true]], 250);
    G.player.add('keycard'); G.ui.notify('Elias will meet you at TR-09', 'follow'); this.checkReturn();
  }
  async playRecording() {
    const G = this.G; this.recording = true; G.audio.radio(true);
    G.player.docs.push({ title: 'Station Log 09', text: 'PROJECT EXODUS moves survivors to the lower lines. TR-09 was never meant to stop here.' });
    await this.script([['Radio', 'Kessler Street log, day nine. Surface lost. They follow noise and warmth.', true], ['Radio', 'Project Exodus will evacuate the lower lines. Train TR-09 is the last carrier.', true], ['Radio', 'If you hear this... do not stop at the stations. It was never about the fuel.', true]], 200);
    G.audio.radio(false); G.ui.notify('Document added to inventory', 'note'); this.say('Mara', 'Exodus. My father mentioned that word once...', true); this.checkReturn();
  }
  checkReturn() { if (this.survivorFound && this.phase !== 'return' && this.phase !== 'done') { this.phase = 'return'; this.departReady = false; this.refresh(); this.G.ui.notify('Return to TR-09', 'train'); setTimeout(() => this.say('Mara', 'Now back to the train. Quietly.', true), 2500); } }
  async finish() {
    if (this.ending) return; const G = this.G; this.ending = true; this.phase = 'done'; this.threatOn = false; G.director.enabled = false; G.creature.despawn(); this.refresh();
    G.audio.trainDepart(); G.world.trainDoors.forEach((d) => { d.locked = true; d.target = 0; }); await G.ui.fade(1, 900); G.world.setMoving(true); G.audio.setMoving(true); G.audio.setZone('train'); await G.ui.fade(0, 700);
    await this.script([['Elias', 'Next stop is the lower lines. They are waiting.', true], ['Mara', 'We made it. For now.', true]], 200);
    const P = G.player, t = Math.round(G.time - this.started), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    await G.ui.card('The Abandoned Station', 'Chapter 1 complete', 3200);
    G.save({ complete: true, time: t }); G.ui.showEnd([['Time', `${mm}:${ss}`], ['Fuel cells', '3/3'], ['Survivor', 'Rescued'], ['Recording', this.recording ? 'Found' : 'Missed'], ['Times hit', P.stats.hits], ['Flares used', P.stats.flares], ['Downed', this.deaths]], () => G.restart());
  }
  update(dt) {
    const G = this.G, P = G.player; if (this.phase === 'return' && !this.departReady && P.inTrain) { this.departReady = true; G.ui.notify('Elias boards TR-09', 'check'); const s = G.world.anchors.trainSpawn; this.survivor.root.position.set(-4.7, 0, 11.5); this.survivor.root.rotation.y = Math.PI / 2; this.survivor.play('Sitting_Idle_Loop'); void s; this.refresh(); this.say('Mara', 'Everyone is aboard. Start the train.', true); }
    // first stalker sighting: scripted scare near the ticket hall
    if (!this.scareDone && this.threatOn && P.pos.z < -30 && !P.inTrain && this.phase !== 'prologue') { this.scareDone = true; G.audio.stinger(); G.audio.skitter({ x: 3, y: 1, z: -48 }); setTimeout(() => { G.creature.order('stalk'); this.say('Mara', 'Did you see that? Something is moving in the dark.', true); }, 1200); }
    this.cells.forEach((c) => { if (c.mesh.parent) { c.mesh.rotation.y += dt; c.mesh.position.y += Math.sin(G.time * 2 + c.mesh.position.x) * 0.0006; } });
    this.survivor?.update?.(dt);
    void clamp; void pick;
  }
}
