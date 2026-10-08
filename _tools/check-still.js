'use strict';
/* The still picture, where the background cannot be drawn (W3): no WebGL,
   a renderer that cannot start, or a lost context that never comes back.
   main.js then sets data-bg="static" on <html>; index.html's stylesheet
   hides the canvas and shows assets/img/bg-still.webp in its place, and
   site.css hides the motion toggle, since nothing moves.

     the file    a WebP, 2400x1350 (a 16:9 crop, 1600x900 CSS px at 1.5),
                 at most 150 KB
     fresh       it is still the renderer's picture of the scene: rendered
                 again from the current code (make-still.js's own render)
                 and compared, the file is within MEAN levels of it on
                 average and under OFF of its pixels more than 48 levels
                 off (WebP's loss on the line work). A scene retuned without
                 running node _tools/make-still.js fails here.
     the page    headless Chrome with WebGL made unavailable: exactly one
                 console warning, nothing else on the console; data-bg is
                 static; the canvas hidden; #motion not displayed; the
                 picture fetched once (HTTP 200) and showing (with the card
                 hidden, over 5% of the viewport off the page grey, the
                 picture's own share: an empty fallback is 0%), waited for
                 as a resource, fetched and painted (glkit.stillPicture),
                 not judged once 300 ms on, which a busy machine can lose;
                 no frame asked for. And with WebGL, the picture is never
                 fetched.

   SKIP without puppeteer-core or Chrome. Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');
const K = require('./glkit');
const M = require('./make-still');

const MEAN = 4, OFF = 0.0002, DRAWN = 0.05, TOL = 12;
const fails = [], notes = [];
const pct = v => (100 * v).toFixed(2) + '%';

/* width and height from a WebP's header (lossy VP8, lossless VP8L or the extended VP8X) */
function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { kind, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { kind, w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  if (kind === 'VP8X') return { kind, w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  return null;
}

async function main() {
  const file = path.join(B.ROOT, M.FILE);
  if (!fs.existsSync(file)) { console.log('check-still: FAIL - ' + file + ' does not exist (node _tools/make-still.js makes it)'); process.exit(1); }
  const buf = fs.readFileSync(file);
  const size = webpSize(buf);
  const W = Math.round(M.WIDTH * M.RES), Hh = Math.round(M.HEIGHT * M.RES);
  if (!size) fails.push(M.FILE + ' is not a WebP');
  else if (size.w !== W || size.h !== Hh) fails.push(M.FILE + ' is ' + size.w + 'x' + size.h + ', not ' + W + 'x' + Hh);
  if (buf.length > M.LIMIT) fails.push(M.FILE + ' is ' + buf.length + ' bytes, over ' + M.LIMIT);
  notes.push(M.FILE + ' ' + (size ? size.w + 'x' + size.h + ' ' + size.kind.trim() : '?') + ', ' + (buf.length / 1024).toFixed(1) + ' KB');

  const why = B.unavailable();
  if (why) { report('SKIP (the file only) - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  try {
    /* fresh: the file against the scene rendered again now */
    const r = await M.render(b, site);
    try {
      const st = await r.session.evaluate(async src => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data, px = window.__still.px, w = c.width, h = c.height;
        let sum = 0, off = 0;
        for (let y = 0; y < h; y++) {
          const fy = (h - 1 - y) * w;          /* readPixels: bottom row first */
          for (let x = 0; x < w; x++) {
            const i = 4 * (y * w + x), j = 4 * (fy + x);
            const e = Math.max(Math.abs(d[i] - px[j]), Math.abs(d[i + 1] - px[j + 1]), Math.abs(d[i + 2] - px[j + 2]));
            sum += e;
            if (e > 48) off++;
          }
        }
        return { w, h, mean: sum / (w * h), off: off / (w * h) };
      }, '/' + M.FILE.split(path.sep).join('/'));
      if (!(st.mean <= MEAN && st.off <= OFF)) {
        fails.push('the picture is stale: ' + st.mean.toFixed(2) + ' levels off the current scene on average (limit ' + MEAN + '), '
                   + pct(st.off) + ' of its pixels over 48 levels off (limit ' + pct(OFF) + '); run node _tools/make-still.js');
      }
      notes.push('against the scene rendered now: ' + st.mean.toFixed(2) + ' levels off on average, ' + pct(st.off) + ' of px over 48');
    } finally { await r.close(); }

    /* the page with no WebGL */
    const NO_WEBGL = "(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, a) { return /webgl/.test(t) ? null : g.call(this, t, a); }; window.__raf = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => { window.__raf++; return raf(cb); }; })();";
    for (const [label, init] of [['no WebGL', NO_WEBGL], ['WebGL', null]]) {
      const s = await b.open(site.url + 'index.html', { width: 1440, height: 900, dpr: 1.5, init });
      try {
        await new Promise(res => setTimeout(res, 600));
        const dom = await s.evaluate(() => {
          const c = document.getElementById('cosmos'), m = document.getElementById('motion');
          const before = getComputedStyle(document.body, '::before');
          const got = performance.getEntriesByType('resource').filter(e => /bg-still\.webp/.test(e.name));
          return { bg: document.documentElement.dataset.bg || null, canvas: getComputedStyle(c).visibility,
                   motion: m ? getComputedStyle(m).display : 'missing', image: before.backgroundImage, raf: window.__raf,
                   fetched: got.map(e => e.responseStatus || 200) };
        });
        if (label === 'WebGL') {
          if (dom.bg !== null) fails.push('with WebGL, data-bg is ' + JSON.stringify(dom.bg));
          if (dom.fetched.length) fails.push('with WebGL, the still picture was fetched anyway');
          if (dom.motion === 'none') fails.push('with WebGL, the motion toggle is hidden');
          for (const m of s.messages) fails.push('with WebGL: console ' + m.type + ': ' + m.text);
          continue;
        }
        await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
        /* fetched, then painted: waited for, up to glkit's STILL_MS */
        const pic = await K.stillPicture(s, await K.pageGrey(s), DRAWN, TOL);
        const fetched = pic.fetched, shown = pic.shown;
        /* the frames asked for, counted again now that it shows */
        dom.raf = await s.evaluate(() => window.__raf);
        if (dom.bg !== 'static') fails.push('no WebGL: data-bg is ' + JSON.stringify(dom.bg) + ', not "static"');
        if (dom.canvas !== 'hidden') fails.push('no WebGL: the canvas is ' + dom.canvas + ', not hidden');
        if (dom.motion !== 'none') fails.push('no WebGL: the motion toggle is still displayed (' + dom.motion + ')');
        if (!/bg-still\.webp/.test(dom.image)) fails.push('no WebGL: the picture is not the page\'s background (' + dom.image + ')');
        if (!(fetched.length === 1 && fetched[0] === 200)) fails.push('no WebGL: the picture was fetched ' + fetched.length + 'x (' + fetched.join(', ') + ')');
        if (!(shown > DRAWN)) fails.push('no WebGL: the picture does not show (' + pct(shown) + ' of the viewport off the page grey)');
        if (dom.raf) fails.push('no WebGL: the page asked for ' + dom.raf + ' animation frames, with nothing to animate');
        const warns = s.messages.filter(m => m.type === 'warn' || m.type === 'warning');
        if (warns.length !== 1) fails.push('no WebGL: ' + warns.length + ' console warnings (need 1): ' + warns.map(m => m.text).join(' | '));
        for (const m of s.messages) if (!(m.type === 'warn' || m.type === 'warning')) fails.push('no WebGL: console ' + m.type + ': ' + m.text);
        for (const e of s.errors) fails.push('no WebGL: ' + e.type + ': ' + e.text);
        notes.push('no WebGL: data-bg static, canvas hidden, toggle gone, picture fetched once and showing (' + pct(shown)
                   + ' off the page grey), ' + dom.raf + ' frames asked for, warned once ("' + (warns[0] ? warns[0].text : '') + '")');
      } finally { await s.close(); }
    }
    notes.push('with WebGL, never fetched');
  } finally {
    await b.close();
    await site.close();
  }
  report();
}
function report(skip) {
  if (fails.length) {
    console.log('check-still: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-still: ' + (skip || 'OK') + ' - ' + notes.join('; '));
}
main().catch(e => { console.log('check-still: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
