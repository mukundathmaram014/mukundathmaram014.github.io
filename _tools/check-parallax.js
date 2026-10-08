'use strict';
/* One parallax rule (audit G3.1, G3.2): when the pointer moves the view
   (look), everything standing on the sheet moves exactly with the patch of
   sheet it stands on, and the sky moves up and down exactly with the
   horizon.

   The sheet slides shiftX(d) = look.x * LOOK_X * max(0, (PAR_D0 - d) /
   (PAR_D0 - 1)) at depth d (scene.js), and the ridges, peaks, conifers and
   trees stand at their x at rest plus the same shift at their own depth
   (the renderer's vertex shader: shiftAt). They used to slide by their own
   hand-set `par` while the sheet slid a flat 30 * look.x at every depth, so
   a sideways move of the pointer slid the floor up to 22px under the
   mountains (skate) and, since every base re-sampled the swell at its new
   spot, raised, sank and tilted the bases by up to 13px (bob). The sun and
   the clouds ignored look.y while the horizon and every ridge moved 16 *
   look.y, so the ridges slid 8px over the sun on every vertical move.

   Measured on where the renderer draws, with twin runs: two copies of the
   page on one clock, the cursor never seen (no field). Run A eases look
   corner to corner and gutter to gutter; run B holds it at rest. A minus B
   is what look does. For every base the renderer stands on the floor - a
   ridge's or a peak's corners on the ground, a tree's or a conifer's root
   (scenery-twin.js: the vertex shader's placement, which
   check-wave-parity.js holds to the real shader) - at its depth:
     skate   how far the floor point under the base moved, in px at that
             depth: world x under the base in A minus in B, each run
             inverting its own surfacePoint (|skate| <= 1e-6 px)
     bob     how far the base moved off its rest plane because of look:
             (y - rest) in A minus in B (|bob| <= 1e-6 px)
     seat    the base on the floor in A (|gap| <= 1e-6 px), as check-seat
   and for the sun and every cloud vertex (the cloud shader's placement),
   y minus the horizon in A minus in B (|sky| <= 1e-9 px). Four viewports,
   600 frames each, look reaching at least 0.4 in both axes, every frame
   drawn (?bgq=0). Exit 1 on failure. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const VIEWS = [[1440, 900, 1.5], [2560, 1440, 1], [390, 844, 3], [844, 390, 2]];
const FRAMES = 600, LIMIT = 1e-6, SKY_LIMIT = 1e-9;
/* look's target in run A, frame i: rest, then corner to corner, then gutter
   to gutter and back across the card (the finding's two sweeps) */
function lookAt(i) {
  if (i < 60) return [0, 0];
  if (i < 300) { const u = (i - 60) / 240 * 2 * Math.PI; return [0.5 * Math.sin(u), -0.5 * Math.sin(u)]; }
  const u = (i - 300) / 300 * 2 * Math.PI;
  return [0.45 * Math.sin(2 * u), 0.45 * Math.cos(u)];
}
const KINDS = ['ridge', 'peak', 'conifer', 'tree'];

function fail(msg, extra) {
  console.log('check-parallax: FAIL - ' + msg);
  for (const l of extra || []) console.log('  ' + l);
  process.exit(1);
}
const px = v => (Math.abs(v) < 0.01 ? v.toExponential(2) : v.toFixed(2)) + 'px';

/* one run: the page, and (after its first frame) the twin of its shaders */
function run(W, Hh, dpr) {
  let sim;
  try { sim = H.load({ W, H: Hh, dpr, now: 1200, search: '?bgq=0' }); } catch (e) { fail(e.message); }
  const Bg = sim.window.Bg;
  if (!(Bg && Bg.renderers && Bg.renderers.webgl && Bg.renderers.webgl.sceneryMesh)) {
    console.log('check-parallax: SKIP - ' + H.ROOT + ' has no WebGL scenery (before W2b)');
    process.exit(0);
  }
  return { sim, P: sim.P, Bg, tw: null, list: null };
}
/* what each base is, by the table its depth comes from */
function kindOf(Bg, d, massif) {
  const f = Math.fround;
  if (massif) return Bg.RIDGES.some(r => f(r.d) === d) ? 'ridge' : Bg.BANDS.some(b => f(b.d) === d) ? 'peak' : null;
  return Bg.TREES.some(c => f(c.d) === d) ? 'tree' : Bg.CONIFERS.some(c => f(c.d) === d) ? 'conifer' : null;
}
/* the bases of a run, placed: [{ kind, id, d, x, y }] in a fixed order */
const OUT = [0, 0], S4 = [0, 0, 0, 0];
function bases(R, t) {
  if (!R.tw) {
    R.tw = Twin.make(R.Bg);
    const b = R.tw.bases();
    R.list = b.massif.map(k => ({ k, massif: true, m: R.tw.massif(k) })).concat(b.root.map(k => ({ k, massif: false, m: R.tw.stroke(k) })));
    for (const e of R.list) { e.kind = kindOf(R.Bg, e.m.d, e.massif); if (!e.kind) fail('a base at d ' + e.m.d + ' belongs to no table'); }
  }
  return R.list.map(e => {
    const p = e.massif ? R.tw.massifAt(e.k, t, OUT) : R.tw.strokeAt(e.k, t, S4);
    return { kind: e.kind, id: e.m.id, d: e.m.d, x: p[0], y: p[1] };
  });
}
/* the run's own projection at depth d and time t: world x under screen x,
   the floor's y there, and the rest plane */
