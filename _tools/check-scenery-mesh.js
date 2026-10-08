'use strict';
/* The massif meshes cover their silhouettes exactly, their lines are a
   mountain's, not a fan's, and no piece of them turns over where the floor
   carries it (render-webgl.js sceneryMesh, slice, massifAt; audit G2.1-G2.3,
   F59, the owner's line-art style; the W2b review's fold).

   On Canvas the facets were drawn over a page-grey fill of the
   silhouette and never quite matched it: a peak's fan chorded its base
   across 5 of 14 points and painted up to 27 px below it or left bare
   wedges up to 23 px deep (G2.1), its fan from one core filled the
   notches above the stroked outline (G2.2), a ridge's bottom row chorded
   its base (G2.3), and every peak ended in a 46-81 px vertical wall
   (F59). In WebGL each ridge and peak is one mesh whose triangles ARE its
   silhouette: its facets, each cut into pieces between vertical cut lines,
   each piece drawn with its facet's lines (its corners carry their
   barycentric coordinates in the facet). Through the harness, at 9
   viewports (390x844 to 3840x2160), for each of the 12 ridges and peaks:

     coverage   sampled every 0.73 px over its whole extent: every point
                under its crest (and above the ground) inside exactly one of
                its pieces, every point above the crest inside none, and
                every point of the skirt (the few px the mesh reaches under
                its base, which the floor in front hides) inside one
     feet       a peak's crest falls to height 0 at both ends (no wall) and
                no corner of it out-tops its summit
     lines      a piece's edge is drawn where it lies on an edge of its
                facet (both its ends 0 in the barycentric coordinate across
                from that edge) with that edge's width: every edge on the
                crest is the silhouette's (the heavier line), every edge on
                the ground and below it is drawn with no line, and no more
                than LINE_FAN lines meet at any one point (the Canvas fan
                met 42 at its core: lines that radiate from one point are
                what the owner's reference does not have; and the WebGL
                mesh's corners up to 10, until the line economy: the final
                QA lens's fans); no line ends in mid-air (a point off the
                crest and off the ground with one line)
     needles    no edge of a crest is steeper than SLOPE_MAX, so no summit
                and no jag is narrower than 2 / SLOPE_MAX of its height over
                its notches (they rose 9.27 px per px at 1440x900 and 44.9
                at 390x844: the lens's splinters)
     spread     only the silhouette reaches a peak's foot: the layers under
                it touch down on the ground further in (FOOT_LINES; 3.05
                lines on a foot, up to 4, before)
     broad      the facets as they are seen (the pieces joined across every
                edge they share that has no line) that reach the lowest
                BAND px over the ground (times S), which is what a short
                tab's card leaves on show: no more than SMALL_RATE a 100 px
                of crest under SMALL px^2 (times S^2): 1.2-6.2 were, at
                every viewport (the lens's band of small triangles under the
                writing tab's card)
     rim        the silhouette whole: in from every crest edge, more than
                2 x its width from either end (where every facet narrows to
                a point), every 0.5 px, the line work as the shader inks it
                (a point of a piece is inked where some lined edge of the
                piece's facet is within its width, by barycentric distance)
                reaches RIM_INK px in, but for runs of at most RIM_RUN px.
                The silhouette is drawn inside its own facet only, so a
                sliver under the crest, and the line beside it taken out,
                cut it short: along 31.5 px of the near band's at 1440x900 it
                inked less than RIM_INK, 55 at 2560x1440 and 59 at 3840x2160
                (the final review: a facet 0.49 px deep, the line beside it
                taken out by economise)
     run-on     a facet's line is its distance to its edge's whole line, so
                where a facet under the crest is obtuse at a corner A of its
                crest edge, the silhouette runs on past A along the facet's
                other edge from A, AC, for rim / sin(180 deg - the angle at
                A); where the crest turns up at A that is inside the massif,
                and a stub of the silhouette unless AC has its line. None
                may be bare more than RUN_ON_MAX px past rim (the facets
                after economise, by a hook in the build). Before the line
                economy held lines for the silhouette's width, 191 run-ons
                reaching RUN_ON_SEEN px past it (check-webgl-terrain.js's
                2.5 device px at 1.5) were bare at these sizes and
                1425x900, and holding one line beside a thin facet made
                the facet rule take another and bare four that check saw,
                1-3 device px each, up to 56 levels off the fill
     in front   every tree and conifer stands nearer than every band, as
                the Canvas renderer painted them, over every peak (the
                depth test would hide one behind the near band otherwise:
                scene.js, CONIFERS)
     unfolded   every piece placed as the vertex shader places it
                (scenery-twin.js; check-wave-parity.js holds the shader to
                it), in IDLE scene states over 100 s and the first swell
                event at its height, and in PUSH states with the pointer
                parked on each band's base line (the cursor's dent sunk
                into the floor right under that band) and on the near
                peaks' faces (the terrain's own push at full strength):
                none may turn over - its signed area may not change sign
                from its mesh's - by more than FOLD_PX (altitude). The
                facets drawn flat between corners stood on the curving
                floor did, by up to 13.8 px at 1440x900 idle and on every
                strip, before they were cut (W2b review: fold3/4/6.js).
     reaches    in the same states, the floor's contour sags below no
                chord of a base (its ground between two cut lines) by as
                much as the skirt reaches under it, wherever the cut lines
                are wider apart than BASE_STEP (render-webgl.js gridAt
                widens them where the floor curves slowly); where they are
                BASE_STEP apart (a phone) the sag is reported only, as the
                base was walked before
   Exit 1 on failure. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const VIEWS = [[1440, 900], [390, 844], [844, 390], [1080, 1920], [1366, 657], [2560, 1440], [3840, 2160], [1440, 450], [1024, 768]];
const LINE_FAN = 6, STEP = 0.73, FOLD_PX = 0.5, ON_CREST = 1e-3, ON_EDGE = 1e-6;
/* the needles, the feet and the facets low on a massif (the header) */
const SLOPE_MAX = 1.8, FOOT_LINES = 1, BAND = 75, SMALL = 600, SMALL_RATE = 0.25;
/* the silhouette whole (px; the header) */
const RIM_INK = 0.8, RIM_RUN = 4, RUN_ON_MAX = 2, RUN_ON_SEEN = 1.7;
/* render-webgl.js: the closest its cut lines (gridAt) may be */
const BASE_STEP = 12;
/* the scene states the pieces are placed in */
const IDLE_EVERY = 4000, IDLE_TO = 100000, BASE_XS = [0.06, 0.2, 0.8, 0.94], FACE_XS = [0.1, 0.3, 0.7, 0.9], SETTLE = 45;
const fails = [];
function heightAt(P, x) {
  if (x <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (x <= P[i][0]) { const a = P[i - 1], b = P[i]; return b[0] - a[0] < 1e-9 ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]); }
  }
  return P[P.length - 1][1];
}
const area = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
{
  const Bg = H.load({ W: 1440, H: 900, dpr: 1 }).window.Bg;
  if (!(Bg && Bg.renderers && Bg.renderers.webgl && Bg.renderers.webgl.sceneryMesh)) {
    console.log('check-scenery-mesh: SKIP - ' + H.ROOT + ' has no WebGL scenery (Bg.renderers.webgl.sceneryMesh; before W2b)');
    process.exit(0);
  }
  /* in front: trees and conifers nearer than every band */
  const nearest = Math.min(...Bg.BANDS.map(b => b.d), ...Bg.RIDGES.map(r => r.d));
  Bg.TREES.concat(Bg.CONIFERS).forEach((c, i) => {
    if (!(c.d < nearest)) fails.push((i < Bg.TREES.length ? 'TREES[' + i + ']' : 'CONIFERS[' + (i - Bg.TREES.length) + ']') + ' stands at d ' + c.d + ', not in front of the near band (' + nearest + '): the near band\'s peaks hide it');
  });
}
const totals = { samples: 0, tris: 0, fan: 0, fanAt: '', massifs: 0, crestEdges: 0, states: 0, placed: 0, flips: 0, worstFold: 0, foldAt: '' };
const rows = [];
for (const [w, h] of VIEWS) {
  /* the facets after the line economy, for run-on */
  const CUT = 'const cuts = cutsOf(xs, gridAt(o.d)), nc = cuts.length;';
  const sim = H.load({ W: w, H: h, dpr: 1, now: 1000, search: '?bgq=0', patches: [['function paint(t, still) {', 'function paint(t, still) { return;'],
    [CUT, '(globalThis.__facets = globalThis.__facets || []).push({ id: o.id, rim: width.rim, crest: c.crest.map(p => p.slice()), '
          + 'facets: facets.map(f => [f[0].slice(0, 2), f[1].slice(0, 2), f[2].slice(0, 2), f[3], f[4], f[5]]) }); ' + CUT]] });
  const Bg = sim.window.Bg;
  sim.window.__facets = [];
  const tw = Twin.make(Bg);
  const facetsOf = new Map(sim.window.__facets.map(f => [f.id, f]));
  const m = tw.mesh, F = Twin.MF, A = m.massif;
  const tris = new Map();
  for (let v = 0; v < A.length / F; v += 3) {
    const id = A[v * F + 7];
    const t = [0, 1, 2].map(k => [A[(v + k) * F], A[(v + k) * F + 1]]);
    t.w = [A[v * F + 10], A[v * F + 11], A[v * F + 12]];
    t.b = [0, 1, 2].map(k => { const b0 = A[(v + k) * F + 8], b1 = A[(v + k) * F + 9]; return [b0, b1, 1 - b0 - b1]; });
    if (!tris.has(id)) tris.set(id, []);
    tris.get(id).push(t);
  }
  let worstOver = 0, worstGap = 0, worstOut = 0, worstSkirt = 0, fanMax = 0, crestEdges = 0;
  let midair = 0, midAt = '', steep = 0, steepAt = '', footMax = 0, bandN = 0, smallN = 0, crestW = 0;
  let rimN = 0, rimThin = 0, rimRun = 0, rimAt = '', runSeen = 0, runLong = 0, runAt = '';
  for (const cr of m.crests) {
    const T = tris.get(cr.id) || [], C = cr.crest.map(p => [p[0] + cr.x0, p[1]]);
    const peak = cr.id >= 20 + Bg.RIDGES.length;
    const tag = w + 'x' + h + ' ' + (peak ? 'peak' : 'ridge') + ' ' + cr.id;
    totals.massifs++; totals.tris += T.length;
    /* feet and summit */
    if (peak) {
      if (C[0][1] !== 0 || C[C.length - 1][1] !== 0) fails.push(tag + ': its crest ends at ' + C[0][1].toFixed(1) + ' / ' + C[C.length - 1][1].toFixed(1) + ' px, not at the ground (a wall)');
      const top = Math.max(...C.map(p => p[1])), apexes = C.filter(p => p[1] === top).length;
      if (apexes !== 1) fails.push(tag + ': ' + apexes + ' corners share its highest point');
    }
    /* coverage */
    const x0 = C[0][0], x1 = C[C.length - 1][0];
    let maxH = 0; for (const p of C) maxH = Math.max(maxH, p[1]);
    const nx = Math.floor((x1 - x0) / STEP), ny = Math.ceil((maxH + 12) / STEP);
    const cnt = new Uint8Array(nx * ny);
    for (const t of T) {
      const [a, b, c] = t;
      const d = area(a, b, c), sg = Math.sign(d);
      const xmin = Math.min(a[0], b[0], c[0]), xmax = Math.max(a[0], b[0], c[0]), ymin = Math.min(a[1], b[1], c[1]), ymax = Math.max(a[1], b[1], c[1]);
      for (let i = Math.max(0, Math.floor((xmin - x0) / STEP)); i <= Math.min(nx - 1, Math.ceil((xmax - x0) / STEP)); i++) {
        const px = x0 + (i + 0.31) * STEP;
        for (let j = Math.max(0, Math.floor((ymin + 10) / STEP)); j <= Math.min(ny - 1, Math.ceil((ymax + 10) / STEP)); j++) {
          const py = -10 + (j + 0.27) * STEP;
          const s1 = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) * sg;
          const s2 = ((c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0])) * sg;
          const s3 = ((a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0])) * sg;
          if (s1 > 0 && s2 > 0 && s3 > 0) cnt[j * nx + i]++;
        }
      }
    }
    let over = 0, gap = 0, out = 0, skirtGap = 0;
    for (let i = 0; i < nx; i++) {
      const px = x0 + (i + 0.31) * STEP, top = heightAt(C, px);
      for (let j = 0; j < ny; j++) {
        const py = -10 + (j + 0.27) * STEP, k = cnt[j * nx + i];
        totals.samples++;
        if (k > 1) over++;
        if (py > 0.3 && py < top - 0.3 && k === 0) gap++;
        if (py > top + 0.3 && k) out++;
        if (py < -0.3 && py > -5.5 && k !== 1) skirtGap++;
      }
    }
    if (over || gap || out || skirtGap) fails.push(tag + ': ' + over + ' samples in two triangles, ' + gap + ' under the crest in none, ' + out + ' above it covered, ' + skirtGap + ' of the skirt not once');
    worstOver = Math.max(worstOver, over); worstGap = Math.max(worstGap, gap); worstOut = Math.max(worstOut, out); worstSkirt = Math.max(worstSkirt, skirtGap);
    /* lines: a piece's edge on an edge of its facet carries that edge's
       width; on the crest the rim's, on the ground none; and how many meet */
    const rimW = Math.max(...T.flatMap(t => t.w));
    const meet = new Map();
    const crestMiss = [], groundLine = [];
    for (const t of T) {
      for (let k = 0; k < 3; k++) {
        const i1 = (k + 1) % 3, i2 = (k + 2) % 3, p = t[i1], q = t[i2];
        let wk = 0;
        for (let j = 0; j < 3; j++) if (Math.abs(t.b[i1][j]) < ON_EDGE && Math.abs(t.b[i2][j]) < ON_EDGE) wk = Math.max(wk, t.w[j]);
        const onCrest = p[1] > 0 && q[1] > 0 && Math.abs(heightAt(C, p[0]) - p[1]) < ON_CREST && Math.abs(heightAt(C, q[0]) - q[1]) < ON_CREST
                        && Math.abs(heightAt(C, (p[0] + q[0]) / 2) - (p[1] + q[1]) / 2) < ON_CREST;
        if (onCrest) { crestEdges++; if (Math.abs(wk - rimW) > 1e-6) crestMiss.push(wk); }
        if (p[1] <= 0 && q[1] <= 0 && wk !== 0) groundLine.push(wk);
        if (wk > 0) {
          for (const r of [p, q]) {
            const key = r[0] + ',' + r[1], other = r === p ? q : p;
            if (!meet.has(key)) meet.set(key, new Set());
            meet.get(key).add(other[0] + ',' + other[1]);
          }
        }
      }
    }
    if (crestMiss.length) fails.push(tag + ': ' + crestMiss.length + ' edges on the crest are drawn ' + crestMiss[0] + ' px wide, not as the silhouette (' + rimW + ')');
    if (groundLine.length) fails.push(tag + ': ' + groundLine.length + ' edges on or under the ground have a line');
    for (const [key, set] of meet) if (set.size > fanMax) { fanMax = set.size; if (set.size > totals.fan) { totals.fan = set.size; totals.fanAt = tag + ' at (' + key + ')'; } }
    if (fanMax > LINE_FAN) fails.push(tag + ': ' + fanMax + ' lines meet at one point (limit ' + LINE_FAN + ')');
    /* a line ending in mid-air: a point with one line, off the crest and
       off the ground (the mesh's corners are float32: so is the key) */
    const key32 = p => Math.fround(p[0]) + ',' + Math.fround(p[1]);
    const crestKeys = new Set(C.map(key32));
    for (const [key, set] of meet) {
      if (set.size === 1 && +key.split(',')[1] > 0 && !crestKeys.has(key)) { midair++; if (!midAt) midAt = tag + ' at (' + key + ')'; }
    }
    /* rim: in from each crest edge as the shader inks it. A piece's
       barycentric coordinates are its facet's, so edge j of the facet is
       b_j / |grad b_j| px away (both from the piece's corners), and its
       line inks there out to its width w_j; pieces looked up by x */
    {
      const CELL = 8, cx0 = C[0][0], cells = new Map();
      const geo = T.map(t => {
        const a2 = area(t[0], t[1], t[2]);
        if (Math.abs(a2) < 1e-9) return null;
        return { a2, g: [0, 1, 2].map(j => {
          const b0 = t.b[0][j], b1 = t.b[1][j], b2 = t.b[2][j];
          return Math.hypot((b0 * (t[1][1] - t[2][1]) + b1 * (t[2][1] - t[0][1]) + b2 * (t[0][1] - t[1][1])) / a2,
                            (b0 * (t[2][0] - t[1][0]) + b1 * (t[0][0] - t[2][0]) + b2 * (t[1][0] - t[0][0])) / a2);
        }) };
      });
      T.forEach((t, ti) => {
        if (!geo[ti]) return;
        const c0 = Math.floor((Math.min(t[0][0], t[1][0], t[2][0]) - cx0) / CELL), c1 = Math.floor((Math.max(t[0][0], t[1][0], t[2][0]) - cx0) / CELL);
        for (let c = c0; c <= c1; c++) { if (!cells.has(c)) cells.set(c, []); cells.get(c).push(ti); }
      });
      const inked = (x, y) => {
        for (const ti of cells.get(Math.floor((x - cx0) / CELL)) || []) {
          const t = T[ti], G = geo[ti], l0 = area([x, y], t[1], t[2]) / G.a2, l1 = area(t[0], [x, y], t[2]) / G.a2, l2 = 1 - l0 - l1;
          if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
          for (let j = 0; j < 3; j++) if (t.w[j] > 0 && (l0 * t.b[0][j] + l1 * t.b[1][j] + l2 * t.b[2][j]) / Math.max(G.g[j], 1e-12) <= t.w[j]) return true;
          return false;
        }
        return false;
      };
      for (let i = 1; i < C.length; i++) {
        const p = C[i - 1], q = C[i], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
        if ((p[1] <= 0 && q[1] <= 0) || L < 4 * rimW) continue;
        let run = 0;
        for (let s = 2 * rimW + 0.25; s <= L - 2 * rimW; s += 0.5) {
          /* in from the crest: x increases along it, so (dy, -dx) / L points down, into the massif */
          const bx = p[0] + (dx * s) / L, by = p[1] + (dy * s) / L;
          let ok = true;
          for (let d = 0.09; ok && d < RIM_INK; d += 0.1) ok = inked(bx + (dy * d) / L, by - (dx * d) / L);
          rimN++;
          if (ok) { run = 0; continue; }
          rimThin++; run += 0.5;
          if (run > rimRun) { rimRun = run; rimAt = tag + ', crest edge ' + i + ' (x ' + p[0].toFixed(1) + ' to ' + q[0].toFixed(1) + ') at x ' + bx.toFixed(1); }
        }
      }
    }
    /* run-on: at a crest corner A where the crest turns up (p to A to q
       turns left), a facet under the crest obtuse at A, bare where its
       other edge from A, AC, has no line (the slot across from B) */
    {
      const f = facetsOf.get(cr.id);
      if (!f) fails.push(tag + ': its facets were not captured (the hook in the build)');
      else {
        const key = p => p[0] + ',' + p[1], kth = new Map(f.crest.map((p, k) => [key(p), k]));
        for (const g of f.facets) {
          for (let s = 0; s < 3; s++) {
            if (g[3 + s] !== f.rim) continue;
            for (const [ja, jb] of [[(s + 1) % 3, (s + 2) % 3], [(s + 2) % 3, (s + 1) % 3]]) {
              const A = g[ja], B = g[jb], Cc = g[s], k = kth.get(key(A));
              if (k === undefined || k <= 0 || k >= f.crest.length - 1 || g[3 + jb] > 0) continue;
              const p = f.crest[k - 1], q = f.crest[k + 1];
              if ((A[0] - p[0]) * (q[1] - A[1]) - (A[1] - p[1]) * (q[0] - A[0]) <= 0) continue;
              const ux = B[0] - A[0], uy = B[1] - A[1], vx = Cc[0] - A[0], vy = Cc[1] - A[1];
              if (ux * vx + uy * vy >= 0) continue;
              const past = (f.rim * Math.hypot(ux, uy) * Math.hypot(vx, vy)) / Math.abs(ux * vy - uy * vx) - f.rim;
              if (past > RUN_ON_SEEN) runSeen++;
              if (past > runLong) { runLong = past; runAt = tag + ', the crest corner at x ' + (A[0] + cr.x0).toFixed(1); }
            }
          }
        }
      }
    }
    /* needles: the steepest edge of the crest */
    for (let i = 1; i < C.length; i++) {
      const s = Math.abs(C[i][1] - C[i - 1][1]) / Math.max(1e-9, C[i][0] - C[i - 1][0]);
      if (s > steep) { steep = s; steepAt = tag + ' at x ' + C[i][0].toFixed(1); }
    }
    /* spread: the lines that reach a peak's foot */
    if (peak) {
      for (const f of [C[0], C[C.length - 1]]) {
        const n = meet.has(key32(f)) ? meet.get(key32(f)).size : 0;
        footMax = Math.max(footMax, n);
        if (n > FOOT_LINES) fails.push(tag + ': ' + n + ' lines reach its foot at x ' + f[0].toFixed(1) + ' (limit ' + FOOT_LINES + ': the silhouette)');
      }
    }
    /* broad: the facets as they are seen, its pieces above the ground
       joined across every edge they share that has no line, reaching the
       lowest BAND px */
    const above = T.filter(t => t[0][1] >= 0 && t[1][1] >= 0 && t[2][1] >= 0);
    const par = above.map((_, i) => i), seenArea = above.map(t => Math.abs(area(t[0], t[1], t[2])) / 2);
    const seenLow = above.map(t => Math.min(t[0][1], t[1][1], t[2][1]));
    const root = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const shared = new Map();
    above.forEach((t, ti) => {
      for (let k = 0; k < 3; k++) {
        const i1 = (k + 1) % 3, i2 = (k + 2) % 3, p = t[i1], q = t[i2];
        let wk = 0;
        for (let j = 0; j < 3; j++) if (Math.abs(t.b[i1][j]) < ON_EDGE && Math.abs(t.b[i2][j]) < ON_EDGE) wk = Math.max(wk, t.w[j]);
        const kp = p[0] + ',' + p[1], kq = q[0] + ',' + q[1], ek = kp < kq ? kp + '|' + kq : kq + '|' + kp, e = shared.get(ek);
        if (!e) shared.set(ek, [ti, wk > 0]);
        else if (!(wk > 0) && !e[1]) {
          const a = root(ti), b = root(e[0]);
          if (a !== b) { par[b] = a; seenArea[a] += seenArea[b]; seenLow[a] = Math.min(seenLow[a], seenLow[b]); }
        }
      }
    });
    for (let i = 0; i < above.length; i++) {
      if (root(i) === i && seenLow[i] < BAND * Bg.S) { bandN++; if (seenArea[i] < SMALL * Bg.S * Bg.S) smallN++; }
    }
    crestW += C[C.length - 1][0] - C[0][0];
  }
  if (midair) fails.push(midAt + ': ' + midair + ' lines end in mid-air (a point off the crest and the ground with one line)');
  if (runLong > RUN_ON_MAX) fails.push(runAt + ': the silhouette runs on ' + runLong.toFixed(1) + ' px past its width into the massif with no line beside it (limit ' + RUN_ON_MAX + '): a stub');
  totals.runSeen = (totals.runSeen || 0) + runSeen; totals.runLong = Math.max(totals.runLong || 0, runLong);
  if (rimRun > RIM_RUN) fails.push(rimAt + ': the silhouette inks less than ' + RIM_INK + ' px in from the crest along ' + rimRun.toFixed(1) + ' px (limit ' + RIM_RUN + '): a sliver under it, or the line beside it taken out');
  totals.rimRun = Math.max(totals.rimRun || 0, rimRun); totals.rimThin = (totals.rimThin || 0) + rimThin / 2; totals.rimN = (totals.rimN || 0) + rimN / 2;
  if (steep > SLOPE_MAX + 1e-9) fails.push(steepAt + ': a crest edge rises ' + steep.toFixed(2) + ' px per px (limit ' + SLOPE_MAX + '): a needle');
  const smallRate = (100 * smallN) / crestW;
  if (smallRate > SMALL_RATE) fails.push(w + 'x' + h + ': ' + smallN + ' facets under ' + SMALL + ' px^2 (times S^2) reach the lowest ' + BAND + ' px, ' + smallRate.toFixed(2)
                                         + ' a 100 px of crest (limit ' + SMALL_RATE + '): a band of small triangles where a short tab\'s card shows the feet');
  totals.steep = Math.max(totals.steep || 0, steep); totals.footMax = Math.max(totals.footMax || 0, footMax);
  totals.smallRate = Math.max(totals.smallRate || 0, smallRate); totals.bandRate = Math.max(totals.bandRate || 0, (100 * bandN) / crestW);
  totals.crestEdges += crestEdges;
  if (!crestEdges) fails.push(w + 'x' + h + ': no edge was found on any crest, so the silhouette was not checked');

  /* unfolded: every piece placed as the shader places it, in each state.
     A vertex is placed once per distinct set of the attributes the shader
     reads (the pieces of a facet share their points) */
  const n = A.length / F, rep = new Int32Array(n), seen = new Map(), uniq = [];
  for (let v = 0; v < n; v++) {
    let k = '';
    for (const o of [0, 1, 2, 3, 4, 6, 19, 20, 21, 22, 23, 24, 25, 26]) k += A[v * F + o] + ',';
    let r = seen.get(k);
    if (r === undefined) { r = uniq.length; seen.set(k, r); uniq.push(v); }
    rep[v] = r;
  }
  const meshSign = new Int8Array(n / 3), alive = new Uint8Array(n / 3);
  for (let v = 0, i = 0; v < n; v += 3, i++) {
    const a = area([A[v * F], -A[v * F + 1]], [A[(v + 1) * F], -A[(v + 1) * F + 1]], [A[(v + 2) * F], -A[(v + 2) * F + 1]]);
    meshSign[i] = Math.sign(a); alive[i] = Math.abs(a) > 1e-6 ? 1 : 0;
  }
  const X = new Float64Array(uniq.length), Y = new Float64Array(uniq.length), P = [0, 0];
  let states = 0, flips = 0, worst = 0, worstAt = '';
  /* the base's chords: each massif's ground points (height 0) in x order,
     and how deep its skirt reaches (its lowest corner) */
  const ground = new Map();
  let skirt = 0;
  for (let v = 0; v < n; v++) {
    const hv = A[v * F + 1], id = A[v * F + 7];
    skirt = Math.min(skirt, hv);
    if (hv !== 0) continue;
    if (!ground.has(id)) ground.set(id, new Map());
    ground.get(id).set(A[v * F], v);
  }
  skirt = -skirt;
  const chords = [];
  let widest = 0;
  for (const g of ground.values()) {
    const xs = [...g.keys()].sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) { chords.push([rep[g.get(xs[i - 1])], rep[g.get(xs[i])], A[g.get(xs[i]) * F + 4]]); widest = Math.max(widest, xs[i] - xs[i - 1]); }
  }
  let sag = 0, sagAt = '';
  const judge = label => {
    const t = Bg.simNow;
    for (let r = 0; r < uniq.length; r++) { tw.massifAt(uniq[r], t, P); X[r] = P[0]; Y[r] = P[1]; }
    states++;
    for (let v = 0, i = 0; v < n; v += 3, i++) {
      if (!alive[i]) continue;
      const a = rep[v], b = rep[v + 1], c = rep[v + 2];
      const s = (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
      const l = Math.max(Math.hypot(X[b] - X[a], Y[b] - Y[a]), Math.hypot(X[c] - X[b], Y[c] - Y[b]), Math.hypot(X[a] - X[c], Y[a] - Y[c])) || 1;
      const alt = (s * meshSign[i]) / l;
      if (alt < 0 && Math.abs(s) > 1e-6) {
        flips++;
        if (-alt > worst) { worst = -alt; worstAt = w + 'x' + h + ' ' + label + ': massif ' + A[v * F + 7] + ', a piece turned over by ' + (-alt).toFixed(2) + ' px'; }
      }
    }
    /* the floor's contour under the base's chords, which the skirt must
       reach below */
    for (const [a, b, dd] of chords) {
      for (let j = 1; j < 8; j++) {
        const f = j / 8, x = X[a] + (X[b] - X[a]) * f, s = tw.floorAt(x, dd, t) - (Y[a] + (Y[b] - Y[a]) * f);
        if (s > sag) { sag = s; sagAt = label; }
      }
    }
  };
  /* idle: no pointer, over IDLE_TO ms of scene time, and the first swell
     event at its height */
  let now = 1000, seenEvent = false;
  sim.frame(16.7);
  while (Bg.simNow < IDLE_TO) {
    const next = Bg.simNow + IDLE_EVERY;
    while (Bg.simNow < next) {
      now += 64; sim.frame(64);
      if (!seenEvent && Bg.EVF.on && Bg.EVF.env > 0.97) { seenEvent = true; judge('idle, the swell event at ' + (Bg.simNow / 1000).toFixed(1) + ' s'); }
    }
    judge('idle at ' + (Bg.simNow / 1000).toFixed(1) + ' s');
  }
  if (!seenEvent) fails.push(w + 'x' + h + ': no swell event came in ' + IDLE_TO / 1000 + ' s, so none was judged');
  /* push: the pointer parked on each band's base line (its dent in the
     floor under that band, deepest there) and on the near peaks' faces */
  const pushAt = [];
  for (const d of [...new Set(Bg.BANDS.map(b => b.d).concat(Bg.RIDGES.map(r => r.d)))]) for (const fx of BASE_XS) pushAt.push(['the pointer at x ' + fx + ' on the base line of d ' + d, fx * w, Bg.restAt(d) + 1]);
  const near = Bg.BANDS[Bg.BANDS.length - 1];
  for (const fx of FACE_XS) pushAt.push(['the pointer at x ' + fx + ' on the near peaks\' faces', fx * w, Bg.restAt(near.d) - near.hmin * h * 0.5]);
  for (const [label, x, y] of pushAt) {
    sim.move(x, y);
    for (let f = 0; f < SETTLE; f++) sim.frame(16.7);
    judge(label);
  }
  totals.states += states; totals.placed += states * (n / 3); totals.flips += flips;
  if (flips && worst > FOLD_PX) fails.push(worstAt + ' (' + flips + ' turned over in ' + states + ' states; limit ' + FOLD_PX + ' px)');
  if (worst > totals.worstFold) { totals.worstFold = worst; totals.foldAt = worstAt; }
  /* reaches: where the cut lines are wider apart than BASE_STEP (gridAt
     widens them where the floor curves slowly), the skirt must still reach
     below the floor's contour under every chord of the base; at
     BASE_STEP (a phone) it is reported only - that is the walk as it was */
  if (widest > BASE_STEP + 1e-6 && !(sag < skirt)) fails.push(w + 'x' + h + ' ' + sagAt + ': the floor sags ' + sag.toFixed(2) + ' px below a base chord ' + widest.toFixed(1) + ' px wide, where the skirt reaches ' + skirt);
  totals.sag = Math.max(totals.sag || 0, widest > BASE_STEP + 1e-6 ? sag : 0);
  rows.push(w + 'x' + h + ' S ' + Bg.S.toFixed(3) + ': ' + m.crests.length + ' massifs, ' + (A.length / F / 3) + ' pieces; over ' + worstOver + ', gap ' + worstGap
            + ', above ' + worstOut + ', skirt ' + worstSkirt + '; ' + crestEdges + ' crest edges; at most ' + fanMax + ' lines at a point, ' + footMax + ' at a foot, '
            + midair + ' ending in mid-air; the steepest crest edge ' + steep.toFixed(3) + '; ' + ((100 * bandN) / crestW).toFixed(2) + ' facets a 100 px reach the lowest '
            + BAND + ' px, ' + smallRate.toFixed(2) + ' of them small; the silhouette under ' + RIM_INK + ' px along ' + (rimThin / 2).toFixed(1) + ' of ' + (rimN / 2).toFixed(0)
            + ' px of crest, in runs of at most ' + rimRun.toFixed(1) + ' px; ' + runSeen + ' bare run-ons past ' + RUN_ON_SEEN + ' px (the longest ' + runLong.toFixed(1) + '); '
            + states + ' states placed (' + pushAt.length + ' with the pointer), ' + flips + ' pieces turned over'
            + (flips ? ' (worst ' + worst.toFixed(3) + ' px)' : '') + '; base chords up to ' + widest.toFixed(1) + ' px, the floor ' + sag.toFixed(2) + ' px below one at most (skirt ' + skirt + ')');
}
for (const r of rows) console.log('  ' + r);
if (fails.length) {
  console.log('check-scenery-mesh: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1, 20)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-scenery-mesh: OK - ' + VIEWS.length + ' viewports, ' + totals.massifs + ' ridges and peaks, ' + totals.tris + ' pieces, '
            + totals.samples.toLocaleString('en-US') + ' samples: every point under a crest in exactly one piece, none above it, the skirt whole;'
            + ' every peak falls to the ground at both feet under one summit; the crest drawn as the silhouette (' + totals.crestEdges + ' edges), the ground unlined;'
            + ' at most ' + totals.fan + ' lines meet at a point (' + totals.fanAt + '; the Canvas fan met 42 at its core), ' + totals.footMax + ' at a peak\'s foot (the silhouette), none ending in mid-air;'
            + ' no crest edge steeper than ' + totals.steep.toFixed(3) + ' (no needles); at most ' + totals.smallRate.toFixed(2) + ' small facets a 100 px of crest in the lowest ' + BAND + ' px (of '
            + totals.bandRate.toFixed(2) + ' facets there); the silhouette inked ' + RIM_INK + ' px in all along every crest edge but for ' + totals.rimThin.toFixed(1) + ' of '
            + totals.rimN.toFixed(0) + ' px, in runs of at most ' + totals.rimRun.toFixed(1) + ' px (limit ' + RIM_RUN + '), and run on into the massif bare by at most '
            + totals.runLong.toFixed(1) + ' px (limit ' + RUN_ON_MAX + '; ' + totals.runSeen + ' by more than ' + RUN_ON_SEEN + '); every tree and conifer in front of every band;'
            + ' ' + totals.states + ' scene states (idle over 100 s and a swell event, the pointer on every band\'s base line and on the near faces), '
            + totals.placed.toLocaleString('en-US') + ' pieces placed as the shader places them: '
            + (totals.flips ? totals.flips + ' turned over, none by more than ' + FOLD_PX + ' px (worst ' + totals.worstFold.toFixed(3) + ': ' + totals.foldAt + ')' : 'none turned over at all')
            + '; where the cut lines are wider apart than ' + BASE_STEP + ' px the floor sags at most ' + (totals.sag || 0).toFixed(2) + ' px below a base chord, inside the skirt');
