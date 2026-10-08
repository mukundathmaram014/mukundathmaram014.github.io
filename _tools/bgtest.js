/* Executes the real background scripts against a stub DOM and the
   harness's recording WebGL stub, one frame at a time, so we measure the
   shipped code rather than a reimplementation of it. At 1440x900 it prints:
     - the cursor field's world speed and depth at a given pixel speed,
       sideways and toward the horizon (the world metric);
     - how far the field trails a steady sweep, in ms, at 60 and 165 Hz,
       and how soon it is within 2 px of a pointer that stops dead (as
       check-cursor-response.js measures them at 60 Hz);
     - the push on a mountain face with the pointer above the horizon;
     - the meshes the renderer builds at this size, and their bytes (what
       goes to the GPU once per size: render-webgl.js sheetMesh and
       sceneryMesh);
     - how far the view's parallax bows the sheet's columns;
     - over one orbit, the share of the time the bodies are on screen in the
       gutters the card leaves (harness.cssCard).
   Loads the background scripts under SITE_ROOT (assets/js/bg/, in the
   order index.html loads them) through harness.js. */
const H = require('./harness');

let sim;
try {
  sim = H.load({ W: 1440, H: 900, dpr: 2, search: '?bgq=0', expose: ['DEPTH_W', 'CUR_SIGMA2'] });
} catch (e) {
  console.log('FAIL: script threw at load: ' + e.message);
  process.exit(1);
}
const P = sim.P;
/* the world metric (a step in depth counts DEPTH_W of one in xw) and the
   dent's width, from the scene (older roots: the values they had) */
const DEPTH_W = P.DEPTH_W !== undefined ? P.DEPTH_W : 0.55;
const SIG = P.CUR_SIGMA2 !== undefined ? Math.sqrt(P.CUR_SIGMA2 / 2) : 0.21;   /* speed / SIG = dent-widths per second */

const move = (x, y) => sim.move(x, y);
function frame(ms) {
  try { sim.frame(ms); } catch (e) { console.log('FAIL: tick threw: ' + e.message); process.exit(1); }
}

// warm up
move(300, 700); for (let i = 0; i < 90; i++) frame(16.7);
console.log('frame executes clean; ' + (sim.gl ? sim.gl.draws + ' GL draw calls over warm-up' : 'no WebGL context'));

/* ---- the field at a given pixel speed, sideways and toward the horizon ---
   The dent now sits on the pointer at every speed, so its world speed is the
   pointer's; what the world metric governs is how DEEP it is. A move toward
   the horizon crosses far more depth per pixel, so at the same pixel speed it
   must count as faster and leave a shallower dent than the same move
   sideways (README "The cursor field": the anisotropy must not come back). Older
   scenes have no ripple (RIP) and report only the speed. */
function sweep(dir, px) {
  // park, settle, then sweep the pointer at `px` px/frame for 40 frames
  let x = 300, y = 760;
  move(x, y); for (let i = 0; i < 120; i++) frame(16.7);
  let worst = 0, depth = 1;
  for (let i = 0; i < 40; i++) {
    if (dir === 'h') x += px; else y -= px;          // -y = toward the horizon
    move(x, y);
    const a = { xw: P.CUR.xw, d: P.CUR.d };
    frame(16.7);
    const sp = Math.hypot(P.CUR.xw - a.xw, (P.CUR.d - a.d) * DEPTH_W) * (1000 / 16.7);
    if (sp > worst) worst = sp;
    if (P.RIP) depth = Math.min(depth, P.CUR.on + P.RIP.on);
  }
  return [worst, depth];
}
for (const px of [3, 7, 24]) {
  const [h, hd] = sweep('h', px), [v, vd] = sweep('v', px);
  console.log('');
  console.log('pointer at ' + (px * 1000 / 16.7).toFixed(0) + ' px/s:');
  console.log('  horizontal   ' + h.toFixed(2) + ' u/s   = ' + (h / SIG).toFixed(1) + ' dent-widths/s' + (P.RIP ? '   dent depth ' + (100 * hd).toFixed(0) + '%' : ''));
  console.log('  to horizon   ' + v.toFixed(2) + ' u/s   = ' + (v / SIG).toFixed(1) + ' dent-widths/s' + (P.RIP ? '   dent depth ' + (100 * vd).toFixed(0) + '%' : ''));
}

