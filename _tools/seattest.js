'use strict';
/* Does each object's base sit ON the floor, how far does it travel, and how
   much of itself does the sheet hide? 1440x900, no pointer, 96s of scene
   time from 1s in: two whole swell-event cycles (EVENT_MS 48s, an event
   running for EVENT_SPAN of each), every frame drawn (?bgq=0).

   1. Seating, one base of each kind of object (each RIDGES and BANDS entry,
      the first conifer and the first tree: the base nearest the card's left
      edge). For a thing standing at screen x and depth d, the floor's
      screen y there is surfacePoint(worldX(x, d), d, t)[1]. The renderer
      stands every base there in its vertex shader (scenery-twin.js is that
      math in JS; check-wave-parity.js holds the real shader to it), so the
      gap is 0 by construction: check-seat.js holds it over every base, this
      prints it with how far the base travels. The gap is drawn y - floor y
      at the base's own depth, and canvas y grows downward: POSITIVE is sunk
      into the floor, negative floating above it. (The legend said the
      opposite until the docs pass: a mutant that sank every base 18px
      printed +18.00 px under "positive = floating".) Exit 1 unless every
      gap is within 1e-6 px.

      Travel two ways, from twin runs on one clock: run B has the swell
      events patched out (EVF.on never set), so its travel (highest less
      lowest) is the ambient swell's alone; A - B, the most a base is moved
      at any moment by the events of the run (the first two of a visit,
      both hills: scene.js EVENT_SEED), is the events' own part.

   2. The near floor, the same two ways, at d = 1.25 in the middle of the
      left gutter.

   3. How much the sheet hides of itself, as information. A row crossing is
      a farther row drawn BELOW a nearer one in the same column of pixels,
      so it is measured at one SCREEN column: there the world x moves with
      depth (xw = worldX(sx, d)), and the swell's xw terms change along it
      far faster than its d terms (audit G1.5). Every 4th px column of the
      gutters the card leaves (harness.cssCard), every 30th frame:
        rows      the drawn rows - ROWS of them at the renderer's own row
                  depths, 1 + (DMAX - 1) * (r / (ROWS - 1))^ROW_POW, only
                  where a row is drawn (|sn| <= XSPAN) - each against the
                  one in front of it, and against the floor in front of it
                  (the highest the sheet nearer than the row rises in that
                  column, swept every 0.02 of depth from the floor's near
                  edge, MESH_NEAR: the blank apron is opaque floor too),
                  with the bodies' wells (the full wave) and without them
                  (waveBase)
        terrain   every depth the scenery stands at (RIDGES, BANDS, TREES,
                  CONIFERS), each against the next nearer one: a base drawn
                  below a nearer one is behind the floor between them
      Since W2a the floor is opaque and depth-tested: a crossing is drawn
      as the crest in front hiding what is behind it, and
      check-webgl-floor.js (the floor) and check-webgl-terrain.js (the
      bases) find every pixel showing the nearest surface. On the Canvas
      wireframe it showed as braided rows (audit G1.1). This used to sample
      a fixed WORLD x and 34 rows where the page draws 20, and to call the
      accepted state "FOLDED" (audit F54).

   4. Swell events beyond the run: each of the first 200 of a visit at its
      height (the envelope at 1), from the scene's own prepEvent and
      swellEvent - how far it lifts or drops each base, and the near floor
      in the gutters (d 1 to 2) - and how many move a base showing in the
      gutters by more than 5px.

   Loads the background scripts under SITE_ROOT through harness.js. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const sim = H.load({ W: 1440, H: 900, dpr: 2, search: '?bgq=0' });
{
  const Bg0 = sim.window.Bg;
  if (!(Bg0 && Bg0.renderers && Bg0.renderers.webgl && Bg0.renderers.webgl.sceneryMesh)) {
    console.log('seattest: SKIP - no WebGL scenery under ' + H.ROOT + ' (before W2b): its bases are placed by its vertex shader, measured through scenery-twin.js');
    process.exit(0);
  }
}
/* B: the same page with no swell events */
const simB = H.load({ W: 1440, H: 900, dpr: 2, search: '?bgq=0', patches: [['EVF.on = k > 0 && k < 1;', 'EVF.on = false;']] });
const P = sim.P, PB = simB.P;
for (let i = 0; i < 60; i++) { sim.frame(16.7); simB.frame(16.7); }

