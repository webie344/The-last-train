// All HUD / menus. Every icon is an SVG <use> from the sprite in index.html - no emoji.
import { clamp } from './util.js';

const ic = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const ITEM = {
  fuel: { name: 'Fuel cell', icon: 'cell', use: false, desc: 'Powers the emergency generator.' },
  medkit: { name: 'Medkit', icon: 'medkit', use: true, desc: 'Restores 45 health.' },
  battery: { name: 'Battery', icon: 'battery', use: true, desc: 'Recharges your flashlight.' },
  flare: { name: 'Flare', icon: 'flare', use: true, desc: 'Burns bright for 40 s. The Stalker will not cross it.' },
  bottle: { name: 'Bottle', icon: 'bottle', use: true, desc: 'Throw it to make noise far away.' },
  keycard: { name: 'Keycard', icon: 'key', use: false, desc: 'Security office access.' },
  scrap: { name: 'Scrap', icon: 'wrench', use: false, desc: 'Spend at the workshop to craft.' },
};
export { ITEM, ic };

export class UI {
  constructor(root) {
    this.root = root; this.holdP = 0; this._subT = null; this._notifT = null;
    root.innerHTML = `
    <div id="orient" class="overlay hidden"><div class="orient-box">${ic('expand', 'big')}<p>Rotate your phone to landscape</p></div></div>

    <div id="loader" class="screen">
      <div class="logo-sm">THE LAST TRAIN</div>
      <div class="load-bar"><i id="loadFill"></i></div>
      <div id="loadText" class="load-text">Starting engine…</div>
      <div id="loadTip" class="load-tip"></div>
    </div>

    <div id="title" class="screen hidden">
      <div class="title-rails"></div>
      <div class="title-wrap">
        <div class="kicker">${ic('train')} TR-09</div>
        <h1 class="logo"><span>THE LAST</span><span>TRAIN</span></h1>
        <p class="tag">The world ended above. Survival continues below.</p>
        <div class="menu">
          <button id="btnPlay" class="mbtn primary">${ic('play')}<span id="playLabel">Begin Chapter 1</span></button>
          <button id="btnHow" class="mbtn">${ic('hand')}<span>How to play</span></button>
          <button id="btnSettings" class="mbtn">${ic('gear')}<span>Settings</span></button>
        </div>
        <div class="ver">v<span id="verTxt"></span> · Chapter 1 · Solo + AI companion</div>
      </div>
    </div>

    <div id="hud" class="hidden">
      <canvas id="vignette"></canvas>
      <div id="hurt"></div>
      <div id="fadeBlack"></div>

      <div id="topLeft">
        <div id="miniWrap"><canvas id="mini" width="220" height="220"></canvas><i class="mini-n">N</i></div>
        <div id="objective" class="glass"><button id="objHead" type="button">${ic('flag')}<span id="objTitle">Objective</span>${ic('arrow', 'chev')}</button><ul id="objList"></ul></div>
        <div id="noiseMeter" class="glass" title="Noise"><span>${ic('noise')}</span><div class="nbars">${'<i></i>'.repeat(14)}</div></div>
      </div>

      <div id="topRight">
        <button id="btnMap" class="rbtn sm" data-act="commands" aria-label="Companion commands">${ic('radio')}</button>
        <button id="btnBag" class="rbtn sm" data-act="inventory" aria-label="Inventory">${ic('bag')}</button>
        <button id="btnFs" class="rbtn sm" data-act="fullscreen" aria-label="Fullscreen">${ic('expand')}</button>
        <button id="btnPause" class="rbtn sm" data-act="pause" aria-label="Pause">${ic('pause')}</button>
      </div>

      <div id="vitals">
        <div class="vbar hp">${ic('heart')}<div><i id="hpFill"></i></div><b id="hpNum">100</b></div>
        <div class="vbar st">${ic('bolt')}<div><i id="stFill"></i></div></div>
        <div id="slots"></div>
      </div>

      <div id="subtitle"><b id="subWho"></b><span id="subTxt"></span></div>
      <div id="notes"></div>
      <div id="prompt" class="hidden"></div>
      <div id="crosshair"><i></i><i></i><i></i><i></i><b></b></div><div id="hitm"></div><div id="hurtDir"></div>
      <div id="ammo"><b id="ammoMag">30</b><span id="ammoRes">/ 120</span><small id="ammoName">RIFLE</small></div>
      <div id="downed" class="hidden"><b>You're down</b><span id="downTxt">Hold on…</span><div class="dbar"><i id="downFill"></i></div></div>

      <div id="stickZone">
        <div id="stickGhost"></div>
        <div id="stick"><div class="ring r1"></div><div class="ring r2"></div><div id="knob"></div><div class="sprint-arc"></div></div>
        <button id="btnSprint" class="rbtn" data-act="sprint" aria-label="Sprint">${ic('run')}<small>SPRINT</small></button>
      </div>
      <div id="lookZone"></div>

      <div id="cluster">
        <button id="btnFire" class="rbtn lg" data-act="fire" aria-label="Fire">${ic('fire')}<small>FIRE</small></button>
        <button id="btnReload" class="rbtn md" data-act="reload" aria-label="Reload">${ic('reload')}<small>RELOAD</small></button>
        <button id="btnMelee" class="rbtn md" data-act="melee" aria-label="Melee">${ic('melee')}<small>MELEE</small></button>
        <button id="btnItem" class="rbtn md" data-act="item" aria-label="Use item"><span id="itemIcon">${ic('flare')}</span><small id="itemCount">2</small></button>
        <button id="btnRoll" class="rbtn md" data-act="roll" aria-label="Dodge roll">${ic('roll')}<small>DODGE</small></button>
        <button id="btnFlash" class="rbtn md toggle on" data-act="flashlight" aria-label="Flashlight">${ic('flashlight')}<small>LIGHT</small></button>
        <button id="btnCrouch" class="rbtn md toggle" data-act="crouch" aria-label="Crouch">${ic('crouch')}<small>CROUCH</small></button>
        <button id="btnUse" class="rbtn xl disabled" data-act="interact" aria-label="Interact">
          <svg class="ring-svg" viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="46"/><circle id="holdRing" class="prg" cx="50" cy="50" r="46"/></svg>
          <span id="useIcon">${ic('hand')}</span><small id="useLabel">ACT</small>
        </button>
      </div>

      <div id="wheel" class="hidden">
        <div class="wheel-c">${ic('radio')}<small>MARA</small></div>
        <button class="wbtn w-up" data-cmd="follow">${ic('follow')}<span>Follow</span></button>
        <button class="wbtn w-right" data-cmd="interact">${ic('gear')}<span>Interact</span></button>
        <button class="wbtn w-down" data-cmd="stay">${ic('stay')}<span>Stay</span></button>
        <button class="wbtn w-left" data-cmd="defend">${ic('shield')}<span>Defend</span></button>
        <button class="wclose" data-act="commands">${ic('close')}</button>
      </div>
    </div>

    <div id="invModal" class="overlay hidden"><div class="panel">
      <div class="panel-h">${ic('bag')}<b>Inventory</b><button class="xbtn" data-close="invModal">${ic('close')}</button></div>
      <div id="invGrid"></div><div id="invDesc" class="inv-desc">Select an item.</div>
      <div class="panel-s">${ic('note')}<b>Found documents</b></div><ul id="docList" class="doc-list"></ul>
    </div></div>

    <div id="pauseModal" class="overlay hidden"><div class="panel narrow">
      <div class="panel-h">${ic('pause')}<b>Paused</b></div>
      <button id="pResume" class="mbtn primary">${ic('play')}<span>Resume</span></button>
      <button id="pSettings" class="mbtn">${ic('gear')}<span>Settings</span></button>
      <button id="pRestart" class="mbtn">${ic('roll')}<span>Restart from train</span></button>
      <button id="pQuit" class="mbtn">${ic('home')}<span>Main menu</span></button>
      <div id="dirStatus" class="dir-status"></div>
    </div></div>

    <div id="setModal" class="overlay hidden"><div class="panel">
      <div class="panel-h">${ic('gear')}<b>Settings</b><button class="xbtn" data-close="setModal">${ic('close')}</button></div>
      <div class="set-grid">
        <label>Graphics<select id="sQuality"><option value="low">Low (best battery)</option><option value="medium">Medium</option><option value="high">High (bloom + shadows)</option></select></label>
        <label>Brightness<input id="sBright" type="range" min="0.6" max="1.8" step="0.05"></label>
        <label>Look sensitivity<input id="sSens" type="range" min="0.4" max="2.2" step="0.05"></label>
        <label>Master volume<input id="sVol" type="range" min="0" max="1" step="0.05"></label>
        <label>Music &amp; ambience<input id="sMusic" type="range" min="0" max="1" step="0.05"></label>
        <label class="row">Vibration<input id="sHaptic" type="checkbox"></label>
        <label class="row">AI Director (Groq)<input id="sDirector" type="checkbox"></label>
        <label class="row">Show FPS<input id="sFps" type="checkbox"></label>
      </div>
    </div></div>

    <div id="howModal" class="overlay hidden"><div class="panel">
      <div class="panel-h">${ic('hand')}<b>How to play</b><button class="xbtn" data-close="howModal">${ic('close')}</button></div>
      <ul class="how">
        <li>${ic('follow')}<span><b>Move</b> with the left stick. Push it to the edge to sprint.</span></li>
        <li>${ic('eye')}<span><b>Look</b> by dragging on the right side. Your flashlight follows where you look.</span></li>
        <li>${ic('hand')}<span><b>Act</b> when the big button lights up: search, repair, rescue, open.</span></li>
        <li>${ic('noise')}<span>Everything you do makes <b>noise</b>. Sprinting, doors and the generator are loud. Crouch to stay quiet.</span></li>
        <li>${ic('flare')}<span><b>Flares</b> keep the Stalker back. <b>Bottles</b> pull it away. <b>Dodge</b> to slip a swing.</span></li>
        <li>${ic('radio')}<span>Tell <b>Mara</b> to follow, stay, interact or defend. Stay together: it hunts the isolated.</span></li>
        <li>${ic('train')}<span>The train is safe. The creature will never enter TR-09.</span></li>
      </ul>
      <p class="how-k">Keyboard: WASD move · Shift sprint · Mouse look · E act · C crouch · F light · Space dodge · G flare · I inventory · Q commands · Esc pause</p>
    </div></div>

    <div id="cardModal" class="overlay card hidden"><div id="cardInner"></div></div>
    <div id="endModal" class="overlay hidden"><div class="panel narrow center" id="endInner"></div></div>
    <div id="fps" class="hidden"></div>
    `;
    this.$ = (id) => root.querySelector('#' + id);
    this.q = (s) => root.querySelector(s);
    this.vig = this.$('vignette');
    const closeIt = (e) => { const b = e.target.closest('[data-close]'); if (!b) return; e.preventDefault(); e.stopPropagation(); if (b._t && performance.now() - b._t < 350) return; b._t = performance.now(); this.modal(b.dataset.close, false); try { this.audio?.ui('back'); } catch { /* audio not started yet */ } this.onClose?.(b.dataset.close); };
    root.addEventListener('click', closeIt); root.addEventListener('pointerup', closeIt);
    this.$('objHead').addEventListener('click', () => this.$('objective').classList.toggle('open'));
    this.$('verTxt').textContent = '';
    this.tips = ['Noise draws it in. Crouch when you can.', 'It never enters the train. Remember that.', 'Hold the generator repair: it is loud.', 'It hunts those who are alone. Stay near Mara.', 'Flares give you a few seconds of safety. Spend them well.', 'Dodge at the last moment to slip its swing.'];
    this.$('loadTip').textContent = this.tips[Math.floor(Math.random() * this.tips.length)];
    this._buildMini();
  }

