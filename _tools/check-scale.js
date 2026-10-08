'use strict';
/* One scale for the scenery sized in px (audit G4.2; scene.js, rescale):

     S = max(0.35, min(H / 900, W / 1100)),  SW = max(1, S)

   The trees and conifers (and their line widths, by SW), the clouds, the
   peaks' half-widths, the bodies and the cursor's push on the terrain are
   their 1440x900 sizes times S; the mountains' heights were always
   fractions of H. Without it, short windows had trees taller than the
   skyline, running off the top and through the clouds, and 4K had trees a
   third of the mountains.

   Checked through the harness, on what the renderer draws: its meshes
   (render-webgl.js sceneryMesh, built per size from the scaled values) as
   its vertex shaders place them (scenery-twin.js, which check-wave-parity.js
   holds to the real shaders), and every call it hands the GPU (the
   recording stub). No card (the sun is check-sun.js's).
     exact      at every viewport S and SW are the formula's, every scaled
                size is its S = 1 value times S, and at 1440x900 S is 1, so
                that size draws what it drew before the scale existed
     no drift   a page resized from 1440x900 through 390x844 and 3840x2160
                and back, a frame at each, draws once the scenery is built
                again (the renderer builds at most once every REBUILD_MS, the
                meshes fitted to the sizes in between: 8 frames on, both
                pages) its next frame bit for bit as one that never resized -
                every call, every uniform, the meshes rebuilt to the same
                bytes: the sizes are set from their S = 1 values, never
                compounded
     the scene  over 26s of scene time (a swell event included) with look
                eased to all four corners, at the viewports below: nothing
                drawn above the top edge (a corner, a stroke's edge, a
                cloud's); no tree or conifer stroke over a cloud (pixel
                centres within half a line width of a stroke, inside a
                cloud facet); the tallest tree no taller against the
                tallest near peak than at 1440x900 (+1%), and the same
                ratio wherever S = H / 900 (within 2%)
     the push   with the pointer parked on a mountain face, the dip under it
                is CUR_TERR_PUSH * S times the push's strength (the
                terrain's copy of the field, TPUSH, settled on the
                pointer), and the sideways shove at one reach is
                CUR_TERR_SIDE * S * 0.6065 times the same: in proportion to
                the scene at every size
   Every frame drawn (?bgq=0). Exit 1 on any failure; one line per
   viewport, then the summary. */
const crypto = require('crypto');
const H = require('./harness');
const Twin = require('./scenery-twin');

const REPORT = [[390, 844], [844, 390], [1080, 1920], [1366, 657], [2560, 1440], [3840, 2160]];
const VIEWS = [[1440, 900]].concat(REPORT, [[1440, 450], [1024, 768]]);
const FRAMES = 400, DT = 64, EVERY = 25;
const fails = [];
const fail = m => fails.push(m);

/* ---- what is drawn, from the meshes as the shaders place them ------------ */
/* the scenery of one frame: massif triangles, stroke segments ({ id, d,
   a: [x, y], b: [x, y], hw }), cloud triangles, in CSS px */
function drawnScene(tw, t) {
  const out = { massif: [], stroke: [], cloud: [] }, o2 = [0, 0], o4 = [0, 0, 0, 0];
  for (let i = 0; i < tw.massifs; i += 3) {
    const tri = [0, 1, 2].map(j => tw.massifAt(i + j, t, o2).slice());
    const m = tw.massif(i);
    out.massif.push({ id: m.id, d: m.d, pts: tri, h: [0, 1, 2].map(j => tw.massif(i + j).h) });
  }
  for (let i = 0; i < tw.strokes; i += 6) {
    const p = tw.strokeAt(i, t, o4), s = tw.stroke(i);
    out.stroke.push({ id: s.id, d: s.d, a: [p[0], p[1]], b: [p[2], p[3]], hw: tw.mesh.stroke[i * Twin.SF + 10], root: s.p1[0] === 0 && s.p1[1] === 0 });
  }
  for (let i = 0; i < tw.clouds; i += 3) out.cloud.push([0, 1, 2].map(j => tw.cloudAt(i + j, o2).slice()));
  return out;
}
/* the pixels of [0, W) x [0, H) inside any cloud facet (centres), as a mask */
function cloudMask(sc, W, Hh) {
  const mask = new Uint8Array(W * Hh);
  for (const [a, b, c] of sc.cloud) {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(Hh - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const e = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5, d1 = e(a, b, px, py), d2 = e(b, c, px, py), d3 = e(c, a, px, py);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) mask[y * W + x] = 1;
    }
  }
  return mask;
}
/* cloud pixels within half a line width of a tree or conifer stroke */
function floraOverClouds(sc, mask, W, Hh) {
  const hit = new Set();
  for (const s of sc.stroke) {
    const h = s.hw, [ax, ay] = s.a, [bx, by] = s.b;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - h)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + h));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - h)), y1 = Math.min(Hh - 1, Math.ceil(Math.max(ay, by) + h));
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!mask[y * W + x]) continue;
      const px = x + 0.5, py = y + 0.5;
      const u = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const qx = ax + u * dx - px, qy = ay + u * dy - py;
      if (qx * qx + qy * qy <= h * h) hit.add(y * W + x);
    }
  }
  return hit.size;
}
/* the highest point drawn: [y, what] */
function topOf(sc) {
  let top = Infinity, what = '';
  for (const m of sc.massif) for (const p of m.pts) if (p[1] < top) { top = p[1]; what = 'massif'; }
  for (const s of sc.stroke) { const y = Math.min(s.a[1], s.b[1]) - s.hw; if (y < top) { top = y; what = 'tree or conifer'; } }
  for (const tri of sc.cloud) for (const p of tri) if (p[1] < top) { top = p[1]; what = 'cloud'; }
  return [top, what];
}
/* the tallest drawn fractal tree: per tree, its root less the top of its
   highest stroke (TREES' ids come first among the strokes) */
