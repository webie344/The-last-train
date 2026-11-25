// The Last Train: bootstrap, game loop, menu, settings, save, respawn.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Emitter, clamp } from './util.js';
import { glowTexture } from './textures.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { loadUAL } from './rig.js';
import { Nav } from './nav.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Creature } from './creature.js';
import { Companion } from './companion.js';
import { Director } from './director.js';
import { Interactables } from './interact.js';
import { Mission } from './chapter1.js';
import { FX } from './fx.js';

const $ = (id) => document.getElementById(id);
const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || /Android/i.test(navigator.userAgent) && (navigator.deviceMemory || 4) <= 3;
const DEFAULTS = { quality: lowEnd ? 'low' : 'medium', brightness: 1, sens: 1, volume: 0.9, music: 0.8, haptics: true, director: true, fps: false };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CFG.SET_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
const saveSettings = (s) => { try { localStorage.setItem(CFG.SET_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
const readSave = () => { try { return JSON.parse(localStorage.getItem(CFG.SAVE_KEY) || '{}'); } catch { return {}; } };

const G = { settings: loadSettings(), time: 0, state: 'loading', events: new Emitter(), noiseBus: new Emitter(), flares: [] };
window.__G = G;
G.noise = (x, z, r, src = 'player') => G.noiseBus.emit('noise', { x, z, r, src });
G.save = (extra = {}) => { try { const prev = readSave(); localStorage.setItem(CFG.SAVE_KEY, JSON.stringify({ ...prev, ...extra, v: CFG.VERSION })); } catch { /* ignore */ } };

function fitUI() {
  const u = clamp(Math.min(innerWidth, innerHeight) / 430, 0.8, 1.35); document.documentElement.style.setProperty('--u', u.toFixed(3));
  G.ui?.orient(innerHeight > innerWidth * 1.05 && 'ontouchstart' in window);
}

// ---- installable app (PWA)
let installEvt = null;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showInstall(); });
addEventListener('appinstalled', () => { installEvt = null; document.getElementById('btnInstall')?.remove(); });
function showInstall() {
  const menu = document.querySelector('#title .menu'); if (!menu || !installEvt || document.getElementById('btnInstall')) return;
  const b = document.createElement('button'); b.id = 'btnInstall'; b.className = 'mbtn'; b.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><use href="#i-arrow"/></svg><span>Install app</span>';
  b.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; b.remove(); }); menu.appendChild(b);
}

async function boot() {
  const ui = G.ui = new UI($('ui')); ui.screen('loader'); ui.setLoader(0.04, 'Starting engine');
  const canvas = $('gl');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: G.settings.quality !== 'low', powerPreference: 'high-performance', stencil: false }); }
  catch (e) { ui.setLoader(0, 'WebGL is not available on this device.'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace; G.renderer = renderer;
  G.scene = new THREE.Scene(); G.scene.background = new THREE.Color(0x030507); G.scene.fog = new THREE.FogExp2(0x05080b, 0.042);
  G.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 90);
  G.scene.add(G.camera);
  G.amb = new THREE.HemisphereLight(0x1c2a3a, 0x0a0806, 0.5); G.scene.add(G.amb);
  G.glowTex = glowTexture();
  G.audio = ui.audio = new GameAudio(); G.audio.setVolumes({ master: G.settings.volume, music: G.settings.music });
  G.fx = new FX(G); G.fx.apply();
  ui.setLoader(0.12, 'Loading character models');
  G.gltf = await loadUAL(CFG.ASSET_UAL, (p) => ui.setLoader(0.12 + p * 0.6, 'Loading character models'));
  if (!G.gltf) console.warn('UAL model not found; using placeholder characters.');
  ui.setLoader(0.78, 'Building station');
  await new Promise((r) => setTimeout(r, 30));
  G.world = buildWorld(G); G.scene.add(G.world.group);
  const B = G.world.bounds; G.nav = new Nav(B);
  const doorIds = new Set(G.world.doors.map((d) => d.id));
  for (const c of G.world.colliders) if (!(c.id && doorIds.has(c.id))) G.nav.addStatic(c);
  G.nav.addSafe(G.world.trainBox);
  for (const D of G.world.doors) if (D.type !== 'train') G.nav.setDoor(D.id, D.c, true);
  ui.setMapBase(G.world.colliders, B);
  ui.setLoader(0.88, 'Waking the creature');
  G.input = new Input(ui, G.settings);
  G.player = new Player(G, G.gltf); G.creature = new Creature(G, G.gltf); G.companion = new Companion(G, G.gltf);
  G.interact = new Interactables(G); G.director = new Director(G); G.mission = new Mission(G); G.mission.init();
  G.player.teleport(G.world.anchors.trainSpawn, Math.PI);
  wire(); fitUI(); addEventListener('resize', () => { G.fx.apply(); fitUI(); }); addEventListener('orientationchange', () => setTimeout(() => { G.fx.apply(); fitUI(); }, 250));
  ui.setSlots(G.player.inv, G.player.selected); ui.setHealth(100); ui.setStamina(100);
  ui.setLoader(1, 'Ready'); await new Promise((r) => setTimeout(r, 250)); ui.screen('title'); ui.hud(false); G.state = 'title'; showInstall();
  const s = readSave(); if (s.complete) $('btnPlay').querySelector('span') && ($('btnPlay').querySelector('span').textContent = 'Play again');
  requestAnimationFrame(loop);
}

