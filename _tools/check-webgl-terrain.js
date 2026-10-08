'use strict';
/* The WebGL scenery (W2b): it draws, it is in front of exactly what it is
   in front of, and it has no seams.

   On Canvas the terrain was painted over the sheet in one fixed order: a
   base sunk into a dent was painted over the nearer floor that should hide
   it (G1.2, F58), facets painted past their silhouettes or left wedges of
   the fill underneath bare (G2.1-G2.3), and the anti-aliasing between
   separately filled facets let the underlay through as light lines (F60).
   render-webgl.js draws each ridge and peak as one opaque mesh at its own
   depth, its lines in the fragment shader, through the depth buffer. This
   checks what the GPU produced, in headless Chrome (1440x900@1.5,
   paused, so the frame is a still one of a scene state set with
   Bg.advance, the card hidden), against the scene and against the mesh
   the renderer was given (sceneryMesh, placed by scenery-twin.js, which
   check-wave-parity.js holds the shader to):

     draws      every ridge and peak shows (renderer.probeIds: what each
                pixel shows), and every one of the 8 trees and conifers,
                each on at least STROKE_PX device px: they all stand in
                front of the bands, as the Canvas renderer painted them
                (two conifers stood behind the near band, and showed on
                1,539 and 0 px, before scene.js brought them forward)
     occludes   every pixel the mesh puts a massif on (its triangles, at the
                pixel's centre, not within 1.5 device px of any massif's
                outline), against the floor alone there (probeDepth) and
                every other massif on it: the nearest must be what shows.
                Where the floor is nearer - in front of a base, rising out
                of a dent the base sank into - the floor must show (the
                floor in front of a base occludes it); where it is farther
                or absent, the massif (the mountain occludes the floor
                behind it), and a nearer massif over a farther one. (The
                mesh reaches a few px below its base, its skirt, which the
                floor in front must hide everywhere; with the pointer at a
                base, the dent's rim must also hide some of the massif above
                its base line.) Pixels
                within 2 px (of the floor's own depth slope) of a tie are
                counted, not judged; a tree in front is skipped.
     no seams   in the screenshot, every pixel a massif shows, 2.5 device px
                or more from any of its lines and any massif's outline, 2 or
                more from where anything else shows (the floor in front of a
                base, a nearer massif), and clear of the trees, the bodies
                and the ring, is that
                massif's fill exactly (within 2 levels): nothing from behind
                - the page grey, the floor's lines, a farther ridge - shows
                through anywhere inside a silhouette, along a facet edge or
                along the unlined edges of the base.

   States: idle at 134 s; the pointer parked at the base of a near peak
   in the left gutter, where its dent sinks the base and the dent's near
   rim rises in front of it (the floor must hide the base there: at least
   200 device px of it); and the first swell event, a hill in the left
   gutter, at its height.

     the ring   drawn over all of it, the cursor ring must stay legible
                over the line art: with the pointer resting on a mountain
                face it read as one more teal line among the facets' and
                the trees' and disappeared (the final QA lens). Its circle
                and its dot sit on a casing of the card's tone (--surface),
                RING_HALO px each side of the line, which must clear the
                lines under it: over the device px in the casing (outside
                the line and both's anti-aliasing) that a line darkens
                without the ring, the median must be lifted at least
                RING_LIFT of the way to the card's tone (the casing's own
                alpha is 0.86 with the ring faded in; the screenshot smears
                a band 1.5 device px wide with the ring's line and the
                casing's edge: measured 0.75, and 0 with no casing). Over
                the plain floor, which
                is all but that tone, it must stay subtle: no plain pixel
                of it lighter by more than RING_SUBTLE levels. Each from two
                frames of one scene state, drawn at once in a page whose
                frames the test drives (glkit's clock): moving, with the
                ring, and the still frame the motion pause paints in its
                place, the same scene without it.

   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const K = require('./glkit');
const H = require('./harness');
const Twin = require('./scenery-twin');

const fails = [], notes = [];
/* the fewest device px a tree or a conifer may show on, at 1440x900@1.5 */
const STROKE_PX = 1000;
/* the ring (above): how far toward the card's tone its casing must lift the
   lines under it (the median), and the most it may lighten the plain floor
   (luminance levels) */