/* ---- where the field is: behind a steady sweep, and after a dead stop ---
   As check-cursor-response.js measures it at 60 Hz - the touch's centre,
   projected at rest, against the pointer's own path, on sweeps at 760 px
   from far past one edge to far past the other, one pointermove a frame,
   counted once the follower has settled into its lag - and at 165 Hz, the
   owner's display, where the frame's own step is shorter. */
if (P.FIELD_W) {
  const rows = [];
  for (const [hz, dt] of [[60, 16.7], [165, 1000 / 165]]) {
    let lag = 0, settle = 0;
    for (const pxs of [250, 1000, 2500, 6000]) {
      const s = H.load({ W: 1440, H: 900, dpr: 1, search: '?bgq=0' }), Q = s.P, y = 760;
      const at = () => Q.centreX(Q.CUR.d) + (Q.CUR.xw * Q.W * Q.PERSP_X) / Q.CUR.d;
      s.move(-1000, y);
      for (let i = 0; i < 90; i++) s.frame(dt);
      let x = -1000;
      for (let i = 0; x < 2440; i++) {
        x += (pxs * dt) / 1000;
        s.move(x, y);
        s.frame(dt);
        if (i * dt >= 170) lag = Math.max(lag, ((x - at()) / pxs) * 1000);
      }
      let n = 0;
      for (; n < 1000; n++) {
        s.frame(dt);
        if (Math.abs(at() - x) <= 2 && Math.abs(Q.restAt(Q.CUR.d) - y) <= 2) break;
      }
      settle = Math.max(settle, (n + 1) * dt);
    }
    /* and a jump of the pointer, 600 px from rest: the follower within 2% of it */
    const s = H.load({ W: 1440, H: 900, dpr: 1, search: '?bgq=0' }), Q = s.P;
    s.move(300, 700);
    for (let i = 0; i < 120; i++) s.frame(dt);
    const x0 = Q.ptr.x;
    s.move(900, 700);
    let t = 0;
    while (Math.abs(Q.ptr.x - 900) > 0.02 * Math.abs(900 - x0) && t < 2000) { s.frame(dt); t += dt; }
    rows.push(hz + ' Hz: trails by ' + lag.toFixed(1) + ' ms, within 2 px of a stopped pointer in ' + settle.toFixed(0) + ' ms, a jump settled to 2% in '
              + t.toFixed(0) + ' ms');
  }
  console.log('');
  console.log('the field behind a steady sweep (250-6,000 px/s; FIELD_W ' + P.FIELD_W + '): ' + rows.join('; '));
}


/* ---- does pointing at a mountain face move it? -------------------------- */
// a far band sits around y 300-420 on screen, well above the horizon (378).
// The label is the horizon with the pointer at rest (look.y = 0); the live
// one moves 16 * look.y with the pointer.
const horizon = P.HORIZON !== undefined ? P.H * P.HORIZON : P.H * 0.42;
console.log('');
console.log('horizon at y=' + horizon.toFixed(0) + '; terrain push with the pointer ABOVE it:');
for (const y of [260, 330, 370, 500]) {
  move(700, y); for (let i = 0; i < 90; i++) frame(16.7);
  // a column at x=700 whose silhouette spans 300..430, as the renderer's
  // terrain feels it (the terrain's copy of the field, TPUSH)
  const push = P.terrainPushDip ? P.terrainPushDip(700, 300, 430) : P.cursorTerrain(700, 300, 430);
  console.log('  pointer y=' + y + '  ->  ' + push.toFixed(1) + ' px');
}

