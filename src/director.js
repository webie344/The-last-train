// AI Director client. Groq proposes a strategic action (through /api/director); this module validates it against a
// whitelist, the threat budget and mercy rules, and falls back to a local scoring director when Groq is unavailable.
import { CFG } from './config.js';
import { clamp, rand } from './util.js';

export const ACTIONS = ['none', 'hunt', 'investigate', 'stalk', 'ambush', 'retreat', 'hide', 'pressure'];
const COST = { none: 0, hunt: 40, investigate: 10, stalk: 5, ambush: 30, retreat: 0, hide: 0, pressure: 8 };

export class Director {
  constructor(G) {
    this.G = G; this.budget = 35; this.cap = 100; this.enabled = false; this.timer = 4; this.inflight = false; this.backoff = 0; this.lastAction = 'none'; this.lastOrderT = -99; this.source = 'local';
    this.quiet = 0; this.log = []; this.failures = 0; this.lastEncounter = -99; this.online = null;
    G.events.on('playerHit', () => { this.lastEncounter = G.time; });
    G.events.on('chaseStart', () => { this.lastEncounter = G.time; this.budget = Math.max(0, this.budget - 10); });
  }
  state() {
    const G = this.G, P = G.player, c = G.creature.snapshot();
    return { phase: G.mission.phase, playerHp: Math.round(P.hp), stamina: Math.round(P.stamina), flashlight: P.flashOn, inTrain: P.inTrain, crouching: P.crouch, sprinting: P.sprinting, noise: +P.noiseLevel.toFixed(2),
      zone: G.world.zoneAt(P.pos.x, P.pos.z), powerOn: G.world.powered, objectivesDone: G.mission.progress(), creature: c.state, creatureDist: c.dist, creatureSeesPlayer: c.visible, mercy: c.mercy,
      secondsSinceAttack: Math.min(999, Math.round(G.time - P.lastHit)), secondsSinceEncounter: Math.min(999, Math.round(G.time - this.lastEncounter)), threatBudget: Math.round(this.budget), lastAction: this.lastAction, flares: P.inv.flare, companionAlive: !G.companion.down };
  }
  valid(action) {
    const G = this.G, P = G.player, c = G.creature;
    if (!ACTIONS.includes(action)) return false;
    if (action === 'none') return true;
    if (COST[action] > this.budget) return false;
    if (G.time - this.lastOrderT < 6 && action !== 'retreat') return false;
    const mercy = c.mercy > 0 || P.hp < 35 || P.downed || G.time - P.lastHit < 10;
    if (mercy && !['retreat', 'hide', 'stalk'].includes(action)) return false;
    if (P.inTrain && !['stalk', 'retreat', 'hide'].includes(action)) return false;
    if (!G.mission.threatOn) return false;
    if ((action === 'hunt' || action === 'ambush') && G.time - this.lastEncounter < 25) return false;
    if (action === 'ambush' && !c.ambushSpot()) return false;
    return true;
  }
  apply(action, source, reason = '') {
    const G = this.G; if (action === 'none') return false;
    if (!G.creature.order(action)) return false;
    this.budget = clamp(this.budget - COST[action], 0, this.cap); this.lastAction = action; this.lastOrderT = G.time; this.source = source;
    this.log.unshift({ t: Math.round(G.time), action, source, reason }); this.log.length = Math.min(this.log.length, 6); G.events.emit('director', { action, source, reason }); return true;
  }
  localChoice() {
    const G = this.G, P = G.player, c = G.creature, s = c.snapshot(), since = G.time - this.lastEncounter;
    const mercy = c.mercy > 0 || P.hp < 35 || G.time - P.lastHit < 10;
    if (mercy) return s.state === 'CHASE' || s.state === 'ATTACK' || (s.dist < 14 && c.active) ? 'retreat' : 'none';
    const cand = [];
    if (!c.active || s.state === 'PATROL' || s.state === 'HIDE') {
      if (P.noiseLevel > 0.55 && this.budget >= 40 && since > 30) cand.push(['hunt', 3]);
      if (P.noiseLevel > 0.3 && this.budget >= 10) cand.push(['investigate', 3]);
      if (since > 40 && this.budget >= 30 && G.mission.phase !== 'prologue') cand.push(['ambush', 2]);
      if (since > 20 && this.budget >= 5) cand.push(['stalk', 3]);
      if (since > 60 && this.budget >= 8) cand.push(['pressure', 2]);
    }
    if (s.state === 'STALK' && s.dist < 8 && since > 10) cand.push(['retreat', 2]);
    cand.push(['none', 2]);
    const total = cand.reduce((a, b) => a + b[1], 0); let r = rand(0, total); for (const [a, w] of cand) { r -= w; if (r <= 0) return a; }
    return 'none';
  }
  async askGroq() {
    const G = this.G; if (!G.settings.director || this.backoff > 0 || !CFG.DIRECTOR_URL) return null;
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), CFG.DIRECTOR_TIMEOUT);
    try {
      const r = await fetch(CFG.DIRECTOR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.state()), signal: ctrl.signal });
      if (!r.ok) throw new Error('http ' + r.status); const j = await r.json(); this.failures = 0; this.online = true; return j;
    } catch (e) { this.failures++; this.online = false; this.backoff = Math.min(120, 20 * this.failures); return null; } finally { clearTimeout(to); }
  }
  async think() {
    if (this.inflight) return; this.inflight = true;
    try {
      const j = await this.askGroq();
      if (j && j.action && this.valid(j.action)) { if (this.apply(j.action, 'groq', j.reason)) return; }
      const a = this.localChoice(); if (this.valid(a)) this.apply(a, 'local', j ? 'groq rejected' : 'fallback');
    } finally { this.inflight = false; }
  }
  update(dt) {
    const G = this.G; this.backoff = Math.max(0, this.backoff - dt);
    if (!this.enabled || !G.mission.threatOn || G.player.dead) return;
    this.budget = clamp(this.budget + 3 * dt * (G.player.inTrain ? 0.3 : 1), 0, this.cap);
    this.timer -= dt; if (this.timer <= 0) { this.timer = CFG.DIRECTOR_INTERVAL / 1000 * rand(0.85, 1.2); this.think(); }
  }
}
