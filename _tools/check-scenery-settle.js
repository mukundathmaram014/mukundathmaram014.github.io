'use strict';
/* The scenery's meshes are built again for a new size at once, but no more
   than once every REBUILD_MS while a window is dragged, the meshes it has
   fitted to the sizes in between (render-webgl.js scenery and FIT_GLSL).
   It used to wait for a size to hold SETTLE_MS (150 ms), drawing the old
   layout in the new box meanwhile, and then the mountains and the trees
   jumped a second time, as far as the resize had moved everything else
   (the final QA lens: one resize, two adjustments). Before that it built
   at every size, and a build took 12-26 ms of JS in every frame of a drag
   (the W2b review).

   Node, through the harness (the real background scripts, the WebGL
   renderer on its recording stub), counting the renderer's calls of
   sceneryMesh and reading the massif draw's vertex count and the uFit
   uniform off the recorded calls:

     at once    the first frame builds the scenery (1 build), and nothing
                is built again while the size stays put
     one        one resize: the frame after it builds once and draws the
                massif vertices sceneryMesh makes at the new size, unfitted
                (uFit 0), and nothing is built after it
     dragged    a window resized in every one of DRAG frames: builds no two
                less than REBUILD_MS apart, and at least one every
                REBUILD_MS and a frame; every frame in between draws the
                meshes it has with uFit the ratio of its size to theirs
                (W, H, S and SW, less 1)
     settled    the size the drag ended at is built within REBUILD_MS and
                a frame of the last build, drawn unfitted the frame after,
                and nothing after that
     paused     a paused page (the motion pause: one still frame per
                change) resized once builds in that still frame and asks
                for no other; dragged, it builds as above, and once the
                wait is over asks for a frame of its own (main.js passes the
                renderer its wake), which builds the size it ended at
     cost       each frame's JS during the drag, against the same drag
                with the scenery built for every new size, reported

   Headless Chrome (browser.js; SKIP without it), the page's frames driven
   by the test (glkit's clock) with no time passing, so the scene stands
   still and two frames differ only where the resize changed something:

     one change   the viewport resized once, 1280x720 to 1440x900, and
                  frames drawn for well over REBUILD_MS (and the old
                  SETTLE_MS) after it: exactly one significant change from
                  one frame to the next - the resize itself - where waiting
                  for the size to hold made a second one when the scenery
                  was rebuilt (more than CHANGE_SHARE of the px by more than
                  CHANGE_LEVELS)
     fitted       a drag of DRAG_STEPS sizes inside one task, so no wait can
                  end on the way and every frame after the first is drawn
                  fitted: the last against the frame that builds the same
                  size once the wait is over, in the gutters beside the card,
                  as 8x8 px block means - the layout, not the facets' fine
                  detail, which the build redraws: no block mean more than
                  FIT_LEVELS off on average. Unfitted, the meshes built for
                  the size the drag began at are drawn where they stood in
                  the new box.

   SKIP on a root whose renderer has no REBUILD_MS (before this). Exit 1 on
   failure. */
const H = require('./harness');
const B = require('./browser');
const K = require('./glkit');
const Twin = require('./scenery-twin');

