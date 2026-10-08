'use strict';
/* The page works in a real browser. Headless Chrome (browser.js) loads
   index.html four ways:
     1. 1440x900 at dpr 1.5
     2. 390x844 at dpr 3
     3. 1440x900 at dpr 1.5 as it ships: the quality governor adapting
        (governor.js). SwiftShader takes ~140 ms a frame here, so within a
        few seconds it steps its resolution down (Bg.gov.res, 0.75 to
        min(dpr, 2)) - drawing the scene in a corner of the canvas, whose
        bitmap stays the box times min(dpr, 2) (render-webgl.js, THE
        LEVELS) - and the page must still draw and animate in its first
        seconds
     4. the same, with render-webgl.js swapped for a test double whose
        factory takes the canvas's WebGL context and then gives up, as a
        renderer whose shader fails to compile would: main.js shows the
        still picture instead (data-bg="static", the canvas hidden, the
        motion toggle gone, assets/img/bg-still.webp showing) - the path
        that keeps a failed WebGL start from leaving the page without a
        background
   1 and 2 hold the governor's top level (?bgq=0), so they test the
   drawing, not the adapting (check-governor.js). #cosmos must have a WebGL
   context. Each load must show no console error, uncaught exception,
   failed request or HTTP error; the background must draw (with the card
   hidden, over 5% of the viewport is off the page grey: the mountains are
   pale line work on a fill near it, ~11%; a blank canvas, checked once with
   #cosmos hidden, is under 0.5%, measured 0) and animate (over 1% of the
   pixels change in a second; ~15% measured). The renderer itself is
   checked in check-webgl-smoke.js, check-webgl-context.js,
   check-webgl-floor.js, check-webgl-terrain.js and check-wave-parity.js,
   the still picture in check-still.js.

   Then the motion pause (main.js; audit G5.1, F3, F2), in the same browser:
   a page that loads with prefers-reduced-motion emulated must draw its
   still frame and then hold still (under STILL of the pixels change in a
   second); resized while paused it must paint again rather than go blank
   (the old reduced-motion code left the canvas empty after any resize) at a
   bitmap of exactly the canvas box times the dpr; a 'bgmotion' event with
   detail { paused: false } must set it moving, and { paused: true } stop it
   again.

   It serves SITE_ROOT itself on a free port, so it honours SITE_ROOT and
   needs no server running; SITE_URL=<base url> (e.g. http://127.0.0.1:8787/)
   tests that server instead. Third-party requests (there are none since
   the fonts are self-hosted: check-fonts.js) would get an empty answer, so
   the result never depends on the network. SKIP when puppeteer-core or
   Chrome is missing. Exit 1 on failure. */
const B = require('./browser');

const DRAWN = 0.05, BLANK = 0.005, MOVING = 0.01, STILL = 0.001, TOL = 12;
const WEBGL_GIVES_UP = '/* check-browser-smoke.js: a WebGL renderer that fails after taking the context */\n'
  + "window.Bg.renderers.webgl = function (canvas) { canvas.getContext('webgl2') || canvas.getContext('webgl'); return null; };\n";
