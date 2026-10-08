'use strict';
/* The WebGL floor is opaque, ordered by depth, and its lines are whole.

   On Canvas the sheet was a wireframe drawn back to front: where the swell
   or a well turned the sheet away from the viewer, a farther row showed
   below a nearer one - braided rows in 100% of frames, 18-106 px (audit
   G1.1) - and the terrain's COAT fills, painted over the whole sheet,
   wiped rows that were nearer than the terrain (G1.2: 19-31 px deep, ~1,100
   px of row a frame); and every column was dashed, one segment in three
   missing (F1). render-webgl.js draws the floor as an opaque mesh through
   the depth buffer, and its lines from the (sn, 1/d) of the surface each
   pixel shows. This checks what the GPU actually produced, in headless
   Chrome (1440x900@1.5 and 390x844@2, paused, so the frame is a still one
   of a scene state the check sets with Bg.advance), against the scene's
   own surface (surfacePoint):

     depth    the floor's 1/d at every pixel, read back (probeDepth), against
              the nearest part of the true surface over that pixel: each
              screen column swept from near to far over the mesh's own
              depth span (sheetMesh's nearest and farthest rows, MESH_NEAR
              and MESH_FAR), a step of 3.5e-4 in the rows' parameter u
              (~3,700 depths), the first part of the sheet to cross a pixel
              being the one in front. That is the whole sheet only where
              the sweep starts below the bottom of the screen, so the
              floor's near edge must be off the screen in every column: a
              floor that stopped at d = 0.99 was not, by up to 139 px, and
              farther rows showed below its nearest where the cursor's dent
              pushed them down there (G1.1 at the near edge), which a sweep
              that started where the mesh did could not see. Every 4th
              device column, every pixel of it. A pixel
              matches if the two agree to within 1 px of the surface's own
              slope there (the mesh is within 0.4 px, check-sheet-mesh.js),
              where the true front surface jumps (silhouettes, coverage
              edges), the pixels within 2 of the jump are counted, not
              judged: the mesh's edge, within 0.4 px of the true one, may
              fall a pixel either side; and a pixel that shows the true front
              surface of a pixel within 2 above or below is a sub-pixel
              shift, counted too. Any other mismatch is counted by kind -
              see-through (a farther part shown where a nearer one stands:
              G1.1), too near, and coverage (floor where there is none, or
              none where there is) - and there must be none. The pixels
              where the sheet does overlap itself are counted, to show the
              folds were there to hide.
     monotone the floor's visible 1/d never rises going up a column of
              pixels, in every device column: no pixel's 1/d is more than
              1e-4 above the least 1/d below it, down to where the floor
              ends. The front of an opaque sheet that starts below the
              screen can only recede going up (sweeping near to far, the
              rows of pixels are first crossed in order, bottom to top); a
              farther part shown below a nearer one breaks it. This needs
              no sweep: it found the near-edge G1.1 the sweep missed, 1,771
              and 7,883 device px in the 390x844 states below and 4,718 at
              1440x900 with the pointer at (145, 690), before the floor
              reached below the screen.
     apron    the floor nearer than its first row shows the floor and its
              lines only: in the screenshot, every pixel where the readback
              shows it nearer than d = 0.995, more than 3 px below anything
              at d = 0.999 or farther (the first row's own line, a fold's
              silhouette), and clear of the bodies, is the page grey or a
              mix of it and the line ink (within 3 levels of that line) -
              nothing of a farther part, of the scenery or of the bodies
              shows through it. It was blank, and rows and columns stopped
              at d = 1; they go on now (render-webgl.js THE NEAR FLOOR: the
              first row, lifted by the swell, left plain floor under it), so
              some of it must be lines: at least one pixel in a state
              that has an apron at all.
     layers   the same with a stand-in for a later layer drawn after the
              floor through the depth test (probeDepth(dTest)) at the
              terrain's depths 6.49, 5.65 and 4.92: it must win exactly where
              the floor in front of it is farther or absent - a stand-in
              shown over nearer floor is the G1.2 wipe, floor shown over a
              nearer stand-in a leak; none of either. And one just behind
              the floor's nearest row (1.01 MESH_NEAR) must show on every
              pixel: the near plane is nearer than any of the floor (with
              1 - 1/d it was at d = 0.5, and clipped the floor nearer).
     columns  the 33 columns traced through the screenshot from d = 1 to
              DMAX in steps of 0.005, wherever the readback says that point
              of the column is the surface in front (to 1/4 px), nothing of
              the scenery stands in front of it or beside it (probeIds: the
              floor at the pixel and all 8 around it; W2b's ridges, peaks
              and trees stand on the far floor and hide it, as they should)
              and nothing else is near (no row within 3 CSS px, the
              neighbouring column 4 CSS px or more away, so not faded for
              bunching): the pixel there, or one beside it, must carry the
              column's ink (at least 35% of its alpha's darkness). No gap
              may be found.
     crests   one clean line along every fold, calm in motion (render-
              webgl.js THE CREST; the final QA lens: "a faint dotted trail
              runs along floor crests where a nearer swell hides farther
              rows"). On a renderer of the check's own over the page's
              scene:
                calm  CALM_FRAMES frames CALM_DT ms apart (so the motion
                      moves no edge a pixel a frame), the swell alone at
                      CALM_T; over the lower 60% of the frame, the pixels
                      that brighten and darken again (or the other way) by
                      more than CALM_REV levels from one frame to the next:
                      at most CALM_MAX a frame. The motion moves a pixel's
                      brightness one way at a time; flicker reverses it.
                      The rows' fading tails along the crests made 55.4 a
                      frame at 1440x900@1.5 and 20.2 at 390x844@2.
                line  in a still frame, every device column's fold
                      silhouettes (floor over floor, the 1/d jumping more
                      than 4 times what it changes by a pixel either side,
                      the near side at d 1.1 to DMAX - 0.3, floor all round,
                      no body near) must have the crest line's ink on the
                      near surface within CREST_GAP + CREST_W of them (60%
                      of a row's darkness at that depth) at LINE_MIN of
                      them, LINE_MIN_PHONE at 390x844 (a fold only just
                      born draws its line fading in, and on the sides of a
                      round fold it tapers off).

   States: idle at scene time 134 s (the frame G1.1 measured its worst body
   fold in, 65.9 px); the pointer parked at (145, 690), where its dent
   folds the near floor (G1.1: 64 px of braid); and the first swell event
   with the pointer gone; and at 390x844@2 the pointer parked low in the
   left gutter at (39, 650), 3.4 s and 55 s in (the review's G1.1 states:
   the swell lifts the first row and the dent pushes the sheet behind it
   down below it). The crests: the swell alone at 40 s, the pointer parked
   low on the floor (300, 760; at 390x844, 60, 720), and the first swell
   event at its height. SKIP when puppeteer-core or Chrome is missing. Exit
   1 on any mismatch. */
