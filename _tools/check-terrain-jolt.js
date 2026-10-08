'use strict';
/* The cursor's push never jolts the scenery (the WebGL renderer's terrain:
   audit F58 / F11, README "The scenery").

   render-webgl.js places every massif corner and every tree and conifer
   point in its vertex shader, from the scene's state, with nothing kept per
   vertex between frames. So nothing smooths a push after the scene hands
   it over: the smoothing is the scene's (TPUSH, terrainStep: the terrain's
   copy of the field, moved under a budget of TERR_JOLT px a frame each).
   This runs the shader's math in node (scenery-twin.js; check-wave-parity.js
   holds the shader to it) over the whole mesh, frame by frame, under
   scripted pointer paths, and measures how far the push moves any point in
   one frame - the push's own part of its motion, at the same moment and
   on the same floor: a massif point's slide (where it is drawn, less where
   it would be with no push) and its press (where it is drawn, less where
   it would be slid but not pressed); a stroke point's bend and squash
   about its root. The floor's own motion is the sheet's
   (check-cursor-response.js) and is left out, the slide along a sloping
   floor with it: a facet's corner moves with the floor under it, and a
   point where a facet's edge was cut (render-webgl.js slice) with its
   edge's straight line, whose corners do. The massif points are every
   facet corner and one in CUT_EVERY of the cut points (all of them made
   the check 4x slower and found no more).

   Paths, at 1440x900 and 390x844 (60 Hz) and 1440x900 at 144 Hz: a slow
   drift over a face; flicks between faces in both gutters; sweeps across
   the faces at 420-4,000 px/s; a pointer scribbling up and down a face
   (900-2,500 px/s: across the span gate, the push's steepest part); leaving
   and coming back on the other side; flicks over the near floor; and
   through the horizon. Limit: 2 * TERR_JOLT * S px per 16.7 ms (the two
   copies' budgets), per component (sideways, up and down), plus 1e-6.

   For comparison it also reports what the pushes would do read directly
   off the two dents (CUR, RIP) with no smoothing - the same kernels
   (terrainPushDip / terrainPushSide) with TPUSH set to the dents for the
   reading - on the same paths. (The Canvas renderer, gone since W3,
   smoothed them through a filter per vertex instead, LIFTS, which still
   let 3.09 px through at 1440x900.) The bloom (scene.js THE BLOOM) is
   left out - the twin reads it as none - as check-bloom holds it to its
   own limits. Every frame drawn (?bgq=0). Exit 1 on failure. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const fails = [];
const minjerk = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
function pathOf(name, W, HH, dt) {
  const a = [], sx = W / 1440, sy = HH / 900;
  const hold = n => { for (let i = 0; i < n; i++) a.push(null); };
  const at = (x, y, ms) => { for (let i = 0; i < Math.round(ms / dt); i++) a.push({ x: x * sx, y: y * sy }); };
  const flick = (x0, y0, x1, y1, ms) => {
    const n = Math.max(1, Math.round(ms / dt));
    for (let i = 1; i <= n; i++) { const f = minjerk(i / n); a.push({ x: (x0 + (x1 - x0) * f) * sx, y: (y0 + (y1 - y0) * f) * sy }); }
  };
  const line = (x0, y0, x1, y1, pxs) => {
    const n = Math.max(1, Math.round((Math.hypot(x1 - x0, y1 - y0) / pxs) * 1000 / dt));
    for (let i = 1; i <= n; i++) { const f = i / n; a.push({ x: (x0 + (x1 - x0) * f) * sx, y: (y0 + (y1 - y0) * f) * sy }); }
  };
  if (name === 'face drift') {
    at(150, 380, 1000);
    for (let t = 0; t < 10000; t += dt) { const w = (t / 1000) * 2 * Math.PI * 0.2; a.push({ x: (150 + 90 * Math.sin(w)) * sx, y: (380 + 60 * (1 - Math.cos(w))) * sy }); }
  } else if (name === 'face flicks') {
    at(150, 380, 1500);
    let p = [150, 380];
    for (const q of [[1300, 300], [120, 450], [1250, 420], [200, 250], [1350, 480], [80, 330]]) { flick(p[0], p[1], q[0], q[1], 220); at(q[0], q[1], 750); p = q; }
  } else if (name === 'face sweeps') {
    at(-50, 300, 500);
    for (const [y, s] of [[300, 420], [400, 1500], [250, 4000], [460, 2500]]) { line(-50, y, 1490, y, s); at(1490, y, 330); line(1490, y, -50, y, s); at(-50, y, 330); }
  } else if (name === 'face scribble') {
    at(150, 300, 1000);
    for (let k = 0; k < 4; k++) { line(150, 150, 150, 560, 900); line(150, 560, 150, 150, 900); }
    for (let k = 0; k < 4; k++) { flick(150, 150, 150, 560, 140); at(150, 560, 250); flick(150, 560, 150, 150, 140); at(150, 150, 250); }
    for (let k = 0; k < 3; k++) { line(1300, 120, 1300, 540, 2500); line(1300, 540, 1300, 120, 2500); }
  } else if (name === 're-entry') {
    at(150, 380, 3000);
    for (const away of [300, 1000, 4000]) {
      a.push('leave'); hold(Math.round(away / dt)); at(1300, 400, 2500);
      a.push('leave'); hold(Math.round(away / dt)); at(150, 380, 2500);
    }
  } else if (name === 'floor flicks') {
    at(200, 760, 1500);
    let p = [200, 760];
    for (const q of [[1250, 820], [180, 640], [1300, 560], [120, 880], [1200, 700], [240, 520], [1340, 860]]) { flick(p[0], p[1], q[0], q[1], 220); at(q[0], q[1], 750); p = q; }
  } else if (name === 'horizon') {
    at(200, 700, 1000); line(200, 700, 200, 250, 180); at(200, 250, 500); line(200, 250, 200, 700, 180); at(200, 700, 500);
    flick(200, 700, 200, 250, 200); at(200, 250, 500); flick(200, 250, 200, 760, 200); at(200, 760, 1000);
  }
  return a;
}
const PATHS = ['face drift', 'face flicks', 'face sweeps', 'face scribble', 're-entry', 'floor flicks', 'horizon'];

/* the push's part of a corner's / a stroke point's place: [dx, dy] */
function load(W, HH) {
  return H.load({ W, H: HH, dpr: 1.5, now: 1000, search: '?bgq=0' });
}
/* fn read with the terrain's copy of the field set to the field itself:
   the pushes as they would be with no budget */
