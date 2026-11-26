// Character rig: clones the Quaternius mannequin, tints it, plays whole clips with cross-fades.
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp } from './util.js';

export async function loadUAL(url, onProgress) {
  return new Promise((res) => {
    new GLTFLoader().load(url, (g) => res(g), (e) => { if (e.total) onProgress?.(e.loaded / e.total); }, (err) => { console.warn('[assets] could not load', url, err); res(null); });
  });
}

export const loadGLB = loadUAL;
const ALIAS = {
  // canonical (mannequin / UAL) names -> Soldier.glb clip names
  soldier: { Idle_Loop: 'Idle', Idle_Torch_Loop: 'Idle_Gun', Walk_Loop: 'Walk', Jog_Fwd_Loop: 'Run', Sprint_Loop: 'Run', Crouch_Idle_Loop: 'Idle_Gun', Crouch_Fwd_Loop: 'Walk', Fixing_Kneeling: 'Interact', PickUp_Table: 'Interact', Hit_Chest: 'HitRecieve', Hit_Head: 'HitRecieve_2', Death01: 'Death', Punch_Cross: 'Punch_Right', Punch_Jab: 'Punch_Left', Sitting_Idle_Loop: 'Idle_Neutral', Idle_Talking_Loop: 'Idle_Neutral' },
  // Soldier names -> mannequin clips (used when Soldier.glb is missing and the mannequin stands in)
  ual: { Idle: 'Idle_Loop', Walk: 'Walk_Loop', Run: 'Jog_Fwd_Loop', Run_Back: 'Walk_Loop', Run_Left: 'Jog_Fwd_Loop', Run_Right: 'Jog_Fwd_Loop', Idle_Gun: 'Pistol_Idle_Loop', Idle_Gun_Pointing: 'Pistol_Aim_Neutral', Idle_Gun_Shoot: 'Pistol_Shoot', Gun_Shoot: 'Pistol_Shoot', Run_Shoot: 'Jog_Fwd_Loop', HitRecieve: 'Hit_Chest', HitRecieve_2: 'Hit_Head', Death: 'Death01', Punch_Right: 'Punch_Cross', Punch_Left: 'Punch_Jab', Kick_Right: 'Punch_Cross', Kick_Left: 'Punch_Jab', Idle_Neutral: 'Idle_Loop', Wave: 'Idle_Talking_Loop' },
};
const NOMINAL = { Walk_Loop: 1.45, Jog_Fwd_Loop: 3.5, Sprint_Loop: 5.6, Crouch_Fwd_Loop: 1.25 };

