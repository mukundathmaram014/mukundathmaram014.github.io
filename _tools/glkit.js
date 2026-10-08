'use strict';
/* Shared by the browser checks (check-webgl-*.js, check-wave-parity.js,
   check-occluder.js): a page whose frames the test drives, so two pages -
   WebGL 1 and WebGL 2, or the page with and without a change - can be put
   in exactly the same scene state and compared pixel for pixel.

     const K = require('./glkit');
     const s = await b.open(url, { width, height, dpr, init: K.CLOCK });
     await K.step(s, 60);                 60 frames of 16.7 ms, in the page
     await K.pointer(s, 300, 700);        a pointermove at CSS (300, 700)
     await K.hideCard(s);                 the card off (the scene behind it: main.js
                                          sees it go and draws no card depth there
                                          from its next frame)
     const sky = await K.openSky(s, 3);   which device px have nothing drawn on them,
                                          nor within 3 px: { w, h, at(x, y) }
     const p = await K.stillPicture(s, grey, 0.05, 12);
                                          the still picture fetched, then shown (over 5%
                                          of the viewport off the page grey): { fetched,
                                          shown, waited } (check-still, check-webgl-context)

   CLOCK replaces window.requestAnimationFrame before the page's scripts run:
   callbacks queue up and run only when the test calls step, each with a
   timestamp that moves on by exactly dt. The scene (scene.js) is
   deterministic in its inputs - the frame times, the pointer and the size -
   so the same steps give the same scene, bit for bit, in every page. The
   real requestAnimationFrame stays reachable as __clock.real (the browser
   keeps compositing; screenshots show the last frame drawn). */

const CLOCK = `(() => {
  const real = window.requestAnimationFrame.bind(window);
  const queue = [];
  let now = 0;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__clock = {
    real,
    step(n, dt) {
      for (let k = 0; k < n; k++) {
        now += dt;
        const due = queue.splice(0);
        for (const cb of due) cb(now);
      }
      return now;
    },
    pending() { return queue.length; }
  };
})();`;

/* n frames of dt ms; resolves with the clock's time after them */
function step(s, n, dt) {
  return s.evaluate((k, ms) => window.__clock.step(k, ms), n, dt || 16.7);
}
/* a pointermove at CSS px (x, y), as main.js listens for it */
function pointer(s, x, y) {
  return s.evaluate((px, py) => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py, pointerType: 'mouse', isPrimary: true }));
  }, x, y);
}
function hideCard(s) {
  return s.evaluate(() => { const c = document.querySelector('.shell'); if (c) c.style.visibility = 'hidden'; });
}
/* the page grey, from the body's computed background */
async function pageGrey(s) {
  const grey = await s.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(grey);
  if (!m) throw new Error('cannot read the page grey (body background ' + grey + ')');
  return [+m[1], +m[2], +m[3]];
}
/* which kind of context the page's #cosmos ended up with */
function rendererOf(s) {
  return s.evaluate(() => {
    const c = document.getElementById('cosmos');
    if (!c) return 'none';
    if (c.getContext('webgl2')) return 'webgl2';
    if (c.getContext('webgl')) return 'webgl';
    return 'none';
  });
}

/* The open sky: the device pixels of #cosmos that nothing is drawn on -
   no sun, cloud, ridge, peak, tree, conifer or floor - nor anything within
   r px of them (their anti-aliasing), from a WebGL renderer of the page's
   own scene on a canvas of its own (renderer.probeIds: what each pixel
   shows), so a check can hold the background's empty sky to the page
   grey exactly however much scenery stands in it. The scene must be still
   (a paused page, or the clock not stepped) between the screenshot and
   this. Null without a WebGL renderer. */
async function openSky(s, r) {
  const got = await s.evaluate(rad => {
    const Bg = window.Bg;
    if (!window.__skyProbe) window.__skyProbe = Bg.renderers.webgl && Bg.renderers.webgl(document.createElement('canvas'));
    const R = window.__skyProbe;
    if (!R || !R.probeIds) return null;
    R.resize(Bg.W, Bg.H, Math.min(devicePixelRatio, 2));
    const ids = R.probeIds();
    if (!ids) return null;
    const w = ids.w, h = ids.h, busy = new Uint8Array(w * h), out = new Uint8Array(Math.ceil((w * h) / 8));
    /* dilate by rad: rows, then columns */
    const row = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      for (let x = 0; x < w; x++) { if (ids.id[y * w + x]) last = x; if (x - last <= rad) row[y * w + x] = 1; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (ids.id[y * w + x]) last = x; if (last - x <= rad) row[y * w + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (row[y * w + x]) last = y; if (y - last <= rad) busy[y * w + x] = 1; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (row[y * w + x]) last = y; if (last - y <= rad) busy[y * w + x] = 1; }
    }
    for (let i = 0; i < w * h; i++) if (!busy[i]) out[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (let i = 0; i < out.length; i += 8192) bin += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
    return { w, h, bits: btoa(bin) };
  }, r);
  if (!got) return null;
  const bits = Buffer.from(got.bits, 'base64');
  return { w: got.w, h: got.h, at: (x, y) => x >= 0 && y >= 0 && x < got.w && y < got.h && !!(bits[(y * got.w + x) >> 3] & (1 << ((y * got.w + x) & 7))) };
}

/* The still picture, assets/img/bg-still.webp, which index.html's
   stylesheet puts behind the card once main.js sets data-bg static: waits
   for its fetch to end (its resource-timing entry; nothing here fetches it
   again), then for a screenshot that shows it - more than `drawn` of the
   viewport more than `tol` off the page grey `grey` - taking one every
   POLL ms until `ms` (STILL_MS) have gone by. Resolves { fetched: the
   fetches' statuses, shown: the last screenshot's share off the grey,
   waited: ms from the call to it }; the caller fails a shown under drawn.
   One screenshot a fixed time after the picture was asked for is a race:
   it is fetched only once data-bg is static, and 600 ms after main.js's
   grace it had not yet been decoded and painted in a run-all that ran
   beside three others (0.0% off the page grey, against 19.5% with
   check-webgl-context alone: the final review). Fetched and painted, it
   shows on the first screenshot. */
const STILL_MS = 20000, POLL = 200;
async function stillPicture(s, grey, drawn, tol, ms) {
  const B = require('./browser');
  const t0 = Date.now(), until = t0 + (ms || STILL_MS);
  const pause = () => new Promise(r => setTimeout(r, POLL));
  let fetched = [], shown = 0;
  for (;;) {
    fetched = await s.evaluate(() => performance.getEntriesByType('resource')
      .filter(e => /bg-still\.webp/.test(e.name)).map(e => e.responseStatus || 200));
    if (fetched.length || Date.now() > until) break;
    await pause();
  }
  for (;;) {
    shown = B.offColour(B.decodePNG(await s.screenshot()), grey, tol);
    if (shown > drawn || Date.now() > until) break;
    await pause();
  }
  return { fetched, shown, waited: Date.now() - t0 };
}

module.exports = { CLOCK, step, pointer, hideCard, pageGrey, rendererOf, openSky, stillPicture, STILL_MS };