function direct(Bg, fn) {
  const T = Bg.TPUSH, was = T.map(p => [p.on, p.sx, p.sy]);
  [Bg.CUR, Bg.RIP].forEach((w, i) => { T[i].on = w.on > 0 ? w.on : 0; T[i].sx = w.sx; T[i].sy = w.sy; });
  try { return fn(); } finally { T.forEach((p, i) => { p.on = was[i][0]; p.sx = was[i][1]; p.sy = was[i][2]; }); }
}
/* the distinct things the push moves, from the mesh: a massif point
   (dedup by its attributes: every facet corner, one in CUT_EVERY of the
   cut points) and a stroke's two ends (dedup by segment) */
const CUT_EVERY = 5;
function points(tw) {
  const seen = new Set(), massif = [], stroke = [];
  let cuts = 0;
  for (let i = 0; i < tw.massifs; i++) {
    const m = tw.massif(i);
    if (m.h <= 0) continue;
    const k = [m.x0, m.h, m.xc, m.hspan, m.d].join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    if (!m.cut || cuts++ % CUT_EVERY === 0) massif.push(i);
  }
  for (let i = 0; i < tw.strokes; i += 6) stroke.push(i);
  return { massif, stroke };
}

{
  const Bg = H.load({ W: 1440, H: 900, dpr: 1 }).window.Bg;
  if (!(Bg && Bg.TPUSH && Bg.renderers && Bg.renderers.webgl && Bg.renderers.webgl.sceneryMesh)) {
    console.log('check-terrain-jolt: SKIP - ' + H.ROOT + ' has no WebGL scenery and no TPUSH (before W2b)');
    process.exit(0);
  }
}
const report = [];
let worstAll = 0;
const OUT = [0, 0], OUT2 = [0, 0], S4 = [0, 0, 0, 0], S4b = [0, 0, 0, 0];
for (const [W, HH, hz] of [[1440, 900, 60], [390, 844, 60], [1440, 900, 144]]) {
  const dt = 1000 / hz;
  const row = { size: W + 'x' + HH + '@' + hz + 'Hz', worst: 0, at: '', raw: 0, paths: {} };
  for (const name of PATHS) {
    const sim = load(W, HH);
    const Bg = sim.window.Bg;
    if (Bg.bloomAt) Bg.bloomAt = () => 0;   /* the bloom: check-bloom */
    const tw = Twin.make(Bg);
    tw.strokeAt = tw.strokeRest;   /* the trees' poses are the bloom's (THE FORKS): check-bloom */
    const P = points(tw);
    const limit = 2 * Bg.TERR_JOLT * Bg.S * (dt / 16.7) + 1e-6;
    /* the comparison: the same pushes read off CUR/RIP directly */
    const quants = [];
    for (const b of Bg.BANDS) for (let k = 0; k < b.n; k++) { const p = Bg.peakPlace(b, k); quants.push([p.fx, b.d, p.mh, Bg.CUR_SIDE_PEAK]); }
    for (const c of Bg.TREES) quants.push([c.fx, c.d, c.h, Bg.CUR_TERR_SIDE]);
    for (const c of Bg.CONIFERS) quants.push([c.fx, c.d, c.h, Bg.CUR_TERR_SIDE]);
    let prevD = null, prevQ = null, worst = 0, at = '', raw = 0;
    const acts = pathOf(name, W, HH, dt);
    for (let f = 0; f < acts.length; f++) {
      const a = acts[f];
      if (a === 'leave') sim.leave(); else if (a) sim.move(a.x, a.y);
      sim.frame(dt);
      const t = Bg.simNow;
      /* a massif point: how far it has slid, and how far it is pressed
         (the floor itself moves every point on it alike); a stroke point:
         its bend and its squash, from the root */
      const D = new Float64Array(2 * (P.massif.length + 2 * P.stroke.length));
      let k = 0;
      for (const i of P.massif) {
        tw.massifAt(i, t, OUT);
        D[k++] = OUT[0] - tw.massifRest(i, t, OUT2)[0];
        D[k++] = tw.massifSlid(i, t, OUT2)[1] - OUT[1];
      }
      for (const i of P.stroke) {
        tw.strokeAt(i, t, S4); tw.strokeRest(i, t, S4b);
        D[k++] = S4[0] - S4b[0]; D[k++] = S4[1] - S4b[1]; D[k++] = S4[2] - S4b[2]; D[k++] = S4[3] - S4b[3];
      }
      if (prevD) {
        for (let j = 0; j < D.length; j++) {
          const e = Math.abs(D[j] - prevD[j]);
          if (e > worst) { worst = e; at = name + ' frame ' + f + (j < 2 * P.massif.length ? ' (a massif corner)' : ' (a tree or conifer)'); }
        }
      }
      prevD = D;
      /* the comparison quantities: [dip, shove] at each peak's centre, tree and conifer root */
      const q = direct(Bg, () => {
        const o = [];
        for (const [fx, d, h, side] of quants) {
          const x = Bg.standX(fx, d), rest = Bg.restAt(d);
          o.push(Bg.terrainPushDip(x, rest - h, rest), Bg.terrainPushSide(x, rest - h, rest, side * Bg.S));
        }
        return o;
      });
      if (prevQ) for (let j = 0; j < q.length; j++) raw = Math.max(raw, Math.abs(q[j] - prevQ[j]));
      prevQ = q;
    }
    /* per 16.7 ms, so the rates compare across frame rates */
    const per = 16.7 / dt;
    row.paths[name] = worst * per;
    if (worst > limit) fails.push(row.size + ' ' + at + ': the push moved a point ' + worst.toFixed(3) + ' px in one frame (limit ' + limit.toFixed(3) + ')');
    if (worst * per > row.worst) { row.worst = worst * per; row.at = at; }
    row.raw = Math.max(row.raw, raw * per);
    worstAll = Math.max(worstAll, worst * per / Bg.S);
  }
  report.push(row);
}

for (const r of report) {
  console.log('  ' + r.size.padEnd(16) + ' push per 16.7 ms: ' + Object.entries(r.paths).map(([n, v]) => n + ' ' + v.toFixed(2)).join(', ')
              + ' px; read off the dents directly ' + r.raw.toFixed(2));
}
if (fails.length) {
  console.log('check-terrain-jolt: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1, 20)) console.log('  ' + f);
  process.exit(1);
}
const r0 = report[0];
console.log('check-terrain-jolt: OK - ' + PATHS.length + ' pointer paths x 3 (1440x900 and 390x844 at 60 Hz, 1440x900 at 144 Hz), every facet corner, one in ' + CUT_EVERY + ' of the cut points and every stroke end through the shader\'s math:'
            + ' the push moves no point more than ' + r0.worst.toFixed(2) + ' px per 16.7 ms at 1440x900 (' + (worstAll).toFixed(2) + ' px / S anywhere; limit 2 * TERR_JOLT = '
            + (2 * 0.5).toFixed(2) + ' px * S), where read off the dents directly it would be ' + r0.raw.toFixed(2)
            + ' px');
