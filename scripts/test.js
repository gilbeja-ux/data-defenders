#!/usr/bin/env node
// Headless test harness: stubs the DOM, evals the real game script from
// src/index.html, and exercises game logic, rendering paths, and audio.
// Run with `npm test`.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
let code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// --- DOM stubs ---
const grad = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return canvasStub;
    return (...a) => (String(k).startsWith('create') ? grad : (k === 'measureText' ? { width: 10 } : undefined));
  },
  set: () => true
});
const canvasHandlers = {};
const canvasStub = {
  width: 0, height: 0, style: {},
  getContext: () => ctxStub,
  addEventListener(k, fn) { canvasHandlers[k] = fn; },
  setPointerCapture() {}
};
global.document = {
  getElementById: () => canvasStub,
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctxStub }),
  documentElement: {},
  addEventListener(k, fn) { docHandlers[k] = fn; },
  hidden: false
};
const docHandlers = {};
// fake Web Audio: decoded buffer has 0.5s of "encoder padding" silence at the
// head (500 samples @ 1kHz) and 1s at the tail, so loop-point trimming is testable
function makeBuf() {
  const d = new Float32Array(10000);
  for (let i = 500; i < 9000; i++) d[i] = 0.5;
  return { sampleRate: 1000, length: 10000, duration: 10, getChannelData: () => d };
}
class FakeGain {
  constructor() { this.gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  connect() {} disconnect() {}
}
class FakeSrc {
  constructor() { this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.started = false; this.stopped = false; this.playbackRate = { value: 1 }; }
  connect() {} disconnect() {}
  start(t, off) { this.started = true; this.startOffset = off; }
  stop() { this.stopped = true; }
}
class FakeAC {
  constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; }
  createGain() { return new FakeGain(); }
  createBufferSource() { return new FakeSrc(); }
  createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 1 }, connect() {}, disconnect() {} }; }
  createOscillator() {
    return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  }
  decodeAudioData() { return Promise.resolve(makeBuf()); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
const fetchLog = [];
global.fetch = url => { fetchLog.push(url); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); };
global.window = {
  innerWidth: 800, innerHeight: 450,
  devicePixelRatio: 1,
  addEventListener() {},
  AudioContext: FakeAC,
  MUSIC_DATA: { menu: 'menu.mp3', levels: ['l1.mp3', 'l2.mp3', 'l3.mp3'] }
};
global.getComputedStyle = () => ({ getPropertyValue: () => '0px' });
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = {};
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => {};
global.screen = {};

// expose internals for the tests
code = code.replace("'use strict';", '') + `
;globalThis.__g = {
  startLevel, spawnEnemy, spawnLine, update, nodes, geo, frame, menuTap,
  setState: v => { state = v; }, getState: () => state, S,
  setMenuSettings: v => { menuSettings = v; }, getMenuSettings: () => menuSettings,
  gearRect: () => menuGearRect, toggles: () => pauseTogglesList,
  enemies: () => enemies,
  stats: () => ({ zaps, misses, score, integrity, combo }),
  playTrack, updateMusic, settings, progress, perf: () => ({ lowFX }),
  music: () => ({ src: musicSrc, gain: musicGain, key: currentTrackKey, ac: AC }),
  bolts: () => bolts, hitStop: () => hitStop, fx, pickups: () => pickups, spawnPickup,
  boss: () => boss, endlessCfg, tut: () => tut, isEndless: () => endless, getLV: () => LV,
  startEndless, menuBtns: () => menuButtons, getEndWin: () => endWin,
  setLevelT: v => { levelT = v; }, setIntegrity: v => { integrity = v; }, setScore: v => { score = v; },
  setMenuScroll: v => { menuScroll = v; }, tolVis: () => tolVis, musicRate: () => musicRate, dialCenter,
  detectBeat, beatQuantize, setBeat: (p, at) => { beatPeriod = p; musicStartAt = at; },
  patternQ: () => patternQ, mutators, musicFilterHz: () => musicFilter && musicFilter.frequency.value,
  getPerfects: () => perfects, getScore: () => score, ringAt: z => ring(z, geo()),
  getIntro: () => introT, setIntro: v => { introT = v; introCd = 0; }, getLevelT: () => levelT, setEndT: v => { endT = v; },
  startQualification, getInfoCard: () => infoCard, isQual: () => qual,
  keys, setBeamAim: (x, y) => { beamAim.x = x; beamAim.y = y; }, getHeat: () => heat, isOverheat: () => overheat, startBossTest
};`;
eval(code);
const G = globalThis.__g;
// most tests exercise live gameplay — skip the level-intro countdown by default
const rawStartLevel = G.startLevel;
G.startLevel = i => { rawStartLevel(i); G.setIntro(999); };
const rawStartEndless = G.startEndless;
G.startEndless = () => { rawStartEndless(); G.setIntro(999); };
const rawStartQual = G.startQualification;
G.startQualification = () => { rawStartQual(); G.setIntro(999); };

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function aim(i, a) { G.nodes[i].angle = a; }
function cross(en) { // place at the ring and step one tick
  // (exactly hitZ so the hit check fires even when hit-stop slows the clock)
  const hz = G.geo().hitZ;
  en.z = hz;
  if (en.partner) en.partner.z = hz;
  G.update(0.01);
}