function treeHeight(sc, nTrees, firstId) {
  const root = new Map(), hi = new Map();
  for (const s of sc.stroke) {
    if (s.id < firstId || s.id >= firstId + nTrees) continue;
    if (s.root) root.set(s.id, s.a[1]);
    hi.set(s.id, Math.min(hi.has(s.id) ? hi.get(s.id) : Infinity, Math.min(s.a[1], s.b[1]) - s.hw));
  }
  let best = 0;
  for (const [id, y] of root) best = Math.max(best, y - hi.get(id));
  return best;
}
/* the near band's peaks: per peak, its height (the lowest corner on the
   ground less its highest corner) and its half-width at the ground */
function nearPeaks(sc, d) {
  const per = new Map();
  for (const m of sc.massif) {
    if (m.d !== d) continue;
    const p = per.get(m.id) || { top: Infinity, base: -Infinity, x0: Infinity, x1: -Infinity };
    m.pts.forEach((q, j) => {
      p.top = Math.min(p.top, q[1]);
      if (m.h[j] === 0) { p.base = Math.max(p.base, q[1]); p.x0 = Math.min(p.x0, q[0]); p.x1 = Math.max(p.x1, q[0]); }
    });
    per.set(m.id, p);
  }
  return [...per.values()].map(p => ({ h: p.base - p.top, slope: (p.base - p.top) / ((p.x1 - p.x0) / 2) }));
}

/* ---- exact: S, SW and every scaled size ---------------------------------- */
function exact(P, W, Hh, tag) {
  const S = Math.max(0.35, Math.min(Hh / 900, W / 1100));
  if (P.S !== S) fail(tag + ': S is ' + P.S + ', the formula gives ' + S);
  if (P.SW !== Math.max(1, S)) fail(tag + ': SW is ' + P.SW + ', max(1, S) is ' + Math.max(1, S));
  const bad = [];
  for (const c of P.TREES) if (c.h !== c.h0 * S) bad.push('tree h ' + c.h);
  for (const c of P.CONIFERS) if (c.h !== c.h0 * S || c.w !== c.w0 * S) bad.push('conifer ' + c.h + '/' + c.w);
  for (const c of P.CLOUDS) if (c.w !== c.w0 * S || c.h !== c.h0 * S) bad.push('cloud ' + c.w + '/' + c.h);
  for (const b of P.BANDS) if (b.wmin !== b.wmin0 * S || b.wmax !== b.wmax0 * S) bad.push('band ' + b.wmin + '-' + b.wmax);
  if (bad.length) fail(tag + ': not their S = 1 sizes times S: ' + bad.join(', '));
  return S;
}

