'use strict';
/* The WebGL renderer works in a real browser, and fails cleanly.

   Headless Chrome (browser.js; WebGL through SwiftShader, so this is about
   correctness, not GPU time), the page with the quality governor's top
   level held (?bgq=0: check-governor.js tests the adapting):

     1. 1440x900@1.5 and 390x844@3: #cosmos has a WebGL 2 context;
        nothing at all on the console (WebGL reports its own errors there as
        warnings, so a GL error in a frame shows up too); the background
        draws (with the card hidden, over 5% of the viewport off the page
        grey) and animates (over 1% of the pixels change in a second); the
        open sky (the top fifth, wherever nothing at all is drawn within 6
        device px - a single-sample id buffer can miss a sub-pixel summit tip
        the multisampling still draws: glkit.openSky, from the renderer's own id buffer, with
        the motion paused so the two agree) is exactly the page grey, every
        pixel, and so is the floor between its lines (the commonest colour
        of the bottom fifth): the canvas is the page's background now, so
        COAT must be --coat exactly.
     2. WebGL 1 (getContext('webgl2') made to return null): the GLSL ES 1.00
        path with OES_standard_derivatives compiles, nothing on the console,
        and in the same scene state (glkit's clock, at 720x450) it draws what
        WebGL 2 draws (under 0.1% of the pixels more than 8 levels apart).
     3. A shader that does not compile (render-webgl.js served with one GLSL
        line broken): exactly one console warning, no error, and main.js
        shows the still picture (data-bg="static", the canvas hidden, the
        picture showing, nothing moving).
     4. No WebGL at all: the same, one warning, the still picture.
     5. What a frame costs, on glkit's clock with the pointer in: the GL
        draw calls (7 or 8: the card's depth where it covers the canvas,
        the sun, the clouds, the floor, the ridges and peaks, the trees and
        conifers, the bodies, the ring); and
        what the JS heap allocates, by the sampling heap profiler (32-byte
        interval, collected objects counted) over 200 frames after 1,200 to
        warm up (at 480x300: what a frame allocates does not depend on its
        pixels; the Canvas renderer, whose figure is ~2,000 times larger, at
        a 4 KB interval over 60 frames after 200). For the WebGL frames
        after the draw count the GL draws and clears are skipped (the
        renderer's JS runs unchanged; only SwiftShader is spared drawing
        1,400 frames of 240k vertices on the CPU). render-webgl.js's own
        code may allocate nothing a frame - under 8 B a frame on average:
        one boxed number a frame is 16, a stray sample of the JIT's own
        bookkeeping (40 B once in 200 frames) is not. The best of up to
        WINDOWS such windows (200 more frames between them): an allocation
        the renderer makes every frame shows in every window, while a
        one-off of the JIT's - an optimisation landing inside the window,
        ~3.1 KB once (15.5 B a frame), blamed on whichever function of the
        renderer was on the stack: blended, stand, attribs - showed in one
        run in three to five with a single window, on code that had not
        changed (the docs pass). Every upload goes
        through typed arrays made once (a double passed to a WebGL call is
        boxed even in optimised code). What it calls in the scene (sunAt,
        bodiesAt and the wave under them) still boxes a few doubles while V8
        has not optimised it - functions run once a frame are optimised
        late, and before 1,200 frames even the renderer's own were not, in
        one run in three - so that figure (everything under the renderer's
        frames) is reported, not judged (check-scene-alloc.js holds the
        scene's own), as is the JS time per tick, the whole frame (main.js,
        the governor, the scene, the renderer), with the draws skipped. The
        Canvas renderer W3 deleted made ~725 KB of garbage a frame and took
        ~3.4 ms of JS a tick in this same measure.

   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');
const K = require('./glkit');

const DRAWN = 0.05, MOVING = 0.01, TOL = 12;
/* allocation windows at most (part 5) */
const WINDOWS = 3;
const NO_WEBGL2 = "(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, a) { return t === 'webgl2' ? null : g.call(this, t, a); }; })();";
const NO_WEBGL = "(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, a) { return /webgl/.test(t) ? null : g.call(this, t, a); }; })();";
/* counts GL draw calls on #cosmos's context into window.__draws */
/* and skips them, and the clears, once window.__skip is set */
const COUNT_DRAWS = "(() => { window.__draws = 0; window.__skip = false; for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; for (const m of ['drawArrays', 'drawElements', 'clear']) { const f = C.prototype[m]; C.prototype[m] = function (...a) { if (m !== 'clear' && this.canvas && this.canvas.id === 'cosmos') window.__draws++; if (window.__skip) return; return f.apply(this, a); }; } } })();";
const fails = [], notes = [];
const pct = v => (100 * v).toFixed(1) + '%';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* drawn and moving (or, for the still picture, drawn and still), with the
   card hidden, real frames */
