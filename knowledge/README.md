# Data Defenders — project notes (v0.13)

A mobile browser game. Single self-contained file: `data-defenders.html` (~8.4 MB, soundtrack embedded as base64). Open in any browser; designed for landscape phones, works on desktop with mouse + keyboard (A/D = left node, arrows = right node, Esc/P = pause).

## Concept

The player flies down a fiber-optic data tunnel escorting a golden data payload. Hackers implant "data traps" on the tunnel wall. Two nodes ride rails on a fixed holder ring — left thumb steers the blue node, right thumb the white node, each via a circular dial in the bottom corners (relative drag, 1:1, no snap). Align a node with an arriving trap to zap it; a trap that slips through corrupts the payload.

## Controls & mechanics

- Dual-thumb radial dials, relative movement, zero lag. Angular hit tolerance ±18° (`TOL = 0.314`).
- Traps arrive at the ring depth plane (`hitZ`, derived from geometry). Missed traps fly past the player and dissolve.
- 4 life blocks (right curved bar); each miss costs 25% integrity; 0 = payload corrupted (fail).
- Left curved green bar = level progress. Dial radars show live enemy blips (angle + proximity; blink when close).
- Combo multiplier up to x5 (100 pts base). Stars: 0 misses = 3★, 1 = 2★, 2–3 = 1★.
- 3 levels: Local Network (40s), City Grid (55s, double spawns), Global Backbone (70s, faster, drifting "crawler" traps).
- Progress + settings persist via localStorage (`dataDefenders.v1`).

## Soundtrack (by Gil, embedded at 96 kbps)

- Menu: View From The Dashboard
- L1: Sub Level Three · L2: Steel and Rain · L3: Terminal Velocity
- SFX are synthesized (WebAudio). Pause menu has toggles + volume sliders for both.

## Visual architecture (canvas 2D, no libs)

- Landscape-only: portrait screens render the whole game rotated 90° (`ROT`), input mapped inversely.
- Tunnel = dense prerendered "data annulus" texture (`wallTex`: ~650 broken arcs, 170 code strings, ticks, specks; blue/white/amber) stamped at 10 receding depths with per-band twist. Nearest band continues past the viewer and fades (no popping).
- Swerve: layered sines, horizontal + vertical, anchored at the ring plane (`q=0` at `hitZ`) so traps always arrive on the ring.
- Golden data river (190 particles) along the floor + ambient radial streaks; perspective code traffic drawn glyph-by-glyph along the tunnel axis, flowing both directions.
- Enemies: procedural — 13–18 branching wiry filaments (some glinting) around an 11–15 facet iridescent crystal cluster with molten core. Red = stealer, orange = crawler. Spawn beyond far plane, fade in.
- Atmosphere: depth fog, ring contact shadow, cold specular top-left + warm river reflection on the ring, vignette + cool/warm color grade.

## Key tuning knobs (search in file)

- `TOL` hit tolerance · `nodeR` ring size (0.44) · `bz` ring thickness (0.055)
- `LEVELS[]` durations/spawn rates/speeds · integrity damage (25)
- `wallTex` element counts · stamp count `N = 10` · `tunnelScroll` speeds (1.4 play / 0.5 menu)
- Dial size/position in `dialCenter()` (r = H*0.21)

## Known gaps / next ideas

- Sprite PNGs (tendril ball + crystal) never arrived as files — enemies are procedural approximations. Background reference image likewise.
- In-chat/desktop test widget exists but lags behind the file build.
- Ideas discussed: power-ups, more enemy types, boss traps, adaptive glyph count if mobile frame rate dips.