const B = require('./browser');
const K = require('./glkit');
const Hs = require('./harness');
/* the sheet's lines as the renderer declares them (render-webgl.js), for
   the page side of the check: the rows' ROW_POW, the columns' COLS,
   COL_SPAN and their alpha, COL_A * (1 - COL_DIM * dn) */
const L = Hs.rendererNumbers(['ROW_POW', 'COLS', 'COL_SPAN', 'COL_A', 'COL_DIM']);
/* the sheet's line ink (render-webgl.js INK), read from the source */
const INK_RGB = (() => {
  const m = /const INK = \[(\d+), (\d+), (\d+)\]/.exec(require('fs').readFileSync(require('path').join(Hs.ROOT, 'assets', 'js', 'bg', 'render-webgl.js'), 'utf8'));
  if (!m) { console.log('check-webgl-floor: FAIL - render-webgl.js has no const INK = [r, g, b]'); process.exit(1); }
  return [+m[1], +m[2], +m[3]];
})();
/* the crests (the header) */
const CALM_FRAMES = 60, CALM_DT = 4, CALM_REV = 12, CALM_MAX = 12, CALM_T = 40000;
const LINE_MIN = 0.85, LINE_MIN_PHONE = 0.6, LINE_SHARE = 0.6;

const fails = [], notes = [];
const DTESTS = [6.49, 5.65, 4.92];

/* in the page: one state, measured; the column points to look for ink at
   come back as [X, Y, darkness needed] for node to check in the screenshot */