  // ---------- screens ----------
  setLoader(p, text) { this.$('loadFill').style.width = Math.round(p * 100) + '%'; if (text) this.$('loadText').textContent = text; }
  screen(name) { ['loader', 'title'].forEach((s) => this.$(s).classList.toggle('hidden', s !== name)); }
  hud(on) { this.$('hud').classList.toggle('hidden', !on); }
  modal(id, on = true) { this.$(id).classList.toggle('hidden', !on); }
  isModalOpen() { return [...this.root.querySelectorAll('.overlay')].some((o) => !o.classList.contains('hidden') && o.id !== 'orient'); }
  orient(show) { this.$('orient').classList.toggle('hidden', !show); }
  fade(to, ms = 600) { const f = this.$('fadeBlack'); f.style.transition = `opacity ${ms}ms ease`; f.style.opacity = to; return new Promise((r) => setTimeout(r, ms)); }
  card(title, sub, ms = 3600) {
    const c = this.$('cardModal'); this.$('cardInner').innerHTML = `<small>${sub || ''}</small><h2>${title}</h2>`;
    c.classList.remove('hidden'); c.classList.add('show'); setTimeout(() => { c.classList.remove('show'); setTimeout(() => c.classList.add('hidden'), 800); }, ms);
    return new Promise((r) => setTimeout(r, ms + 400));
  }