const RING_LIFT = 0.6, RING_SUBTLE = 16;

/* in the page: what the GPU drew, against the mesh, the floor and the screenshot */
async function analyse(label, pngB64) {
  const Bg = window.Bg, W = Bg.W, H = Bg.H, t = Bg.simNow;
  /* render-webgl.js's depth: clip z = depthAt(d) - zb, depthAt(d) = 1 -
     DEPTH_K / d (DEPTH_K = 2 * DEPTH_NEAR there), so a massif's nudge zb
     is zb / DEPTH_K of 1/d */
  const DEPTH_K = 0.5;
  if (!window.__probeR) window.__probeR = Bg.renderers.webgl(document.createElement('canvas'));
  const R = window.__probeR;
  if (!R) return { error: 'no WebGL renderer' };
  if (!R.probeIds || !R.probeScenery || !window.__sceneryTwin) return { skip: 'the WebGL renderer has no scenery probes (before W2b)' };
  R.resize(W, H, Math.min(devicePixelRatio, 2));
  const ids = R.probeIds(), floor = R.probeDepth();
  if (!ids || !floor) return { error: 'a probe failed' };
  const bw = ids.w, bh = ids.h, kx = bw / W, ky = bh / H;
  /* the screenshot */
  const bin = atob(pngB64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const oc = new OffscreenCanvas(bmp.width, bmp.height), c2 = oc.getContext('2d');
  c2.drawImage(bmp, 0, 0);
  const img = c2.getImageData(0, 0, bmp.width, bmp.height).data, iw = bmp.width;
  /* the mesh, placed */
  const tw = window.__sceneryTwin(Bg);
  const objs = new Map();
  const P = [0, 0];
  for (let v = 0; v < tw.massifs; v += 3) {
    const m = tw.massif(v);
    let o = objs.get(m.id);
    if (!o) {
      o = { id: m.id, d: m.d, z: 1 - DEPTH_K / m.d - m.zb, tris: [], fill: m.fill.map(c => Math.round(c * 255)) };
      objs.set(m.id, o);
    }
    const tri = [];
    for (let k = 0; k < 3; k++) { tw.massifAt(v + k, t, P); tri.push([P[0] * kx, P[1] * ky]); }
    tri.w = tw.massif(v).widths;
    tri.b = [0, 1, 2].map(k => tw.massif(v + k).bary);
    tri.skirt = tw.massif(v).h < 0 || tw.massif(v + 1).h < 0 || tw.massif(v + 2).h < 0;
    o.tris.push(tri);
  }
  const list = [...objs.values()].sort((p, q) => p.z - q.z);
  /* per pixel: the nearest massif whose triangles cover its centre */
  const near = new Int16Array(bw * bh).fill(-1), edge = new Uint8Array(bw * bh), lined = new Uint8Array(bw * bh), skirt = new Uint8Array(bw * bh);
  const inside = (tri, x, y) => {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (c === 0) return false;
      s += c > 0 ? 1 : -1;
    }
    return Math.abs(s) === 3;
  };
  const mark = (mask, a, b, r) => {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(bw - 1, Math.ceil(Math.max(a[0], b[0]) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(bh - 1, Math.ceil(Math.max(a[1], b[1]) + r));
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a[0], py = y + 0.5 - a[1];
        const u = L2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
        if (Math.hypot(px - u * dx, py - u * dy) <= r) mask[y * bw + x] = 1;
      }
    }
  };
  let tris = 0;
  list.forEach((o, oi) => {
    const count = new Map();
    const key = (a, b) => { const p = a[0] + ',' + a[1], q = b[0] + ',' + b[1]; return p < q ? p + '|' + q : q + '|' + p; };
    for (const tri of o.tris) {
      tris++;
      for (let k = 0; k < 3; k++) { const kk = key(tri[k], tri[(k + 1) % 3]); count.set(kk, (count.get(kk) || 0) + 1); }
      const xs = tri.map(p => p[0]), ys = tri.map(p => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(bh - 1, Math.ceil(Math.max(...ys))); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(bw - 1, Math.ceil(Math.max(...xs))); x++) {
          const i = y * bw + x;
          if (near[i] >= 0 && near[i] < oi) continue;
          if (inside(tri, x + 0.5, y + 0.5)) { near[i] = oi; skirt[i] = tri.skirt ? 1 : 0; }
        }
      }
      /* its lines: a piece is drawn with its facet's lines, so a piece's
         edge carries one where it lies on an edge of the facet (both its
         ends 0 in the barycentric coordinate across from that edge),
         with that edge's width w[j] (CSS px) */
      for (let k = 0; k < 3; k++) {
        const i1 = (k + 1) % 3, i2 = (k + 2) % 3;
        for (let j = 0; j < 3; j++) {
          if (tri.w[j] > 0 && Math.abs(tri.b[i1][j]) < 1e-6 && Math.abs(tri.b[i2][j]) < 1e-6) mark(lined, tri[i1], tri[i2], tri.w[j] * kx + 2.5);
        }
      }
    }
    /* its outline: the edges no two of its triangles share */
    for (const tri of o.tris) for (let k = 0; k < 3; k++) if (count.get(key(tri[k], tri[(k + 1) % 3])) === 1) mark(edge, tri[k], tri[(k + 1) % 3], 2.5);
  });
  /* the trees, the bodies and the ring: kept clear of */
  const busy = new Uint8Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) {
    if (ids.id[i] >= 40) {
      const x = i % bw, y = (i - x) / bw;
      for (let yy = Math.max(0, y - 3); yy <= Math.min(bh - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(bw - 1, x + 3); xx++) busy[yy * bw + xx] = 1;
    }
  }
  for (const b of Bg.bodiesAt(t)) mark(busy, [b.x * kx, b.y * ky], [b.x * kx, b.y * ky], (17 * b.size + 3) * kx);
  const fv = i => floor[2 + i];
  const r = { label, t, bw, bh, tris, shown: {}, floorFront: 0, floorOver: 0, massifFront: 0, overFarther: 0, ties: 0, skipped: 0,
              wrong: 0, first: null, seamPx: 0, seamBad: 0, seamWorst: 0, seamAt: null };
  for (let i = 0; i < bw * bh; i++) {
    const got = ids.id[i];
    if (got >= 20 && got < 40) r.shown[got] = (r.shown[got] || 0) + 1;
    if (got >= 40 && got < 50) r.shown[got] = (r.shown[got] || 0) + 1;
    const oi = near[i];
    if (oi < 0 || edge[i]) continue;
    if (got >= 40) { r.skipped++; continue; }
    const o = list[oi], v = fv(i), x = i % bw, y = (i - x) / bw;
    const mv = (1 - o.z) / DEPTH_K;                     /* the massif's 1/d, nudged */
    let want;
    if (v > 0) {
      const g = Math.max(Math.abs(fv(Math.min(bw * bh - 1, i + bw)) - v), Math.abs(fv(Math.max(0, i - bw)) - v), 1e-6);
      if (Math.abs(v - mv) <= 2 * g + 1e-5) { r.ties++; continue; }
      want = v > mv ? 1 : o.id;
    } else want = o.id;
    if (want === 1) { r.floorFront++; if (!skirt[i]) r.floorOver++; }
    else if (v > 0) r.massifFront++;
    else r.overFarther++;
    if (got !== want) {
      r.wrong++;
      if (!r.first) r.first = { x, y, want, got, v: +v.toFixed(5), mv: +mv.toFixed(5) };
      continue;
    }
    /* seams: the fill, exactly, away from every line, outline and stroke,
       and from where the massif stops showing (the floor in front taking
       over at its base: the multisampling blends the two there). A crack
       wide enough to reach a pixel's centre is a wrong pixel above. */
    if (want === 1 || lined[i] || busy[i]) continue;
    let alone = x >= 2 && y >= 2 && x < bw - 2 && y < bh - 2;
    for (let yy = y - 2; alone && yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (ids.id[yy * bw + xx] !== got) { alone = false; break; }
    if (!alone) continue;
    const j = 4 * (y * iw + x);
    const dev = Math.max(Math.abs(img[j] - o.fill[0]), Math.abs(img[j + 1] - o.fill[1]), Math.abs(img[j + 2] - o.fill[2]));
    r.seamPx++;
    if (dev > 2) { r.seamBad++; if (dev > r.seamWorst) { r.seamWorst = dev; r.seamAt = { x, y, got: [img[j], img[j + 1], img[j + 2]], fill: o.fill, id: o.id }; } }
  }
  return r;
}

/* The ring over a spot (CSS px, from the page's own layout: at, run in the
   page), twice: moving, with the ring, and the motion pause's still frame
   of the same scene, without it (main.js paints it in the next frame) */
async function ringPair(b, site, at, arg) {
  const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5, init: K.CLOCK });
  try {
    await K.step(s, 30, 16.7);
    const p = await s.evaluate(at, arg);
    for (let i = 0; i < 90; i++) { await K.pointer(s, p.x, p.y); await K.step(s, 1, 16.7); }
    /* the line art as it stands: a resting pointer blooms the scenery
       (scene.js THE BLOOM), which carries the lines away from under the
       ring, and the trees turn out of its disc - its legibility is over the
       lines, so the bloom is held off for the frame (check-bloom holds it) */
    await s.evaluate(() => {
      const B = window.Bg.BLOOM, F = window.Bg.FORK;
      for (const q of B.s) { q.on = 0; q.v = 0; } B.on = 0;
      /* and the trees' turns out of the cursor's disc with it (THE FORKS) */
      if (F) { for (const o of F.obj) { o.off.fill(0); o.vel.fill(0); } F.idle = true; }
    });
    await K.step(s, 1, 16.7);
    const on = B.decodePNG(await s.screenshot());
    const mk = await s.evaluate(() => ({ x: window.Bg.mk.x, y: window.Bg.mk.y, k: window.Bg.ptr.k }));
    await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true } })));
    await K.step(s, 1, 16.7);
    const off = B.decodePNG(await s.screenshot());
    return { p, on, off, mk, errors: s.errors.slice() };
  } finally { await s.close(); }
}
/* The casing - the band RING_HALO px beyond the line on each side, clear of
   both's anti-aliasing - against the same px without the ring: how far the
   px a line darkens (inked) are lifted toward the card's tone (--surface),
   as a share of the way (the median), and how far the plain ones lighten */