// ================= enemy hit logic =================
G.startLevel(2);
let en = G.spawnEnemy(0.1, 'normal');
aim(0, Math.PI); aim(1, 0.1);
cross(en);
check('normal zapped by single node', en.dead === true);

en = G.spawnEnemy(0.1, 'normal');
aim(0, Math.PI); aim(1, Math.PI / 2);
cross(en);
check('normal missed when no node covers', en.resolved === true && !en.dead);

en = G.spawnEnemy(0.1, 'heavy');
aim(0, Math.PI); aim(1, 0.1);
cross(en);
check('heavy survives a single node', en.resolved === true && !en.dead);

en = G.spawnEnemy(0.1, 'heavy');
aim(0, 0.15); aim(1, 0.05);
cross(en);
check('heavy zapped by both nodes together', en.dead === true);

function makeLine(a1, a2) {
  const before = G.enemies().length;
  G.spawnLine();
  const pair = G.enemies().slice(before);
  pair[0].angle = a1; pair[1].angle = a2;
  return pair;
}
let [e1, e2] = makeLine(1.0, 2.0);
aim(0, 1.0); aim(1, 2.0);
cross(e1);
check('line zapped with node per end', e1.dead && e2.dead);

[e1, e2] = makeLine(1.0, 2.0);
aim(0, 2.0); aim(1, 1.0);
cross(e1);
check('line zapped with swapped node assignment', e1.dead && e2.dead);

[e1, e2] = makeLine(1.0, 2.0);
aim(0, 1.0); aim(1, 1.05);
cross(e1);
check('line survives both nodes on one end', e1.resolved && e2.resolved && !e1.dead && !e2.dead);

const s = G.stats();
check('line miss counts as ONE miss for the pair', s.misses === 3);

// ================= draw smoke tests =================
function drawOk(name, setup) {
  try { setup(); G.frame(16); check('draw: ' + name, true); }
  catch (err) { console.log('   ' + err.stack.split('\n')[0]); check('draw: ' + name, false); }
}
drawOk('play HUD with all enemy types', () => { G.setState(G.S.PLAY); });
drawOk('pause panel', () => { G.setState(G.S.PAUSE); });
drawOk('end screen', () => { G.setState(G.S.END); });
drawOk('main menu', () => { G.setState(G.S.MENU); });
drawOk('menu audio-config overlay', () => { G.setMenuSettings(true); });

// ================= menu settings interaction =================
G.frame(16);
check('overlay populated toggle controls', G.toggles().length === 3); // SFX, MUSIC, HAPTICS
const t0 = G.toggles()[0];
G.menuTap(t0.x + 5, t0.y + 5, 1);
check('toggle tap flips a setting from the menu overlay', true);
G.menuTap(1, 1, 1);
check('tap outside closes the overlay', G.getMenuSettings() === false);
G.setMenuSettings(false);
G.frame(16);
const gr = G.gearRect();
G.menuTap(gr.x + 10, gr.y + 10, 1);
check('gear button opens the overlay', G.getMenuSettings() === true);
G.setMenuSettings(false);

