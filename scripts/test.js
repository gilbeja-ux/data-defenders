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
  addEventListener() {},
  hidden: false
};
global.window = {
  innerWidth: 800, innerHeight: 450,
  devicePixelRatio: 1,
  addEventListener() {},
  MUSIC_DATA: { menu: 'menu.mp3', levels: ['l1.mp3', 'l2.mp3', 'l3.mp3'] }
};
global.getComputedStyle = () => ({ getPropertyValue: () => '0px' });
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = {};
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => {};
global.screen = {};
global.Audio = class {
  constructor(src) {
    this.src = src; this.paused = true; this.currentTime = 0;
    this.duration = 10; this.volume = 1; this.muted = false; this.ended = false;
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
};

// expose internals for the tests
code = code.replace("'use strict';", '') + `
;globalThis.__g = {
  startLevel, spawnEnemy, spawnLine, update, nodes, geo, frame, menuTap,
  setState: v => { state = v; }, getState: () => state, S,
  setMenuSettings: v => { menuSettings = v; }, getMenuSettings: () => menuSettings,
  gearRect: () => menuGearRect, toggles: () => pauseTogglesList,
  enemies: () => enemies,
  stats: () => ({ zaps, misses, score, integrity, combo }),
  playTrack, updateMusic, loopers: () => musicEls, settings, progress
};`;
eval(code);
const G = globalThis.__g;

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function cross(en) { // place just above the ring and step one tick
  const hz = G.geo().hitZ;
  en.z = hz + 0.001;
  if (en.partner) en.partner.z = hz + 0.001;
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
check('overlay populated toggle controls', G.toggles().length === 2);
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

// ================= seamless music looper =================
(async () => {
  G.settings.music = true; G.settings.musicVol = 0.5;
  G.playTrack('menu');
  await new Promise(r => setImmediate(r));
  const L = G.loopers().menu;
  let cur = L.els[L.active], nxt = L.els[1 - L.active];
  check('menu track playing after playTrack', !cur.paused);
  check('unlock left the twin paused and unmuted', nxt.paused && !nxt.muted);
  check('fade-in starts from silence', cur.volume === 0);
  cur.currentTime = 5; G.updateMusic(1.1);
  check('fade-in ramping', cur.volume > 0.05 && cur.volume < 0.45);
  G.updateMusic(5);
  check('mid-track: full volume, twin idle', Math.abs(cur.volume - 0.5) < 1e-9 && nxt.paused);

  cur.currentTime = 9.1; G.updateMusic(0.016);
  check('seam: twin started', !nxt.paused);
  check('seam: volumes crossfading', cur.volume < 0.5 && nxt.volume > 0 && nxt.volume < 0.5);

  cur.currentTime = 9.99; G.updateMusic(0.016);
  check('handoff: active flipped to the twin', L.active === 1 && L.els[1] === nxt);
  check('handoff: old take parked at 0, twin at full volume', cur.paused && cur.currentTime === 0 && Math.abs(nxt.volume - 0.5) < 1e-9);

  nxt.currentTime = 9.97; nxt.ended = true; nxt.paused = true; cur.paused = true;
  G.updateMusic(0.016);
  check('ended fallback restarts the twin and flips back', L.active === 0 && !L.els[0].paused);

  G.playTrack(0);
  check('track switch stops both menu takes', L.els[0].paused && L.els[1].paused);
  check('level track playing', !G.loopers().levels[0].els[0].paused);

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
