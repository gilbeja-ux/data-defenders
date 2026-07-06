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
const canvasStub = {
  width: 0, height: 0, style: {},
  getContext: () => ctxStub,
  addEventListener() {}, setPointerCapture() {}
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
  constructor() { this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.started = false; this.stopped = false; }
  connect() {} disconnect() {}
  start(t, off) { this.started = true; this.startOffset = off; }
  stop() { this.stopped = true; }
}
class FakeAC {
  constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; }
  createGain() { return new FakeGain(); }
  createBufferSource() { return new FakeSrc(); }
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
  setMenuScroll: v => { menuScroll = v; }
};`;
eval(code);
const G = globalThis.__g;

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
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
G.nodes[0].angle = Math.PI; G.nodes[1].angle = 0.1;
cross(en);
check('normal zapped by single node', en.dead === true);

en = G.spawnEnemy(0.1, 'normal');
G.nodes[0].angle = Math.PI; G.nodes[1].angle = Math.PI / 2;
cross(en);
check('normal missed when no node covers', en.resolved === true && !en.dead);

en = G.spawnEnemy(0.1, 'heavy');
G.nodes[0].angle = Math.PI; G.nodes[1].angle = 0.1;
cross(en);
check('heavy survives a single node', en.resolved === true && !en.dead);

en = G.spawnEnemy(0.1, 'heavy');
G.nodes[0].angle = 0.15; G.nodes[1].angle = 0.05;
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
G.nodes[0].angle = 1.0; G.nodes[1].angle = 2.0;
cross(e1);
check('line zapped with node per end', e1.dead && e2.dead);

[e1, e2] = makeLine(1.0, 2.0);
G.nodes[0].angle = 2.0; G.nodes[1].angle = 1.0;
cross(e1);
check('line zapped with swapped node assignment', e1.dead && e2.dead);

[e1, e2] = makeLine(1.0, 2.0);
G.nodes[0].angle = 1.0; G.nodes[1].angle = 1.05;
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
G.nodes[0].angle = Math.PI; G.nodes[1].angle = 0.1;
cross(en);
check('zap spawns a lightning bolt', G.bolts().length > 0);
check('zap triggers hit-stop', G.hitStop() > 0);

// ================= color-locked traps =================
G.startLevel(5); // QUANTUM RELAY
en = G.spawnEnemy(0.1, 'normal'); en.lock = 1; // white node only
G.nodes[0].angle = 0.1; G.nodes[1].angle = Math.PI; // only the BLUE node covers it
cross(en);
check('color-locked trap ignores the wrong node', en.resolved === true && !en.dead);
en = G.spawnEnemy(0.1, 'normal'); en.lock = 1;
G.nodes[0].angle = Math.PI; G.nodes[1].angle = 0.1; // WHITE node covers it
cross(en);
check('color-locked trap zapped by its matching node', en.dead === true);

// ================= power-ups =================
G.startLevel(1);
G.fx.wide = 10;
en = G.spawnEnemy(0.45, 'normal'); // outside normal TOL (0.314), inside widened (0.534)
G.nodes[0].angle = Math.PI; G.nodes[1].angle = 0;
cross(en);
check('wide-arc widens the hit window', en.dead === true);
G.fx.wide = 0;
G.fx.auto = 5;
en = G.spawnEnemy(2.5, 'normal');
G.nodes[0].angle = 0; G.nodes[1].angle = 0.2; // nowhere near it
cross(en);
check('auto-zap clears traps without coverage', en.dead === true);
G.fx.auto = 0;
for (let i = 0; i < 40; i++) G.update(0.05); // drain hit-stop
en = G.spawnEnemy(3.0, 'normal'); en.z = 0.9;
G.update(0.05);
const dzNormal = 0.9 - en.z;
en.z = 0.9; G.fx.slow = 6;
G.update(0.05);
const dzSlow = 0.9 - en.z;
G.fx.slow = 0;
check('slow-mo halves the stream speed', dzSlow < dzNormal * 0.7 && dzSlow > 0);
G.spawnPickup();
const pk = G.pickups()[G.pickups().length - 1];
pk.kind = 'auto'; pk.z = G.geo().hitZ; pk.angle = 1.2;
G.nodes[0].angle = 1.2;
G.update(0.01);
check('catching a pickup arms its effect', G.fx.auto > 4);
G.fx.auto = 0;

// ================= endless config ramp =================
const c0 = G.endlessCfg(0), c200 = G.endlessCfg(200);
check('endless difficulty ramps with time', c200.speed > c0.speed && c200.spawnMin < c0.spawnMin && c200.heavies > 0 && c0.heavies === 0);

// ================= boss (CORE FIREWALL) =================
G.startLevel(7);
G.setLevelT(46); // past the level clock
G.update(0.01);
check('firewall core spawns after the level clock', !!G.boss());
const B = G.boss();
B.z = G.geo().hitZ; B.angle = 1.0; B.drift = 0;
G.nodes[0].angle = 1.0; G.nodes[1].angle = Math.PI; // one node parked on it
G.update(0.05);
check('node coverage drains the core', G.boss().hp < 8);
let guard = 200;
while (G.boss() && guard-- > 0) {
  G.boss().cd[0] = 0; G.boss().drift = 0; G.boss().angle = 1.0;
  G.nodes[0].angle = 1.0;
  G.update(0.05);
}
check('draining the core to zero wins the level', G.getState() === G.S.END && G.getEndWin() === true);
check('campaign completion recorded', G.progress.stars[7] > 0);

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

// ================= tutorial =================
G.progress.tutorialDone = false;
G.startLevel(0);
check('tutorial armed on the first run of level 1', !!G.tut());
G.update(1.1);
const tp1 = G.enemies().find(e => e.tut === 'L');
check('tutorial spawns a slow left-side practice trap', !!tp1 && tp1.speedMul < 0.5);
tp1.z = G.geo().hitZ;
G.nodes[0].angle = tp1.angle + 1.5; G.nodes[1].angle = tp1.angle - 1.5; // miss it
G.update(0.01);
check('missed practice trap costs nothing', G.stats().integrity === 100 && G.stats().misses === 0);
G.update(1.0);
const tp2 = G.enemies().find(e => e.tut && !e.resolved && !e.dead);
check('practice trap respawns after a miss', !!tp2);
tp2.z = G.geo().hitZ;
G.nodes[0].angle = tp2.angle;
G.update(0.01); G.update(0.01);
check('tutorial advances after the first zap', G.tut().step >= 2);
G.update(1.3); G.update(1.3);
const tp3 = G.enemies().find(e => e.tut === 'R' && !e.dead && !e.resolved);
check('right-thumb practice trap spawns', !!tp3);
tp3.z = G.geo().hitZ;
G.nodes[1].angle = tp3.angle;
G.update(0.01); G.update(0.01);
G.update(1.7); G.update(1.7);
check('tutorial completes and persists', G.tut() === null && G.progress.tutorialDone === true);
check('spawns held during tutorial', true);

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
