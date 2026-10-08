'use strict';
/* The WebGL renderer survives losing its context (audit F43).

   A GPU reset, a driver update, a switch between GPUs or a resume from
   sleep takes a WebGL context away; if nothing calls preventDefault on
   webglcontextlost it never comes back, and a renderer that keeps calling
   GL meanwhile, or does not rebuild its programs and buffers when it
   returns, leaves the background blank or broken for the rest of the visit.

   Headless Chrome (browser.js), the page at 1440x900@1.5 (?bgq=0: the
   quality governor's top level held), the card hidden,
   the context taken away with WEBGL_lose_context.loseContext() and given
   back with restoreContext():

     running   while it is lost, frames go on (no error, nothing on the
               console); once it is back, the background draws again (over
               5% of the viewport off the page grey), it animates (over 1%
               of the pixels change in a second), and its open sky (the top
               fifth wherever nothing is drawn within 6 px, glkit.openSky,
               read with the motion then paused) is exactly the page grey
               again
     paused    (prefers-reduced-motion) the page asks for no frames, so the
               still frame must be painted again by itself when the context
               returns (main.js's listener, after the renderer's own has
               rebuilt everything): the same picture as before the loss
               (under 0.1% of the pixels changed), not a blank canvas

     for good  (W3) lost and not given back: once main.js's grace (LOST_MS,
               3s) is over, and not before, the still picture in the
               canvas's place - data-bg="static", the canvas hidden, the
               motion toggle gone, assets/img/bg-still.webp showing (over 5%
               of the viewport off the page grey with the card hidden);
               given back after all, the animation again: data-bg gone, the
               canvas drawing and moving, the toggle back

   The timing of "for good" is judged by events, in the page's own clock,
   not by sleeping a fixed time and looking once: under load a fixed wait
   made it fail while the page was right (the final review: in a run-all
   beside three others, the picture not yet painted 600 ms after the
   grace). The page records when the context was lost and when data-bg
   became static, and the check waits (up to WAIT_MS) for both; the switch
   must come no sooner than LOST_MS after the loss (which the old check
   never asked: main.js with no grace passed it), and no later than
   LATE_MS after it plus however late a timer of LOST_MS set at the same
   loss fired (a sentinel: 1-10 ms on a quiet machine, so the bound is the
   3.6 s this check always allowed, and on a busy one the machine's own
   delay, not the page's). The picture is then waited for as a resource,
   fetched and painted (glkit.stillPicture), not for a fixed time: with
   1.5 s of network latency on its fetch the old check failed ("does not
   show, 0.0% off the page grey"), the page right all along. LOST_MS is
   this check's, the grace README "The WebGL renderer" gives, not read
   from main.js: a grace changed there must fail here (none, or 5 s, does).

   restoreContext only works if the renderer called preventDefault on the
   loss, so a missing preventDefault fails both. Each load: no console
   message at all, no page error. SKIP when puppeteer-core or Chrome is
   missing. Exit 1 on failure. */
const B = require('./browser');
const K = require('./glkit');

const DRAWN = 0.05, MOVING = 0.01, SAME = 0.001, TOL = 12;
/* for good (the header): main.js's grace for a lost context; the switch to
   the still picture no later than LATE_MS past it, plus the sentinel's
   lateness; WAIT_MS the most this check waits for it */
const LOST_MS = 3000, LATE_MS = 600, WAIT_MS = 30000;
const fails = [], notes = [];
const pct = v => (100 * v).toFixed(1) + '%';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* take #cosmos's context away (lose) or give it back (restore); resolves
   once the matching event has fired, or says what went wrong. A loss is
   stamped in the page's clock (lostAt), and starts the sentinel: a timer
   of the grace, set in the same dispatch as main.js's own (its listener
   runs first), whose lateness is the machine's (the header) */