const tw = Twin.make(sim.window.Bg), twB = Twin.make(simB.window.Bg), b = tw.bases(), f = Math.fround;
const card = H.cssCard(P.W);
const R = H.rendererNumbers(['ROW_POW', 'MESH_NEAR']);
const OUT = [0, 0, 0, 0];

/* the bases, and the near floor */
const things = [
  ['far ridge', P.RIDGES[0].d, true], ['mid ridge', P.RIDGES[1].d, true],
  ['far peaks', P.BANDS[0].d, true], ['near peaks', P.BANDS[1].d, true],
  ['conifer', P.CONIFERS[0].d, false], ['tree', P.TREES[0].d, false]
].map(([tag, d, massif]) => {
  const list = massif ? b.massif.filter(i => tw.massif(i).d === f(d)) : b.root.filter(i => tw.stroke(i).d === f(d));
  const at = i => (massif ? tw.massifAt(i, P.simNow, OUT) : tw.strokeAt(i, P.simNow, OUT))[0];
  const k = list.length ? list.reduce((a, i) => (Math.abs(at(i) - card.left) < Math.abs(at(a) - card.left) ? i : a), list[0]) : -1;
  /* its own depth, as its mesh stores it: a float32 (6.49 is 6.4899998,
     which alone is 1e-5 px of gap) */
  const dk = k < 0 ? d : massif ? tw.massif(k).d : tw.stroke(k).d;
  return { tag, d, massif, k, dk, worst: 0, travel: span(), event: 0 };
});
function span() { return { lo: Infinity, hi: -Infinity }; }
const add = (s, v) => { if (v < s.lo) s.lo = v; if (v > s.hi) s.hi = v; };
const nearX = card.left / 2, nearD = 1.25, near = { travel: span(), event: 0 };

/* the drawn rows, as the renderer draws them, and the scenery's depths */
const rowD = [];
for (let r = 0; r < P.ROWS; r++) rowD.push(1 + (P.DMAX - 1) * Math.pow(r / (P.ROWS - 1), R.ROW_POW));
const TERRAIN_D = [...new Set([...P.RIDGES, ...P.BANDS, ...P.TREES, ...P.CONIFERS].map(o => o.d))].sort((p, q) => p - q);
const COLX = [];
for (let sx = 2; sx < P.W; sx += 4) if (sx < card.left || sx > card.right) COLX.push(sx);
/* the sheet at screen column sx and depth d: its y with the wells (wave,
   through surfacePoint) or without them (waveBase), and whether a row is
   drawn there at all (|sn| <= XSPAN) */
const yFull = (sx, d, t) => P.surfacePoint(P.worldX(sx, d), d, t)[1];
const yBase = (sx, d, t) => P.restAt(d) + (P.waveBase(P.worldX(sx, d), d, t) * P.H * P.WAVE_Y) / d;
const drawnAt = (sx, d) => Math.abs((sx - P.centreX(d)) / (P.W * P.PERSP_X)) <= P.XSPAN;
const worst = () => ({ v: 0, at: null });
const S = { rowFull: worst(), rowBase: worst(), hidFull: worst(), hidBase: worst(), terr: worst() };
const note = (s, v, at) => { if (v > s.v) { s.v = v; s.at = at; } };
let framesWith = 0, framesSampled = 0;
function foldScan(t) {
  framesSampled++;
  let crossed = false;
  for (const sx of COLX) {
    for (const [y, rowS, hidS] of [[yFull, S.rowFull, S.hidFull], [yBase, S.rowBase, S.hidBase]]) {
      let crest = Infinity, k = 0, prev = null;
      for (let d = R.MESH_NEAR; k < rowD.length; d += 0.02) {
        if (d >= rowD[k]) {
          const dr = rowD[k];
          if (drawnAt(sx, dr)) {
            const yr = y(sx, dr, t), where = 'row ' + k + ' (d=' + dr.toFixed(2) + ') at x=' + sx + ', ' + (t / 1000).toFixed(1) + 's';
            if (prev && prev.k === k - 1) {
              note(rowS, yr - prev.y, where);
              if (yr - prev.y > 0.5 && y === yFull) crossed = true;
            }
            note(hidS, yr - crest, where);
            prev = { k, y: yr };
          }
          k++;
        }
        crest = Math.min(crest, y(sx, d, t));
      }
    }
    for (let k = 1; k < TERRAIN_D.length; k++) {
      note(S.terr, yFull(sx, TERRAIN_D[k], t) - yFull(sx, TERRAIN_D[k - 1], t),
           'd=' + TERRAIN_D[k - 1] + ' -> ' + TERRAIN_D[k] + ' at x=' + sx + ', ' + (t / 1000).toFixed(1) + 's');
    }
  }
  if (crossed) framesWith++;
}