/* ---- the meshes the renderer builds at this size ------------------------ */
const R = sim.window.Bg && sim.window.Bg.renderers && sim.window.Bg.renderers.webgl;
if (R && R.sheetMesh && R.sceneryMesh) {
  const floor = R.sheetMesh(), sc = R.sceneryMesh();
  const F = H.rendererNumbers(['MASSIF_F', 'STROKE_F', 'CLOUD_F']);
  const total = floor.byteLength + sc.massif.byteLength + sc.stroke.byteLength + sc.cloud.byteLength;
  const B = n => n.toLocaleString('en-US') + ' B';
  console.log('');
  console.log('meshes at ' + P.W + 'x' + P.H + ' (uploaded once per size; the floor\'s is the same at every size):');
  console.log('  floor     ' + (floor.length / 2).toLocaleString('en-US') + ' vertices in its strip, ' + B(floor.byteLength));
  console.log('  massifs   ' + (sc.massif.length / F.MASSIF_F / 3).toLocaleString('en-US') + ' triangles, ' + B(sc.massif.byteLength));
  console.log('  strokes   ' + (sc.stroke.length / F.STROKE_F / 6).toLocaleString('en-US') + ' tree and conifer segments, ' + B(sc.stroke.byteLength));
  console.log('  clouds    ' + (sc.cloud.length / F.CLOUD_F / 3).toLocaleString('en-US') + ' facets, ' + B(sc.cloud.byteLength));
  console.log('  in all    ' + B(total));
}

/* ---- the view's parallax bends the sheet's columns ---------------------- */
/* The sheet slides shiftX(d), linear in d, while a column's points are
   linear in 1/d, so a column (here on a flat sheet) bows off the straight
   line between its ends as look.x moves: how far, for the worst column. */
if (P.shiftX && P.restAt && P.centreX) {
  const C = H.rendererNumbers(['COLS', 'COL_SPAN']);
  const keep = [P.look.x, P.look.y];
  const bows = [];
  for (const L of [0.25, 0.5]) {
    P.look.x = L; P.look.y = 0;
    let worst = 0;
    for (let j = 0; j < C.COLS; j++) {
      const xc = -C.COL_SPAN + (2 * C.COL_SPAN * j) / (C.COLS - 1);
      const d0 = Math.max(1, Math.abs(xc) / P.XSPAN), d1 = P.DMAX;
      if (!(d0 < d1)) continue;
      const pt = d => [P.centreX(d) + (xc * P.W * P.PERSP_X) / d, P.restAt(d)];
      const a = pt(d0), b = pt(d1), ux = b[0] - a[0], uy = b[1] - a[1], n = Math.hypot(ux, uy);
      for (let d = d0; d <= d1; d += 0.01) { const p = pt(d); worst = Math.max(worst, Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / n); }
    }
    bows.push('look.x ' + L + ': ' + worst.toFixed(2) + ' px (the near floor slid ' + P.shiftX(1).toFixed(1) + ' px)');
  }
  [P.look.x, P.look.y] = keep;
  console.log('');
  console.log('the view\'s parallax: a drawn column bows off the line between its ends by up to ' + bows.join(', '));
}

/* ---- the bodies: how much of an orbit they spend where they can be seen -- */
{
  let s2;
  try { s2 = H.load({ W: 1440, H: 900, dpr: 1, search: '?bgq=0' }); } catch (e) { console.log('FAIL: ' + e.message); process.exit(1); }
  const Q = s2.P, Bg2 = s2.window.Bg, card = H.cssCard(Q.W);
  if (Bg2 && Bg2.bodiesAt && Q.ORBIT_RATE) {
    const N = Math.round((2 * Math.PI) / Q.ORBIT_RATE / 16.7);
    let seen = 0, all = 0, reach = 0;
    for (let i = 0; i < N; i++) {
      s2.frame(16.7);
      if (i % 4) continue;
      for (const o of Bg2.bodiesAt(Q.simNow)) {
        all++;
        reach = Math.max(reach, Math.abs(o.x - Q.W / 2));
        if (o.x >= 0 && o.x <= Q.W && o.y >= 0 && o.y <= Q.H && (o.x < card.left || o.x > card.right)) seen++;
      }
    }
    console.log('');
    console.log('the bodies over one orbit (' + (N * 16.7 / 1000).toFixed(0) + 's, no pointer): on screen in the gutters '
                + (100 * seen / all).toFixed(0) + '% of the time; at most ' + reach.toFixed(0) + 'px from the centre (the card\'s edge '
                + (Q.W / 2 - card.left) + ', the screen\'s ' + Q.W / 2 + ')');
  }
}
