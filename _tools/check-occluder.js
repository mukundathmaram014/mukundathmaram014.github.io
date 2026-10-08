'use strict';
/* The card's depth (audit F14; render-webgl.js THE CARD, main.js occlusion):
   before anything else, a frame writes depth alone over the opaque card's
   rect, so the GPU rejects every fragment the card hides before shading it.
   It must change no pixel anyone can see, and it must be there.

     pixels    the renderer's own frame (a renderer of its own on a canvas
               of its own, in the page's scene state) with the rect and
               without: every pixel outside the rect the same to the bit,
               and the rect itself left the page grey (so the rect did
               something); 1440x900@1.5 at the top and scrolled, 390x844@3,
               1920x1080@1
     the page  the page itself, the card showing, in the same scene state
               (glkit's clock) as the page with main.js's occlusion turned
               off: the same screenshot, pixel for pixel, at the top and
               scrolled to the bottom (the card's lower edge in view; the
               dice, which roll anew on every load, hidden in both). And
               the pass is there: with the card showing a frame on #cosmos
               makes 8 draw calls (the card's, then the sun, the clouds,
               the floor, the ridges and peaks, the trees and conifers, the
               bodies and the ring); with the card hidden, 7 - no hole
               where there is no card
     the GPU   report only: on a hardware GPU (a headless Chrome of its own
               with ANGLE on D3D11, where there is one), the GPU's time per
               frame at 1440x900@1.5 with and without the rect (20 frames
               back to back, synced by a 1-px readPixels, interleaved).
               SwiftShader shades before its depth test, so it shows no
               saving; measured on an Intel Arc iGPU: 2.26 -> 1.29 ms (-43%)
               at 1440x900@1.5, 2.56 -> 1.63 ms (-37%) at 1699x887@1.5,
               1.13 -> 0.46 ms (-60%) at 390x844@3.

   SKIP without puppeteer-core or Chrome. Exit 1 on failure. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./browser');
const K = require('./glkit');

const fails = [], notes = [];
const COUNT_DRAWS = "(() => { window.__draws = 0; for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; const f = C.prototype.drawArrays; C.prototype.drawArrays = function (...a) { if (this.canvas && this.canvas.id === 'cosmos') window.__draws++; return f.apply(this, a); }; } })();";

/* in the page: the card's rect as main.js makes it, and the frame with it
   and without it */
function pixels(res, scroll) {
  window.scrollTo(0, scroll);
  const Bg = window.Bg, c = document.createElement('canvas'), r = Bg.renderers.webgl(c), gl = c.getContext('webgl2');
  const W = Bg.W, H = Bg.H, card = document.querySelector('.shell'), b = card.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
  const rect = [Math.max(0, b.left + inset), Math.max(0, b.top + inset + 160), Math.min(W, b.right - inset), Math.min(H, b.bottom - inset - 160)];
  r.resize(W, H, res);
  const bw = c.width, bh = c.height, k = bw / W;
  const read = on => {
    if (on) r.occlude(rect[0], rect[1], rect[2], rect[3]); else r.occlude();
    r.draw(Bg.simNow, false);
    const px = new Uint8Array(4 * bw * bh);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const a = read(false), z = read(true);
  const grey = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
  let out = 0, nOut = 0, hole = 0, nIn = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const cx = (x + 0.5) / k, cy = (bh - 1 - y + 0.5) / k, i = 4 * (y * bw + x);
      const same = a[i] === z[i] && a[i + 1] === z[i + 1] && a[i + 2] === z[i + 2];
      if (cx > rect[0] + 1 && cx < rect[2] - 1 && cy > rect[1] + 1 && cy < rect[3] - 1) {
        nIn++;
        if (z[i] === grey[0] && z[i + 1] === grey[1] && z[i + 2] === grey[2]) hole++;
      } else if (cx < rect[0] - 1 || cx > rect[2] + 1 || cy < rect[1] - 1 || cy > rect[3] + 1) {
        nOut++;
        if (!same) out++;
      }
    }
  }
  return { bitmap: bw + 'x' + bh, area: (rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]) / (W * H), out, nOut, hole, nIn };
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-occluder: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  try {
    /* pixels */
    for (const [w, h, dpr, scroll] of [[1440, 900, 1.5, 0], [1440, 900, 1.5, 300], [390, 844, 3, 0], [1920, 1080, 1, 0]]) {
      const s = await b.open(site.url + 'index.html', { width: w, height: h, dpr, init: K.CLOCK });
      try {
        await K.step(s, 30);
        const p = await s.evaluate(pixels, Math.min(dpr, 2), scroll);
        const label = w + 'x' + h + '@' + dpr + (scroll ? ' scrolled' : '');
        if (p.out) fails.push(label + ': ' + p.out + ' of ' + p.nOut + ' pixels outside the card\'s rect differ with it');
        if (!(p.hole > 0.99 * p.nIn)) fails.push(label + ': the rect is not left the page grey (' + p.hole + ' of ' + p.nIn + ' px): the pass did nothing');
        notes.push(label + ' ' + p.bitmap + ': the rect ' + (100 * p.area).toFixed(0) + '% of the canvas, ' + p.nOut + ' px outside it identical');
      } finally { await s.close(); }
    }
    /* the page, with and without main.js's occlusion */
    const mainFile = path.join(B.ROOT, 'assets', 'js', 'bg', 'main.js'), mainSrc = fs.readFileSync(mainFile, 'utf8');
    const anchor = '        occlusion(now);';
    if (mainSrc.split(anchor).length !== 2) fails.push('cannot turn the occlusion off: main.js has no single "' + anchor.trim() + '"');
    const off = { [new URL('assets/js/bg/main.js', site.url).pathname]: { body: mainSrc.replace(anchor, '        renderer.occlude();'), contentType: 'text/javascript' } };
    const shots = {};
    for (const [label, routes] of [['on', null], ['off', off]]) {
      const s = await b.open(site.url + 'index.html', { width: 1440, height: 900, dpr: 1.5, init: K.CLOCK + '\n' + COUNT_DRAWS, routes });
      try {
        /* the dice roll anew on every load: out of the picture */
        await s.evaluate(() => { const d = document.getElementById('dice'); if (d) d.style.visibility = 'hidden'; });
        await K.step(s, 30);
        await K.pointer(s, 140, 700);
        await K.step(s, 5);
        const d0 = await s.evaluate(() => window.__draws);
        await K.step(s, 1);
        const draws = await s.evaluate(() => window.__draws) - d0;
        await new Promise(r => setTimeout(r, 200));
        shots[label] = [B.decodePNG(await s.screenshot())];
        await s.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await new Promise(r => setTimeout(r, 400));     /* past main.js's quiet time after a scroll */
        await K.step(s, 1);
        await new Promise(r => setTimeout(r, 200));
        shots[label].push(B.decodePNG(await s.screenshot()));
        if (label === 'on') {
          if (draws !== 8) fails.push('the page, the card showing: ' + draws + ' draw calls a frame (need 8: the card\'s depth pass and 7)');
          await K.hideCard(s);
          await K.step(s, 1);
          const d1 = await s.evaluate(() => window.__draws);
          await K.step(s, 1);
          const hidden = await s.evaluate(() => window.__draws) - d1;
          if (hidden !== 7) fails.push('the page, the card hidden: ' + hidden + ' draw calls a frame (need 7: no hole where there is no card)');
          notes.push('the page: 8 draw calls a frame with the card showing, ' + hidden + ' with it hidden');
        }
        for (const m of s.messages) if (!/GPU stall due to ReadPixels/.test(m.text)) fails.push('the page (' + label + '): console ' + m.type + ': ' + m.text);
        for (const e of s.errors) fails.push('the page (' + label + '): ' + e.type + ': ' + e.text);
      } finally { await s.close(); }
    }
    for (const [i, where] of [[0, 'at the top'], [1, 'scrolled to the bottom']]) {
      const diff = B.changed(shots.on[i], shots.off[i], 0);
      if (diff) fails.push('the page ' + where + ': ' + (100 * diff).toFixed(4) + '% of the pixels differ with the card\'s depth pass');
    }
    notes.push('the page with it and without it: the same screenshot at the top and scrolled to the bottom');
  } finally {
    await b.close();
    await site.close();
  }
  notes.push('the GPU: ' + await gpuTiming());
  if (fails.length) {
    console.log('check-occluder: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-occluder: OK - ' + notes.join('; '));
}