const CASES = [
  { label: '1440x900@1.5', q: '?bgq=0', width: 1440, height: 900, dpr: 1.5, blank: true },
  { label: '390x844@3', q: '?bgq=0', width: 390, height: 844, dpr: 3 },
  { label: 'as shipped', q: '', width: 1440, height: 900, dpr: 1.5, adapting: true },
  { label: 'WebGL gives up', q: '', width: 1440, height: 900, dpr: 1.5, givesUp: true }
];

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-browser-smoke: SKIP - ' + why); return; }
  const site = process.env.SITE_URL ? null : await B.serve();
  const base = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : site.url;
  const b = await B.launch();
  const fails = [], notes = [];
  let version = '';
  try {
    version = (await b.version()).replace(/^(Headless)?Chrome\//, 'Chrome ');
    for (const c of CASES) {
      const routes = c.givesUp
        ? { [new URL('assets/js/bg/render-webgl.js', base).pathname]: { body: WEBGL_GIVES_UP, contentType: 'text/javascript' } }
        : null;
      const s = await b.open(base + 'index.html' + c.q, { width: c.width, height: c.height, dpr: c.dpr, routes });
      try {
        await s.frames(5);
        const grey = await s.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(grey);
        if (!m) throw new Error('cannot read the page grey (body background ' + grey + ')');
        const rgb = [+m[1], +m[2], +m[3]];
        const dom = await s.evaluate(() => {
          const all = document.querySelectorAll('canvas#cosmos');
          const el = all[0], m = document.getElementById('motion');
          /* the box as laid out: a level below 0 may scale the canvas up by a transform */
          const t = el ? el.style.transform : '';
          if (t) el.style.transform = 'none';
          const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
          if (t) el.style.transform = t;
          return { n: all.length, w: el ? el.width : 0, h: el ? el.height : 0, bw: r.width, bh: r.height, dpr: devicePixelRatio,
                   res: window.Bg && window.Bg.gov ? window.Bg.gov.res : null,
                   gl: !!(el && (el.getContext('webgl2') || el.getContext('webgl'))), bg: document.documentElement.dataset.bg || null,
                   canvas: el ? getComputedStyle(el).visibility : 'missing', toggle: m ? getComputedStyle(m).display : 'missing' };
        });
        await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
        await s.frames(2);
        const a = B.decodePNG(await s.screenshot());
        await new Promise(r => setTimeout(r, 1000));
        await s.frames(2);
        const z = B.decodePNG(await s.screenshot());
        c.drawn = B.offColour(a, rgb, TOL);
        c.moving = B.changed(a, z, TOL);
        if (c.blank) {
          await s.evaluate(() => { document.getElementById('cosmos').style.visibility = 'hidden'; });
          await s.frames(2);
          c.blankShare = B.offColour(B.decodePNG(await s.screenshot()), rgb, TOL);
          if (!(c.blankShare < BLANK)) fails.push('blank control: with #cosmos hidden ' + pct(c.blankShare) + ' is still off the page grey, so the drawn test proves nothing');
        }
        await s.frames(1);
        for (const e of s.errors) fails.push(c.label + ': ' + e.type + ': ' + e.text);
        if (dom.n !== 1) fails.push(c.label + ': ' + dom.n + ' canvas#cosmos elements (need exactly 1)');
        if (!(c.drawn > DRAWN)) fails.push(c.label + ': the background did not draw (' + pct(c.drawn) + ' of the viewport off the page grey)');
        if (c.givesUp) {
          const hits = Object.values(routes)[0].hits || 0;
          if (!hits) { c.na = true; notes.push(c.label + ' n/a: the page does not load render-webgl.js'); }
          else if (dom.bg !== 'static' || dom.canvas !== 'hidden' || dom.toggle !== 'none') {
            fails.push(c.label + ': not the still picture: ' + JSON.stringify({ bg: dom.bg, canvas: dom.canvas, toggle: dom.toggle }));
          }
          c.moving = null;
        } else {
          if (!(c.moving > MOVING)) fails.push(c.label + ': the background is not animating (' + pct(c.moving) + ' changed in 1s)');
          if (!dom.gl) fails.push(c.label + ': #cosmos has no WebGL context; the renderer did not start');
          if (dom.bg) fails.push(c.label + ': data-bg is ' + dom.bg + ' with WebGL running');
          const most = Math.round(dom.bw * Math.min(dom.dpr, 2));
          if (dom.w !== most) fails.push(c.label + ': the bitmap is ' + dom.w + ' wide for a ' + dom.bw + ' px box at dpr ' + dom.dpr + ' (need the box times min(dpr, 2) at every level)');
          if (c.adapting && !(dom.res >= 0.75 && dom.res <= Math.min(dom.dpr, 2))) fails.push(c.label + ': the governor\'s resolution is ' + dom.res + ' (need 0.75 to min(dpr, 2))');
          if (c.adapting) c.bitmap = dom.w + 'x' + dom.h + ' bitmap, res ' + dom.res;
        }
      } finally {
        await s.close();
      }
    }
    await motion(b, base, fails, notes);
  } finally {
    await b.close();
    if (site) await site.close();
  }
  if (fails.length) {
    console.log('check-browser-smoke: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  const ran = CASES.filter(c => !c.na);
  console.log('check-browser-smoke: OK - ' + version + ' headless, ' + ran.map(c => c.label).join(', ')
              + ': no console errors; the background draws (' + ran.map(c => pct(c.drawn)).join(' / ')
              + ' of the viewport off the page grey; blank ' + pct(CASES[0].blankShare) + ') and animates ('
              + ran.filter(c => c.moving !== null).map(c => pct(c.moving)).join(' / ') + ' changed in 1s; as shipped, the governor at a '
              + (CASES[2].bitmap || '?') + ' by then); WebGL giving up shows the still picture, without the toggle; served from '
              + (site ? 'SITE_ROOT' : base) + ', third-party requests stubbed' + (notes.length ? '; ' + notes.join('; ') : ''));
}
const pct = v => (100 * v).toFixed(1) + '%';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* the motion pause in a real browser */
async function motion(b, base, fails, notes) {
  const s = await b.open(base + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1.5, media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    await s.frames(5);
    const grey = await s.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(grey);
    const rgb = [+m[1], +m[2], +m[3]];
    await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
    const shot = async () => { await s.frames(2); return B.decodePNG(await s.screenshot()); };
    const pair = async () => { const a = await shot(); await sleep(1000); const z = await shot(); return [a, z]; };
    let [a, z] = await pair();
    const still = { drawn: B.offColour(a, rgb, TOL), moving: B.changed(a, z, TOL) };
    if (!(still.drawn > DRAWN)) fails.push('paused at load: the background did not draw (' + pct(still.drawn) + ')');
    if (!(still.moving < STILL)) fails.push('paused at load: ' + pct(still.moving) + ' of the pixels changed in 1s (need under ' + pct(STILL) + ')');
    await s.page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1.5 });
    await s.frames(6);
    const resized = B.offColour(await shot(), rgb, TOL);
    const box = await s.evaluate(() => { const c = document.getElementById('cosmos'), r = c.getBoundingClientRect(); return { w: c.width, h: c.height, bw: r.width, bh: r.height, dpr: devicePixelRatio }; });
    if (!(resized > DRAWN)) fails.push('paused, then resized: the background is blank (' + pct(resized) + ' off the page grey)');
    if (box.w !== Math.round(box.bw * Math.min(box.dpr, 2)) || box.h !== Math.round(box.bh * Math.min(box.dpr, 2))) {
      fails.push('the bitmap is ' + box.w + 'x' + box.h + ' for a ' + box.bw + 'x' + box.bh + ' box at dpr ' + box.dpr);
    }
    await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: false } })));
    [a, z] = await pair();
    const resumed = B.changed(a, z, TOL);
    if (!(resumed > MOVING)) fails.push('bgmotion resume: only ' + pct(resumed) + ' changed in 1s');
    await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true } })));
    await s.frames(3);
    [a, z] = await pair();
    const repaused = B.changed(a, z, TOL);
    if (!(repaused < STILL)) fails.push('bgmotion pause: ' + pct(repaused) + ' still changed in 1s');
    for (const e of s.errors) fails.push('motion: ' + e.type + ': ' + e.text);
    notes.push('motion pause: paused load ' + pct(still.drawn) + ' drawn, ' + pct(still.moving) + ' changed in 1s; resized while paused '
               + pct(resized) + ' drawn, bitmap ' + box.w + 'x' + box.h + ' for ' + box.bw + 'x' + box.bh + '@1.5; resumed ' + pct(resumed)
               + ' changed in 1s; paused again ' + pct(repaused));
  } finally {
    await s.close();
  }
}
main().catch(e => { console.log('check-browser-smoke: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
