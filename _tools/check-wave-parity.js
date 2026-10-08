'use strict';
/* One wave: the shader's sheet is the scene's sheet.

   The scene keeps its wave on the CPU (the terrain stands on it, the bodies
   roll on its slope, the cursor's well is put on the sheet through it), and
   the WebGL renderer draws the floor from a GLSL copy that render-webgl.js
   writes from the scene's own numbers when it loads (WAVE, DEPTH_W, CUR_*,
   WELL_*, EVENT_*). This holds the two together.

   Static: render-webgl.js may not write any of the wave's numbers itself -
   no swell speed (a kt of WAVE) as a literal, and no hand-written term of
   the form "xw * <number>" or "d * <number>" in its code.

   Live, in headless Chrome on glkit's clock, at 1440x900@1.5 and 390x844@3:
   a renderer of its own on a detached canvas (the page's is not reachable,
   and need not be: the probe reads the same scene), driven through scene
   states by Bg.advance - scene time 0; the pointer's dents in the left
   gutter; the first swell event, the pointer moving; and that state again
   at scene times of 1 and 10 hours, for the swell's phase. In each, the
   shader's wave and its projection (probeWave: the sheet's height and its
   screen x, y) at ~2,800 points - a grid over the whole mesh (sn in
   +-XSPAN, d over the mesh's own span, sheetMesh's nearest row to its
   farthest: 0.35 to 6.8) and dense patches around each body's well,
   each dent and the event - against Bg.wave and Bg.surfacePoint at the
   same (float32-rounded) points. Then once more with scene.js served with
   the swell's table retuned (the first term's amplitude 0.96 -> 1.5): the
   shader must follow the table, not a copy of it.

   Limits: the wave within 1e-3 world units (the task's tolerance; float32
   gives ~1e-5), the screen position within 0.05 CSS px. The states must
   reach every term: a dent of 0.5 or more, a well of 1 or more and an event
   term of 0.5 or more somewhere among the points.

   The scenery stands on the same wave (W2b). In the swell event's state,
   and in one with the pointer parked on a tree's canopy (so the bloom is
   in play, scene.js THE BLOOM: a tree's pieces moving a stroke end 5 * S px
   or more), the
   shader's own placement of every massif corner and every tree and
   conifer end (renderer.probeScenery) against the shader's math in JS
   from the scene's functions (scenery-twin.js), within 0.05 CSS px; and
   the seating itself, against the sheet: every corner on the ground (the
   base of every ridge and peak) and every tree's and conifer's root must
   lie on the scene's floor under where the shader drew it - surfacePoint
   at (worldX(x, d), d) - within 0.05 CSS px. The retuned run also serves
   KEEP_R 46 -> 80: the trees' pose must follow the scene's
   constant, not a copy of it. SKIP without puppeteer-core or Chrome. Exit
   1 on failure. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');
const K = require('./glkit');
const H = require('./harness');
const Twin = require('./scenery-twin');

const WAVE_TOL = 1e-3, PX_TOL = 0.05, SEAT_TOL = 0.05;
const fails = [];

/* ---- static ------------------------------------------------------------ */
const webglFile = path.join(H.ROOT, 'assets', 'js', 'bg', 'render-webgl.js');
const sceneFile = path.join(H.ROOT, 'assets', 'js', 'bg', 'scene.js');
if (!fs.existsSync(webglFile) || !fs.existsSync(sceneFile)) {
  console.log('check-wave-parity: SKIP - no assets/js/bg/render-webgl.js and scene.js under ' + H.ROOT);
  process.exit(0);
}
const code = fs.readFileSync(webglFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const sim = H.load({ W: 1440, H: 900 });
const WAVE = sim.window.Bg.WAVE;
if (!Array.isArray(WAVE) || !WAVE.length) fails.push('scene.js exports no WAVE table');
else {
  for (const w of WAVE) {
    const s = String(Math.abs(w.kt));
    if (code.includes(s)) fails.push('render-webgl.js writes the swell speed ' + s + ' itself (it must come from Bg.WAVE)');
  }
}
const hand = code.match(/\b(?:xw|d)\s*\*\s*\(?-?\d/g);
if (hand) fails.push('render-webgl.js has hand-written wave terms: ' + hand.slice(0, 3).join(', '));
if (!/\bWAVE\b/.test(code)) fails.push('render-webgl.js does not read Bg.WAVE');

/* ---- live -------------------------------------------------------------- */
/* in the page: drive the scene, probe, compare */
function inPage(WT, PT, ROW_POW) {
  const Bg = window.Bg;
  const c = document.createElement('canvas');
  const r = Bg.renderers.webgl && Bg.renderers.webgl(c);
  if (!r || !r.probeWave) return { error: 'no WebGL renderer with a probe' };
  r.resize(Bg.W, Bg.H, 1);
  const f = Math.fround;
  /* the mesh's own depth span, and its ends on the rows' parametrisation
     (d = 1 + (DMAX - 1) * sign(u) * |u|^ROW_POW, the renderer's own) */
  const mesh = Bg.renderers.webgl.sheetMesh();
  let dLo = Infinity, dHi = 0;
  for (let i = 1; i < mesh.length; i += 2) { dLo = Math.min(dLo, mesh[i]); dHi = Math.max(dHi, mesh[i]); }
  const uOf = d => Math.sign(d - 1) * Math.pow(Math.abs(d - 1) / (Bg.DMAX - 1), 1 / ROW_POW);
  const U0 = uOf(dLo), U1 = uOf(dHi), NU = Math.ceil((U1 - U0) / (1.04 / 28));
  function points() {
    const P = [];
    const add = (xw, d) => { if (d >= dLo && d <= dHi) P.push(f(xw), f(d)); };
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= NU; j++) {
        const sn = -Bg.XSPAN + (2 * Bg.XSPAN * i) / 40, u = U0 + ((U1 - U0) * j) / NU;
        const d = Math.min(dHi, Math.max(dLo, 1 + (Bg.DMAX - 1) * Math.sign(u) * Math.pow(Math.abs(u), ROW_POW)));
        add(sn * d, d);
      }
    }
    const patch = (cx, cd, rx, rd, n) => {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) add(cx + rx * (2 * i / (n - 1) - 1), cd + rd * (2 * j / (n - 1) - 1));
    };
    for (const b of Bg.bodiesW) patch(b.xw, b.d, 0.5, 0.9, 9);
    for (const w of [Bg.CUR, Bg.RIP]) if (w.on > 0) patch(w.xw, w.d, 0.9, 1.6, 9);
    if (Bg.EVF.on) patch(Bg.EVF.cx, Bg.EVF.cd, 2, 4, 9);
    return P;
  }
  const res = [];
  function compare(label, t) {
    const P = points();
    const got = r.probeWave(P, t);
    if (!got) { res.push({ label, error: 'probeWave returned nothing' }); return; }
    let ew = 0, ex = 0, ey = 0, at = null, dent = 0, well = 0, evt = 0;
    for (let i = 0; i < P.length / 2; i++) {
      const xw = P[2 * i], d = P[2 * i + 1];
      const w = Bg.wave(xw, d, t), sp = Bg.surfacePoint(xw, d, t);
      const a = Math.abs(got[3 * i] - w), bx = Math.abs(got[3 * i + 1] - sp[0]), by = Math.abs(got[3 * i + 2] - sp[1]);
      if (a > ew) { ew = a; at = [xw, d, w, got[3 * i]]; }
      ex = Math.max(ex, bx); ey = Math.max(ey, by);
      dent = Math.max(dent, Math.abs(Bg.dentAt(xw, d)));
      well = Math.max(well, Math.abs(w - Bg.waveBase(xw, d, t)));
      evt = Math.max(evt, Math.abs(Bg.swellEvent(xw, d)));
    }
    res.push({ label, n: P.length / 2, ew, ex, ey, at, dent, well, evt });
  }
  let now = 0;
  const adv = (n, dt) => { for (let i = 0; i < n; i++) { now += dt; Bg.advance(now); } };
  Bg.resetClock();
  compare('scene time 0', Bg.simNow);
  Bg.pointerAt(0.11 * Bg.W, 0.80 * Bg.H);
  adv(40, 16.7);
  compare('dents', Bg.simNow);
  for (let i = 0; i < 200 && !(Bg.EVF.on && Bg.simNow > 12000); i++) {
    Bg.pointerAt((0.11 + 0.08 * Math.sin(i * 0.05)) * Bg.W, (0.78 + 0.1 * Math.sin(i * 0.03)) * Bg.H);
    adv(1, 64);
  }
  compare('swell event', Bg.simNow);
  compare('1 hour in', WT);
  compare('10 hours in', PT);
  /* the scenery: the shader's placement against its math in JS, and the
     seating against the floor, in each state again and with a push on */
  const tw = window.__sceneryTwin(Bg);
  const scen = [];
  function seats(label, t) {
    const got = r.probeScenery && r.probeScenery(t);
    if (!got) { scen.push({ label, error: 'probeScenery returned nothing' }); return; }
    const OUT = [0, 0], S4 = [0, 0, 0, 0];
    let ex = 0, seat = 0, nBase = 0, nRoot = 0, at = null, slide = 0, dip = 0, bend = 0;
    for (let i = 0; i < tw.massifs; i++) {
      const p = tw.massifAt(i, t, OUT), m = tw.massif(i);
      const e = Math.max(Math.abs(got.massif[2 * i] - p[0]), Math.abs(got.massif[2 * i + 1] - p[1]));
      if (e > ex) { ex = e; at = 'massif corner ' + i; }
      if (m.h === 0) {
        nBase++;
        const x = got.massif[2 * i], y = got.massif[2 * i + 1];
        seat = Math.max(seat, Math.abs(y - Bg.surfacePoint(Bg.worldX(x, m.d), m.d, t)[1]));
      }
      if (m.h > 0) {
        const q = tw.massifRest(i, t, [0, 0]);
        slide = Math.max(slide, Math.abs(p[0] - q[0]));
        /* a facet's corner (a cut point's height is also its edge's
           straightening: render-webgl.js massifAt) */
        if (!m.cut) dip = Math.max(dip, Math.abs((tw.floorAt(p[0], m.d, t) - p[1]) - m.h));
      }
    }
    for (let i = 0; i < tw.strokes; i++) {
      const p = tw.strokeAt(i, t, S4), s = tw.stroke(i);
      for (let k = 0; k < 4; k++) {
        const e = Math.abs(got.stroke[4 * i + k] - p[k]);
        if (e > ex) { ex = e; at = 'stroke vertex ' + i; }
      }
      if (i % 6 === 0 && s.p1[0] === 0 && s.p1[1] === 0) {
        nRoot++;
        const x = got.stroke[4 * i], y = got.stroke[4 * i + 1];
        seat = Math.max(seat, Math.abs(y - Bg.surfacePoint(Bg.worldX(x, s.d), s.d, t)[1]));
      }
      const q = tw.strokeRest(i, t, [0, 0, 0, 0]);
      bend = Math.max(bend, Math.abs(p[2] - q[2]));
    }
    scen.push({ label, n: tw.massifs + tw.strokes, ex, at, seat, nBase, nRoot, slide, dip, bend,
                curlMin: 5 * Bg.S });
  }
  seats('the swell event', Bg.simNow);
  {
    /* parked on the first tree's canopy until the bloom there is full: the
       tree comes apart its furthest - the card set aside (at 390x844 it covers
       the tree, and nothing blooms under the card: this asks only whether
       the shader places a bloom as the twin does) */
    const c = Bg.TREES[0], rest = Bg.restAt(c.d);
    Bg.setCard();
    Bg.pointerAt(Bg.standX(c.fx, c.d), rest - 0.6 * c.h);
    adv(330, 16.7);
  }
  seats('a bloom on', Bg.simNow);
  return { res, scen, gl2: !!c.getContext('webgl2') };
}