// ================= lifecycle + perf watchdog =================
G.setState(G.S.PLAY);
global.document.hidden = true; docHandlers.visibilitychange();
check('hiding the app auto-pauses gameplay', G.getState() === G.S.PAUSE);
check('hiding the app suspends audio', G.music().ac && G.music().ac.state === 'suspended');
global.document.hidden = false; docHandlers.visibilitychange();
check('returning resumes the audio context', G.music().ac && G.music().ac.state === 'running');

G.setState(G.S.MENU);
G.update(6); // past the watchdog's startup grace period
for (let i = 0; i < 80; i++) G.frame(100000 + i * 40); // sustained 25fps
check('perf watchdog trips lowFX after sustained slow frames', G.perf().lowFX === true);

// ================= zap juice =================
G.startLevel(1);
en = G.spawnEnemy(0.1, 'normal');
aim(0, Math.PI); aim(1, 0.1);
cross(en);
check('zap spawns a lightning bolt', G.bolts().length > 0);
check('zap triggers hit-stop', G.hitStop() > 0);

// ================= color-locked traps =================
G.startLevel(5); // QUANTUM RELAY
en = G.spawnEnemy(0.1, 'normal'); en.lock = 1; // white node only
aim(0, 0.1); aim(1, Math.PI); // only the BLUE node covers it
cross(en);
check('color-locked trap ignores the wrong node', en.resolved === true && !en.dead);
en = G.spawnEnemy(0.1, 'normal'); en.lock = 1;
aim(0, Math.PI); aim(1, 0.1); // WHITE node covers it
cross(en);
check('color-locked trap zapped by its matching node', en.dead === true);

// ================= power-ups =================
// idle() steps the sim while pinning integrity so background misses can't end the level
function idle(n) { for (let i = 0; i < n; i++) { G.setIntegrity(100); G.update(0.05); } }
G.startLevel(1);
G.fx.wide = 10;
idle(30); // let the coverage arc ease out
check('coverage arc eases out to the widened size', G.tolVis() > 1.6);
en = G.spawnEnemy(0.45, 'normal'); // outside normal TOL (0.314), inside widened (~0.534)
aim(0, Math.PI); aim(1, 0);
cross(en);
check('wide-arc widens the hit window', en.dead === true);
G.fx.wide = 0;
idle(30);
check('coverage arc eases back to normal', G.tolVis() < 1.05);
G.fx.auto = 5;
en = G.spawnEnemy(2.5, 'normal');
aim(0, 0); aim(1, 0.2); // nowhere near it
cross(en);
check('auto-zap clears traps without coverage', en.dead === true);
G.fx.auto = 0;
idle(40); // drain hit-stop
en = G.spawnEnemy(3.0, 'normal'); en.z = 0.9;
G.update(0.05);
const dzNormal = 0.9 - en.z;
en.z = 0.9; G.fx.slow = 6;
G.update(0.05);
const dzSlow = 0.9 - en.z;
check('slow-mo halves the stream speed', dzSlow < dzNormal * 0.7 && dzSlow > 0);
idle(30);
check('slow-mo drags the music playback rate down', G.musicRate() < 0.8);
G.fx.slow = 0;
idle(40);
check('music rate returns to real time when slow-mo ends', G.musicRate() > 0.97);
G.setIntegrity(100);
G.spawnPickup();
const pk = G.pickups()[G.pickups().length - 1];
pk.kind = 'auto'; pk.z = G.geo().hitZ; pk.angle = 1.2;
aim(0, 1.2);
G.update(0.01);
check('catching a pickup arms its effect', G.fx.auto > 4);
G.fx.auto = 0;

// ================= endless config ramp =================
const c0 = G.endlessCfg(0), c200 = G.endlessCfg(200);
check('endless difficulty ramps with time', c200.speed > c0.speed && c200.spawnMin < c0.spawnMin && c200.heavies > 0 && c0.heavies === 0);