  // ---------- HUD ----------
  setObjective(title, list) {
    this.$('objTitle').textContent = title;
    this.$('objList').innerHTML = list.map((o) => `<li class="${o.done ? 'done' : ''}">${ic(o.done ? 'check' : 'flag')}<span>${o.text}${o.count ? ` <em>${o.have || 0}/${o.count}</em>` : ''}</span></li>`).join('');
    const ob = this.$('objective'); ob.classList.remove('ping'); void ob.offsetWidth; ob.classList.add('ping', 'open'); clearTimeout(this._objT); this._objT = setTimeout(() => ob.classList.remove('open'), 6000);
  }
  notify(text, icon = 'check') {
    const n = document.createElement('div'); n.className = 'note'; n.innerHTML = `${ic(icon)}<span>${text}</span>`; this.$('notes').appendChild(n);
    setTimeout(() => n.classList.add('out'), 2600); setTimeout(() => n.remove(), 3200);
    while (this.$('notes').children.length > 4) this.$('notes').firstChild.remove();
  }
  subtitle(who, text, ms = 3800) {
    this.$('subWho').textContent = who ? who + ': ' : ''; this.$('subTxt').textContent = text; const s = this.$('subtitle'); s.classList.add('show');
    clearTimeout(this._subT); this._subT = setTimeout(() => s.classList.remove('show'), ms);
  }
  setPrompt(p) {
    const b = this.$('btnUse'), has = !!p;
    b.classList.toggle('disabled', !has || p.disabled);
    this.$('useIcon').innerHTML = ic(has ? p.icon : 'hand');
    this.$('useLabel').textContent = has ? (p.short || 'ACT') : 'ACT';
    const pr = this.$('prompt');
    if (!has) { pr.classList.add('hidden'); return; }
    pr.classList.remove('hidden'); pr.classList.toggle('bad', !!p.disabled);
    pr.innerHTML = `${ic(p.icon)}<span>${p.label}</span>${p.hold ? '<em>HOLD</em>' : ''}${p.note ? `<small>${p.note}</small>` : ''}`;
  }
  hold(p) { const c = this.$('holdRing'); c.style.strokeDashoffset = String(289 * (1 - clamp(p, 0, 1))); this.$('btnUse').classList.toggle('holding', p > 0); }
  setHealth(hp) { this.$('hpFill').style.width = clamp(hp, 0, 100) + '%'; this.$('hpNum').textContent = Math.round(hp); this.$('hpFill').parentElement.classList.toggle('low', hp < 35); }
  setStamina(s) { this.$('stFill').style.width = clamp(s, 0, 100) + '%'; this.$('stFill').parentElement.classList.toggle('low', s < 20); }
  setNoise(n, hot) {
    const bars = this.$('noiseMeter').querySelectorAll('.nbars i'), k = Math.round(clamp(n, 0, 1) * bars.length);
    bars.forEach((b, i) => b.className = i < k ? (i > 9 ? 'r' : i > 5 ? 'o' : 'g') : '');
    this.$('noiseMeter').classList.toggle('hot', !!hot);
  }
  setSlots(inv, selected) {
    const order = ['flare', 'medkit', 'battery', 'bottle'];
    this.$('slots').innerHTML = order.map((k) => `<button class="slot ${k === selected ? 'sel' : ''} ${inv[k] ? '' : 'empty'}" data-slot="${k}">${ic(ITEM[k].icon)}<b>${inv[k] || 0}</b></button>`).join('');
    const it = ITEM[selected] || ITEM.flare; this.$('itemIcon').innerHTML = ic(it.icon); this.$('itemCount').textContent = inv[selected] || 0;
    this.$('btnItem').classList.toggle('disabled', !(inv[selected] > 0));
  }
  setAmmo(mag, res, reloading) { this.$('ammoMag').textContent = reloading ? '--' : mag; this.$('ammoRes').textContent = '/ ' + res; this.$('ammo').classList.toggle('low', !reloading && mag <= 6); }
  crosshair(hot, firing) { const c = this.$('crosshair'); c.classList.toggle('hot', !!hot); c.classList.toggle('fire', !!firing); }
  hitMarker(kill) { const h = this.$('hitm'); h.classList.remove('show', 'kill'); void h.offsetWidth; h.classList.add('show'); if (kill) h.classList.add('kill'); }
  hurtDir(rel) { const d = this.$('hurtDir'); d.style.transform = `rotate(${rel}rad)`; d.classList.remove('show'); void d.offsetWidth; d.classList.add('show'); }
  toggleState(id, on) { this.$(id).classList.toggle('on', !!on); }
  hurt(amount = 1) { const h = this.$('hurt'); h.style.opacity = clamp(amount, 0, 1); h.style.transition = 'none'; requestAnimationFrame(() => { h.style.transition = 'opacity 900ms ease'; h.style.opacity = 0; }); }
  setDowned(on, p = 0, text = '') { const d = this.$('downed'); d.classList.toggle('hidden', !on); this.$('downFill').style.width = (clamp(p, 0, 1) * 100) + '%'; if (text) this.$('downTxt').textContent = text; }
  showWheel(on, active) { this.$('wheel').classList.toggle('hidden', !on); this.root.querySelectorAll('.wbtn').forEach((b) => b.classList.toggle('on', b.dataset.cmd === active)); }
  fps(v) { const f = this.$('fps'); f.classList.toggle('hidden', !v.show); if (v.show) f.textContent = v.text; }

