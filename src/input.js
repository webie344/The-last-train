// Touch controller (floating stick, look drag, buttons) + keyboard/mouse. Multi-touch safe via pointer ids.
import { clamp } from './util.js';

export class Input {
  constructor(ui, settings) {
    this.ui = ui; this.s = settings;
    this.mx = 0; this.my = 0; this.lookX = 0; this.lookY = 0;
    this.sprintLatch = false; this.stickSprint = false; this.keySprint = false;
    this.interactHeld = false; this.enabled = false; this.handlers = {};
    this.keys = new Set(); this.stickId = null; this.lookId = null; this._sprintT = 0;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this._bindStick(); this._bindLook(); this._bindButtons(); this._bindKeys();
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    ['gesturestart', 'gesturechange'].forEach((g) => document.addEventListener(g, (e) => e.preventDefault()));
  }
  on(name, fn) { this.handlers[name] = fn; }
  fire(name, ...a) { this.handlers[name]?.(...a); }
  buzz(ms = 8) { if (this.s.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } } }

  _bindStick() {
    const z = this.ui.$('stickZone'), stick = this.ui.$('stick'), knob = this.ui.$('knob'), ghost = this.ui.$('stickGhost');
    let cx = 0, cy = 0, R = 60;
    const place = (x, y) => {
      const zr = z.getBoundingClientRect(), r = stick.offsetWidth / 2;
      const px = clamp(x - zr.left, r, zr.width - r), py = clamp(y - zr.top, r, zr.height - r);
      stick.style.left = px - r + 'px'; stick.style.bottom = (zr.height - py - r) + 'px';
      const b = stick.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2; R = b.width * 0.36;
    };
    const reset = () => {
      this.stickId = null; this.mx = 0; this.my = 0; this.stickSprint = false; stick.classList.remove('active', 'sprint'); knob.style.transform = '';
      stick.style.left = ''; stick.style.bottom = ''; ghost.style.opacity = 1;
    };
    this._resetStick = reset;
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy), m = Math.min(1, d / R);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const dead = 0.1, k = m < dead ? 0 : (m - dead) / (1 - dead), nx = d ? dx / Math.min(d, R) : 0, ny = d ? dy / Math.min(d, R) : 0;
      this.mx = nx * k; this.my = -ny * k; this.mag = k;
      const sp = m > 0.96; if (sp && !this._spOn) this._sprintT = performance.now(); this._spOn = sp;
      this.stickSprint = sp && performance.now() - this._sprintT > 160; stick.classList.toggle('sprint', this.stickSprint);
    };
    z.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stickId !== null || e.target.closest('.rbtn')) return;
      this.stickId = e.pointerId; z.setPointerCapture(e.pointerId); place(e.clientX, e.clientY); stick.classList.add('active'); ghost.style.opacity = 0; move(e); this.buzz(4);
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    ['pointerup', 'pointercancel'].forEach((ev) => z.addEventListener(ev, (e) => { if (e.pointerId === this.stickId) reset(); }));
  }

  _bindLook() {
    const z = this.ui.$('lookZone'); let lx = 0, ly = 0;
    z.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') { z.requestPointerLock?.(); return; }
      if (this.lookId !== null) return; this.lookId = e.pointerId; z.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; this._lt = performance.now(); this._lmoved = 0;
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.pointerId !== this.lookId) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      this.lookX += dx * this.s.sens * 0.0052; this.lookY += dy * this.s.sens * 0.0042; this._lmoved += Math.abs(dx) + Math.abs(dy);
    });
    const up = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up);
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement && this.enabled) { this.lookX += e.movementX * this.s.sens * 0.0024; this.lookY += e.movementY * this.s.sens * 0.002; } });
  }

  _bindButtons() {
    this.ui.root.querySelectorAll('[data-act]').forEach((b) => {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); b.setPointerCapture?.(e.pointerId); b.classList.add('pressed'); this.buzz(act === 'interact' ? 14 : 8);
        if (act === 'interact') { this.interactHeld = true; this.fire('interact', true); return; }
        if (act === 'sprint') { this.sprintLatch = !this.sprintLatch; b.classList.toggle('on', this.sprintLatch); return; }
        if (!this.enabled && !['pause', 'commands', 'inventory', 'fullscreen'].includes(act)) return;
        this.fire(act);
      });
      const up = () => { b.classList.remove('pressed'); if (act === 'interact' && this.interactHeld) { this.interactHeld = false; this.fire('interact', false); } };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, up));
    });
    this.ui.root.addEventListener('click', (e) => {
      const w = e.target.closest('[data-cmd]'); if (w) { this.fire('command', w.dataset.cmd); return; }
      const s = e.target.closest('[data-slot]'); if (s) this.fire('slot', s.dataset.slot);
    });
  }

  _bindKeys() {
    const map = { KeyE: 'interact', KeyC: 'crouch', KeyF: 'flashlight', Space: 'roll', KeyG: 'item', KeyI: 'inventory', Tab: 'inventory', KeyQ: 'commands', Escape: 'pause', KeyP: 'pause' };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.keySprint = true; return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { this.keys.add(e.code); e.preventDefault(); return; }
      const a = map[e.code]; if (!a) { if (/^Digit[1-4]$/.test(e.code)) this.fire('slotIndex', +e.code.slice(5) - 1); return; }
      e.preventDefault();
      if (a === 'interact') { this.interactHeld = true; this.fire('interact', true); return; }
      if (!this.enabled && !['pause', 'commands', 'inventory'].includes(a)) return;
      this.fire(a);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keySprint = false;
      this.keys.delete(e.code);
      if (e.code === 'KeyE') { this.interactHeld = false; this.fire('interact', false); }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.keySprint = false; this._resetStick?.(); this.interactHeld = false; this.fire('interact', false); });
  }

  // Called once per frame by the game.
  poll() {
    let mx = this.mx, my = this.my, mag = this.mag || 0;
    if (this.stickId === null) { mag = 0; }
    const k = this.keys;
    if (k.size) {
      const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; mag = 1; }
    }
    const r = { mx, my, mag: Math.hypot(mx, my), sprint: this.stickSprint || this.keySprint || (this.sprintLatch && Math.hypot(mx, my) > 0.2), lookX: this.lookX, lookY: this.lookY };
    this.lookX = 0; this.lookY = 0; return r;
  }
  setEnabled(on) { this.enabled = on; if (!on) { this._resetStick?.(); this.lookId = null; } }
}