function measure(label, dTests, greyG, L) {
  const Bg = window.Bg, W = Bg.W, H = Bg.H, t = Bg.simNow;
  if (!window.__probe) {
    const c = document.createElement('canvas');
    window.__probe = Bg.renderers.webgl(c);
  }
  const r = window.__probe;
  if (!r) return { error: 'no WebGL renderer' };
  r.resize(W, H, Math.min(devicePixelRatio, 2));
  const base = r.probeDepth();
  if (!base) return { error: 'probeDepth failed' };
  /* what the whole scene shows at each pixel: the trace only looks where the floor does */
  const scene = r.probeIds ? r.probeIds() : null;
  const floorOnly = (X, Y) => {
    if (!scene) return true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (scene.id[(Y + dy) * scene.w + X + dx] !== 1) return false;
    return true;
  };
  const bw = base[0], bh = base[1], k = bw / W;
  const OUT = [0, 0];
  /* the mesh's own depth span: its nearest and farthest rows */
  const mesh = Bg.renderers.webgl.sheetMesh();
  let dLo = Infinity, dHi = 0;
  for (let i = 1; i < mesh.length; i += 2) { if (mesh[i] < dLo) dLo = mesh[i]; if (mesh[i] > dHi) dHi = mesh[i]; }
  /* on the rows' parametrisation, d = 1 + (DMAX - 1) * sign(u) * |u|^ROW_POW
     (mirrored through the first row, as the mesh is), a step of 3.5e-4 in u
     (3,000 depths over 0.99..6.8 was that) */
  const uOf = d => Math.sign(d - 1) * Math.pow(Math.abs(d - 1) / (Bg.DMAX - 1), 1 / L.ROW_POW);
  const U0 = uOf(dLo), U1 = uOf(dHi), N = Math.ceil((U1 - U0) / 3.5e-4);
  /* the true surface's nearest part over every pixel of column X (device
     px), and where the sweep starts on the screen (y0, device px) */
  function sweep(X) {
    const x = (X + 0.5) / k, vis = new Float32Array(bh), slope = new Float32Array(bh), multi = new Uint8Array(bh);
    let py = 0, pv = 0, y0 = 0;
    for (let i = 0; i <= N; i++) {
      const u = U0 + ((U1 - U0) * i) / N;
      const d = 1 + (Bg.DMAX - 1) * Math.sign(u) * Math.pow(Math.abs(u), L.ROW_POW);
      const sn = (x - Bg.centreX(d)) / (W * Bg.PERSP_X);
      const y = Bg.surfacePoint(sn * d, d, t, OUT)[1] * k, v = 1 / d;
      if (i === 0) y0 = y;
      if (i > 0 && y !== py) {
        const lo = Math.min(y, py), hi = Math.max(y, py);
        const s = Math.abs((v - pv) / (y - py));
        for (let Y = Math.max(0, Math.ceil(lo - 0.5)); Y <= Math.min(bh - 1, Math.floor(hi - 0.5)); Y++) {
          const f = (Y + 0.5 - py) / (y - py), vv = pv + (v - pv) * f;
          if (vis[Y] === 0) { vis[Y] = vv; slope[Y] = s; } else multi[Y] = 1;
        }
      }
      py = y; pv = v;
    }
    return { vis, slope, multi, y0 };
  }
  const cols = [];
  for (let X = 1; X < bw; X += 4) cols.push([X, sweep(X)]);
  /* the floor's near edge: below the screen in every column, or the sweep
     is not the whole sheet there */
  const nearEdge = { on: 0, at: null, gap: Infinity };
  for (const [X, sw] of cols) {
    nearEdge.gap = Math.min(nearEdge.gap, (sw.y0 - bh) / k);
    if (sw.y0 < bh) { nearEdge.on++; if (!nearEdge.at) nearEdge.at = [X, +sw.y0.toFixed(1)]; }
  }
  const at = (img, X, Y) => img[2 + Y * bw + X];
  /* Silhouettes and coverage edges: where the true front surface jumps
     from one pixel to the next (by more than 4 px of its slope), the mesh's
     edge, within 0.4 px of the true one, may land a pixel either side. The
     pixels within 2 of such a jump are counted, not judged. */
  for (const [, sw] of cols) {
    const edge = sw.edge = new Uint8Array(bh);
    for (let Y = 0; Y + 1 < bh; Y++) {
      const a = sw.vis[Y], b2 = sw.vis[Y + 1];
      const jump = (a === 0) !== (b2 === 0) || Math.abs(a - b2) > 4 * Math.max(sw.slope[Y], sw.slope[Y + 1]) + 1e-5;
      if (jump) for (let k2 = Y - 1; k2 <= Y + 2; k2++) if (k2 >= 0 && k2 < bh) edge[k2] = 1;
    }
    /* and the floor's own near and far edges (the mesh's dLo, dHi), which
       the loop above cannot see where they run along the screen's last row */
    for (let Y = 0; Y < bh; Y++) {
      const v = sw.vis[Y];
      if (v > 0 && (v >= 1 / dLo - 2 * sw.slope[Y] || v <= 1 / dHi + 2 * sw.slope[Y])) edge[Y] = 1;
    }
  }
  /* Is g within the true front surface's range over the pixels 2 above to
     2 below? Then a pixel that disagrees is that surface shifted by a
     fraction of a pixel - where the sheet turns nearly edge-on, 1/d changes
     several times faster per pixel than its neighbours do, and between mesh
     columns a crest can stand a fraction of a pixel proud of the true one -
     not another part of the sheet showing through, whose 1/d lies far
     outside that range. */
  const shifted = (sw, Y, g) => {
    let lo = Infinity, hi = -Infinity;
    for (let k2 = Y - 2; k2 <= Y + 2; k2++) {
      if (k2 < 0 || k2 >= bh || sw.vis[k2] === 0) continue;
      lo = Math.min(lo, sw.vis[k2] - sw.slope[k2]); hi = Math.max(hi, sw.vis[k2] + sw.slope[k2]);
    }
    return g >= lo && g <= hi;
  };
  /* the floor alone: every pixel shows the true front surface (within 1 px
     of its slope), or none where there is none */
  const depth = { n: 0, edge: 0, shift: 0, see: 0, near: 0, cover: 0, folds: 0, worst: null };
  for (const [X, sw] of cols) {
    for (let Y = 0; Y < bh; Y++) {
      depth.n++;
      if (sw.multi[Y]) depth.folds++;
      if (sw.edge[Y]) { depth.edge++; continue; }
      const e = sw.vis[Y], g = at(base, X, Y);
      if ((e === 0) !== (g === 0)) depth.cover++;
      else if (e === 0 || Math.abs(g - e) <= sw.slope[Y] + 2e-6) continue;
      else if (shifted(sw, Y, g)) { depth.shift++; continue; }
      else if (g < e) depth.see++;
      else depth.near++;
      if (!depth.worst) depth.worst = [X, Y, e, g];
    }
  }
  /* up every device column, the visible 1/d never more than 1e-4 above the
     least 1/d below it, down to where the floor ends */
  const mono = { n: 0, bad: 0, worst: null };
  for (let X = 0; X < bw; X++) {
    let least = Infinity;
    for (let Y = bh - 1; Y >= 0; Y--) {
      const g = at(base, X, Y);
      if (g === 0) { least = Infinity; continue; }
      mono.n++;
      if (g > least + 1e-4) {
        mono.bad++;
        if (!mono.worst || g - least > mono.worst[4]) mono.worst = [X, Y, +(1 / least).toFixed(3), +(1 / g).toFixed(3), g - least];
      }
      if (g < least) least = g;
    }
  }
  /* the apron's pixels (the header), as runs [Y, X0, X1], for node to look
     at in the screenshot; and the bodies' discs, which may stand over it */
  const apron = [];
  for (let Y = 0; Y < bh; Y++) {
    let x0 = -1;
    for (let X = 0; X <= bw; X++) {
      let on = X < bw && at(base, X, Y) > 1 / 0.995;
      for (let dy = 1; dy <= 3 && on; dy++) {
        const g = Y - dy >= 0 ? at(base, X, Y - dy) : 0;
        if (g > 0 && g <= 1 / 0.999) on = false;
      }
      if (on && x0 < 0) x0 = X;
      if (!on && x0 >= 0) { apron.push(Y, x0, X - 1); x0 = -1; }
    }
  }
  const bodies = Bg.bodiesAt(t).map(b => [b.x * k, b.y * k, (17 * b.size + 3) * k]);
  /* the depth range: a stand-in layer just behind the floor's nearest row
     shows on every pixel, so nothing of the floor is nearer than the near
     plane, which would clip it away (1 - 1/d put the near plane at
     d = 0.5) */
  const reach = { dT: dLo * 1.01, shown: 0, n: bw * bh };
  {
    const img = r.probeDepth(reach.dT);
    if (!img) return { error: 'probeDepth(' + reach.dT + ') failed' };
    const lv = 1 / reach.dT;
    for (let i = 0; i < reach.n; i++) {
      if (img[2 + i] > lv - 1e-5) reach.shown++;
      else if (!reach.at) reach.at = [i % bw, Math.floor(i / bw), +(1 / img[2 + i]).toFixed(4)];
    }
  }
  /* a layer after the floor at 1/dT: it shows exactly where the floor in
     front is farther or absent. Pixels within 2 px (of the floor's slope)
     of the floor's own 1/dT, where either may win, are counted, not judged. */
  const layers = [];
  for (const dT of dTests) {
    const img = r.probeDepth(dT);
    if (!img) return { error: 'probeDepth(' + dT + ') failed' };
    const lv = 1 / dT, L = { dT, n: 0, skipped: 0, won: 0, wipes: 0, leaks: 0, off: 0, shift: 0, worst: null };
    for (const [X, sw] of cols) {
      for (let Y = 0; Y < bh; Y++) {
        const g = at(img, X, Y), layer = Math.abs(g - lv) < 1e-5;
        /* the floor in front: the true surface's, or where the floor alone
           was a sub-pixel shift of it (above), the floor the GPU drew - a
           crest whose tip only grazes a pixel's centre can miss it, and
           then the layer rightly wins over the farther part shown there
           (390x844, a dent's crest: one pixel a layer) */
        const gb = at(base, X, Y), sh = sw.vis[Y] > 0 && gb > 0 && Math.abs(gb - sw.vis[Y]) > sw.slope[Y] + 2e-6 && shifted(sw, Y, gb);
        const e = sh ? gb : sw.vis[Y];
        L.n++;
        if (layer) L.won++;
        if (sw.edge[Y] || (e > 0 && Math.abs(e - lv) <= 2 * sw.slope[Y] + 1e-5)) { L.skipped++; continue; }
        if (sh) L.shift++;
        const floorWins = e > lv;
        if (floorWins && layer) L.wipes++;
        else if (!floorWins && !layer) L.leaks++;
        else if (floorWins && Math.abs(g - e) > sw.slope[Y] + 2e-6 && !shifted(sw, Y, g)) L.off++;
        else continue;
        if (!L.worst) L.worst = [X, Y, e, g];
      }
    }
    layers.push(L);
  }
  /* the columns: where each one's point is the surface in front, alone */
  const trace = [];
  {
    const rowD = [];
    for (let i = 0; i < Bg.ROWS; i++) rowD.push(1 + (Bg.DMAX - 1) * Math.pow(i / (Bg.ROWS - 1), L.ROW_POW));
    const colStep = (2 * L.COL_SPAN) / (L.COLS - 1);
    for (let c = 0; c < L.COLS; c++) {
      const xc = -L.COL_SPAN + colStep * c;
      for (let d = 1; d <= Bg.DMAX; d += 0.005) {
        const p = Bg.surfacePoint(xc, d, t, OUT), X = Math.floor(p[0] * k), Y = Math.floor(p[1] * k);
        if (X < 2 || Y < 2 || X >= bw - 2 || Y >= bh - 2) continue;
        /* the surface in front there is this point of the column */
        if (!floorOnly(X, Y)) continue;
        const g = at(base, X, Y), sv = 1 / d, py = p[1];
        const vy = Math.abs(1 / d - 1 / (d + 0.001)) / Math.max(1e-9, Math.abs(Bg.surfacePoint(xc, d + 0.001, t, OUT)[1] - py) * k);
        if (!(Math.abs(g - sv) <= vy * 0.25 + 2e-6)) continue;
        /* nothing else near: no row within 3 CSS px, neighbours 4+ px away */
        const px = Bg.surfacePoint(xc, d, t, OUT)[0];
        const near = rowD.some(dr => {
          const q = Bg.surfacePoint(((px - Bg.centreX(dr)) * dr) / (W * Bg.PERSP_X), dr, t, OUT);
          return Math.abs(q[1] - py) < 3;
        });
        if (near) continue;
        const nb = [c - 1, c + 1].filter(j => j >= 0 && j < L.COLS).map(j => Bg.surfacePoint(-L.COL_SPAN + colStep * j, d, t, OUT)[0]);
        if (nb.some(x2 => Math.abs(x2 - px) < 4)) continue;
        const dn = Math.pow((d - 1) / (Bg.DMAX - 1), 1 / L.ROW_POW);
        trace.push([X, Y, 0.35 * L.COL_A * (1 - L.COL_DIM * dn) * (greyG - 104), c, +d.toFixed(3)]);
      }
    }
  }
  return { label, t, bw, bh, columns: cols.length, dLo, dHi, N, nearEdge, reach, depth, mono, layers, trace, apron, bodies };
}