async function looks(s, label, still) {
  await s.frames(3);
  await K.hideCard(s);
  const grey = await K.pageGrey(s);
  await s.frames(2);
  const a = B.decodePNG(await s.screenshot());
  await sleep(1000);
  await s.frames(2);
  const z = B.decodePNG(await s.screenshot());
  const drawn = B.offColour(a, grey, TOL), moving = B.changed(a, z, TOL);
  if (!(drawn > DRAWN)) fails.push(label + ': the background did not draw (' + pct(drawn) + ' off the page grey)');
  if (still ? moving > 0 : !(moving > MOVING)) fails.push(label + ': ' + pct(moving) + ' of the pixels changed in 1s' + (still ? ' (the still picture)' : ' (not animating)'));
  return { a, grey, drawn, moving };
}
function quiet(s, label, allowWarnings) {
  for (const m of s.messages) {
    const warn = m.type === 'warn' || m.type === 'warning';
    if (allowWarnings && warn) continue;
    /* the open-sky probe's readPixels makes SwiftShader say it stalled: the test's own doing */
    if (warn && /GPU stall due to ReadPixels/.test(m.text)) continue;
    fails.push(label + ': console ' + m.type + ': ' + m.text);
  }
  for (const e of s.errors) if (e.type !== 'error') fails.push(label + ': ' + e.type + ': ' + e.text);
}
/* the sky band exactly the page grey, and the floor's commonest colour */
async function coat(s, img, grey, label) {
  /* the motion paused (one still frame, then none), so the picture and the
     open sky are of one scene state */
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true } })));
  await s.frames(3);
  const still = B.decodePNG(await s.screenshot());
  const sky = await K.openSky(s, 6);
  const g = await s.evaluate(() => ({ W: window.Bg.W, H: window.Bg.H, dpr: devicePixelRatio }));
  const k = g.dpr, top = Math.floor(0.2 * g.H * k), w = Math.floor(g.W * k);
  let off = 0, n = 0;
  if (!sky) fails.push(label + ': no open sky to read (glkit.openSky)');
  else {
    /* the mask is in the canvas's own pixels, which are fewer than the
       screenshot's where the page's dpr is over 2 (the bitmap is made at 2) */
    const sx = sky.w / (g.W * k), sy = sky.h / (g.H * k);
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < w; x++) {
        if (!sky.at(Math.floor(x * sx), Math.floor(y * sy))) continue;
        const i = 4 * (y * still.width + x);
        n++;
        if (still.data[i] !== grey[0] || still.data[i + 1] !== grey[1] || still.data[i + 2] !== grey[2]) off++;
      }
    }
    if (!(n > 0.25 * top * w)) fails.push(label + ': only ' + n + ' px of open sky in the top fifth to judge');
  }
  if (off) fails.push(label + ': ' + off + ' of ' + n + ' open-sky pixels are not exactly the page grey rgb(' + grey.join(',') + ')');
  const counts = new Map();
  for (let y = Math.floor(0.8 * g.H * k); y < Math.floor(g.H * k); y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * img.width + x), key = img.data[i] + ',' + img.data[i + 1] + ',' + img.data[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const mode = [...counts.entries()].sort((p, q) => q[1] - p[1])[0];
  if (mode[0] !== grey.join(',')) fails.push(label + ': the floor between its lines is rgb(' + mode[0] + '), not the page grey rgb(' + grey.join(',') + ')');
  return { sky: n, floorShare: mode[1] / [...counts.values()].reduce((p, q) => p + q, 0) };
}
/* Bytes the JS heap allocates over `frames` clock steps: by `file`'s own
   functions (self), and by everything that runs under them (inclusive),
   sampled every `interval` bytes. */