/* ---- the scene at each viewport ------------------------------------------ */
const rows = [];
let ratio1440 = null, dip1440 = null;
for (const [W, Hh] of VIEWS) {
  const tag = W + 'x' + Hh;
  let sim;
  try { sim = H.load({ W, H: Hh, dpr: 1, now: 1200, search: '?bgq=0' }); } catch (e) { fail(tag + ': ' + e.message); continue; }
  const P = sim.P, Bg = sim.window.Bg;
  const S = exact(P, W, Hh, tag);
  const row = { tag, S, top: Infinity, topWhat: '', over: 0, ratio: Infinity, ratioMax: 0, slope: null };
  let tw = null;
  const near = Math.fround(Math.min(...P.BANDS.map(b => b.d)));
  for (let i = 0; i < FRAMES; i++) {
    /* look to each corner in turn, held long enough to arrive */
    const q = Math.floor(i / 100);
    P.look.tx = [0.5, -0.5, -0.5, 0.5][q % 4]; P.look.ty = [-0.5, -0.5, 0.5, 0.5][q % 4];
    sim.frame(DT);
    if (i % EVERY !== EVERY - 1) continue;
    if (!tw) tw = Twin.make(Bg);
    const sc = drawnScene(tw, P.simNow);
    const [y, what] = topOf(sc);
    if (y < row.top) { row.top = y; row.topWhat = what; }
    row.over = Math.max(row.over, floraOverClouds(sc, cloudMask(sc, W, Hh), W, Hh));
    const tree = treeHeight(sc, P.TREES.length, Math.min(...sc.stroke.map(s => s.id))), peaks = nearPeaks(sc, near);
    const peak = Math.max(...peaks.map(p => p.h));
    row.ratio = Math.min(row.ratio, tree / peak);
    row.ratioMax = Math.max(row.ratioMax, tree / peak);
    if (!row.slope) row.slope = [Math.min(...peaks.map(p => p.slope)), Math.max(...peaks.map(p => p.slope))];
  }
  if (row.top < 0) fail(tag + ': a ' + row.topWhat + ' is drawn ' + (-row.top).toFixed(1) + 'px above the top edge');
  if (row.over > 0) fail(tag + ': ' + row.over + ' cloud px under a tree or conifer stroke');
  /* the push: park the pointer on the near band's face and let the
     terrain's copy of the field settle on it */
  const nb = P.BANDS.reduce((a, b) => (b.d < a.d ? b : a));
  const px = W * 0.5, py = P.restAt(nb.d) - 0.3 * nb.hmax * Hh;
  sim.move(px, py);
  sim.frames(300, 16.7);
  const T = P.TPUSH, on = T[0].on + T[1].on, top = py - 50 * S, bot = py + 50 * S;
  if (!(Math.abs(T[0].sx - T[1].sx) < 1e-6 && Math.abs(T[0].sy - T[1].sy) < 1e-6 && Math.abs(T[0].sx - P.CUR.sx) < 1e-6)) {
    fail(tag + ': the terrain\'s copy of the field did not settle on the parked pointer');
  }
  const dip = P.terrainPushDip(T[0].sx, top, bot), want = P.CUR_TERR_PUSH * S * on;
  const shove = P.terrainPushSide(T[0].sx + P.CUR_TERR_SX * S, top, bot, P.CUR_TERR_SIDE * S), wantShove = P.CUR_TERR_SIDE * S * on * Math.exp(-0.5);
  /* the push reaches the terrain through the ripple's copy alone, and today
     both are off (scene.js CALM_RIPPLE 0, CUR_TERR_PUSH 0): then there is
     no field there to scale */
  const pushOn = P.CALM_RIPPLE !== 0 && (P.CUR_TERR_PUSH > 0 || P.CUR_TERR_SIDE > 0);
  if (pushOn && !(on > 0.5)) fail(tag + ': the field never came on under a parked pointer (' + on + ')');
  if (!(Math.abs(dip - want) <= 1e-9 * Math.max(1, want))) fail(tag + ': the dip under the pointer is ' + dip + 'px, CUR_TERR_PUSH * S * on is ' + want);
  if (!(Math.abs(shove - wantShove) <= 1e-6 * Math.max(1, wantShove))) fail(tag + ': the shove one reach out is ' + shove + 'px, CUR_TERR_SIDE * S * 0.6065 * on is ' + wantShove);
  row.dip = dip / on;
  row.dipShare = row.dip / peakHeightAt(P, nb, Hh);
  rows.push(row);
  if (W === 1440 && Hh === 900) { ratio1440 = row; dip1440 = row.dipShare; }
}
/* the near band's tallest peak at rest, from its table (for the dip's share) */
function peakHeightAt(P, b, Hh) {
  let best = 0;
  for (let k = 0; k < b.n; k++) best = Math.max(best, (b.hmin + (b.hmax - b.hmin) * P.hash1(b.seed + k * 7.3 + 1.1)) * Hh);
  return best;
}
/* the proportions against 1440x900 */
if (ratio1440) {
  for (const r of rows) {
    const [W, Hh] = r.tag.split('x').map(Number);
    if (r.ratioMax > ratio1440.ratioMax * 1.01) fail(r.tag + ': the tallest tree is ' + r.ratioMax.toFixed(3) + ' of the tallest near peak, against ' + ratio1440.ratioMax.toFixed(3) + ' at 1440x900');
    if (Hh / 900 <= W / 1100 && Hh / 900 >= 0.35 && Math.abs(r.ratioMax / ratio1440.ratioMax - 1) > 0.02) {
      fail(r.tag + ': S = H / 900 here, but the tree / peak ratio is ' + r.ratioMax.toFixed(3) + ' against ' + ratio1440.ratioMax.toFixed(3) + ' at 1440x900');
    }
  }
}