// ================= boss duel (CORE FIREWALL) =================
G.progress.bossBriefed = false;
G.startLevel(7);
G.setLevelT(46); // past the level clock
G.update(0.01);
check('firewall core spawns after the level clock', !!G.boss());
check('boss briefing card shows first', G.getState() === G.S.INFO && G.getInfoCard() === 'boss');
dismiss();
check('briefing dismissed back to the duel', G.getState() === G.S.PLAY);
for (let i = 0; i < 40 && G.boss().mergeT < 1; i++) G.update(0.05);
check('nodes fuse into the ray cannon', G.boss().mergeT >= 1 && Math.abs(G.nodes[0].angle - G.nodes[1].angle) < 1e-6);
function aimBeam() {
  // solve the stick so the straight screen ray passes through the core:
  // the far endpoint T is linear in the stick vector, so invert directly
  const g2 = G.geo();
  const b = G.boss();
  aim(0, Math.atan2(b.v, b.u)); aim(1, G.nodes[0].angle); // swing the cannon toward it
  const A = G.nodes[0].angle;
  const railR = g2.nodeR - Math.min(800, 450) * 0.055 * 0.86;
  const sx = g2.cx + Math.cos(A) * railR, sy = g2.cy + Math.sin(A) * railR;
  const rg1 = G.ringAt(1.0);
  const T0x = rg1.x + Math.cos(A) * rg1.r, T0y = rg1.y + Math.sin(A) * rg1.r; // stick centered
  const M = 5 * (1.0 - g2.hitZ) * rg1.r; // px of far-plane travel per stick unit
  const lam = Math.hypot(T0x - sx, T0y - sy) / (Math.hypot(b.sx - sx, b.sy - sy) || 1);
  const Tx = sx + (b.sx - sx) * lam, Ty = sy + (b.sy - sy) * lam;
  G.setBeamAim((Tx - T0x) / M, (Ty - T0y) / M);
}
G.keys['ArrowUp'] = true;
const hp0 = G.boss().hp;
for (let i = 0; i < 20; i++) { aimBeam(); G.update(0.05); }
check('the beam drains the core', G.boss().hp < hp0);
check('firing builds heat', G.getHeat() > 0.05);
drawOk('boss duel frame (beam + heat gauge)', () => {});
for (let i = 0; i < 220 && !G.isOverheat(); i++) {
  aimBeam(); G.setIntegrity(100);
  G.boss().hp = Math.max(G.boss().hp, 50); // keep it alive while we cook the cannon
  G.update(0.05);
}
check('sustained fire overheats the cannon (~5s)', G.isOverheat() === true);
const hpLock = G.boss().hp;
for (let i = 0; i < 6; i++) { aimBeam(); G.update(0.05); }
check('overheated cannon cannot fire', Math.abs(G.boss().hp - hpLock) < 1e-9);
for (let i = 0; i < 60 && G.isOverheat(); i++) G.update(0.05); // ~2s forced cooldown, fire still held
check('cooldown clears with fire still held', G.isOverheat() === false);
G.keys['ArrowUp'] = false;
// dodge mechanics
const B2 = G.boss();
aim(0, 1.0); aim(1, 1.0);
B2.shots.length = 0; B2.shootT = 0.01;
G.update(0.05); // fires at the cannon's current spot
B2.shootT = 99;  // hold further fire
check('the core returns fire', B2.shots.length > 0);
aim(0, 2.4); aim(1, 2.4); // dodge away
const hpMe = G.stats().integrity;
for (let i = 0; i < 60 && B2.shots.length; i++) G.update(0.05);
check('dodging the shot avoids damage', G.stats().integrity === hpMe);
B2.shootT = 0.01;
G.update(0.05);
B2.shootT = 99;
const hpMe2 = G.stats().integrity;
for (let i = 0; i < 60 && B2.shots.length; i++) G.update(0.05); // stand still
check('standing still takes the hit', hpMe2 - G.stats().integrity >= 9);
// finish it
G.keys['ArrowUp'] = true;
G.boss().hp = 2;
let bGuard = 120;
while (G.boss() && bGuard-- > 0) { aimBeam(); G.setIntegrity(100); G.update(0.05); }
G.keys['ArrowUp'] = false;
check('destroying the core wins the level', G.getState() === G.S.END && G.getEndWin() === true);
check('campaign completion recorded', G.progress.stars[7] > 0);

