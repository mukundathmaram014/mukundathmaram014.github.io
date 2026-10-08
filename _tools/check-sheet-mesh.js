'use strict';
/* The WebGL floor's lines lie on the true surface at every size (audit
   G4.3: on Canvas a row is a polyline of 73 points whatever the width -
   27 px chords at 1440, 71 px at 3840 - up to 5.4 px off the curve, and
   visibly polygonal on a 4K screen).

   render-webgl.js draws the sheet as one mesh (Bg.renderers.webgl.sheetMesh,
   the real one) whose vertices the vertex shader puts where surfacePoint
   puts them (check-wave-parity.js holds the two together), and draws each
   row and column where the interpolated (sn, 1/d) says the pixel is on it.
   A line therefore lies exactly where the mesh, interpolated linearly in
   screen space, puts that parameter - and the true surface puts it at
   surfacePoint(sn / v, 1 / v). This measures the gap between the two, in
   node, at the scene's own numbers:

     rows     every row runs along a mesh row (rows lie on mesh rows: the
              check fails if one does not); on each mesh edge, 8 points
     columns  in each mesh triangle a column crosses, the straight piece of
              the column there (the zero set of sn - xc / d, which is
              linear in the triangle), 8 points along it

   The gap is measured across the line (perpendicular to the true curve
   there): sliding along a line is not visible, and a column's depth is
   parametrised differently by the mesh and by the true surface. Only where
   the true point is on the screen. 7 viewports from 390x844 to
   3840x2160, 4 scene states each (idle, the pointer's dents in the left
   gutter, the first swell event, the pointer gone), the worst over all.
   (The Canvas renderer's sampling - rows every 0.03 of sn, columns at 31
   depths - measured 4.37 px for rows and 4.43 px for columns at 3840x2160
   the same way, before W3 deleted it.) Exit 1 if any line strays more
   than LIMIT px, or the mesh is not the expected one (rows on mesh rows,
   covering the sheet, cells only).

   And the mesh's nearest row (MESH_NEAR) is below the bottom of the
   screen whatever the wave does, so nothing of the farther sheet can
   show below the floor's near edge (G1.1 there: the floor stopped at
   d = 0.99, which the swell lifted up to 139 px above the bottom, and the
   cursor's dent then pushed farther rows below it). At that depth d0 the
   wave lifts the sheet by at most the swell's amplitudes (WAVE), the
   largest swell event (sampled over 20,000 events, its full amplitude,
   whatever its depth) and the well of any body that can reach d0 (the
   bodies keep behind BODY_FLOOR, a well reaches sqrt(WELL_R2) / DEPTH_W
   nearer); the dents only press it down. The horizon tilts by at most
   LOOK_Y / 2 with the pointer in the window. The edge's y,
   H * (HORIZON + (PERSP_Y - lift * WAVE_Y) / d0) - LOOK_Y / 2, must be
   below H in every window MIN_H px tall or more. */
const H = require('./harness');
/* the renderer's own line constants (render-webgl.js), not copies */
const L = H.rendererNumbers(['ROW_POW', 'COLS', 'COL_SPAN']);

/* sub-pixel at every size; measured 0.16 (rows) and 0.39 (columns) at 3840x2160 */
const LIMIT = 0.5;
/* the shortest window the near edge must stay below the bottom of (it
   does from 36 px, at MESH_NEAR = 0.35) */
const MIN_H = 100;
const SIZES = [[390, 844], [844, 390], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]];

const fails = [];
let worstRow = { e: 0 }, worstCol = { e: 0 };
let meshInfo = '';