const W0 = 1440, H0 = 900, DRAG = 60, STEP = [7, 3], DT = 16.7;
const CHANGE_SHARE = 0.0005, CHANGE_LEVELS = 8, DRAG_STEPS = 12, FIT_LEVELS = 2;
const COUNT = ['  function sceneryMesh() {', '  function sceneryMesh() { (window.__built || (window.__built = [])).push(window.performance.now());'];
const fails = [];
const fail = m => fails.push(m);
const median = a => { const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
const load = extra => H.load(Object.assign({ W: W0, H: H0, dpr: 1.5, now: 1000, search: '?bgq=0', patches: [COUNT] }, extra || {}));
const builds = sim => (sim.window.__built || []).length;
/* the massif vertices sceneryMesh makes at a size, in a page of its own */
const massifCache = new Map();
function massifAt(w, h) {
  const k = w + 'x' + h;
  if (!massifCache.has(k)) massifCache.set(k, H.load({ W: w, H: h, dpr: 1.5, now: 1000, search: '?bgq=0' }).window.Bg.renderers.webgl.sceneryMesh().massif.length / Twin.MF);
  return massifCache.get(k);
}
/* one frame: the triangle draws' vertex counts and the first uFit uploaded */
function frame(sim) {
  const tris = [];
  let fit = null;
  sim.setRecord(r => {
    if (r.op === 'drawArrays' && r.args[0] === 4) tris.push(r.args[2]);
    else if (fit === null && r.op === 'uniform4fv' && r.args[0] && r.args[0].name === 'uFit') fit = r.args[1];
  });
  sim.frame(DT);
  sim.setRecord(null);
  return { tris, fit };
}
const unfitted = f => !!f.fit && f.fit.every(v => v === 0);
/* uFit as the renderer should upload it for a frame at sim's size over meshes built at b */
function fitFor(sim, b) {
  const Bg = sim.window.Bg;
  return [Bg.W / b.W - 1, Bg.H / b.H - 1, Bg.S / b.S - 1, Bg.SW / b.SW - 1];
}
const sizeOf = sim => { const Bg = sim.window.Bg; return { W: Bg.W, H: Bg.H, S: Bg.S, SW: Bg.SW }; };
const near32 = (a, b) => !!a && a.length === 4 && a.every((v, i) => Math.abs(v - b[i]) <= 1e-6 * Math.max(1, Math.abs(b[i])));

function nodeHalf(REBUILD, res) {
  /* at once */
  const sim = load();
  frame(sim);
  if (builds(sim) !== 1) fail('the first frame built the scenery ' + builds(sim) + ' times (want 1)');
  for (let i = 0; i < 30; i++) frame(sim);
  if (builds(sim) !== 1) fail('30 frames at one size built the scenery ' + builds(sim) + ' times (want 1)');
  /* one resize */
  {
    const w = 1280, h = 800, want = massifAt(w, h);
    sim.resize(w, h);
    const f = frame(sim);
    if (builds(sim) !== 2) fail('one resize: the frame after it built the scenery ' + (builds(sim) - 1) + ' times (want 1: at once)');
    if (!f.tris.includes(want)) fail('one resize: the frame after it does not draw the ' + want + ' massif vertices of ' + w + 'x' + h + ' (draws: ' + f.tris.join(', ') + ')');
    if (!unfitted(f)) fail('one resize: the frame after it draws meshes fitted to its size (uFit ' + JSON.stringify(f.fit) + '), not built for it');
    for (let i = 0; i < 15; i++) frame(sim);
    if (builds(sim) !== 2) fail('one resize: the scenery was built ' + (builds(sim) - 2) + ' more times after it (want 0: one resize, one adjustment)');
    res.one = w + 'x' + h + ', ' + want + ' massif vertices drawn in the frame after it';
  }
  /* dragged, then settled */
  {
    const times = [], at = [];
    let last = sizeOf(sim), wrong = 0, firstWrong = '';
    const n0 = builds(sim);
    for (let i = 1; i <= DRAG; i++) {
      sim.resize(1280 + STEP[0] * i, 800 + STEP[1] * i);
      const before = builds(sim), t0 = process.hrtime.bigint();
      const f = frame(sim);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (builds(sim) > before) {
        at.push(sim.window.__built[sim.window.__built.length - 1]);
        last = sizeOf(sim);
        if (!unfitted(f)) { wrong++; firstWrong = firstWrong || 'frame ' + i + ' built its size and drew it fitted (uFit ' + JSON.stringify(f.fit) + ')'; }
      } else if (!near32(f.fit, fitFor(sim, last))) {
        wrong++;
        firstWrong = firstWrong || 'frame ' + i + ': uFit ' + JSON.stringify(f.fit) + ', want ' + JSON.stringify(fitFor(sim, last).map(v => +v.toFixed(6)));
      }
    }
    const nb = builds(sim) - n0, gaps = at.slice(1).map((t, i) => t - at[i]);
    const lo = Math.floor((DRAG * DT) / (REBUILD + DT)), hi = Math.ceil((DRAG * DT) / REBUILD) + 1;
    if (nb < lo || nb > hi) fail('a ' + DRAG + '-frame drag built the scenery ' + nb + ' times (want ' + lo + '-' + hi + ': once every ' + REBUILD + ' ms and a frame at most)');
    if (gaps.length && Math.min(...gaps) < REBUILD) fail('a drag built the scenery twice ' + Math.min(...gaps).toFixed(1) + ' ms apart (want at least ' + REBUILD + ')');
    if (gaps.length && Math.max(...gaps) > REBUILD + DT + 1e-6) fail('a drag went ' + Math.max(...gaps).toFixed(1) + ' ms between builds (want at most ' + REBUILD + ' ms and a frame)');
    if (wrong) fail('a drag drew ' + wrong + ' frames unfitted to their size (' + firstWrong + ')');
    res.drag = times; res.dragBuilds = nb; res.gaps = gaps;
    const end = sizeOf(sim), want = massifAt(end.W, end.H), nAfter = builds(sim);
    let f = null;
    for (let k = 0; k < 20 && builds(sim) === nAfter; k++) f = frame(sim);
    if (builds(sim) !== nAfter + 1) fail('after the drag, the size it ended at was built ' + (builds(sim) - nAfter) + ' times (want 1)');
    else {
      const ms = sim.window.__built[sim.window.__built.length - 1] - at[at.length - 1];
      if (ms > REBUILD + DT + 1e-6) fail('after the drag, the size it ended at was built ' + ms.toFixed(1) + ' ms after the last build of the drag (want at most ' + REBUILD + ' ms and a frame)');
      if (!f.tris.includes(want) || !unfitted(f)) fail('after the drag, the frame that built ' + end.W + 'x' + end.H + ' does not draw its ' + want + ' massif vertices unfitted (draws ' + f.tris.join(', ') + ', uFit ' + JSON.stringify(f.fit) + ')');
      res.settled = end.W + 'x' + end.H + ' built ' + ms.toFixed(0) + ' ms after the drag\'s last build';
    }
    for (let i = 0; i < 15; i++) frame(sim);
    if (builds(sim) !== nAfter + 1) fail('after the drag, the scenery was built again (' + (builds(sim) - nAfter - 1) + ' more times)');
  }
  /* paused: the page's own frames (starter kept), a still frame per change */
  {
    const sim = load({ starter: 'keep', motion: 'paused' });
    for (let i = 0; i < 3; i++) sim.frame(DT);
    if (builds(sim) !== 1) fail('a paused page built the scenery ' + builds(sim) + ' times for its still frame (want 1)');
    sim.resize(1280, 800);
    const f1 = frame(sim);
    if (builds(sim) !== 2 || !f1.tris.includes(massifAt(1280, 800))) fail('a paused page resized once did not build the new size in the still frame it painted (' + (builds(sim) - 1) + ' builds, draws ' + f1.tris.join(', ') + ')');
    const asked = sim.rafRequests;
    sim.idle(400);
    if (sim.rafRequests !== asked) fail('a paused page resized once asked for another frame after its still frame (its scenery was built in it)');
    for (let i = 0; i < 5; i++) sim.frame(DT);
    if (builds(sim) !== 2) fail('a paused page resized once built the scenery again after (' + (builds(sim) - 2) + ' more times)');
    const n0 = builds(sim), N = 10;
    for (let i = 1; i <= N; i++) { sim.resize(1280 - STEP[0] * i, 800 - STEP[1] * i); sim.frame(DT); }
    const during = builds(sim) - n0, top = Math.ceil((N * DT) / REBUILD) + 1;
    if (during < 1 || during > top) fail('a paused page dragged built the scenery ' + during + ' times (want 1-' + top + ')');
    const asked2 = sim.rafRequests;
    sim.idle(400);
    if (!(sim.rafRequests > asked2)) fail('a paused page did not ask for a frame once its drag\'s wait was over, so it kept its meshes fitted');
    const w = 1280 - STEP[0] * N, h = 800 - STEP[1] * N, fEnd = frame(sim);
    if (builds(sim) !== n0 + during + 1 || !fEnd.tris.includes(massifAt(w, h)) || !unfitted(fEnd)) {
      fail('the paused page\'s frame after its drag\'s wait does not build and draw ' + w + 'x' + h + ' (' + (builds(sim) - n0 - during) + ' builds, draws ' + fEnd.tris.join(', ') + ')');
    }
    sim.frame(DT);
    if (builds(sim) !== n0 + during + 1) fail('the paused page built the scenery again after that');
    res.paused = during;
  }
  /* cost: the same drag with a build for every new size, as before SETTLE_MS */
  {
    const sim = load({ patches: [COUNT, ['      if (massifBuf && !now && rebuildTimer) {', '      if (false) {']] });
    for (let i = 0; i < 31; i++) sim.frame(DT);
    const times = [];
    for (let i = 1; i <= DRAG; i++) {
      sim.resize(1280 + STEP[0] * i, 800 + STEP[1] * i);
      const t0 = process.hrtime.bigint();
      sim.frame(DT);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    res.old = times; res.oldBuilds = builds(sim) - 1;
  }
}

/* n frames with no time passing (glkit's step makes a dt of 0 its 16.7) */
const still = (s, n) => s.evaluate(k => window.__clock.step(k, 0), n);
/* in the page: the canvas as it stands (read in the task that drew it) */
const GRAB = `window.__grab = () => {
  const c = document.getElementById('cosmos'), t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const g = t.getContext('2d');
  g.drawImage(c, 0, 0);
  return g.getImageData(0, 0, t.width, t.height);
};`;
async function browserHalf(res) {
  const why = B.unavailable();
  if (why) { res.browser = 'SKIP - ' + why; return; }
  const site = await B.serve();
  const b = await B.launch();
  try {
    /* one change: a real resize of the viewport, then frames for well over REBUILD_MS */
    {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1280, height: 720, dpr: 1, init: K.CLOCK });
      try {
        await K.step(s, 30, DT);
        await still(s, 2);
        await s.page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await s.evaluate(() => new Promise(r => window.__clock.real(() => window.__clock.real(r))));
        const shots = [], t0 = Date.now();
        while (shots.length < 6 || Date.now() - t0 < 900) {
          await still(s, 1);
          shots.push(B.decodePNG(await s.screenshot()));
          await new Promise(r => setTimeout(r, 30));
        }
        const W1 = await s.evaluate(() => [window.Bg.W, document.getElementById('cosmos').getBoundingClientRect().width]);
        if (!(W1[0] > 1400 && W1[0] === W1[1])) fail('one change: the background did not take the new size (Bg.W ' + W1[0] + ', the canvas ' + W1[1] + ' px wide)');
        const steps = shots.slice(1).map((p, i) => B.changed(shots[i], p, CHANGE_LEVELS));
        const later = steps.map((v, i) => [v, i + 1]).filter(([v]) => v > CHANGE_SHARE);
        if (later.length) {
          fail('one resize (1280x720 to 1440x900): ' + (1 + later.length) + ' significant changes from one frame to the next (want 1, the resize itself); again at frame '
               + later.map(([v, i]) => i + ' (' + (100 * v).toFixed(2) + '% of the px)').join(', '));
        }
        res.oneChange = shots.length + ' frames over ' + (Date.now() - t0) + ' ms after it, none of them changed from the one before (at most '
                        + (100 * Math.max(...steps)).toFixed(3) + '% of the px)';
        for (const e of s.errors) fail('one change: ' + e.type + ': ' + e.text);
      } finally { await s.close(); }
    }
    /* fitted: a drag inside one task, then the frame that builds its last size */
    {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1, init: K.CLOCK });
      try {
        await K.step(s, 30, DT);
        await still(s, 2);
        await s.evaluate(GRAB);
        await new Promise(r => setTimeout(r, 300));
        const drag = await s.evaluate(n => {
          const c = document.getElementById('cosmos');
          for (let i = 1; i <= n; i++) {
            c.style.width = (1440 - 20 * i) + 'px'; c.style.height = (900 - 12 * i) + 'px';
            window.dispatchEvent(new Event('resize'));
            window.__clock.step(1, 0);
          }
          window.__fitted = window.__grab();
          return { W: window.Bg.W, H: window.Bg.H };
        }, DRAG_STEPS);
        await new Promise(r => setTimeout(r, 300));
        const m = await s.evaluate(() => {
          window.__clock.step(1, 0);
          const now = window.__grab(), was = window.__fitted, w = now.width, h = now.height;
          if (w !== was.width || h !== was.height) return { error: 'the canvas changed size (' + was.width + 'x' + was.height + ' then ' + w + 'x' + h + ')' };
          const card = document.querySelector('.shell').getBoundingClientRect(), k = w / window.Bg.W, N = 8;
          const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          let sum = 0, n = 0, worst = 0, exact = true;
          for (let by = 0; by + N <= h; by += N) {
            for (let bx = 0; bx + N <= w; bx += N) {
              const cx = (bx + N / 2) / k;
              if (cx > card.left - 16 && cx < card.right + 16) continue;
              let a = 0, z = 0;
              for (let y = by; y < by + N; y++) for (let x = bx; x < bx + N; x++) { const i = 4 * (y * w + x); a += lum(now.data, i); z += lum(was.data, i); if (now.data[i] !== was.data[i]) exact = false; }
              const d = Math.abs(a - z) / (N * N);
              sum += d; n++; worst = Math.max(worst, d);
            }
          }
          return { mean: sum / n, worst, blocks: n, exact };
        });
        if (m.error) fail('fitted: ' + m.error);
        else {
          if (m.exact) fail('fitted: the drag\'s last frame is the build of its size to the bit, so nothing was fitted (the test tests nothing)');
          if (!(m.mean <= FIT_LEVELS)) {
            fail('fitted: after a drag of ' + DRAG_STEPS + ' sizes to ' + drag.W + 'x' + drag.H + ', the meshes drawn are ' + m.mean.toFixed(2) + ' levels off the build of that size on average, in '
                 + m.blocks + ' blocks of 8x8 px beside the card (limit ' + FIT_LEVELS + '; worst block ' + m.worst.toFixed(1) + '): the old layout in the new box');
          }
          res.fitted = 'a drag to ' + drag.W + 'x' + drag.H + ' drawn fitted ' + m.mean.toFixed(2) + ' levels off its build on average (' + m.blocks + ' 8x8 blocks beside the card, worst ' + m.worst.toFixed(1) + ')';
        }
        for (const e of s.errors) fail('fitted: ' + e.type + ': ' + e.text);
      } finally { await s.close(); }
    }
  } finally {
    await b.close();
    await site.close();
  }
}