/* report only: the GPU's time per frame with and without the rect, on a
   hardware GPU if this machine has one */
async function gpuTiming() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch (e) { return 'n/a (no puppeteer-core)'; }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-gpu-'));
  const site = await B.serve();
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath: B.chromePath ? B.chromePath() : 'C:/Program Files/Google/Chrome/Application/chrome.exe',
                                       userDataDir: profile, headless: true, timeout: B.LAUNCH_TIMEOUT || 120000,
                                       args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
    await page.evaluateOnNewDocument(K.CLOCK);
    await page.goto(site.url + 'index.html', { waitUntil: 'load' });
    await page.evaluate(() => window.__clock.step(30, 16.7));
    const got = await page.evaluate(() => {
      const Bg = window.Bg, c = document.createElement('canvas'), r = Bg.renderers.webgl(c), gl = c.getContext('webgl2'), ONE = new Uint8Array(4);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info'), name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
      if (/swiftshader|llvmpipe|software/i.test(name)) return { name, soft: true };
      r.resize(Bg.W, Bg.H, 1.5);
      const card = document.querySelector('.shell'), b = card.getBoundingClientRect(), inset = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
      const rect = [b.left + inset, b.top + inset + 160, b.right - inset, Math.min(Bg.H, b.bottom - inset - 160)];
      const batch = on => {
        if (on) r.occlude(rect[0], rect[1], rect[2], rect[3]); else r.occlude();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, ONE);
        const a = performance.now();
        for (let i = 0; i < 20; i++) r.draw(Bg.simNow + i, false);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, ONE);
        return (performance.now() - a) / 20;
      };
      for (let i = 0; i < 3; i++) { batch(false); batch(true); }
      const A = [], Z = [];
      for (let i = 0; i < 10; i++) { A.push(batch(false)); Z.push(batch(true)); }
      A.sort((p, q) => p - q); Z.sort((p, q) => p - q);
      return { name, without: A[5], with: Z[5] };
    });
    if (got.soft) return 'n/a (no hardware GPU here: ' + got.name + ')';
    return got.name.replace(/^ANGLE \([^,]+, (.*?) \(0x[0-9A-Fa-f]+\).*$/, '$1') + ' at 1440x900@1.5: ' + got.without.toFixed(2) + ' -> ' + got.with.toFixed(2)
           + ' ms a frame (' + (100 * (got.with / got.without - 1)).toFixed(0) + '%)';
  } catch (e) {
    return 'n/a (' + String((e && e.message) || e).split('\n')[0].slice(0, 80) + ')';
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* gone */ } }
    await site.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* a temp dir */ }
  }
}
main().catch(e => { console.log('check-occluder: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