function measure(sim, label) {
  const P = sim.P, Bg = sim.window.Bg, W = P.W, Hh = P.H, t = P.simNow;
  const mesh = Bg.renderers.webgl.sheetMesh();
  /* the mesh's grid: its distinct sn and d values, in order */
  const sns = new Set(), ds = new Set();
  for (let i = 0; i < mesh.length; i += 2) { sns.add(mesh[i]); ds.add(mesh[i + 1]); }
  const SN = [...sns].sort((a, b) => a - b), D = [...ds].sort((a, b) => a - b);
  const nx = SN.length, nd = D.length;
  /* screen position of every grid vertex, as the vertex shader puts it */
  const X = new Float64Array(nx * nd), Y = new Float64Array(nx * nd);
  for (let j = 0; j < nd; j++) for (let i = 0; i < nx; i++) {
    const p = P.surfacePoint(SN[i] * D[j], D[j], t);
    X[j * nx + i] = p[0]; Y[j * nx + i] = p[1];
  }
  const on = (x, y) => x >= 0 && x <= W && y >= 0 && y <= Hh;
  /* how far (px, py) is from a line through tp with direction (tx, ty) */
  const across = (px, py, tp, tx, ty) => {
    const n = Math.hypot(tx, ty) || 1;
    return Math.abs(((px - tp[0]) * ty - (py - tp[1]) * tx) / n);
  };
  /* the true row r (depth d) and column xc near a point, as tangents */
  const rowTan = (sn, d) => {
    const a = P.surfacePoint((sn - 1e-4) * d, d, t), b = P.surfacePoint((sn + 1e-4) * d, d, t);
    return [b[0] - a[0], b[1] - a[1]];
  };
  const colTan = (xc, d) => {
    const a = P.surfacePoint(xc, d - 1e-4, t), b = P.surfacePoint(xc, d + 1e-4, t);
    return [b[0] - a[0], b[1] - a[1]];
  };
  const rowD = [];
  for (let r = 0; r < P.ROWS; r++) rowD.push(1 + (P.DMAX - 1) * Math.pow(r / (P.ROWS - 1), L.ROW_POW));
  if (!meshInfo) {
    const rowsOn = rowD.map(d => D.findIndex(v => Math.abs(v - d) <= 1e-6 * d)).filter(j => j >= 0).length;
    meshInfo = nx + ' x ' + nd + ' vertices, ' + (mesh.length / 2) + ' in the strip';
    if (rowsOn !== P.ROWS) fails.push('only ' + rowsOn + ' of ' + P.ROWS + ' rows lie on a mesh row');
    if (!(SN[0] <= -P.XSPAN + 1e-6 && SN[nx - 1] >= P.XSPAN - 1e-6)) fails.push('the mesh does not span sn = +-XSPAN');
    if (!(D[0] < 1 && D[nd - 1] > P.DMAX)) fails.push('the mesh does not reach past the first and the last row');
  }
  /* rows: along the mesh edges of each row's mesh row */
  for (let r = 0; r < P.ROWS; r++) {
    const j = D.findIndex(v => Math.abs(v - rowD[r]) <= 1e-6 * rowD[r]);
    if (j < 0) continue;
    const d = D[j];
    for (let i = 0; i + 1 < nx; i++) {
      for (let q = 1; q < 8; q++) {
        const a = q / 8, sn = SN[i] + (SN[i + 1] - SN[i]) * a;
        const px = X[j * nx + i] + (X[j * nx + i + 1] - X[j * nx + i]) * a;
        const py = Y[j * nx + i] + (Y[j * nx + i + 1] - Y[j * nx + i]) * a;
        const tp = P.surfacePoint(sn * d, d, t);
        if (!on(tp[0], tp[1])) continue;
        const [tx, ty] = rowTan(sn, d);
        const e = across(px, py, tp, tx, ty);
        if (e > worstRow.e) worstRow = { e, at: label + ' row ' + r + ' at (' + tp[0].toFixed(0) + ', ' + tp[1].toFixed(0) + ')' };
      }
    }
  }
  /* columns: in every cell triangle a column crosses */
  const COLS = L.COLS, SPAN = L.COL_SPAN, CSTEP = 2 * SPAN / (COLS - 1);
  const tri = (i0, j0, i1, j1, i2, j2) => {
    const V = [[i0, j0], [i1, j1], [i2, j2]].map(([i, j]) => ({ sn: SN[i], v: 1 / D[j], d: D[j], x: X[j * nx + i], y: Y[j * nx + i] }));
    const xws = V.map(p => p.sn * p.d);
    const lo = Math.min(...xws), hi = Math.max(...xws);
    for (let c = Math.ceil((lo + SPAN) / CSTEP); c * CSTEP - SPAN <= hi && c < COLS; c++) {
      if (c < 0) continue;
      const xc = c * CSTEP - SPAN;
      const f = V.map(p => p.sn - xc * p.v);
      const cuts = [];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        if ((f[a] < 0) === (f[b] < 0) || f[a] === f[b]) continue;
        const s = f[a] / (f[a] - f[b]);
        const lerp = k => V[a][k] + (V[b][k] - V[a][k]) * s;
        cuts.push({ sn: lerp('sn'), v: lerp('v'), x: lerp('x'), y: lerp('y') });
      }
      if (cuts.length < 2) continue;
      for (let q = 0; q <= 8; q++) {
        const a = q / 8, lerp = k => cuts[0][k] + (cuts[1][k] - cuts[0][k]) * a;
        const v = lerp('v'), d = 1 / v;
        if (d < 1 || d > P.DMAX) continue;
        const tp = P.surfacePoint(xc, d, t);
        if (!on(tp[0], tp[1])) continue;
        const [tx, ty] = colTan(xc, d);
        const e = across(lerp('x'), lerp('y'), tp, tx, ty);
        if (e > worstCol.e) worstCol = { e, at: label + ' column ' + c + ' at (' + tp[0].toFixed(0) + ', ' + tp[1].toFixed(0) + ')' };
      }
    }
  };
  for (let j = 0; j + 1 < nd; j++) for (let i = 0; i + 1 < nx; i++) {
    tri(i, j + 1, i, j, i + 1, j + 1);
    tri(i, j, i + 1, j + 1, i + 1, j);
  }
}