async function main() {
  let REBUILD;
  try { REBUILD = H.rendererNumbers(['REBUILD_MS']).REBUILD_MS; }
  catch (e) {
    console.log('check-scenery-settle: SKIP - ' + H.ROOT + ' has no REBUILD_MS: its renderer builds the scenery for every size, or once a size has held');
    return;
  }
  const res = {};
  nodeHalf(REBUILD, res);
  await browserHalf(res);
  if (fails.length) {
    console.log('check-scenery-settle: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-scenery-settle: OK - built at the first frame and not again at one size; one resize built at once (' + res.one + ') and never again; a '
              + DRAG + '-frame drag built ' + res.dragBuilds + ' times, ' + Math.min(...res.gaps).toFixed(0) + '-' + Math.max(...res.gaps).toFixed(0) + ' ms apart, every frame in between fitted to its size, and '
              + res.settled + '; paused, one resize built in its still frame, a drag ' + res.paused + ' times and once more in the frame it asked for after;'
              + ' a frame of the drag ' + median(res.drag).toFixed(2) + ' ms median, ' + Math.max(...res.drag).toFixed(2) + ' ms at most, where building for every new size ('
              + res.oldBuilds + ' builds) took ' + median(res.old).toFixed(2) + ' ms median, ' + Math.max(...res.old).toFixed(2) + ' ms at most (the harness; JS only); '
              + (res.browser || 'in Chrome, one resize is one change: ' + res.oneChange + '; ' + res.fitted));
}
main().catch(e => { console.log('check-scenery-settle: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