/* ---- no drift: resized away and back, the same frame bit for bit --------- */
function frameCalls(resize) {
  const calls = [];
  let rec = false;
  const sim = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1200, search: '?bgq=0', record: r => { if (rec) calls.push(H.serializeOp(r, true)); } });
  sim.frames(40, 16.7);
  if (resize) {
    for (const [w, h] of [[390, 844], [3840, 2160], [1440, 900]]) { sim.resize(w, h); sim.frame(16.7); }
  } else sim.frames(3, 16.7);
  /* past REBUILD_MS from the build at 390x844, so 1440x900 is built again */
  sim.frames(8, 16.7);
  /* the scenery's buffers as they stand (rebuilt after a resize), and the next frame */
  const tw = Twin.make(sim.window.Bg);
  const mesh = crypto.createHash('sha1');
  for (const k of ['massif', 'stroke', 'cloud']) mesh.update(Buffer.from(tw.mesh[k].buffer));
  rec = true;
  sim.frame(16.7);
  /* GL objects by the order they appear in, not their ids: the buffers
     rebuilt after a resize are new objects holding the same bytes */
  const ids = new Map();
  const named = calls.map(c => c.replace(/#([a-z]+)(\d+)/g, (m, k) => { if (!ids.has(m)) ids.set(m, '#' + k + '@' + ids.size); return ids.get(m); }));
  return { calls: named, P: sim.P, mesh: mesh.digest('hex') };
}
const still = frameCalls(false), moved = frameCalls(true);
let drift = -1;
if (still.calls.length !== moved.calls.length) drift = Math.min(still.calls.length, moved.calls.length);
else for (let k = 0; k < still.calls.length; k++) if (still.calls[k] !== moved.calls[k]) { drift = k; break; }
if (drift >= 0) fail('resized to 390x844 and 3840x2160 and back, 1440x900 draws differently from call ' + drift + ': '
                     + (still.calls[drift] || '(end)') + ' vs ' + (moved.calls[drift] || '(end)'));
if (still.mesh !== moved.mesh) fail('resized away and back, the scenery\'s meshes are not the same bytes');
if (moved.P.S !== 1) fail('back at 1440x900, S is ' + moved.P.S);

const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : String(v));
for (const r of rows) {
  console.log('  ' + r.tag.padEnd(10) + ' S ' + r.S.toFixed(3) + '   tree / near peak ' + f2(r.ratio) + '-' + f2(r.ratioMax)
              + '   highest drawn y ' + r.top.toFixed(1) + ' (' + r.topWhat + ')   flora over clouds ' + r.over + 'px'
              + '   near peaks ' + f2(r.slope[0]) + '-' + f2(r.slope[1]) + ' tall per half-width   dip ' + r.dip.toFixed(1) + 'px = '
              + (100 * r.dipShare).toFixed(1) + '% of the near peak');
}
if (fails.length) {
  console.log('check-scale: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1, 20)) console.log('  ' + f);
  process.exit(1);
}
const rep = rows.filter(r => REPORT.some(([w, h]) => r.tag === w + 'x' + h));
console.log('check-scale: OK - ' + rows.length + ' viewports, S exact and every scaled size its S = 1 value times S; '
            + 'resized away and back, 1440x900 draws its frame bit for bit (' + still.calls.length + ' GL calls, the meshes the same bytes); '
            + 'nothing above the top edge, no tree or conifer over a cloud; tree / near peak ' + f2(ratio1440.ratioMax) + ' at 1440x900, '
            + rep.map(r => f2(r.ratioMax) + ' at ' + r.tag).join(', ') + '; the dip ' + (100 * dip1440).toFixed(1) + '% of the near peak at 1440x900, '
            + Math.min(...rows.map(r => 100 * r.dipShare)).toFixed(1) + '-' + Math.max(...rows.map(r => 100 * r.dipShare)).toFixed(1) + '% everywhere');