export class Rig {
  constructor(gltf, { tint = 0x6b7a64, height = 1.78, rough = 0.75, metal = 0.0, emissive = 0x000000, emissiveI = 0, facing = 0, scaleXZ = 1, keepTex = false, tintMix = 0.42 } = {}) {
    this.root = new THREE.Group(); this.facing = facing; this.cur = null; this.busy = false; this.timeScale = 1; this.fallback = !gltf;
    this.actions = {}; this.clips = {}; this.clock = 0; this.shootUntil = 0; this.kind = 'ual'; this.alias = ALIAS.ual;
    if (gltf) {
      this.model = skClone(gltf.scene);
      this.model.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const nm = mats.map((m) => { const c = m.clone(); if (keepTex && c.color) c.color.lerp(new THREE.Color(tint), tintMix); else c.color = new THREE.Color(tint); if (!keepTex) { c.roughness = rough; c.metalness = metal; } if (emissiveI) { c.emissive = new THREE.Color(emissive); c.emissiveIntensity = emissiveI; } return c; });
          o.material = Array.isArray(o.material) ? nm : nm[0];
        }
      });
      this.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.model, true), sz = box.getSize(new THREE.Vector3());
      const s = sz.y > 0.01 ? height / sz.y : 1;
      this.model.scale.setScalar(s); this.model.scale.x *= scaleXZ; this.model.scale.z *= scaleXZ;
      this.model.position.y = -box.min.y * s;
      this.pivot = new THREE.Group(); this.pivot.add(this.model); this.pivot.rotation.y = facing; this.root.add(this.pivot);
      this.mixer = new THREE.AnimationMixer(this.model);
      gltf.animations.forEach((c) => { this.clips[c.name] = c; });
      if (this.clips.Idle_Gun || this.clips.HitRecieve) { this.kind = 'soldier'; this.alias = ALIAS.soldier; }
      this.bones = {}; this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    } else {
      this._buildFallback(tint, height);
    }
  }

  _buildFallback(tint, h) {
    const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.8 }), g = new THREE.Group();
    const add = (geo, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
    add(new THREE.BoxGeometry(0.45, 0.62, 0.24), 0, h * 0.62, 0); add(new THREE.SphereGeometry(0.12, 12, 10), 0, h * 0.9, 0);
    this.legL = add(new THREE.BoxGeometry(0.16, 0.8, 0.16), -0.12, 0.4, 0); this.legR = add(new THREE.BoxGeometry(0.16, 0.8, 0.16), 0.12, 0.4, 0);
    add(new THREE.BoxGeometry(0.12, 0.6, 0.12), -0.3, h * 0.62, 0); add(new THREE.BoxGeometry(0.12, 0.6, 0.12), 0.3, h * 0.62, 0);
    this.pivot = g; this.root.add(g); this.bones = {}; this._t = 0;
  }

  res(n) { if (this.clips[n]) return n; const a = this.alias[n]; return a && this.clips[a] ? a : null; }
  has(n) { return !!this.res(n); }
  _act(name) {
    if (this.actions[name]) return this.actions[name];
    const clip = this.clips[name]; if (!clip) return null;
    const a = this.mixer.clipAction(clip); this.actions[name] = a; return a;
  }
  play(name, { fade = 0.22, timeScale = 1, loop = true } = {}) {
    if (this.fallback) { this.cur = name; this.timeScale = timeScale; return; }
    name = this.res(name); if (!name) return;
    const a = this._act(name); if (!a) return;
    if (this.cur === name && this.actions[name]?.isRunning()) { a.timeScale = timeScale; return; }
    a.reset(); a.enabled = true; a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.timeScale = timeScale; a.setEffectiveWeight(1);
    const prev = this.cur && this.actions[this.cur];
    if (prev && prev !== a) { a.crossFadeFrom(prev, fade, false); } else a.fadeIn(fade);
    a.play(); this.cur = name;
  }
  // one-shot clip, returns a promise that resolves when it ends. hold keeps last pose.
  once(name, { fade = 0.12, timeScale = 1, hold = false, cut = 0 } = {}) {
    return new Promise((res) => {
      const real = this.res(name);
      if (this.fallback || !real) { this.busy = true; setTimeout(() => { this.busy = false; res(); }, 450); return; }
      this.busy = true; this.play(real, { fade, timeScale, loop: false });
      const a = this.actions[real], dur = a.getClip().duration / Math.abs(timeScale), done = () => { this.busy = false; res(); };
      clearTimeout(this._onceT); this._onceT = setTimeout(done, Math.max(100, (dur - cut) * 1000));
      void hold;
    });
  }
  cancelOnce() { clearTimeout(this._onceT); this.busy = false; }
  // choose locomotion clip from planar speed
  locomote(speed, { crouch = false, torch = false, sprint = false } = {}) {
    if (this.busy) return;
    let name, ts = 1;
    if (crouch) { name = speed > 0.15 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'; if (speed > 0.15) ts = clamp(speed / NOMINAL.Crouch_Fwd_Loop, 0.6, 1.4); }
    else if (speed < 0.15) name = torch && this.has('Idle_Torch_Loop') ? 'Idle_Torch_Loop' : 'Idle_Loop';
    else if (speed < 2.7) { name = 'Walk_Loop'; ts = clamp(speed / NOMINAL.Walk_Loop, 0.6, 1.5); }
    else if (speed < 4.8 && !sprint) { name = 'Jog_Fwd_Loop'; ts = clamp(speed / NOMINAL.Jog_Fwd_Loop, 0.7, 1.4); }
    else { name = 'Sprint_Loop'; ts = clamp(speed / NOMINAL.Sprint_Loop, 0.7, 1.3); }
    this.play(name, { fade: 0.24, timeScale: ts });
  }
  fire() { this.shootUntil = this.clock + 0.16; }
  // soldier-style locomotion with strafing: fwd/rgt are the movement components relative to the body facing
  locomoteDir(speed, { fwd = 1, rgt = 0, crouch = false, sprint = false, armed = true, aim = false } = {}) {
    if (this.busy) return;
    if (this.kind !== 'soldier') { this.locomote(speed, { crouch, torch: armed, sprint }); return; }
    const shooting = this.clock < this.shootUntil; let name, ts = 1;
    if (speed > 0.3) {
      if (shooting) name = 'Run_Shoot';
      else if (Math.abs(rgt) > Math.abs(fwd) * 1.15) name = rgt > 0 ? 'Run_Right' : 'Run_Left';
      else if (fwd < -0.1) name = 'Run_Back';
      else name = speed < 2.7 || crouch ? 'Walk' : 'Run';
      ts = clamp(speed / (name === 'Walk' ? 1.7 : 4.2), 0.55, 1.7);
    } else if (shooting) name = aim ? 'Gun_Shoot' : 'Idle_Gun_Shoot';
    else name = armed ? (aim ? 'Idle_Gun_Pointing' : 'Idle_Gun') : 'Idle';
    this.play(name, { fade: 0.14, timeScale: ts });
  }
  update(dt) {
    this.clock += dt;
    if (this.mixer) this.mixer.update(dt);
    else if (this.fallback && this.legL) { this._t += dt * 8 * (this.timeScale || 1); const sw = Math.sin(this._t) * (this.cur && /Walk|Jog|Sprint|Crouch_Fwd/.test(this.cur) ? 0.5 : 0); this.legL.rotation.x = sw; this.legR.rotation.x = -sw; }
  }
  // Attach something to a bone, but positioned/oriented from an offset in model space (robust to unknown bone axes)
  attach(boneName, obj, offset = new THREE.Vector3()) {
    const b = this.bones[boneName]; if (!b) { this.pivot.add(obj); obj.position.copy(offset); return; }
    this.root.updateMatrixWorld(true);
    const wp = this.root.localToWorld(offset.clone()); b.worldToLocal(wp); obj.position.copy(wp);
    const qb = new THREE.Quaternion(), qm = new THREE.Quaternion(); b.getWorldQuaternion(qb); this.root.getWorldQuaternion(qm);
    obj.quaternion.copy(qb.invert().multiply(qm)); b.add(obj);
  }
  setVisible(v) { this.root.visible = v; }
  dispose() { this.mixer?.stopAllAction(); }
}