/* in the page, for the crests: a renderer of the check's own over the
   page's scene, put in a state */
function crestState(state) {
  const Bg = window.Bg;
  if (!window.__crestR) {
    const c = document.createElement('canvas');
    window.__crestR = { c, r: Bg.renderers.webgl(c) };
  }
  const { r, c } = window.__crestR;
  if (!r) return { error: 'no WebGL renderer' };
  r.resize(Bg.W, Bg.H, Math.min(devicePixelRatio, 2));
  Bg.resetClock();
  let now = 1000;
  Bg.advance(now);
  if (state.px != null) { Bg.pointerAt(state.px, state.py); for (let i = 0; i < 240; i++) { now += 16.7; Bg.advance(now); } }
  else {
    Bg.pointerGone();
    if (state.event) { for (let i = 0; i < 600 && !(Bg.EVF.on && Bg.EVF.env > 0.95); i++) { now += 64; Bg.advance(now); } }
    else while (Bg.simNow < state.t) { now += 64; Bg.advance(now); }
  }
  window.__crestNow = now;
  return { t: Bg.simNow };
}
/* calm: frames dt ms apart, the reversals counted per pixel of the lower 60% */
function crestCalm(n, dt, rev) {
  const Bg = window.Bg, { r, c } = window.__crestR, gl = c.getContext('webgl2') || c.getContext('webgl');
  const bw = c.width, bh = c.height, rows = bh - Math.floor(bh * 0.4), px = new Uint8Array(4 * bw * rows);
  const L3 = [new Float32Array(bw * rows), new Float32Array(bw * rows), new Float32Array(bw * rows)];
  let now = window.__crestNow, total = 0, triples = 0;
  for (let k = 0; k < n; k++) {
    now += dt; Bg.advance(now);
    r.draw(Bg.simNow, true);
    gl.readPixels(0, 0, bw, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const l = L3[k % 3];
    for (let i = 0, j = 0; i < l.length; i++, j += 4) l[i] = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
    if (k >= 2) {
      const a = L3[(k - 2) % 3], b = L3[(k - 1) % 3];
      for (let i = 0; i < l.length; i++) {
        const d1 = b[i] - a[i], d2 = l[i] - b[i];
        if ((d1 > rev && d2 < -rev) || (d1 < -rev && d2 > rev)) total++;
      }
      triples++;
    }
  }
  window.__crestNow = now;
  return { perFrame: total / triples, triples };
}
/* line: the frame, the floor's visible 1/d and what each pixel shows; at
   every fold silhouette, the darkest pixel of the near surface within the
   line's reach */
function crestLine(o) {
  const Bg = window.Bg, { r, c } = window.__crestR, gl = c.getContext('webgl2') || c.getContext('webgl');
  r.draw(Bg.simNow, true);
  const bw = c.width, bh = c.height, k = bw / Bg.W, px = new Uint8Array(4 * bw * bh);
  gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const G = (X, Y) => px[4 * ((bh - 1 - Y) * bw + X) + 1];
  const depth = r.probeDepth(), ids = r.probeIds();
  if (!depth || !ids) return { error: 'a probe failed' };
  const v = (X, Y) => depth[2 + Y * bw + X], id = (X, Y) => ids.id[Y * bw + X];
  const bodies = Bg.bodiesAt(Bg.simNow).map(b => [b.x * k, b.y * k, (17 * b.size + 6) * k]);
  const R = Math.ceil((o.gap + o.w) * k) + 2;
  let folds = 0, inked = 0;
  for (let X = R + 2; X < bw - R - 2; X += 2) {
    for (let Y = bh - R - 3; Y > R + 2; Y--) {
      const vn = v(X, Y), vf = v(X, Y - 1);
      if (!(vn > 0 && vf > 0 && vn - vf > 0.005 * vn)) continue;
      if (!(vn - vf > 4 * Math.max(Math.abs(vn - v(X, Y + 1)), Math.abs(vf - v(X, Y - 2))))) continue;
      const d = 1 / vn;
      if (d < 1.1 || d > o.dmax - 0.3) continue;
      let alone = true;
      for (let yy = Y - R; alone && yy <= Y + R; yy++) for (let xx = X - R; xx <= X + R; xx++) if (id(xx, yy) !== 1) { alone = false; break; }
      if (!alone || bodies.some(([bx, by, br]) => Math.hypot(X - bx, Y - by) < br)) continue;
      folds++;
      const dn = Math.pow((d - 1) / (o.dmax - 1), 1 / o.rowPow), want = o.rowA * (1 - o.rowDim * dn) * (o.grey - o.ink);
      let dark = 0;
      for (let yy = Y - R; yy <= Y + R; yy++) {
        for (let xx = X - R; xx <= X + R; xx++) {
          if ((xx - X) * (xx - X) + (yy - Y) * (yy - Y) > R * R || !(Math.abs(v(xx, yy) - vn) < 0.03 * vn)) continue;
          dark = Math.max(dark, o.grey - G(xx, yy));
        }
      }
      if (dark >= o.share * want) inked++;
    }
  }
  return { folds, inked };
}
/* the crests (the header), at both sizes */
async function crests(b, site) {
  let N;
  try { N = Hs.rendererNumbers(['CREST_W', 'CREST_GAP', 'ROW_A', 'ROW_DIM']); }
  catch (e) { fails.push('crests: the renderer draws no crest line (' + e.message + ')'); N = { CREST_W: 1.25, CREST_GAP: 0.7, ROW_A: 0.6, ROW_DIM: 0.55 }; }
  const out = [];
  for (const pg of [{ width: 1440, height: 900, dpr: 1.5, min: LINE_MIN, states: [['the swell alone at 40 s', { t: CALM_T }, true], ['the pointer parked at (300, 760)', { px: 300, py: 760 }],
                                                                               ['the first swell event at its height', { event: true }]] },
                    { width: 390, height: 844, dpr: 2, min: LINE_MIN_PHONE, states: [['the swell alone at 40 s', { t: CALM_T }, true], ['the pointer parked at (60, 720)', { px: 60, py: 720 }]] }]) {
    const size = pg.width + 'x' + pg.height + '@' + pg.dpr;
    const s = await b.open(site.url + 'index.html?bgq=0', { width: pg.width, height: pg.height, dpr: pg.dpr, media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await s.frames(3);
      const grey = await K.pageGrey(s);
      for (const [label, state, quiet] of pg.states) {
        const tag = size + ' ' + label;
        const st = await s.evaluate(crestState, state);
        if (st.error) { fails.push('crests, ' + tag + ': ' + st.error); continue; }
        let note = tag + ' (' + (st.t / 1000).toFixed(1) + 's): ';
        if (quiet) {
          const cm = await s.evaluate(crestCalm, CALM_FRAMES, CALM_DT, CALM_REV);
          if (!(cm.perFrame <= CALM_MAX)) fails.push('crests, ' + tag + ': ' + cm.perFrame.toFixed(1) + ' px a frame brighten and darken again by over ' + CALM_REV + ' levels (limit ' + CALM_MAX + '): the crests shimmer');
          note += cm.perFrame.toFixed(1) + ' px a frame reverse, ';
        }
        const ln = await s.evaluate(crestLine, { gap: N.CREST_GAP, w: N.CREST_W, rowA: N.ROW_A, rowDim: N.ROW_DIM, rowPow: L.ROW_POW, dmax: 6.5, share: LINE_SHARE, grey: grey[1], ink: 104 });
        if (ln.error) { fails.push('crests, ' + tag + ': ' + ln.error); continue; }
        const share = ln.folds ? ln.inked / ln.folds : 0;
        if (!(ln.folds >= 100)) fails.push('crests, ' + tag + ': only ' + ln.folds + ' fold silhouettes found (the state tests nothing)');
        else if (!(share >= pg.min)) fails.push('crests, ' + tag + ': the crest line inks only ' + (100 * share).toFixed(1) + '% of ' + ln.folds + ' fold silhouettes (need ' + (100 * pg.min) + '%)');
        out.push(note + 'the line along ' + (100 * share).toFixed(1) + '% of ' + ln.folds + ' fold silhouettes');
      }
      for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push('crests, ' + size + ': console ' + m.type + ': ' + m.text);
      for (const x of s.errors) if (x.type !== 'error') fails.push('crests, ' + size + ': ' + x.type + ': ' + x.text);
    } finally { await s.close(); }
  }
  return out;
}

/* the pages, and the states each is put in (the header) */
const PAGES = [
  { width: 1440, height: 900, dpr: 1.5, states: [
    ['idle at 134s', () => { let now = 0; window.Bg.resetClock(); while (window.Bg.simNow < 134000) { now += 64; window.Bg.advance(now); } }],
    ['pointer parked at (145, 690)', () => {
      let now = 1e6; window.Bg.resetClock(); window.Bg.pointerAt(145, 690);
      for (let i = 0; i < 200; i++) { now += 16.7; window.Bg.advance(now); }
    }],
    ['the first swell event', () => {
      let now = 2e6; window.Bg.resetClock(); window.Bg.pointerGone();
      window.Bg.advance(now);
      for (let i = 0; i < 400 && !(window.Bg.EVF.on && window.Bg.EVF.env > 0.9); i++) { now += 64; window.Bg.advance(now); }
      for (let i = 0; i < 60; i++) { now += 16.7; window.Bg.advance(now); }
    }]] },
  /* the review's two states, exactly: its page drew two frames, then put
     the pointer at (39, 650) for 200 frames (the first), and again for
     1,100 and then 2,000 more (the second, 55 s in), restarting the frame
     clock each time (resetClock: not the scene's time) */
  { width: 390, height: 844, dpr: 2, states: [
    ['pointer parked at (39, 650), 200 frames', () => {
      let now = 0; window.Bg.resetClock();
      for (let i = 0; i < 2; i++) { now += 16.7; window.Bg.advance(now); }
      now = 1e6; window.Bg.resetClock(); window.Bg.pointerAt(39, 650);
      for (let i = 0; i < 200; i++) { now += 16.7; window.Bg.advance(now); }
    }],
    ['pointer parked at (39, 650), 3,300 frames', () => {
      let now = 0; window.Bg.resetClock();
      for (let i = 0; i < 2; i++) { now += 16.7; window.Bg.advance(now); }
      for (const [at, n] of [[1e6, 200], [2e6, 1100], [3e6, 2000]]) {
        now = at; window.Bg.resetClock(); window.Bg.pointerAt(39, 650);
        for (let i = 0; i < n; i++) { now += 16.7; window.Bg.advance(now); }
      }
    }]] }
];

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-webgl-floor: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  let span = '', crestNotes = [];
  try {
    for (const pg of PAGES) {
      const size = pg.width + 'x' + pg.height + '@' + pg.dpr;
      const s = await b.open(site.url + 'index.html?bgq=0', { width: pg.width, height: pg.height, dpr: pg.dpr, media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await s.frames(3);
        if ((await K.rendererOf(s)) !== 'webgl2') fails.push(size + ': the page did not start with WebGL 2');
        await K.hideCard(s);
        const grey = await K.pageGrey(s);
        let fresh = true;
        for (const [name, set] of pg.states) {
          const label = size + ' ' + name;
          if (!fresh) await s.page.reload({ waitUntil: 'load' }), await s.frames(3), await K.hideCard(s);
          fresh = false;
          await s.evaluate(set);
          /* the page's own still frame of this state: a resize repaints it */
          await s.evaluate(() => window.dispatchEvent(new Event('resize')));
          await s.frames(4);
          const img = B.decodePNG(await s.screenshot());
          const m = await s.evaluate(measure, label, DTESTS, grey[1], L);
          if (m.error) { fails.push(label + ': ' + m.error); continue; }
          span = 'the mesh\'s span d = ' + m.dLo.toFixed(2) + '..' + m.dHi.toFixed(2) + ', ' + m.N + ' depths';
          const dark = (X, Y) => (X < 0 || Y < 0 || X >= img.width || Y >= img.height) ? 0 : Math.max(0, grey[1] - img.data[4 * (Y * img.width + X) + 1]);
          m.traced = m.trace.length; m.gaps = 0; m.gapAt = null;
          for (const [X, Y, need, c, dd] of m.trace) {
            let ink = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ink = Math.max(ink, dark(X + dx, Y + dy));
            if (ink < need) { m.gaps++; if (!m.gapAt) m.gapAt = [c, dd, X, Y, ink, +need.toFixed(1)]; }
          }
          let apronPx = 0, apronInk = 0, apronAt = null, apronLined = 0;
          for (let q = 0; q < m.apron.length; q += 3) {
            const Y = m.apron[q];
            for (let X = m.apron[q + 1]; X <= m.apron[q + 2]; X++) {
              if (m.bodies.some(([bx, by, br]) => Math.hypot(X + 0.5 - bx, Y + 0.5 - by) < br)) continue;
              apronPx++;
              const i = 4 * (Y * img.width + X);
              const p = [img.data[i], img.data[i + 1], img.data[i + 2]];
              if (p[0] === grey[0] && p[1] === grey[1] && p[2] === grey[2]) continue;
              /* the nearest mix of the grey and the ink */
              const e = [INK_RGB[0] - grey[0], INK_RGB[1] - grey[1], INK_RGB[2] - grey[2]], ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
              const u = Math.max(0, Math.min(1, ((p[0] - grey[0]) * e[0] + (p[1] - grey[1]) * e[1] + (p[2] - grey[2]) * e[2]) / ee));
              const off = Math.max(Math.abs(p[0] - grey[0] - u * e[0]), Math.abs(p[1] - grey[1] - u * e[1]), Math.abs(p[2] - grey[2] - u * e[2]));
              apronLined++;
              if (off > 3) {
                apronInk++;
                if (!apronAt) apronAt = [X, Y, p[0], p[1], p[2]];
              }
            }
          }
          if (apronInk) fails.push(label + ': ' + apronInk + ' of ' + apronPx + ' px of the floor nearer than its first row are neither the page grey nor its lines (first [X, Y, rgb] '
                                   + JSON.stringify(apronAt) + '): something shows through it');
          if (apronPx > 2000 && !apronLined) fails.push(label + ': the ' + apronPx + ' px of floor nearer than its first row are blank: its rows and columns stop at d = 1 (THE NEAR FLOOR)');
          m.apronLined = apronLined;
          const ne = m.nearEdge;
          if (ne.on) fails.push(label + ': the floor\'s near edge (d = ' + m.dLo.toFixed(2) + ') is on the screen in ' + ne.on + ' of ' + m.columns
                                + ' columns (first at device [X, y] ' + JSON.stringify(ne.at) + '): nothing hides what of the farther sheet comes below it,'
                                + ' and the sweep is not the whole sheet there');
          if (m.reach.shown !== m.reach.n) fails.push(label + ': a layer just behind the floor\'s nearest row (d = ' + m.reach.dT.toFixed(3) + ') shows on only '
                                                    + m.reach.shown + ' of ' + m.reach.n + ' px (the first not: device [X, Y, the d it shows] ' + JSON.stringify(m.reach.at) + '): the near plane clips the floor\'s nearest part');
          const d = m.depth, bad = d.see + d.near + d.cover;
          if (bad) fails.push(label + ': ' + bad + ' of ' + d.n + ' pixels show the wrong part of the floor (' + d.see + ' see-through, ' + d.near
                              + ' too near, ' + d.cover + ' coverage; first at ' + JSON.stringify(d.worst) + ')');
          if (!(d.folds > 1000)) fails.push(label + ': only ' + d.folds + ' pixels where the sheet overlaps itself (the state hides nothing)');
          if (!(d.edge + d.shift < 0.01 * d.n)) fails.push(label + ': ' + (d.edge + d.shift) + ' of ' + d.n + ' pixels are by a silhouette, too many to leave unjudged');
          const mo = m.mono;
          if (mo.bad) fails.push(label + ': the visible 1/d rises going up a column at ' + mo.bad + ' of ' + mo.n + ' floor pixels - a farther part of the'
                                 + ' floor shown below a nearer one (G1.1; the worst [X, Y, d below, d shown, rise of 1/d]: ' + JSON.stringify(mo.worst) + ')');
          const lay = [];
          for (const L of m.layers) {
            if (L.wipes || L.leaks || L.off) fails.push(label + ', a layer at d = ' + L.dT + ': ' + L.wipes + ' pixels of it over nearer floor (the G1.2 wipe), '
                                                       + L.leaks + ' of floor over it where the floor is farther, ' + L.off + ' of the wrong floor; first at '
                                                       + JSON.stringify(L.worst));
            lay.push(L.dT + ' shows on ' + (100 * L.won / L.n).toFixed(1) + '%');
          }
          if (m.gaps) fails.push(label + ': ' + m.gaps + ' of ' + m.traced + ' traced column points have no ink (first: column ' + JSON.stringify(m.gapAt) + ')');
          if (!(m.traced > 1000)) fails.push(label + ': only ' + m.traced + ' column points could be traced');
          notes.push(label + ' (' + (m.t / 1000).toFixed(1) + 's): ' + d.n + ' px, ' + d.folds + ' over a fold, ' + d.edge + ' by a silhouette, '
                     + d.shift + ' a sub-pixel shift of it, 0 wrong; near edge ' + ne.gap.toFixed(0) + ' CSS px or more below the bottom, the apron on '
                     + apronPx + ' px, blank; 1/d monotone up '
                     + mo.n + ' px; layers ' + lay.join(', ') + ', 0 wipes, 0 leaks (' + m.layers.reduce((p, L) => p + L.shift, 0)
                     + ' px against a sub-pixel shift); columns ' + m.traced + ' points, ' + m.gaps + ' gaps');
        }
        /* the probes' readPixels make SwiftShader say it stalled: the test's own doing */
        for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push(size + ': console ' + m.type + ': ' + m.text);
        for (const x of s.errors) if (x.type !== 'error') fails.push(size + ': ' + x.type + ': ' + x.text);
      } finally { await s.close(); }
    }
    crestNotes = await crests(b, site);
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-webgl-floor: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-webgl-floor: OK - every 4th device column against the true surface (' + span + '): ' + notes.join('; ')
              + '; the crests: ' + crestNotes.join('; '));
}
main().catch(e => { console.log('check-webgl-floor: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
