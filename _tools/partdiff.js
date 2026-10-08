'use strict';
/* What the cursor's push does to the scenery, apart from everything else.

   Runs the scene from scratch with IDENTICAL elapsed time and only the
   pointer differing - parked at (1180, 330) in run A and at (1340, 330),
   160px to the right, in run B - then diffs where the renderer draws the
   scenery: scenery-twin.js, the vertex shaders' math in JS
   (check-wave-parity.js holds the real shaders to it), every massif corner
   and every tree and conifer segment end. With the swell held constant
   between the runs, what moves is the pointer's doing.

   But the pointer does two things: it pushes the terrain (TPUSH: the dip,
   a peak's slide, a tree's bend) and it moves the view (look: the
   parallax, shiftX). A first version of this diffed A against B alone and
   called all of it the push - the ridges' "0.6px of cursor-caused
   sideways movement" was the parallax, since a ridge never slides (the
   same kind of trap as the facet probe's clouds counted into the near
   band, audit F44). So run B is made twice: with the view held where A's
   is (look's target set to A's every frame), which leaves the push alone,
   and free, which is the push and the parallax together. And run C has
   no pointer at all, its view held where B's is: B - C is the push at one
   place, from nothing (the dip, a peak's slide, a tree's bend, each one
   way).

   Also: does any single peak CHANGE SHAPE sideways, or only slide? Each
   massif has its own id, so the spread of the per-corner dx within one
   peak is deformation within it (0 is a rigid slide), not a spread between
   peaks. 1440x900@2, 200 frames, every frame drawn (?bgq=0). Loads the
   background scripts under SITE_ROOT through harness.js. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const FRAMES = 200, A_X = 1180, B_X = 1340, Y = 330;
function run(px, py, view) {
  let sim;
  try {
    sim = H.load({ W: 1440, H: 900, dpr: 2, search: '?bgq=0' });
  } catch (e) {
    console.log('FAIL: ' + e.message);
    process.exit(1);
  }
  const P = sim.P, Bg0 = sim.window.Bg;
  if (!(Bg0 && Bg0.renderers && Bg0.renderers.webgl && Bg0.renderers.webgl.sceneryMesh)) {
    console.log('partdiff: SKIP - no WebGL scenery under ' + H.ROOT + ' (before W2b): it diffs the scenery where scenery-twin.js places it');
    process.exit(0);
  }
  for (let i = 0; i < FRAMES; i++) {
    if (px !== null) sim.move(px, py);
    if (view) { P.look.tx = view[0]; P.look.ty = view[1]; }
    sim.frame(16.7);
  }
  const tw = Twin.make(sim.window.Bg), t = P.simNow;
  const massif = [], stroke = [];
  for (let i = 0; i < tw.massifs; i++) {
    const m = tw.massif(i);
    massif.push({ id: m.id, ridge: !m.slides, p: tw.massifAt(i, t, [0, 0]) });
  }
  for (let i = 0; i < tw.strokes; i += 6) stroke.push(tw.strokeAt(i, t, [0, 0, 0, 0]));
  return { massif, stroke, look: [P.look.tx, P.look.ty], t };
}

const A = run(A_X, Y, null);
const B = run(B_X, Y, A.look);
const Bfree = run(B_X, Y, null);
/* C: no pointer at all (no field), its view held where Bfree's is */
const C = run(null, null, Bfree.look);
if (A.t !== B.t || A.t !== Bfree.t || A.t !== C.t) { console.log('FAIL: the runs are not on one clock'); process.exit(1); }

console.log('runs from scratch, ' + FRAMES + ' frames, identical elapsed time, the pointer parked at x=' + A_X + ' vs ' + B_X + ' (y=' + Y + ')');
console.log('massif corners ' + A.massif.length + ', stroke segments ' + A.stroke.length);

function stat(X, O) {
  O = O || A;
  const out = {};
  for (const [kind, pairs] of [['ridge', []], ['peak', []], ['tree', []]]) out[kind] = pairs;
  for (let i = 0; i < O.massif.length; i++) out[O.massif[i].ridge ? 'ridge' : 'peak'].push([O.massif[i].p, X.massif[i].p]);
  for (let i = 0; i < O.stroke.length; i++) {
    out.tree.push([[O.stroke[i][0], O.stroke[i][1]], [X.stroke[i][0], X.stroke[i][1]]]);
    out.tree.push([[O.stroke[i][2], O.stroke[i][3]], [X.stroke[i][2], X.stroke[i][3]]]);
  }
  const r = {};
  for (const k of Object.keys(out)) {
    let dx = 0, dy = 0;
    for (const [a, b] of out[k]) { dx = Math.max(dx, Math.abs(a[0] - b[0])); dy = Math.max(dy, Math.abs(a[1] - b[1])); }
    r[k] = { dx, dy };
  }
  return r;
}
const row = (label, s) => '  ' + label.padEnd(20) + 'dx ' + s.dx.toFixed(1).padStart(6) + ' px   dy ' + s.dy.toFixed(1).padStart(6) + ' px';
const push = stat(B), both = stat(Bfree), at = stat(Bfree, C);
console.log('');
console.log("the push with the pointer at x=" + B_X + ", against no pointer at all (run C, its view held where B's is):");
console.log(row('backdrop ridges', at.ridge));
console.log(row('discrete peaks', at.peak));
console.log(row('trees and conifers', at.tree));
console.log('the pointer moved from x=' + A_X + ' to ' + B_X + ": the cursor's push alone (run B's view held where A's is),");
console.log('the most any point moved (a shove that changes side counts both ways):');
console.log(row('backdrop ridges', push.ridge));
console.log(row('discrete peaks', push.peak));
console.log(row('trees and conifers', push.tree));
console.log('the push and the parallax together (run B\'s view free):');
console.log(row('backdrop ridges', both.ridge));
console.log(row('discrete peaks', both.peak));
console.log(row('trees and conifers', both.tree));

/* does any single peak CHANGE SHAPE sideways, or only slide? */
let worstShape = 0, worstId = null;
const byId = new Map();
for (let i = 0; i < A.massif.length; i++) {
  if (A.massif[i].ridge) continue;
  const id = A.massif[i].id;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(B.massif[i].p[0] - A.massif[i].p[0]);
}
for (const [id, ds] of byId) {
  const spread = Math.max(...ds) - Math.min(...ds);   /* 0 => a pure rigid slide */
  if (spread > worstShape) { worstShape = spread; worstId = id; }
}
console.log('');
console.log('peak shape change under the push (spread of per-corner dx within one peak;');
console.log('0 = pure rigid slide, large = the outline is being stretched):');
console.log('  worst ' + worstShape.toFixed(2) + ' px  (massif ' + worstId + ')');