const FRAMES = Math.round((2 * P.EVENT_MS) / 16.7);
let events = 0, wasOn = false;
const OUTB = [0, 0, 0, 0];
for (let i = 0; i < FRAMES; i++) {
  sim.frame(16.7); simB.frame(16.7);
  const t = P.simNow;
  if (P.EVF.on && !wasOn) events++;
  wasOn = P.EVF.on;
  for (const o of things) {
    if (o.k < 0) continue;
    const p = o.massif ? tw.massifAt(o.k, t, OUT) : tw.strokeAt(o.k, t, OUT);
    const floorY = P.surfacePoint(P.worldX(p[0], o.dk), o.dk, t)[1], gap = p[1] - floorY;
    if (!(Math.abs(gap) <= Math.abs(o.worst))) o.worst = gap;
    const q = o.massif ? twB.massifAt(o.k, PB.simNow, OUTB) : twB.strokeAt(o.k, PB.simNow, OUTB);
    add(o.travel, q[1]);
    o.event = Math.max(o.event, Math.abs(p[1] - q[1]));
  }
  const ny = yFull(nearX, nearD, t), nyB = PB.surfacePoint(PB.worldX(nearX, nearD), nearD, PB.simNow)[1];
  add(near.travel, nyB);
  near.event = Math.max(near.event, Math.abs(ny - nyB));
  if (i % 30 === 0) foldScan(t);
}
if (PB.EVF.on || events !== 2) {
  console.log('seattest: FAIL - the run has ' + events + ' swell events (need 2), and the twin without them '
              + (PB.EVF.on ? 'has one' : 'none'));
  process.exit(1);
}

const len = s => (s.hi - s.lo).toFixed(1).padStart(8) + ' px';
console.log('bases on the floor, ' + P.W + 'x' + P.H + ', ' + (FRAMES * 16.7 / 1000).toFixed(0) + 's (two swell-event cycles), no pointer:');
console.log('  gap = drawn y - floor y: positive = sunk into the floor, negative = floating above it');
console.log("  swell travel: the ambient swell's, highest less lowest (a twin run with the events patched out);");
console.log("  events moved it: the most the run's " + events + ' swell events moved it at any moment');
console.log('');
console.log('  object        depth    worst gap     swell travel   events moved it');
let worstSeat = 0;
for (const o of things) {
  if (o.k < 0) { console.log('  ' + o.tag.padEnd(13) + ' no base at d=' + o.d); worstSeat = Infinity; continue; }
  if (!(Math.abs(o.worst) <= Math.abs(worstSeat))) worstSeat = o.worst;
  console.log('  ' + o.tag.padEnd(13) + o.d.toFixed(2).padStart(6) + (o.worst.toExponential(1) + ' px').padStart(12)
              + '  ' + len(o.travel) + '  ' + (o.event.toFixed(1) + ' px').padStart(11));
}
console.log('  near floor    ' + nearD.toFixed(2).padStart(6) + '  (x=' + nearX + ')   ' + len(near.travel)
            + '  ' + (near.event.toFixed(1) + ' px').padStart(11));