function floorOf(P, x, d, t) {
  const sp = P.surfacePoint, x0 = sp(0, d, t)[0], x1 = sp(1, d, t)[0];
  const xw = (x - x0) / (x1 - x0);
  return { xw, y: sp(xw, d, t)[1], rest: P.restAt(d), scale: x1 - x0 };
}
/* the sky's height against the horizon: the sun and every cloud vertex */
function sky(R) {
  const hz = R.P.horizonY(), out = [R.P.sunAt()[1] - hz];
  for (let i = 0; i < R.tw.clouds; i++) out.push(R.tw.cloudAt(i, OUT)[1] - hz);
  return out;
}

const worst = { skate: 0, bob: 0, seat: 0, sky: 0 }, at = {};
const perKind = {};
for (const k of KINDS) perKind[k] = { skate: 0, bob: 0, spread: 0, n: 0 };
let nBases = 0, lookMax = [0, 0], skyN = 0;
const keep = (key, v, where) => { if (Number.isNaN(v) || Math.abs(v) > Math.abs(worst[key])) { worst[key] = v; at[key] = where; } };
for (const [W, Hh, dpr] of VIEWS) {
  const A = run(W, Hh, dpr), B = run(W, Hh, dpr);
  for (let i = 0; i < FRAMES; i++) {
    const [tx, ty] = lookAt(i);
    A.P.look.tx = tx; A.P.look.ty = ty;
    A.sim.frame(16.7); B.sim.frame(16.7);
    if (A.P.ptr.seen || B.P.ptr.seen) fail('precondition: the cursor field came on');
    if (A.P.simNow !== B.P.simNow) fail('precondition: the twin runs are not on one clock');
    lookMax = [Math.max(lookMax[0], Math.abs(A.P.look.x)), Math.max(lookMax[1], Math.abs(A.P.look.y))];
    if (Math.abs(B.P.look.x) || Math.abs(B.P.look.y)) fail('precondition: run B\'s look moved');
    const t = A.P.simNow, ba = bases(A, t), bb = bases(B, t), where = W + 'x' + Hh + ' frame ' + i;
    /* per massif, for the spread: a spread means look tilts or reshapes the
       base, not just moves it */
    const spread = new Map();
    for (let k = 0; k < ba.length; k++) {
      const a = ba[k], b = bb[k];
      const fa = floorOf(A.P, a.x, a.d, t), fb = floorOf(B.P, b.x, b.d, t);
      const skate = (fa.xw - fb.xw) * fb.scale, bob = (a.y - fa.rest) - (b.y - fb.rest);
      const tag = where + ' ' + a.kind + ' d=' + a.d.toFixed(2) + ' x=' + b.x.toFixed(1) + ' (look ' + A.P.look.x.toFixed(2) + ', ' + A.P.look.y.toFixed(2) + ')';
      keep('skate', skate, tag); keep('bob', bob, tag); keep('seat', a.y - fa.y, tag);
      const pk = perKind[a.kind];
      pk.skate = Math.max(pk.skate, Math.abs(skate)); pk.bob = Math.max(pk.bob, Math.abs(bob)); pk.n++;
      const sh = spread.get(a.id);
      if (!sh) spread.set(a.id, { kind: a.kind, lo: bob, hi: bob });
      else { sh.lo = Math.min(sh.lo, bob); sh.hi = Math.max(sh.hi, bob); }
      nBases++;
    }
    for (const sh of spread.values()) perKind[sh.kind].spread = Math.max(perKind[sh.kind].spread, sh.hi - sh.lo);
    const sa = sky(A), sb = sky(B);
    skyN = sa.length;
    for (let k = 0; k < sa.length; k++) keep('sky', sa[k] - sb[k], where + (k ? ' cloud vertex ' + (k - 1) : ' sun') + ' (look.y ' + A.P.look.y.toFixed(2) + ')');
  }
}
if (!(lookMax[0] >= 0.4 && lookMax[1] >= 0.4)) fail('look reached only ' + lookMax.map(v => v.toFixed(2)).join(', ') + ': the sweep moved too little to test anything');
for (const k of KINDS) if (!perKind[k].n) fail('no ' + k + ' base was measured');

const detail = KINDS.map(k => '  ' + k.padEnd(8) + 'skate ' + px(perKind[k].skate).padStart(10) + '   bob ' + px(perKind[k].bob).padStart(10)
                         + (k === 'ridge' || k === 'peak' ? '   bob spread within one massif ' + px(perKind[k].spread).padStart(10) : ''));
detail.push('  sky     the sun and ' + (skyN - 1) + ' cloud vertices against the horizon ' + px(worst.sky) + (at.sky ? ' at ' + at.sky : ''));
const msg = nBases.toLocaleString('en-US') + ' drawn bases (' + VIEWS.length + ' viewports x ' + FRAMES + ' frames, twin runs, look to '
          + lookMax.map(v => v.toFixed(2)).join(' / ') + '): worst skate ' + px(Math.abs(worst.skate)) + ', bob ' + px(Math.abs(worst.bob))
          + ', seat ' + px(Math.abs(worst.seat)) + '; sky against the horizon ' + px(Math.abs(worst.sky));
const bad = [];
if (!(Math.abs(worst.skate) <= LIMIT)) bad.push('the floor skates ' + px(Math.abs(worst.skate)) + ' under a base (' + at.skate + ')');
if (!(Math.abs(worst.bob) <= LIMIT)) bad.push('look moves a base ' + px(Math.abs(worst.bob)) + ' off its rest plane (' + at.bob + ')');
if (!(Math.abs(worst.seat) <= LIMIT)) bad.push('a base is ' + px(Math.abs(worst.seat)) + ' off the floor (' + at.seat + ')');
if (!(Math.abs(worst.sky) <= SKY_LIMIT)) bad.push('the sky moves ' + px(Math.abs(worst.sky)) + ' against the horizon (' + at.sky + ')');
if (bad.length) fail(bad.join('; ') + '; ' + msg, detail);
for (const l of detail) console.log(l);
console.log('check-parallax: OK - ' + msg);