function context(s, what) {
  return s.evaluate(async (w, grace) => {
    const c = document.getElementById('cosmos');
    if (!window.__ctx) {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'no WebGL context on #cosmos';
      window.__ctx = { gl, ext: gl.getExtension('WEBGL_lose_context'), lost: 0, restored: 0, lostAt: 0, sentinel: 0 };
      if (!window.__ctx.ext) return 'no WEBGL_lose_context';
      c.addEventListener('webglcontextlost', () => {
        const x = window.__ctx;
        x.lost++; x.lostAt = performance.now(); x.sentinel = 0;
        setTimeout(() => { x.sentinel = performance.now(); }, grace);
      });
      c.addEventListener('webglcontextrestored', () => { window.__ctx.restored++; });
    }
    const x = window.__ctx, key = w === 'lose' ? 'lost' : 'restored', before = x[key];
    try {
      if (w === 'lose') x.ext.loseContext(); else x.ext.restoreContext();
    } catch (e) { return w + 'Context threw: ' + e.message; }
    for (let i = 0; i < 100 && x[key] === before; i++) await new Promise(r => setTimeout(r, 20));
    if (x[key] === before) return 'no webglcontext' + key + ' event after ' + w + 'Context()';
    if (w === 'lose' && !x.gl.isContextLost()) return 'the context is not lost after loseContext()';
    if (w === 'restore' && x.gl.isContextLost()) return 'the context is still lost after restoreContext()';
    return null;
  }, what, LOST_MS);
}
async function shot(s) { await s.frames(2); return B.decodePNG(await s.screenshot()); }
/* the open sky of the top fifth against the page grey, with the motion
   paused: [pixels off it, pixels judged] */
