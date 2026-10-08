'use strict';
/* Terrain must be welded to the floor (README "The scenery"): with the cursor
   field off, every base the renderer draws sits exactly on the sheet at the
   same screen x and depth.

   The renderer places every massif corner and every tree and conifer point
   in its vertex shader (render-webgl.js MASSIF_GLSL, STROKE_GLSL), each on
   the floor under where it is drawn, from the same wave as the floor. This
   measures the bases where that math puts them - _tools/scenery-twin.js,
   the shader's math in JS, which check-wave-parity.js holds to the real
   shader in Chrome within 0.05 CSS px (measured 1.7e-3) - for every corner
   of every ridge and peak that stands on the ground (its height 0) and
   every tree's and conifer's root, against the floor found from
   surfacePoint alone: screen x is linear in world x at a depth, so two
   samples invert it exactly, and the floor is surfacePoint's own y there.
   gap = drawn y - floor must be 0 (|gap| <= 1e-6 px; ~1e-13 in practice).
   Negative floats above the floor, positive sinks into it.

   Before W3 the Canvas renderer drew the bases from the scene's per-frame
   shape functions (ridgeShape, peakShape, coniferAt, treeAt), and this
   captured them where it drew them; those went with it. What it guarded
   still matters, and fails here the same way: a base whose rest plane or
   depth is not the floor's (a horizon retuned at one site floated every
   base 18px), a mesh whose ground corners are not at height 0, or a root
   that is not where the tree is drawn from.

   The cursor is never seen, so there is no push; from frame 300 look's
   target is set directly, as a pointer in a corner would set it (moving a
   real pointer would switch the field on), and look eases to that corner
   and then to the opposite one, so the horizon and every parallax move
   while the bases must stay seated: that half catches a placement that
   drops look.y or reads look.ty. Four viewports, 600 frames each, every
   frame drawn (?bgq=0). Exit 1 on failure. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const VIEWS = [[1440, 900, 1.5], [390, 844, 3], [2560, 1440, 1], [3840, 2160, 2]];
const FRAMES = 600, LIMIT = 1e-6;
/* look.tx / look.ty from these frames on (a pointer in the top-right corner,
   then in the bottom-left one) */
const LOOK = { 300: [0.5, -0.5], 450: [-0.5, 0.5] };

function fail(msg) { console.log('check-seat: FAIL - ' + msg); process.exit(1); }

/* the floor at screen x, depth d and time t, from surfacePoint alone */
function floorAt(P, x, d, t) {
  const a = P.surfacePoint(0, d, t), b = P.surfacePoint(1, d, t);
  const xw = (x - a[0]) / (b[0] - a[0]);
  return P.surfacePoint(xw, d, t)[1];
}

const OUT = [0, 0], S4 = [0, 0, 0, 0];
let worst = 0, worstAt = '', total = 0, perFrame = '', depths = new Set();
for (const [W, Hh, dpr] of VIEWS) {
  let sim;
  try { sim = H.load({ W, H: Hh, dpr, now: 1200, search: '?bgq=0' }); } catch (e) { fail(e.message); }
  const P = sim.P, Bg = sim.window.Bg;
  if (!(Bg && Bg.renderers && Bg.renderers.webgl && Bg.renderers.webgl.sceneryMesh)) {
    console.log('check-seat: SKIP - ' + H.ROOT + ' has no WebGL scenery (before W2b)');
    process.exit(0);
  }
  let tw = null, b = null;
  for (let i = 0; i < FRAMES; i++) {
    if (LOOK[i]) { P.look.tx = LOOK[i][0]; P.look.ty = LOOK[i][1]; }
    sim.frame(16.7);
    if (!tw) { tw = Twin.make(Bg); b = tw.bases(); }
    const t = P.simNow;
    if (P.CUR.on || P.RIP.on || P.TPUSH[0].on || P.TPUSH[1].on) fail(W + 'x' + Hh + ' frame ' + i + ': the cursor field is on, with no pointer');
    for (const k of b.massif) {
      tw.massifAt(k, t, OUT);
      const m = tw.massif(k), gap = OUT[1] - floorAt(P, OUT[0], m.d, t);
      depths.add(m.d);
      total++;
      if (Math.abs(gap) > worst) { worst = Math.abs(gap); worstAt = W + 'x' + Hh + ' frame ' + i + ' massif ' + m.id + ' corner at (' + OUT[0].toFixed(1) + ', ' + OUT[1].toFixed(1) + '), d ' + m.d; }
    }
    for (const k of b.root) {
      tw.strokeAt(k, t, S4);
      const s = tw.stroke(k), gap = S4[1] - floorAt(P, S4[0], s.d, t);
      depths.add(s.d);
      total++;
      if (Math.abs(gap) > worst) { worst = Math.abs(gap); worstAt = W + 'x' + Hh + ' frame ' + i + ' root of ' + s.id + ' at (' + S4[0].toFixed(1) + ', ' + S4[1].toFixed(1) + '), d ' + s.d; }
    }
  }
  if (!(b.massif.length > 100 && b.root.length === 8)) fail(W + 'x' + Hh + ': only ' + b.massif.length + ' ground corners and ' + b.root.length + ' roots to measure');
  if (W === 1440) perFrame = b.massif.length + ' ground corners and ' + b.root.length + ' roots a frame at 1440x900';
  if (Math.abs(P.look.x) < 0.3 || Math.abs(P.look.y) < 0.3) fail(W + 'x' + Hh + ': look only reached (' + P.look.x.toFixed(2) + ', ' + P.look.y.toFixed(2) + ')');
}
if (!(worst <= LIMIT)) fail('a base is ' + worst.toExponential(2) + ' px off the floor (limit ' + LIMIT + '): ' + worstAt);
console.log('check-seat: OK - ' + perFrame + ' (through scenery-twin.js, the shader\'s placement), at ' + depths.size + ' depths, '
            + FRAMES + ' frames x ' + VIEWS.length + ' viewports, look at rest then easing corner to corner: worst |drawn base - floor| '
            + worst.toExponential(2) + ' px (limit ' + LIMIT + '), ' + total.toLocaleString('en-US') + ' bases');