const px = s => s.v.toFixed(2).padStart(7) + ' px' + (s.at ? '  (' + s.at + ')' : '');
console.log('');
console.log('the sheet hiding itself, at one screen column in the gutters (x < ' + card.left + ' or > ' + card.right
            + '), every 30th frame - information: the floor is opaque and depth-tested');
console.log('  ' + P.ROWS + ' drawn rows, a row below the one in front of it (worst)');
console.log('    with the bodies\' wells    ' + px(S.rowFull));
console.log('    without them (waveBase)   ' + px(S.rowBase));
console.log('  ' + P.ROWS + ' drawn rows, below the floor in front of them (hidden behind a nearer crest; worst)');
console.log('    with the bodies\' wells    ' + px(S.hidFull));
console.log('    without them (waveBase)   ' + px(S.hidBase));
console.log('  rows crossing by over 0.5 px in ' + framesWith + ' of ' + framesSampled + ' sampled frames');
console.log('  terrain depths (' + TERRAIN_D.join(', ') + '), a base below the next nearer one');
console.log('                              ' + px(S.terr));
/* 4. the first 200 swell events of a visit, each at its height */
{
  const NEV = 200, OUT4 = [0, 0, 0, 0], bases = [];
  for (const k of b.massif) { tw.massifAt(k, P.simNow, OUT4); const m = tw.massif(k); bases.push({ x: OUT4[0], d: m.d, kind: m.slides ? 'peaks' : 'ridges' }); }
  for (const k of b.root) { tw.strokeAt(k, P.simNow, OUT4); const s = tw.stroke(k); bases.push({ x: OUT4[0], d: s.d, kind: 'trees and conifers' }); }
  const shows = x => x >= 0 && x <= P.W && (x < card.left || x > card.right);
  const lift = (x, d) => (Math.abs(P.swellEvent(P.worldX(x, d), d)) * P.H * P.WAVE_Y) / d;
  const most = {};
  let seen = 0, hills = 0, nearMost = 0;
  const keepT = P.EVF.t;   /* the event state the run ended in, put back after */
  for (let n = 0; n < NEV; n++) {
    P.EVF.t = -1;
    P.prepEvent((n + P.EVENT_IN + P.EVENT_SPAN / 2) * P.EVENT_MS);
    if (!P.EVF.on) { console.log('seattest: FAIL - swell event ' + n + ' is not running at its middle'); process.exit(1); }
    if (P.EVF.sign > 0) hills++;
    let vis = 0;
    for (const q of bases) {
      const v = lift(q.x, q.d);
      most[q.kind] = Math.max(most[q.kind] || 0, v);
      if (shows(q.x)) vis = Math.max(vis, v);
    }
    if (vis > 5) seen++;
    for (const x of COLX) for (let d = 1; d <= 2 + 1e-9; d += 0.05) nearMost = Math.max(nearMost, lift(x, d));
  }
  P.EVF.t = -1; P.prepEvent(keepT);
  console.log('');
  console.log('the first ' + NEV + ' swell events of a visit, each at its height (' + hills + ' hills, ' + (NEV - hills) + ' valleys):');
  console.log('  ' + seen + ' (' + Math.round((100 * seen) / NEV) + '%) move a base showing in the gutters by more than 5 px');
  console.log('  the most one moves a base: ' + Object.entries(most).map(([k, v]) => k + ' ' + v.toFixed(1) + ' px').join(', '));
  console.log('  the near floor in the gutters (d 1 to 2): up to ' + nearMost.toFixed(0) + ' px');
}

console.log('');
if (!(Math.abs(worstSeat) <= 1e-6)) {
  console.log('seattest: FAIL - a base is ' + (worstSeat > 0 ? 'sunk ' : 'floating ') + Math.abs(worstSeat).toExponential(2) + ' px off the floor');
  process.exit(1);
}
console.log('seattest: OK - every base checked is on the floor (worst ' + Math.abs(worstSeat).toExponential(1)
            + ' px); the crossings above are the sheet hiding itself, which the depth buffer draws');