async function skyExact(s, grey) {
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true } })));
  await s.frames(3);
  const img = B.decodePNG(await s.screenshot()), sky = await K.openSky(s, 6);
  if (!sky) return [-1, 0];
  let off = 0, n = 0;
  for (let y = 0; y < Math.floor(0.2 * sky.h); y++) {
    for (let x = 0; x < sky.w; x++) {
      if (!sky.at(x, y)) continue;
      const i = 4 * (y * img.width + x);
      n++;
      if (img.data[i] !== grey[0] || img.data[i + 1] !== grey[1] || img.data[i + 2] !== grey[2]) off++;
    }
  }
  return [off, n];
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-webgl-context: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  try {
    /* running */
    {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5 });
      try {
        await s.frames(5);
        if ((await K.rendererOf(s)) !== 'webgl2') fails.push('running: the page did not start with WebGL 2');
        await K.hideCard(s);
        const grey = await K.pageGrey(s);
        let e = await context(s, 'lose');
        if (e) fails.push('running: ' + e);
        const t0 = Date.now();
        await sleep(600);
        const during = await s.evaluate(() => new Promise(r => { let n = 0; const f = () => (++n >= 5 ? r(n) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
        if (during !== 5) fails.push('running: frames stopped while the context was lost');
        /* lost from the loss until restoreContext is called (the note used
           to time the whole case, back and drawing included, as "lost") */
        const lostFor = Date.now() - t0;
        e = await context(s, 'restore');
        if (e) fails.push('running: ' + e);
        await s.frames(5);
        const a = await shot(s);
        await sleep(1000);
        const z = await shot(s);
        const drawn = B.offColour(a, grey, TOL), moving = B.changed(a, z, TOL), [off, nSky] = await skyExact(s, grey);
        if (!(drawn > DRAWN)) fails.push('running: after the context came back the background did not draw (' + pct(drawn) + ')');
        if (!(moving > MOVING)) fails.push('running: after the context came back it is not animating (' + pct(moving) + ' changed in 1s)');
        if (off) fails.push('running: after the context came back ' + (off < 0 ? 'there is no open sky to read' : off + ' of ' + nSky + ' open-sky pixels are not the page grey'));
        if (!(nSky > 100000)) fails.push('running: only ' + nSky + ' px of open sky to judge');
        /* the open-sky probe's readPixels makes SwiftShader say it stalled: the test's own doing */
        for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push('running: console ' + m.type + ': ' + m.text);
        for (const x of s.errors) if (x.type !== 'error') fails.push('running: ' + x.type + ': ' + x.text);
        notes.push('running: lost for ' + lostFor + 'ms with frames going on, back drawing ' + pct(drawn) + ', ' + pct(moving) + ' moving in 1s');
      } finally { await s.close(); }
    }
    /* paused */
    {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5, media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await s.frames(5);
        await K.hideCard(s);
        const grey = await K.pageGrey(s);
        const a = await shot(s);
        let e = await context(s, 'lose');
        if (e) fails.push('paused: ' + e);
        await sleep(300);
        e = await context(s, 'restore');
        if (e) fails.push('paused: ' + e);
        await s.frames(5);
        const z = await shot(s);
        const drawn = B.offColour(z, grey, TOL), same = B.changed(a, z, TOL);
        if (!(drawn > DRAWN)) fails.push('paused: after the context came back the still frame was not painted (' + pct(drawn) + ' drawn)');
        if (!(same < SAME)) fails.push('paused: the still frame after the loss differs from the one before (' + pct(same) + ' of the pixels)');
        for (const m of s.messages) fails.push('paused: console ' + m.type + ': ' + m.text);
        for (const x of s.errors) if (x.type !== 'error') fails.push('paused: ' + x.type + ': ' + x.text);
        notes.push('paused: the still frame painted again by itself (' + pct(drawn) + ' drawn, ' + (100 * same).toFixed(3) + '% different from before)');
      } finally { await s.close(); }
    }
    /* for good, then back after all */
    {
      const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5 });
      try {
        await s.frames(5);
        await K.hideCard(s);
        const grey = await K.pageGrey(s);
        const state = () => s.evaluate(() => {
          const m = document.getElementById('motion');
          return { bg: document.documentElement.dataset.bg || null, canvas: getComputedStyle(document.getElementById('cosmos')).visibility,
                   toggle: m ? getComputedStyle(m).display : 'missing' };
        });
        /* when data-bg becomes static, in the page's clock */
        await s.evaluate(() => {
          window.__static = 0;
          new MutationObserver(() => { if (!window.__static && document.documentElement.dataset.bg === 'static') window.__static = performance.now(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-bg'] });
        });
        let e = await context(s, 'lose');
        if (e) fails.push('for good: ' + e);
        /* the switch and the sentinel, waited for (the header) */
        const t = await s.evaluate(async wait => {
          const t0 = performance.now();
          while (!(window.__static && window.__ctx.sentinel) && performance.now() - t0 < wait) await new Promise(r => setTimeout(r, 50));
          return { lostAt: window.__ctx.lostAt, at: window.__static, sentinel: window.__ctx.sentinel };
        }, WAIT_MS);
        const gone = await state();
        const after = t.at - t.lostAt, late = t.sentinel ? Math.max(0, t.sentinel - t.lostAt - LOST_MS) : 0;
        if (!t.at) fails.push('for good: ' + WAIT_MS / 1000 + 's after the loss data-bg is ' + JSON.stringify(gone.bg) + ', not static: no still picture');
        else {
          if (after < LOST_MS - 5) fails.push('for good: the page went to the still picture ' + after.toFixed(0) + 'ms after the loss, before main.js\'s grace (' + LOST_MS + 'ms) was over');
          if (after > LOST_MS + LATE_MS + late) {
            fails.push('for good: the page went to the still picture ' + after.toFixed(0) + 'ms after the loss, over ' + LATE_MS + 'ms past the grace ('
                       + LOST_MS + 'ms) and the machine\'s own delay (a timer of the grace set at the loss came ' + late.toFixed(0) + 'ms late)');
          }
          if (gone.bg !== 'static' || gone.canvas !== 'hidden' || gone.toggle !== 'none') {
            fails.push('for good: data-bg static, the page is ' + JSON.stringify(gone) + ', not the still picture (bg static, canvas hidden, no toggle)');
          }
        }
        const pic = await K.stillPicture(s, grey, DRAWN, TOL);
        const picture = pic.shown;
        if (!(picture > DRAWN)) {
          fails.push('for good: the still picture does not show (' + pct(picture) + ' off the page grey ' + (pic.waited / 1000).toFixed(1) + 's on, fetched '
                     + pic.fetched.length + 'x)');
        }
        e = await context(s, 'restore');
        if (e) fails.push('for good, then back: ' + e);
        await s.frames(5);
        const back = await state();
        const a = await shot(s);
        await sleep(1000);
        const z = await shot(s);
        const moving = B.changed(a, z, TOL);
        if (back.bg !== null || back.canvas !== 'visible' || back.toggle === 'none') fails.push('back after all: the page is ' + JSON.stringify(back));
        if (!(moving > MOVING)) fails.push('back after all: not animating (' + pct(moving) + ' changed in 1s)');
        for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push('for good: console ' + m.type + ': ' + m.text);
        for (const x of s.errors) if (x.type !== 'error') fails.push('for good: ' + x.type + ': ' + x.text);
        notes.push('for good: the still picture after the grace (data-bg static ' + after.toFixed(0) + 'ms after the loss, the grace '
                   + LOST_MS + 'ms, a timer of it ' + late.toFixed(0) + 'ms late; ' + pct(picture) + ' off the page grey, the toggle gone), and back after all '
                   + pct(moving) + ' moving in 1s with the toggle back');
      } finally { await s.close(); }
    }
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-webgl-context: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-webgl-context: OK - 1440x900@1.5, the context lost and restored: ' + notes.join('; ') + '; nothing on the console');
}
main().catch(e => { console.log('check-webgl-context: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