function wire() {
  const { ui, input, player } = G;
  ui.onClose = () => { if (G.state === 'paused' && !ui.isModalOpen()) setPaused(false); };
  $('btnPlay').addEventListener('click', startGame);
  $('btnHow').addEventListener('click', () => ui.modal('howModal', true));
  $('btnSettings').addEventListener('click', () => ui.modal('setModal', true));
  ui.bindSettings(G.settings, (k) => {
    saveSettings(G.settings);
    if (k === 'quality' || k === 'brightness') G.fx.apply();
    if (k === 'volume' || k === 'music') G.audio.setVolumes({ master: G.settings.volume, music: G.settings.music });
    if (k === 'quality') ui.notify('Quality applies fully after restart', 'gear');
  });
  $('pResume').addEventListener('click', () => setPaused(false));
  $('pSettings').addEventListener('click', () => ui.modal('setModal', true));
  $('pRestart').addEventListener('click', () => { setPaused(false); respawn(true); });
  $('pQuit').addEventListener('click', () => location.reload());
  input.on('interact', (d) => { if (G.state === 'play') G.interact.press(!!d); });
  input.on('crouch', () => G.state === 'play' && player.toggleCrouch());
  input.on('flashlight', () => G.state === 'play' && player.toggleFlash());
  input.on('roll', () => G.state === 'play' && player.roll());
  input.on('item', () => G.state === 'play' && player.useItem());
  input.on('slot', (k) => player.select(k)); input.on('slotIndex', (i) => player.selectIndex(i));
  input.on('inventory', () => { if (G.state !== 'play') return; setPaused(true, false); ui.showInventory(player.inv, player.docs, (k) => player.useItem(k)); });
  input.on('commands', () => { if (G.state !== 'play') return; G.wheel = !G.wheel; ui.showWheel(G.wheel, G.companion.mode); });
  input.on('command', (c) => { if (G.state !== 'play') return; G.wheel = false; G.companion.command(c); });
  input.on('pause', () => { if (G.state === 'play') setPaused(true); else if (G.state === 'paused') setPaused(false); });
  input.on('fullscreen', () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* ignore */ } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') setPaused(true); });
  G.events.on('died', () => respawn(false));
  G.events.on('director', (e) => { if (G.settings.fps) G.dirLast = `${e.source}:${e.action}`; });
}

function setPaused(on, showMenu = true) {
  const ui = G.ui;
  if (on && G.state === 'play') { G.state = 'paused'; G.input.setEnabled(false); if (showMenu) { ui.modal('pauseModal', true); const d = G.director; $('dirStatus').textContent = 'AI Director: ' + (!G.settings.director ? 'local only' : d.online === true ? 'Groq online' : d.online === false ? 'Groq unreachable - using local fallback' : 'waiting'); } G.audio.ctx?.suspend?.(); }
  else if (!on && G.state === 'paused') { G.state = 'play'; ['pauseModal', 'invModal', 'setModal'].forEach((m) => ui.modal(m, false)); G.input.setEnabled(true); G.audio.ctx?.resume?.(); }
}

async function startGame() {
  const ui = G.ui; G.audio.start(); G.audio.ui('tap'); try { await G.audio.ctx?.resume(); } catch { /* ignore */ }
  ui.screen('game'); ui.hud(true); G.state = 'play'; G.input.setEnabled(true); G.time = 0;
  if (matchMedia('(pointer: coarse)').matches) { try { await (document.documentElement.requestFullscreen?.()); screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* optional */ } }
  await G.mission.begin(true);
}