async function allocations(s, file, frames, interval) {
  const cdp = await s.page.target().createCDPSession();
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: interval, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await K.step(s, frames);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  await cdp.detach();
  let self = 0, inclusive = 0;
  const where = new Map();
  (function walk(n, under) {
    const f = n.callFrame || {}, mine = !!f.url && f.url.endsWith(file);
    if (mine || under) inclusive += n.selfSize || 0;
    if (mine && n.selfSize) {
      self += n.selfSize;
      const k = f.functionName + ':' + (f.lineNumber + 1);
      where.set(k, (where.get(k) || 0) + n.selfSize);
    }
    for (const c of n.children || []) walk(c, mine || under);
  })(profile.head, false);
  return { self: self / frames, inclusive: inclusive / frames, where: [...where.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3) };
}
/* the main-thread time of one whole tick: the median over batches of 20
   (performance.now is coarsened to 0.1 ms, longer than a WebGL tick) */
function tickTimes(s, n) {
  return s.evaluate(k => {
    const t = [];
    for (let i = 0; i < k; i++) { const a = performance.now(); window.__clock.step(20, 16.7); t.push((performance.now() - a) / 20); }
    t.sort((p, q) => p - q);
    return t[t.length >> 1];
  }, n);
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-webgl-smoke: SKIP - ' + why); return; }
  const webglFile = path.join(B.ROOT, 'assets', 'js', 'bg', 'render-webgl.js');
  const src = fs.readFileSync(webglFile, 'utf8');
  const site = await B.serve();
  const b = await B.launch();
  const webglPath = new URL('assets/js/bg/render-webgl.js', site.url).pathname;
  try {
    /* 1 */
    for (const [label, w, h, dpr] of [['1440x900@1.5', 1440, 900, 1.5], ['390x844@3', 390, 844, 3]]) {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: w, height: h, dpr });
      try {
        const kind = await K.rendererOf(s);
        if (kind !== 'webgl2') fails.push(label + ': #cosmos has a ' + kind + ' context, not webgl2');
        const r = await looks(s, label);
        const c = await coat(s, r.a, r.grey, label);
        quiet(s, label, false);
        notes.push(label + ' ' + kind + ' ' + pct(r.drawn) + ' drawn, ' + pct(r.moving) + ' moving, ' + c.sky + ' sky px exact, floor ' + pct(c.floorShare) + ' exact grey');
      } finally { await s.close(); }
    }
    /* 2 */
    {
      const shots = {};
      for (const [name, init] of [['webgl2', K.CLOCK], ['webgl', K.CLOCK + '\n' + NO_WEBGL2]]) {
        const s = await b.open(site.url + 'index.html?bgq=0', { width: 720, height: 450, dpr: 1, init });
        try {
          const kind = await K.rendererOf(s);
          if (kind !== name) fails.push('WebGL 1 case: #cosmos has ' + kind + ', expected ' + name);
          await K.step(s, 30);
          await K.pointer(s, 80, 350);
          await K.step(s, 30);
          await K.hideCard(s);
          await sleep(200);
          shots[name] = B.decodePNG(await s.screenshot());
          quiet(s, name, false);
        } finally { await s.close(); }
      }
      const diff = B.changed(shots.webgl2, shots.webgl, 8);
      if (!(diff < 0.001)) fails.push('WebGL 1 draws ' + pct(diff) + ' of the pixels differently from WebGL 2 in the same scene state (limit 0.1%)');
      notes.push('WebGL 1 = WebGL 2 to ' + (100 * diff).toFixed(3) + '% of px');
    }
    /* 3, 4 */
    const anchor = 'float cover(float dist) { return';
    if (src.split(anchor).length !== 2) fails.push('cannot break a shader: render-webgl.js has no single "' + anchor + '"');
    for (const [label, routes, init] of [
      ['a shader that does not compile', { [webglPath]: { body: src.replace(anchor, 'float cover(float dist) { retrun'), contentType: 'text/javascript' } }, null],
      ['no WebGL', null, NO_WEBGL]]) {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5, routes, init });
      try {
        const dom = await s.evaluate(() => ({ n: document.querySelectorAll('canvas#cosmos').length, bg: document.documentElement.dataset.bg || null,
                                              canvas: getComputedStyle(document.getElementById('cosmos')).visibility }));
        if (dom.n !== 1 || dom.bg !== 'static' || dom.canvas !== 'hidden') fails.push(label + ': not the still picture: ' + JSON.stringify(dom));
        await looks(s, label, true);
        const warns = s.messages.filter(m => m.type === 'warn' || m.type === 'warning');
        if (warns.length !== 1) fails.push(label + ': ' + warns.length + ' console warnings (need exactly 1): ' + warns.map(m => m.text).join(' | '));
        quiet(s, label, true);
        notes.push(label + ': the still picture, warned once (' + (warns[0] ? JSON.stringify(warns[0].text.slice(0, 90)) : '-') + ')');
      } finally { await s.close(); }
    }
    /* 5 */
    const cost = {};
    for (const [name, q, file, warm, frames, interval] of [['webgl', '?bgq=0', 'render-webgl.js', 1200, 200, 32]]) {
      const s = await b.open(site.url + 'index.html' + q, { width: 480, height: 300, dpr: 1, init: K.CLOCK + '\n' + COUNT_DRAWS });
      try {
        await K.step(s, 10);
        await K.pointer(s, 60, 250);
        await K.step(s, 20);
        const d0 = await s.evaluate(() => window.__draws);
        await K.step(s, 10);
        const draws = (await s.evaluate(() => window.__draws) - d0) / 10;
        await s.evaluate(() => { window.__skip = true; });
        for (let k = 0; k < warm; k += 100) await K.step(s, 100);
        /* the best of up to WINDOWS windows (the header) */
        let al = null, windows = 0;
        while (windows < WINDOWS && !(al && al.self < 8)) {
          if (windows) await K.step(s, 200);
          const a = await allocations(s, file, frames, interval);
          windows++;
          if (!al || a.self < al.self) al = a;
        }
        const ms = await tickTimes(s, 6);
        cost[name] = { draws, al, ms, windows };
        quiet(s, 'frame cost (' + name + ')', false);
      } finally { await s.close(); }
    }
    if (!(cost.webgl.draws <= 8 && cost.webgl.draws >= 7)) fails.push('a WebGL frame makes ' + cost.webgl.draws + ' draw calls (expected 7-8)');
    if (!(cost.webgl.al.self < 8)) {
      fails.push('render-webgl.js allocates ' + cost.webgl.al.self.toFixed(0) + ' bytes a frame itself, warmed up, in the best of '
                 + cost.webgl.windows + ' windows (' + cost.webgl.al.where.map(([k, v]) => k + ' ' + v).join(', ') + ')');
    }
    notes.push('a frame: ' + cost.webgl.draws + ' draw calls; allocated by render-webgl.js ' + cost.webgl.al.self.toFixed(0) + ' B'
               + (cost.webgl.windows > 1 ? ' (best of ' + cost.webgl.windows + ' windows)' : '') + ', under it '
               + cost.webgl.al.inclusive.toFixed(0) + ' B (the scene\'s sunAt/bodiesAt); JS per tick ' + cost.webgl.ms.toFixed(3) + ' ms');
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-webgl-smoke: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-webgl-smoke: OK - ' + notes.join('; '));
}
main().catch(e => { console.log('check-webgl-smoke: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