function ringBands(pair, rn) {
  const { on, off, mk } = pair, k = on.width / 1440, r = rn.RING_R + rn.RING_WOBBLE * Math.sin(mk.x * 0.01 + mk.y * 0.01);
  const lum = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  const aa = 0.5 / k, lo = rn.RING_LINE / 2 + aa, hi = rn.RING_LINE / 2 + rn.RING_HALO - aa;
  const SURF = 0.2126 * 232 + 0.7152 * 232 + 0.0722 * 228;
  const out = { casing: 0, inked: 0, lift: 0, plain: 0, up: 0 }, lifts = [];
  const cx = mk.x * k, cy = mk.y * k, reach = Math.ceil((r + hi + 2) * k);
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(on.height - 1, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(on.width - 1, Math.ceil(cx + reach)); x++) {
      const dd = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / k - r);
      if (dd < lo || dd > hi) continue;
      const i = 4 * (y * on.width + x), was = lum(off, i), now = lum(on, i);
      out.casing++;
      if (was < SURF - 40) {
        out.inked++;
        lifts.push((now - was) / (SURF - was));
      } else if (was > SURF - 16) {
        out.plain++;
        out.up = Math.max(out.up, now - was);
      }
    }
  }
  lifts.sort((p, q) => p - q);
  if (lifts.length) out.lift = lifts[lifts.length >> 1];
  return out;
}
async function ringCheck(b, site) {
  let rn;
  try { rn = H.rendererNumbers(['RING_R', 'RING_WOBBLE', 'RING_LINE', 'RING_HALO']); }
  catch (e) { fails.push('the ring: the renderer gives it no casing (' + e.message + ')'); return; }
  /* a mountain face: the tallest peak of the near band whose centre is in
     the right gutter, 45% of the way up it; and the plain floor low in the
     left gutter */
  /* the first height up that face (45%, then 35, 55, 30, 60%) with line
     work under the ring's casing: a single facet line through the ring's
     centre crosses the casing in two short spans and leaves too little to
     judge (it held only while the old push pressed the face in) */
  let face = null;
  for (const up of [0.45, 0.35, 0.55, 0.3, 0.6]) {
    face = await ringPair(b, site, up => {
      const Bg = window.Bg, band = Bg.BANDS[Bg.BANDS.length - 1], card = document.querySelector('.shell').getBoundingClientRect();
      let best = null;
      for (let j = 0; j < band.n; j++) {
        const p = Bg.peakPlace(band, j), x = Bg.standX(p.fx, band.d);
        if (x > card.right + 40 && x < Bg.W - 40 && (!best || p.mh > best.p.mh)) best = { x, p };
      }
      return best ? { x: best.x, y: Bg.restAt(band.d) - up * best.p.mh } : { x: Bg.W - 120, y: Bg.H * 0.38 };
    }, up);
    if (!(face.mk.k > 0.9) || ringBands(face, rn).inked >= 20) break;
  }
  /* the plain floor: the first spot low in the left gutter with plain floor
     under the casing (the floor's lines move with the dent under the ring,
     and a shallower dent leaves more of them in it) */
  let floor = null;
  for (const [fx, up] of [[140, 70], [210, 95], [100, 120], [250, 60], [170, 140]]) {
    floor = await ringPair(b, site, (p) => ({ x: p[0], y: window.Bg.H - p[1] }), [fx, up]);
    if (!(floor.mk.k > 0.9) || ringBands(floor, rn).plain >= 100) break;
  }
  for (const [label, pair] of [['the ring on a mountain face', face], ['the ring on the plain floor', floor]]) {
    for (const x of pair.errors) fails.push(label + ': ' + x.type + ': ' + x.text);
    if (!(pair.mk.k > 0.9)) { fails.push(label + ': the ring has not faded in (ptr.k ' + pair.mk.k + ')'); return; }
  }
  const f = ringBands(face, rn), g = ringBands(floor, rn);
  if (f.inked < 20) fails.push('the ring on a mountain face: precondition: only ' + f.inked + ' casing px have a line under them (at ' + face.p.x.toFixed(0) + ', ' + face.p.y.toFixed(0) + ')');
  else if (!(f.lift >= RING_LIFT)) {
    fails.push('the ring on a mountain face: its casing lifts the ' + f.inked + ' px a line darkens under it only ' + (100 * f.lift).toFixed(0) + '% of the way to the card\'s tone (median; need '
               + (100 * RING_LIFT) + '%): the ring is lost among the lines (the final QA lens)');
  }
  if (g.plain < 100) fails.push('the ring on the plain floor: precondition: only ' + g.plain + ' plain casing px');
  else if (g.up > RING_SUBTLE) fails.push('the ring on the plain floor: its casing lightens the floor by up to ' + g.up.toFixed(0) + ' levels (limit ' + RING_SUBTLE + ')');
  notes.push('the ring: on a mountain face (' + face.p.x.toFixed(0) + ', ' + face.p.y.toFixed(0) + ') its casing lifts the ' + f.inked + ' px a line darkens under it '
             + (100 * f.lift).toFixed(0) + '% of the way to the card\'s tone (median), and on the plain floor lightens ' + g.plain + ' px by at most ' + g.up.toFixed(1) + ' levels');
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-webgl-terrain: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  try {
    const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5, init: Twin.SOURCE,
                                                          media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await s.frames(3);
      if ((await K.rendererOf(s)) !== 'webgl2') fails.push('the page did not start with WebGL 2');
      const states = [
        ['idle at 134s', () => { let now = 0; window.Bg.resetClock(); while (window.Bg.simNow < 134000) { now += 64; window.Bg.advance(now); } }],
        ['the pointer at a near peak\'s base', () => {
          const Bg = window.Bg, b = Bg.BANDS[Bg.BANDS.length - 1];
          /* the near band's peak whose centre is furthest into the left gutter, but on screen */
          let best = null;
          for (let k = 0; k < b.n; k++) { const p = Bg.peakPlace(b, k), x = Bg.standX(p.fx, b.d); if (x > 40 && x < 300 && (!best || x < best.x)) best = { x, p }; }
          if (!best) { const p = Bg.peakPlace(b, 0); best = { x: Math.max(60, Bg.standX(p.fx, b.d)), p }; }
          let now = 1e6; Bg.resetClock(); Bg.pointerAt(best.x, Bg.restAt(b.d) + 2);
          for (let i = 0; i < 240; i++) { now += 16.7; Bg.advance(now); }
        }],
        ['the first swell event', () => {
          let now = 2e6; window.Bg.resetClock(); window.Bg.pointerGone();
          window.Bg.advance(now);
          for (let i = 0; i < 400 && !(window.Bg.EVF.on && window.Bg.EVF.env > 0.95); i++) { now += 64; window.Bg.advance(now); }
        }]];
      let fresh = true;
      for (const [label, set] of states) {
        if (!fresh) { await s.page.reload({ waitUntil: 'load' }); await s.frames(3); }
        fresh = false;
        await K.hideCard(s);
        await s.evaluate(set);
        await s.evaluate(() => window.dispatchEvent(new Event('resize')));
        await s.frames(4);
        const png = await s.screenshot();
        const m = await s.evaluate(analyse, label, png.toString('base64'));
        if (m.skip) { console.log('check-webgl-terrain: SKIP - ' + m.skip); return; }
        if (m.error) { fails.push(label + ': ' + m.error); continue; }
        const shownMassifs = Object.keys(m.shown).filter(k => k >= 20 && k < 40).length;
        const shownStrokes = Object.keys(m.shown).filter(k => k >= 40).length, strokePx = [];
        for (let i = 0; i < 8; i++) {
          const px = m.shown[40 + i] || 0, name = i < 4 ? 'TREES[' + i + ']' : 'CONIFERS[' + (i - 4) + ']';
          strokePx.push(name + ' ' + px);
          if (!(px >= STROKE_PX)) fails.push(label + ': ' + name + ' shows on only ' + px + ' px (need ' + STROKE_PX + ')');
        }
        if (shownMassifs < 12) fails.push(label + ': only ' + shownMassifs + ' of the 12 ridges and peaks show');
        if (m.wrong) fails.push(label + ': ' + m.wrong + ' pixels show the wrong thing (first ' + JSON.stringify(m.first) + ': want ' + m.first.want + ')');
        if (!(m.massifFront > 10000)) fails.push(label + ': only ' + m.massifFront + ' pixels where a massif hides the floor behind it');
        if (m.seamBad) fails.push(label + ': ' + m.seamBad + ' of ' + m.seamPx + ' pixels inside a silhouette are not its fill (worst ' + m.seamWorst + ' levels: ' + JSON.stringify(m.seamAt) + ')');
        if (!(m.seamPx > 200000)) fails.push(label + ': only ' + m.seamPx + ' fill pixels could be judged for seams');
        if (/base/.test(label) && !(m.floorOver >= 200)) fails.push(label + ': the floor rises over the base line on only ' + m.floorOver + ' px (need 200): the state tests nothing');
        notes.push(label + ' (' + (m.t / 1000).toFixed(1) + 's): ' + m.tris + ' triangles, ' + shownMassifs + ' massifs and ' + shownStrokes + ' trees and conifers shown (' + strokePx.join(', ') + ' px); '
                   + m.massifFront + ' px of floor behind a massif hidden by it, ' + m.overFarther + ' px over nothing or a farther massif, '
                   + m.floorFront + ' px of base hidden by the floor in front (' + m.floorOver + ' of them above the base line), ' + m.ties + ' ties, 0 wrong; seams: ' + m.seamPx + ' px of fill, all exact');
      }
      for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push('console ' + m.type + ': ' + m.text);
      for (const x of s.errors) if (x.type !== 'error') fails.push(x.type + ': ' + x.text);
    } finally { await s.close(); }
    await ringCheck(b, site);
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-webgl-terrain: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-webgl-terrain: OK - 1440x900@1.5, every pixel against the mesh and the floor: ' + notes.join('; '));
}
main().catch(e => { console.log('check-webgl-terrain: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