async function respawn(manual) {
  const ui = G.ui, P = G.player, A = G.world.anchors; G.state = 'respawn';
  await ui.fade(1, 700);
  P.dead = false; P.downed = false; P.hp = manual ? 100 : 60; P.stamina = 100; P.busy = false; P.rolling = 0; P.setFlash(false, true); ui.setDowned(false); ui.setHealth(P.hp);
  P.rig.cancelOnce(); P.rig.play('Idle_Loop', { fade: 0.1 }); G.creature.despawn(); G.director.budget = 0; G.director.lastEncounter = G.time; G.interact.holding = false;
  P.teleport({ x: A.arrive.x - 3.4, y: 0, z: 10 }, Math.PI); P.camYaw = Math.PI; G.companion.teleportTo(A.arrive.x - 3.8, 12); G.companion.mode = 'follow';
  await ui.fade(0, 900); G.state = 'play'; G.input.setEnabled(true);
  G.companion.say('Mara', manual ? 'Back at the train.' : 'I dragged you back. Do not do that again.', true);
}
G.restart = () => location.reload();

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, mapT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now; if (G.state === 'loading') return;
  const play = G.state === 'play' || G.state === 'respawn';
  if (play) {
    G.time += dt; const P = G.player, W = G.world;
    P.update(dt); P.updateCamera(dt); G.companion.update(dt); G.creature.update(dt); G.director.update(dt); G.mission.update(dt); G.interact.update(dt);
    W.update(dt, G.time, [P.pos, G.companion.pos, ...(G.creature.active ? [G.creature.pos] : [])].map((p) => ({ x: p.x, z: p.z })), { x: P.pos.x, z: P.pos.z });
    G.audio.setZone(W.zoneAt(P.pos.x, P.pos.z)); G.audio.setThreat(G.creature.threat);
    G.audio.update(dt, { pos: { x: P.pos.x, y: 1.5, z: P.pos.z }, fwd: { x: Math.sin(P.camYaw), z: Math.cos(P.camYaw) } });
    G.ui.setNoise(P.noiseLevel, P.noiseLevel > 0.7); G.ui.setSlots(P.inv, P.selected);
    G.amb.intensity = (W.powered ? 0.75 : 0.45) * G.settings.brightness;
    mapT -= dt; if (mapT <= 0) { mapT = 0.06; drawMap(); }
  } else if (G.state === 'title') { // slow orbit behind the title
    G.time += dt; const W = G.world, t = G.time * 0.08; G.camera.position.set(1 + Math.sin(t) * 3, 2.2, 10 + Math.cos(t) * 2); G.camera.lookAt(5, 1.6, -6); W.update(dt, G.time, [], { x: 3, z: 6 });
  }
  if (G.state !== 'paused') G.fx.render(G.time, G.creature?.threat || 0);
  fpsAcc += dt; fpsN++; fpsT -= dt; if (fpsT <= 0 && G.settings.fps) { fpsT = 0.5; G.ui.fps({ show: true, text: `${Math.round(fpsN / fpsAcc)} fps  ${G.settings.quality}  director:${G.dirLast || '-'}` }); fpsAcc = 0; fpsN = 0; } else if (!G.settings.fps) G.ui.fps({ show: false });
}

function drawMap() {
  const P = G.player, M = G.mission, A = G.world.anchors, marks = [];
  const add = (p, color, shape, ring) => marks.push({ x: p.x, z: p.z, color, shape, ring });
  add(A.arrive, '#5aa9ff', 'sq');
  if (M.phase === 'explore') G.interact.list.filter((o) => o.id.startsWith('cell')).forEach((o) => { if (!o.used) add(o, '#4cc38a'); });
  if (M.fuel >= 3 && !M.generatorOn) add(A.generator, '#ffd27f', 'sq', true);
  if (M.generatorOn && !M.survivorFound) add(A.cot, '#ffd27f', 'sq', true);
  add(G.companion.pos, '#7fe0ff');
  if (G.creature.active && G.creature.state === 'CHASE') add(G.creature.pos, '#e5484d', null, true);
  G.ui.drawMini(P.pos.x, P.pos.z, P.camYaw + Math.PI, marks);
}

boot().catch((e) => { console.error(e); try { G.ui.setLoader(0, 'Failed to start: ' + e.message); } catch { /* ignore */ } });