/* the floor's near edge, below the bottom whatever the wave does */
let edgeInfo = '';
try {
  const sim = H.load({ W: 1440, H: 900, dpr: 1, search: '?bgq=0' });
  const P = sim.P, Bg = sim.window.Bg, mesh = Bg.renderers.webgl.sheetMesh();
  let d0 = Infinity;
  for (let i = 1; i < mesh.length; i += 2) d0 = Math.min(d0, mesh[i]);
  let event = 0;
  for (let n = 0; n < 20000; n++) {
    P.prepEvent((n + P.EVENT_IN + P.EVENT_SPAN / 2) * P.EVENT_MS);
    event = Math.max(event, Math.abs(P.EVF.amp * P.EVF.env));
  }
  const swell = Bg.WAVE.reduce((s, w) => s + Math.abs(w.amp), 0);
  const wells = d0 > P.BODY_FLOOR - Math.sqrt(Bg.WELL_R2) / Bg.DEPTH_W ? P.WELL_DEPTH * P.bodiesW.length : 0;
  const lift = swell + event + wells;
  /* the edge's y is at least H * k - tilt */
  const k = P.HORIZON + (P.PERSP_Y - lift * P.WAVE_Y) / d0, tilt = P.LOOK_Y / 2;
  const minH = k > 1 ? tilt / (k - 1) : Infinity;
  if (!(event > 1)) fails.push('the swell events were not sampled (largest amplitude ' + event + ')');
  if (!(minH <= MIN_H)) {
    fails.push('the floor\'s near edge (d = ' + d0.toFixed(3) + ') can come above the bottom of the screen: the wave can lift it ' + lift.toFixed(2)
               + ' there (swell ' + swell.toFixed(2) + ', event ' + event.toFixed(2) + ', wells ' + wells.toFixed(2) + '), its y is then only '
               + k.toFixed(3) + ' H - ' + tilt + ' px, ' + (k > 1 ? 'below the bottom only from ' + minH.toFixed(0) + ' px tall' : 'above the bottom at every size')
               + ' (limit: every window ' + MIN_H + ' px tall or more)');
  }
  edgeInfo = 'the near edge (d = ' + d0.toFixed(2) + ', lifted at most ' + lift.toFixed(2) + ') at ' + k.toFixed(3) + ' H - ' + tilt
             + ' px or lower, below the bottom of every window ' + Math.ceil(minH) + ' px tall or more';
} catch (e) {
  fails.push('the near edge: threw: ' + ((e && e.stack) || e));
}

try {
  for (const [W, Hh] of SIZES) {
    const sim = H.load({ W, H: Hh, dpr: 1, search: '?bgq=0' });
    const L = W + 'x' + Hh;
    sim.frames(90, 16.7);
    measure(sim, L + ' idle');
    sim.move(0.12 * W, 0.80 * Hh);
    sim.frames(60, 16.7);
    measure(sim, L + ' dents');
    sim.frames(160, 64);
    if (!sim.P.EVF.on) fails.push(L + ': the swell event is not running at ' + sim.P.simNow.toFixed(0) + 'ms (the state tests nothing)');
    measure(sim, L + ' event');
    sim.leave();
    sim.frames(120, 64);
    measure(sim, L + ' after');
  }
} catch (e) {
  fails.push('threw: ' + ((e && e.stack) || e));
}
if (!(worstRow.e <= LIMIT)) fails.push('a row is drawn ' + worstRow.e.toFixed(3) + 'px off the surface (' + worstRow.at + '; limit ' + LIMIT + ')');
if (!(worstCol.e <= LIMIT)) fails.push('a column is drawn ' + worstCol.e.toFixed(3) + 'px off the surface (' + worstCol.at + '; limit ' + LIMIT + ')');
if (fails.length) {
  console.log('check-sheet-mesh: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-sheet-mesh: OK - the floor mesh (' + meshInfo + '), 7 viewports 390x844..3840x2160 x 4 states: rows within '
            + worstRow.e.toFixed(3) + 'px of the true surface (' + worstRow.at + '), columns within ' + worstCol.e.toFixed(3) + 'px ('
            + worstCol.at + '), limit ' + LIMIT + 'px; ' + edgeInfo);