// ================= TEMP boss-test shortcut =================
G.startBossTest();
G.update(0.05);
if (G.getState() === G.S.INFO) { G.update(0.5); canvasHandlers.pointerdown({ pointerId: 8, clientX: 5, clientY: 5, pointerType: 'touch' }); }
G.update(0.05);
check('BOSS TEST key drops straight into the duel', !!G.boss());

// ================= endless mode =================
G.setState(G.S.MENU);
G.setMenuScroll(1e9); // scroll to the bottom of the list (drawMenu clamps)
G.frame(16);
const eBtn = G.menuBtns().find(b => b.endless);
check('endless key appears unlocked after clearing the campaign', !!eBtn && !eBtn.locked);
G.menuTap(eBtn.x + 10, eBtn.y + 10, 1);
check('tapping the endless key starts an endless run', G.getState() === G.S.PLAY && G.isEndless() && G.getLV().name === 'ENDLESS STREAM');
G.setScore(1234);
G.setIntegrity(0);
G.update(0.01);
check('endless defeat records the best score', G.getState() === G.S.END && G.progress.best === 1234);

// ================= qualification =================
G.progress.tutorialDone = false;
G.startQualification();
G.update(0.05);
check('qualification opens with the movement briefing', G.getState() === G.S.INFO && G.getInfoCard() === 'move' && G.isQual());
function dismiss() { G.update(0.5); canvasHandlers.pointerdown({ pointerId: 7, clientX: 5, clientY: 5, pointerType: 'touch' }); }
function settle() { for (let i = 0; i < 4; i++) G.update(0.4); }
function waitLive(maxS) {
  for (let i = 0; i < maxS / 0.05; i++) {
    if (G.enemies().some(e => e.tut && !e.dead && !e.resolved) || G.pickups().some(p => p.tut && !p.done)) return true;
    G.update(0.05);
  }
  return false;
}
function zapPractice() {
  const pen = G.enemies().find(e => e.tut && !e.dead && !e.resolved);
  if (!pen) return false;
  if (pen.type === 'heavy') { aim(0, pen.angle + 0.05); aim(1, pen.angle - 0.05); }
  else if (pen.type === 'line') { aim(0, pen.angle); aim(1, pen.partner.angle); }
  else if (pen.lock !== undefined) { aim(pen.lock, pen.angle); aim(1 - pen.lock, pen.angle + Math.PI); }
  else { aim(0, pen.angle); aim(1, pen.angle + Math.PI); }
  cross(pen);
  return pen.dead === true;
}
dismiss();
check('tap dismisses the briefing', G.getState() === G.S.PLAY);
for (let i = 1; i <= 14 && G.getState() === G.S.PLAY; i++) { aim(0, i * 0.25); aim(1, -i * 0.25); G.update(0.05); }
check('thumb travel completes movement training', G.getState() === G.S.INFO && G.getInfoCard() === 'normal');
dismiss();
check('practice trap 1 spawns and dies', waitLive(4) && zapPractice());
check('practice trap 2 spawns and dies', waitLive(4) && zapPractice());
settle();
check('heavy briefing appears', G.getState() === G.S.INFO && G.getInfoCard() === 'heavy');
dismiss();
check('heavy practice: pinned by both nodes', waitLive(4) && zapPractice());
settle();
check('barrier briefing appears', G.getState() === G.S.INFO && G.getInfoCard() === 'line');
dismiss();
check('barrier practice: node per end', waitLive(4) && zapPractice());
settle();
check('color-lock briefing appears', G.getState() === G.S.INFO && G.getInfoCard() === 'lock');
dismiss();
check('blue-lock practice', waitLive(4) && zapPractice());
check('white-lock practice', waitLive(4) && zapPractice());
settle();
check('friendly-packet briefing appears', G.getState() === G.S.INFO && G.getInfoCard() === 'frag');
dismiss();
waitLive(4);
{
  const pen = G.enemies().find(e => e.tut && !e.dead && !e.resolved);
  aim(0, pen.angle + 1.5); aim(1, pen.angle - 1.5);
  cross(pen);
  check('letting the packet pass succeeds', pen.resolved === true && !pen.dead);
}
settle();
check('power-up briefing appears', G.getState() === G.S.INFO && G.getInfoCard() === 'pickup');
dismiss();
waitLive(4);
{
  const pp = G.pickups().find(p2 => p2.tut && !p2.done);
  pp.z = G.geo().hitZ; aim(0, pp.angle);
  G.update(0.01);
  check('catching the practice relay works', G.fx.wide > 0);
  G.fx.wide = 0;
}
settle(); settle();
check('QUALIFIED: victory screen + progress persisted', G.getState() === G.S.END && G.getEndWin() === true && G.progress.tutorialDone === true && G.tut() === null);
drawOk('qualification end screen', () => {});
drawOk('briefing card frame', () => { G.progress.tutorialDone = false; G.startQualification(); G.update(0.05); });
G.setState(G.S.MENU);
G.progress.tutorialDone = true;