async function main() {
  const why = B.unavailable();
  if (why) {
    if (fails.length) report(); else console.log('check-wave-parity: SKIP - ' + why);
    return;
  }
  const site = await B.serve();
  const b = await B.launch();
  const notes = [];
  let worst = { ew: 0, ex: 0, ey: 0 }, reach = { dent: 0, well: 0, evt: 0 }, n = 0, retuned = null;
  const scenery = { ex: 0, seat: 0, n: 0, dip: 0, slide: 0, bend: 0, bases: 0 };
  try {
    const runs = [['1440x900@1.5', 1440, 900, 1.5, null], ['390x844@3', 390, 844, 3, null], ['1440x900@1.5, WAVE retuned', 1440, 900, 1.5, 'retune']];
    for (const [label, w, h, dpr, mode] of runs) {
      let routes = null;
      if (mode === 'retune') {
        const src = fs.readFileSync(sceneFile, 'utf8');
        const from = '{ kx: 4.2, kd: 0.34, kt: 0.00035, amp: 0.96 }', push = 'const KEEP_R = 46,';
        if (!src.includes(from)) { fails.push('cannot retune WAVE: scene.js has no ' + from); continue; }
        if (!src.includes(push)) { fails.push('cannot retune the trees\' turn: scene.js has no ' + push); continue; }
        routes = { [new URL('assets/js/bg/scene.js', site.url).pathname]: { body: src.replace(from, '{ kx: 4.2, kd: 0.34, kt: 0.00035, amp: 1.5 }').replace(push, 'const KEEP_R = 80,'),
                                                                            contentType: 'text/javascript' } };
      }
      const s = await b.open(site.url + 'index.html?bgq=0', { width: w, height: h, dpr, init: K.CLOCK + '\n' + Twin.SOURCE, routes });
      try {
        const out = await s.evaluate(inPage, 3.6e6, 3.6e7, H.rendererNumbers(['ROW_POW']).ROW_POW);
        for (const e of s.errors) fails.push(label + ': ' + e.type + ': ' + e.text);
        if (out.error) { fails.push(label + ': ' + out.error); continue; }
        if (mode === 'retune') {
          const amp = await s.evaluate(() => window.Bg.WAVE[0].amp);
          if (amp !== 1.5) fails.push('the retuned scene.js was not used (WAVE[0].amp ' + amp + ')');
        }
        for (const r of out.res) {
          if (r.error) { fails.push(label + ', ' + r.label + ': ' + r.error); continue; }
          n += r.n;
          if (!(r.ew <= WAVE_TOL)) fails.push(label + ', ' + r.label + ': the shader\'s wave is ' + r.ew.toExponential(2) + ' off the scene\'s at xw '
                                            + r.at[0].toFixed(3) + ', d ' + r.at[1].toFixed(3) + ' (scene ' + r.at[2].toFixed(5) + ', shader ' + r.at[3].toFixed(5) + ')');
          if (!(r.ex <= PX_TOL && r.ey <= PX_TOL)) fails.push(label + ', ' + r.label + ': the shader\'s projection is ' + r.ex.toFixed(4) + ' / ' + r.ey.toFixed(4) + ' CSS px off surfacePoint');
          worst = { ew: Math.max(worst.ew, r.ew), ex: Math.max(worst.ex, r.ex), ey: Math.max(worst.ey, r.ey) };
          reach = { dent: Math.max(reach.dent, r.dent), well: Math.max(reach.well, r.well), evt: Math.max(reach.evt, r.evt) };
          if (mode === 'retune') retuned = Math.max(retuned || 0, r.ew);
        }
        if (mode !== 'retune') notes.push(label + ' ' + (out.gl2 ? 'WebGL 2' : 'WebGL 1'));
        for (const q of out.scen) {
          if (q.error) { fails.push(label + ', scenery ' + q.label + ': ' + q.error); continue; }
          if (!(q.ex <= PX_TOL)) fails.push(label + ', scenery ' + q.label + ': the shader puts ' + q.at + ' ' + q.ex.toFixed(4) + ' CSS px from its math (limit ' + PX_TOL + ')');
          if (!(q.seat <= SEAT_TOL)) fails.push(label + ', scenery ' + q.label + ': a base or root is ' + q.seat.toFixed(4) + ' CSS px off the floor (limit ' + SEAT_TOL + ')');
          if (!(q.nBase > 100 && q.nRoot === 8)) fails.push(label + ', scenery ' + q.label + ': only ' + q.nBase + ' base corners and ' + q.nRoot + ' roots were checked');
          if (q.label === 'a bloom on' && !(q.bend >= q.curlMin)) {
            fails.push(label + ': the bloom state moves the trees little (a stroke end moved ' + q.bend.toFixed(1) + ' px, limit ' + q.curlMin.toFixed(1) + ')');
          }
          scenery.ex = Math.max(scenery.ex, q.ex); scenery.seat = Math.max(scenery.seat, q.seat); scenery.n += q.n;
          if (q.label === 'a bloom on') { scenery.dip = Math.max(scenery.dip, q.dip); scenery.slide = Math.max(scenery.slide, q.slide); scenery.bend = Math.max(scenery.bend, q.bend); }
          scenery.bases = Math.max(scenery.bases, q.nBase);
        }
      } finally { await s.close(); }
    }
  } finally {
    await b.close();
    await site.close();
  }
  if (!(reach.dent >= 0.5)) fails.push('no point met a dent of 0.5 (largest ' + reach.dent.toFixed(2) + '): the states test nothing of the cursor');
  if (!(reach.well >= 1)) fails.push('no point met a well of 1 (largest ' + reach.well.toFixed(2) + ')');
  if (!(reach.evt >= 0.5)) fails.push('no point met a swell event of 0.5 (largest ' + reach.evt.toFixed(2) + ')');
  if (fails.length) { report(); return; }
  console.log('check-wave-parity: OK - render-webgl.js writes none of the wave\'s numbers; ' + notes.join(', ') + ': ' + n
              + ' points over 5 states (scene time 0, dents, swell event, 1 h, 10 h; dents up to ' + reach.dent.toFixed(2)
              + ', wells ' + reach.well.toFixed(2) + ', event ' + reach.evt.toFixed(2) + '): the shader\'s wave within '
              + worst.ew.toExponential(1) + ' of the scene\'s (limit ' + WAVE_TOL + '), its projection within '
              + Math.max(worst.ex, worst.ey).toExponential(1) + ' CSS px; with WAVE retuned it follows the table ('
              + (retuned === null ? 'n/a' : retuned.toExponential(1)) + '); the scenery: ' + scenery.n + ' corners and stroke ends over 2 states x 3 runs (the swell event; a bloom on: the tree pieces '
              + scenery.bend.toFixed(1) + ' px, dip ' + scenery.dip.toFixed(1) + ', slide ' + scenery.slide.toFixed(1) + ' px; KEEP_R retuned once) placed within '
              + scenery.ex.toExponential(1) + ' CSS px of the shader\'s math in JS, and every base corner (' + scenery.bases + ' a frame) and root seated within '
              + scenery.seat.toExponential(1) + ' CSS px of the floor');
}
function report() {
  console.log('check-wave-parity: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
main().catch(e => { console.log('check-wave-parity: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