  // ---------- inventory ----------
  showInventory(inv, docs, onUse) {
    const grid = this.$('invGrid'); const keys = Object.keys(ITEM).filter((k) => inv[k]);
    grid.innerHTML = keys.length ? keys.map((k) => `<button class="item" data-k="${k}">${ic(ITEM[k].icon)}<b>${inv[k]}</b><span>${ITEM[k].name}</span></button>`).join('') : '<p class="empty">Your pockets are empty.</p>';
    this.$('invDesc').textContent = 'Select an item.';
    grid.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k, it = ITEM[k]; this.$('invDesc').innerHTML = `<b>${it.name}</b> — ${it.desc}${it.use ? ' <button class="mini" id="useBtn">Use</button>' : ''}`;
      this.$('useBtn')?.addEventListener('click', () => { onUse(k); this.showInventory(inv, docs, onUse); });
    }));
    this.$('docList').innerHTML = docs.length ? docs.map((d) => `<li><b>${d.title}</b><span>${d.text}</span></li>`).join('') : '<li class="empty">Nothing yet.</li>';
    this.modal('invModal', true);
  }

  showEnd(stats, onNext) {
    this.$('endInner').innerHTML = `<div class="end-ic">${ic('train')}</div><small>CHAPTER 1</small><h2>The Abandoned Station</h2><p class="end-q">Did we make it back to the train?</p>
      <ul class="stats">${stats.map((s) => `<li><span>${s[0]}</span><b>${s[1]}</b></li>`).join('')}</ul>
      <button class="mbtn primary" id="endBtn">${ic('arrow')}<span>Continue</span></button>`;
    this.$('endBtn').addEventListener('click', onNext); this.modal('endModal', true);
  }

  // ---------- settings ----------
  bindSettings(s, onChange) {
    const set = (id, k, type = 'value') => { const e = this.$(id); if (type === 'check') e.checked = !!s[k]; else e.value = s[k]; e.addEventListener('input', () => { s[k] = type === 'check' ? e.checked : (e.tagName === 'SELECT' ? e.value : parseFloat(e.value)); onChange(k); }); };
    set('sQuality', 'quality'); set('sBright', 'brightness'); set('sSens', 'sens'); set('sVol', 'volume'); set('sMusic', 'music'); set('sHaptic', 'haptics', 'check'); set('sDirector', 'director', 'check'); set('sFps', 'fps', 'check');
  }

  // ---------- minimap ----------
  _buildMini() { this.mini = this.$('mini'); this.mctx = this.mini.getContext('2d'); this.mapImg = null; }
  setMapBase(colliders, bounds) {
    const S = 6, w = Math.ceil((bounds.x1 - bounds.x0) * S), h = Math.ceil((bounds.z1 - bounds.z0) * S), c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = 'rgba(80,92,100,0.55)'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#0a0d10';
    for (const b of colliders) { if (b.y0 > 1.7 || b.y1 < 0.5 || b.noMap) continue; x.fillRect((b.x0 - bounds.x0) * S, (b.z0 - bounds.z0) * S, (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); }
    this.mapImg = { c, S, b: bounds };
  }
  drawMini(px, pz, yaw, marks) {
    const ctx = this.mctx, W = 220, R = 110, m = this.mapImg; ctx.clearRect(0, 0, W, W);
    ctx.save(); ctx.beginPath(); ctx.arc(R, R, R - 2, 0, 7); ctx.clip(); ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, W);
    if (m) {
      const sc = 3.2; ctx.translate(R, R); ctx.rotate(yaw); ctx.scale(sc / m.S, sc / m.S); ctx.translate(-(px - m.b.x0) * m.S, -(pz - m.b.z0) * m.S);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(m.c, 0, 0);
      for (const k of marks) {
        const x = (k.x - m.b.x0) * m.S, z = (k.z - m.b.z0) * m.S, r = 5 * m.S / sc * 0.8;
        ctx.fillStyle = k.color; ctx.beginPath(); if (k.shape === 'sq') ctx.rect(x - r * 0.8, z - r * 0.8, r * 1.6, r * 1.6); else ctx.arc(x, z, r, 0, 7); ctx.fill();
        if (k.ring) { ctx.strokeStyle = k.color; ctx.lineWidth = 1.5 * m.S / sc; ctx.beginPath(); ctx.arc(x, z, r * 2.2, 0, 7); ctx.stroke(); }
      }
    }
    ctx.restore();
    ctx.save(); ctx.translate(R, R); ctx.fillStyle = '#f2efe6'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  drawVignette(w, h, s = 1) {
    const c = this.vig; if (c.width !== w) { c.width = w; c.height = h; }
    const x = c.getContext('2d'), g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.7); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.7 * s})`); x.clearRect(0, 0, w, h); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
}