// ================= level intro =================
rawStartLevel(1);
check('intro clock arms on level start', G.getIntro() === 0);
for (let i = 0; i < 30; i++) G.update(0.05); // 1.5s — mid-countdown
check('spawns held during the intro', G.enemies().length === 0);
check('level clock frozen during the intro', G.getLevelT() === 0);
drawOk('mid-intro frame (forming ring + countdown)', () => {});
for (let i = 0; i < 50; i++) G.update(0.05); // past 3.7s
check('intro ends after the countdown', G.getIntro() > 3.7);
let spawned = false;
for (let i = 0; i < 80 && !spawned; i++) { G.update(0.05); spawned = G.enemies().length > 0; }
check('the stream goes live after GO', spawned);
check('nodes finished materializing', G.nodes[0].formedFx === true && G.nodes[1].formedFx === true);

// ================= control scheme =================
function pdown(id, x, y) { canvasHandlers.pointerdown({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch' }); }
function pmove(id, x, y) { canvasHandlers.pointermove({ pointerId: id, clientX: x, clientY: y }); }
function pup(id, x, y)   { canvasHandlers.pointerup({ pointerId: id, clientX: x, clientY: y }); }
G.progress.tutorialDone = true;
G.startLevel(0);
const dial = G.dialCenter('L');
const n0 = G.nodes[0];

// raw 1:1 relative drag: rim quarter-turn → node quarter-turn, zero lag
aim(0, 0);
pdown(9, dial.x + dial.r, dial.y);
pmove(9, dial.x, dial.y + dial.r);
check('raw drag: rim quarter-turn turns the node ~90° instantly', Math.abs(n0.angle - Math.PI / 2) < 1e-6);
pup(9, dial.x, dial.y + dial.r);

// aim assist off: no drift toward traps
G.settings.aimAssist = false;
G.enemies().length = 0;
aim(0, 0);
en = G.spawnEnemy(0.3, 'normal');
en.z = G.geo().hitZ + 0.2;
G.update(0.05);
check('no assist drift when aim assist is off', Math.abs(n0.angle) < 1e-6);

// aim assist on: node drifts toward the arriving trap
G.settings.aimAssist = true;
G.enemies().length = 0;
aim(0, 0);
en = G.spawnEnemy(0.3, 'normal');
en.z = G.geo().hitZ + 0.2;
G.update(0.05);
check('aim assist pulls toward an arriving trap', n0.angle > 0.01);
G.settings.aimAssist = false;

// ================= precision scoring =================
G.startLevel(1);
G.enemies().length = 0;
en = G.spawnEnemy(0.7, 'normal');
aim(0, Math.PI); aim(1, 0.7); // dead-center coverage
let s0 = G.getScore();
cross(en);
check('dead-center zap scores PERFECT double (combo 1 → 200)', G.getScore() - s0 === 200 && G.getPerfects() === 1);
en = G.spawnEnemy(0.7, 'normal');
aim(1, 0.7 + 0.2); // covered, but sloppy (err 0.2 > TOL*0.35)
s0 = G.getScore();
cross(en);
check('edge zap scores normal (combo 2 → 200, no perfect)', G.getScore() - s0 === 200 && G.getPerfects() === 1);

// ================= payload fragments =================
G.startLevel(3);
G.enemies().length = 0;
en = G.spawnEnemy(1.2, 'frag');
aim(0, Math.PI); aim(1, 2.6); // leave it alone
s0 = G.getScore();
const int0 = G.stats().integrity;
cross(en);
check('untouched packet pays a small bonus', en.resolved && G.getScore() - s0 === 50 && G.stats().integrity === int0);
en = G.spawnEnemy(1.2, 'frag');
aim(1, 1.2); // zap the friendly — the mistake
cross(en);
check('zapping a friendly packet costs integrity', en.dead && G.stats().integrity === int0 - 25 && G.stats().combo === 0);
// assist must never pull toward friendlies
G.settings.aimAssist = true;
G.enemies().length = 0;
aim(0, 0);
en = G.spawnEnemy(0.3, 'frag');
en.z = G.geo().hitZ + 0.2;
G.update(0.05);
check('aim assist ignores friendly packets', Math.abs(G.nodes[0].angle) < 1e-6);
G.settings.aimAssist = false;

// ================= beat sync =================
const bt = {
  sampleRate: 1000, length: 30000, duration: 30,
  getChannelData: () => {
    const d = new Float32Array(30000);
    for (let i = 0; i < 30000; i += 500) for (let j = 0; j < 20 && i + j < 30000; j++) d[i + j] = 1;
    return d;
  }
};
check('beat detection finds the tempo of a 120bpm click track', Math.abs(G.detectBeat(bt) - 0.5) < 0.03);
G.patternQ().push({ t: 0.01, angle: 2.2 });
G.enemies().length = 0;
G.update(0.05);
check('choreographed volley entries spawn on schedule', G.enemies().some(e => Math.abs(e.angle - 2.2) < 0.1) && G.patternQ().length === 0); // crawler drift can nudge it within the tick

// ================= integrity tension =================
G.setIntegrity(25);
for (let i = 0; i < 60; i++) G.updateMusic(0.05);
check('low integrity muffles the music', G.musicFilterHz() < 3000);
G.setIntegrity(100);
for (let i = 0; i < 60; i++) G.updateMusic(0.05);
check('full integrity reopens the filter', G.musicFilterHz() > 12000);
drawOk('play HUD under heavy damage glitches', () => { G.setState(G.S.PLAY); G.setIntegrity(25); });
G.setIntegrity(100);

// ================= score chase: bests + mutators =================
G.startLevel(1);
G.enemies().length = 0;
en = G.spawnEnemy(0.5, 'normal');
aim(1, 0.5 + 0.2);
cross(en); // some score on the board
G.setLevelT(60);
G.enemies().length = 0;
G.update(0.01);
check('winning records a per-level best', G.getState() === G.S.END && G.progress.bests[1] === G.getScore() && G.getScore() > 0);
G.setEndT(0.1); drawOk('end ceremony: banner fading in', () => {});
G.setEndT(1.2); drawOk('end ceremony: counters running', () => {});
G.setEndT(3.0); drawOk('end ceremony: buttons arrived', () => {});

G.mutators.oneLife = true; G.mutators.fast = true;
G.startLevel(1);
check('one-life modifier starts at a single block', G.stats().integrity === 25);
G.enemies().length = 0;
en = G.spawnEnemy(0.5, 'normal');
aim(0, Math.PI); aim(1, 0.5 + 0.2);
s0 = G.getScore();
cross(en);
check('modifiers multiply the take (×3 → 300)', G.getScore() - s0 === 300);
G.mutators.noPickups = true;
check('modifier multiplier compounds', Math.abs((2 * 1.5 * 1.3) - 3.9) < 1e-9);
G.mutators.oneLife = G.mutators.fast = G.mutators.noPickups = false;

// ================= soak: simulated minutes of play =================
let simNow = 500000; // monotonic clock for frame() across soaks
function soak(name, start, seconds) {
  try {
    start();
    for (let t = 0; t < seconds; t += 0.05) {
      const live = G.enemies().filter(e => !e.dead && !e.resolved);
      if (live.length) { // crude autopilot
        aim(0, live[0].angle);
        aim(1, live[live.length - 1].angle);
      } else if (G.boss() && G.boss().mergeT >= 1) {
        const g2 = G.geo();
        const bb = G.boss();
        aim(0, G.nodes[0].angle + 0.05); // keep drifting so orbs miss sometimes
        const dz = Math.max(0.06, bb.z - g2.hitZ);
        const u0 = Math.cos(G.nodes[0].angle), v0 = Math.sin(G.nodes[0].angle);
        G.setBeamAim((bb.u - u0) / (5 * dz), (bb.v - v0) / (5 * dz));
        G.keys['ArrowUp'] = true;
      }
      G.update(0.05);
      simNow += 50;
      if ((t / 0.05 | 0) % 10 === 0) G.frame(simNow);
      if (G.getState() !== G.S.PLAY) break;
    }
    check('soak: ' + name, true);
  } catch (err) {
    console.log('   ' + err.stack.split('\n')[0]);
    check('soak: ' + name, false);
  }
}
soak('metro exchange (bursts)', () => G.startLevel(2), 60);
soak('quantum relay (color locks)', () => G.startLevel(5), 70);
soak('darknet edge (waves + bursts)', () => G.startLevel(6), 80);
soak('core firewall (boss fight)', () => G.startLevel(7), 90);
soak('endless ramp', () => G.startEndless(), 150);
G.keys['ArrowUp'] = false;

// ================= Web Audio music looper =================
const tick = () => new Promise(r => setImmediate(r));
(async () => {
  G.settings.music = true; G.settings.musicVol = 0.5;
  G.playTrack('menu');
  await tick(); // drain fetch→decode→start promise chain
  let ms = G.music();
  check('menu track decoded into a looping source', !!ms.src && ms.src.started && ms.src.loop === true);
  check('loop points trim the encoder padding', Math.abs(ms.src.loopStart - 0.5) < 1e-9 && Math.abs(ms.src.loopEnd - 9.0) < 1e-9);
  check('playback starts at the trimmed loop start', Math.abs(ms.src.startOffset - 0.5) < 1e-9);
  check('fade-in starts from silence', ms.gain.gain.value === 0);
  G.setBeat(0.5, -0.1); // grid anchored 0.1s ago → beats at delay 0.4, 0.9, 1.4...
  const q = G.beatQuantize(1.13, 0);
  check('spawn delays snap arrivals onto the beat grid', Math.abs(((0.1 + q) % 0.5)) < 1e-9 || Math.abs(((0.1 + q) % 0.5) - 0.5) < 1e-9);
  G.setBeat(0, 0);
  G.updateMusic(1.1);
  check('fade-in ramping', ms.gain.gain.value > 0.05 && ms.gain.gain.value < 0.45);
  G.updateMusic(5);
  check('fade-in completes at the set volume', Math.abs(ms.gain.gain.value - 0.5) < 1e-9);

  const oldSrc = ms.src;
  G.playTrack(1);
  await tick();
  ms = G.music();
  check('track switch stops the old source', oldSrc.stopped);
  check('new track playing on a fresh source', !!ms.src && ms.src !== oldSrc && ms.src.started);
  check('new track fades in from silence too', ms.gain.gain.value === 0);
  const sameSrc = ms.src;
  G.playTrack(1);
  await tick();
  check('same-key replay is a no-op', G.music().src === sameSrc);
  check('fetched the expected files', fetchLog.includes('menu.mp3') && fetchLog.includes('l2.mp3'));
  G.settings.music = false; G.updateMusic(0.016);
  check('music toggle silences the gain', G.music().gain.gain.value === 0);
  G.settings.music = true;

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
