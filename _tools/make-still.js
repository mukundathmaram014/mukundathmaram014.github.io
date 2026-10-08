'use strict';
/* Renders the background's still picture, assets/img/bg-still.webp: what
   the page shows in place of the animation where WebGL cannot draw it
   (main.js, data-bg="static"; index.html's stylesheet).

     node _tools/make-still.js           render it and write it (SITE_ROOT)

   Run it again whenever the scene's look changes - its colours, layout,
   the projection - or _tools/check-still.js fails as stale.

   It is the real renderer's frame (render-webgl.js), not a screenshot of
   the page: a page of its own loads the background scripts index.html
   loads, all but main.js, in headless Chrome (WebGL through SwiftShader,
   which renders what a GPU renders), sizes the scene to WIDTH x HEIGHT CSS
   px with no card in it, and draws the still frame the motion pause draws
   at scene time 0 (the orbit at its rest phase, the swell at time 0, no
   pointer, no ring) at RES bitmap px per CSS px: 2400x1350, a 16:9 crop
   wide enough to cover a desktop window. The stylesheet places it with
   background-size: cover and its horizon (HORIZON, 42% down) on the
   viewport's, so at any shape the sky stays above the line and the floor
   below it. Encoded WebP at the best quality that comes in under LIMIT
   bytes. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');
const H = require('./harness');

const WIDTH = 1600, HEIGHT = 900, RES = 1.5, LIMIT = 150 * 1024;
const FILE = path.join('assets', 'img', 'bg-still.webp');

/* the page: a canvas and the background scripts, without main.js */
function stillPage(root) {
  const scripts = (H.bgScripts(root) || []).filter(s => !/\/main\.js$/.test(s));
  return '<!doctype html><html><head><meta charset="utf-8"><title>still</title></head>'
    + '<body style="margin:0;background:#000"><canvas id="still"></canvas>'
    + scripts.map(s => '<script src="' + s + '"></script>').join('') + '</body></html>';
}
/* in the page: the scene at rest, drawn once; then encoded */
function drawStill(w, h, res) {
  const Bg = window.Bg;
  Bg.setSize(w, h);
  Bg.setCard();
  Bg.resetClock();
  const c = document.getElementById('still');
  const r = Bg.renderers.webgl && Bg.renderers.webgl(c);
  if (!r) return { error: 'no WebGL renderer' };
  r.resize(w, h, res);
  r.draw(Bg.hold(), true);
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(4 * c.width * c.height);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  window.__still = { c, r, px };
  return { w: c.width, h: c.height };
}
function encode(q) {
  /* The drawing buffer is not preserved past the task that drew it (the
     renderer's preserveDrawingBuffer: false), so draw the same still frame
     again and encode it in this one. */
  const s = window.__still;
  s.r.draw(window.Bg.hold(), true);
  return s.c.toDataURL('image/webp', q);
}
/* Opens the still page in a browser b (B.launch) served from site (B.serve);
   resolves with { session, w, h, px (RGBA, bottom row first), encode(q) }. */
async function render(b, site) {
  const s = await b.open(site.url + '__still.html', {
    width: WIDTH, height: HEIGHT, dpr: 1,
    routes: { '/__still.html': { body: stillPage(site.root), contentType: 'text/html; charset=utf-8' } }
  });
  const got = await s.evaluate(drawStill, WIDTH, HEIGHT, RES);
  if (got.error) { await s.close(); throw new Error('make-still: ' + got.error); }
  return {
    session: s, w: got.w, h: got.h,
    pixels: () => s.evaluate(() => { const p = window.__still.px; let bin = ''; for (let i = 0; i < p.length; i += 32768) bin += String.fromCharCode.apply(null, p.subarray(i, i + 32768)); return btoa(bin); }).then(b64 => Buffer.from(b64, 'base64')),
    encode: async q => Buffer.from((await s.evaluate(encode, q)).replace(/^data:image\/webp;base64,/, ''), 'base64'),
    close: () => s.close()
  };
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('make-still: cannot run - ' + why); process.exit(1); }
  const site = await B.serve();
  const b = await B.launch();
  try {
    const r = await render(b, site);
    let q = 0.9, out = null;
    for (; q >= 0.3; q = Math.round((q - 0.05) * 100) / 100) {
      out = await r.encode(q);
      if (out.length <= LIMIT) break;
    }
    await r.close();
    if (!out || out.length > LIMIT) throw new Error('could not get the picture under ' + LIMIT + ' bytes');
    const file = path.join(B.ROOT, FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
    console.log('make-still: wrote ' + file + ': ' + r.w + 'x' + r.h + ' WebP at quality ' + q + ', ' + out.length + ' bytes ('
                + (out.length / 1024).toFixed(1) + ' KB; limit ' + LIMIT / 1024 + ' KB)');
  } finally {
    await b.close();
    await site.close();
  }
}

module.exports = { WIDTH, HEIGHT, RES, LIMIT, FILE, render };
if (require.main === module) main().catch(e => { console.log('make-still: FAILED - ' + ((e && e.stack) || e)); process.exit(1); });
