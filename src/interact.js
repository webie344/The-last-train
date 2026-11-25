// Contextual interaction registry. One big button, label changes with what you are facing.
import { angDiff } from './util.js';

export class Interactables {
  constructor(G) { this.G = G; this.list = []; this.current = null; this.holding = false; this.progress = 0; this.cool = 0; }
  add(o) { // {id,x,y,z,radius,label,icon,hold,enabled(),note(),onUse(),once,disabledLabel}
    o.radius = o.radius ?? 1.6; o.hold = o.hold ?? 0; o.icon = o.icon || 'hand'; o.enabled = o.enabled || (() => true); o.used = false;
    this.list.push(o); return o;
  }
  remove(id) { this.list = this.list.filter((o) => o.id !== id); }
  get(id) { return this.list.find((o) => o.id === id); }
  pick() {
    const p = this.G.player; if (!p || p.dead || p.downed || (p.busy && !p._ia)) return null;
    let best = null, bs = 1e9;
    for (const o of this.list) {
      if (o.hidden && o.hidden()) continue;
      const dx = o.x - p.pos.x, dz = o.z - p.pos.z, d = Math.hypot(dx, dz); if (d > o.radius) continue;
      const ang = Math.abs(angDiff(Math.atan2(dx, dz), p.yaw));
      const score = d + (d > 0.8 ? ang * 0.5 : 0); if (score < bs) { bs = score; best = o; }
    }
    return best;
  }
  press(down) {
    this.holding = down;
    if (!down) { this.progress = 0; this.G.ui.hold(0); this.G.player?.cancelInteractAnim?.(); return; }
    const o = this.current; if (!o) return;
    if (!o.hold && this.cool <= 0 && o.enabled()) { this.cool = 0.35; this.fire(o); }
  }
  fire(o) { this.progress = 0; this.G.ui.hold(0); if (o.once) o.used = true; o.onUse(o); this.G.audio?.click(); }
  update(dt) {
    this.cool -= dt;
    const o = this.pick();
    if (o !== this.current) { this.progress = 0; this.G.ui.hold(0); this.current = o; }
    if (!o) { this.G.ui.setPrompt(null); return; }
    const ok = o.enabled(), used = o.used && o.once;
    if (used) { this.G.ui.setPrompt(null); return; }
    this.G.ui.setPrompt({ label: ok ? o.label : (o.disabledLabel || o.label), icon: o.icon, short: o.short, hold: !!o.hold, disabled: !ok, note: o.note ? o.note() : (ok ? '' : (o.blockedNote ? o.blockedNote() : '')) });
    if (this.holding && ok && o.hold) {
      this.progress += dt / o.hold; this.G.ui.hold(Math.min(1, this.progress)); this.G.player?.interactAnim?.(o.anim || 'Interact');
      if (o.onHold) o.onHold(dt, this.progress);
      if (this.progress >= 1) { this.holding = false; this.fire(o); }
    } else if (this.holding && !ok && this.cool <= 0) { this.cool = 0.6; o.onDenied?.(o); this.G.audio?.beep?.(false); }
  }
}
