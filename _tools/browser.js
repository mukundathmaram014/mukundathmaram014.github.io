'use strict';
/* Headless Chrome for the checks, through puppeteer-core (_tools/package.json;
   run `npm install` in _tools once). It drives the Chrome installed on this
   machine and never downloads one. Every launch gets its own temporary
   profile, deleted again on close, so parallel agents and checks never share
   a profile and never touch anyone's real browser session.

   WebGL works headless through SwiftShader (ANGLE's CPU renderer, the
   --use-angle=swiftshader flags below): good for correctness and pictures,
   meaningless for GPU timings.

     const B = require('./browser');
     const site = await B.serve();                 SITE_ROOT on 127.0.0.1:<free port>
     const s = await B.open(site.url + 'index.html', { width: 1440, height: 900, dpr: 1.5 });
     await s.frames(30);                           30 animation frames in the page
     s.errors                                      console errors, uncaught exceptions,
                                                   failed requests, HTTP >= 400
     const png = await s.screenshot({ path: 'shot.png' });
     const img = B.decodePNG(png);                 { width, height, data: RGBA bytes }
     const title = await s.evaluate(() => document.title);
     await s.close();                              closes the page, its browser, its profile
     await site.close();

   B.encodePNG(img) writes such an image back out as a PNG (a Buffer).

   B.launch(opts) starts a browser for several pages (b.open(url, o) for each,
   each with its own viewport; b.close() at the end). B.open launches one for
   a single page and closes it with the page. B.unavailable() says why the
   browser checks cannot run here (null when they can): a check SKIPS then.

   open(url, o) options: width, height (CSS px), dpr (deviceScaleFactor),
   waitUntil ('load'), timeout (ms, 60000), thirdParty: 'stub' (default:
   requests to other origins get an empty 200, so nothing depends on the
   network or a CDN), 'allow' or 'block'; routes: { '/path': { body,
   contentType, status } } answers those same-origin paths itself (e.g. to
   swap one script for a test double), counting each answer in its .hits;
   init: a function or source string that runs in the page before any of
   its own scripts (page.evaluateOnNewDocument), e.g. to time each frame;
   media: [{ name, value }] media features to emulate from the start, e.g.
   [{ name: 'prefers-reduced-motion', value: 'reduce' }]. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

/* the site under test: SITE_ROOT, as every tool reads it (harness.js) */
const ROOT = require('./harness').ROOT;
/* SwiftShader gives WebGL with no GPU. --disable-accelerated-2d-canvas keeps
   Canvas 2D off it, on Skia's own CPU rasteriser: through SwiftShader a
   Canvas 2D background (the page before W3; _baseline/) drew about 1 frame
   a second headless (1440x900 dpr 1.5) and a screenshot took 4s; on Skia it
   runs at 31-41 fps and a screenshot takes 0.5s. WebGL is unaffected. The
   throttling flags keep rAF running in a page nobody is looking at. */
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas',
                     '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
                     '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

function chromePath() {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null;
  const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', local,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}
function puppeteer() {
  try { return require('puppeteer-core'); } catch (e) { return null; }
}
function unavailable() {
  if (!puppeteer()) return 'puppeteer-core is not installed (run npm install in _tools)';
  if (!chromePath()) return 'no Chrome found (set CHROME_PATH)';
  return null;
}

/* ---- a static file server for a site folder ----------------------------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};
function serve(root) {
  root = path.resolve(root || ROOT);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch (e) { res.writeHead(400); res.end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                           'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: 'http://127.0.0.1:' + port + '/', port, root,
        close: () => new Promise(r => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); })
      });
    });
  });
}

/* ---- the browser ---------------------------------------------------------- */
/* ms for Chrome to start (every launch in _tools uses it). Puppeteer's own
   30 s is too short for a busy machine: with 88 busy processes on this
   one's 22 logical CPUs, 2 of 3 launches ran out of it, and puppeteer,
   finding the new profile's lockfile, reported each as "The browser is
   already running"; with 120 s all 3 started, in 32-53 s */
const LAUNCH_TIMEOUT = 120000;
async function launch(opts) {
  opts = opts || {};
  const why = unavailable();
  if (why) throw new Error('browser: ' + why);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-chrome-'));
  let browser;
  try {
    browser = await puppeteer().launch({
      executablePath: chromePath(), userDataDir: profile, timeout: LAUNCH_TIMEOUT,
      headless: opts.headless === undefined ? true : opts.headless,
      args: CHROME_ARGS.concat(opts.args || [])
    });
  } catch (e) {
    removeProfile(profile);
    throw e;
  }
  live.set(profile, browser);
  return {
    browser, profile,
    open: (url, o) => openPage(browser, url, o, null),
    version: () => browser.version(),
    async close() {
      live.delete(profile);
      try { await browser.close(); } catch (e) { /* already gone */ }
      removeProfile(profile);
    }
  };
}
async function open(url, o) {
  const b = await launch({ headless: o && o.headless, args: o && o.args });
  try { return await openPage(b.browser, url, o, () => b.close()); }
  catch (e) { await b.close(); throw e; }
}
function removeProfile(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* a temp dir */ }
}
/* A caller that dies without closing (an uncaught error, process.exit)
   would otherwise leave Chrome running and its profile behind: kill what is
   still open and remove its profile, as far as an exit handler can. */
const live = new Map();
process.on('exit', () => {
  for (const [dir, browser] of live) {
    try { const p = browser.process(); if (p) p.kill('SIGKILL'); } catch (e) { /* gone */ }
    removeProfile(dir);
  }
});

const STUB_TYPES = { stylesheet: 'text/css', script: 'text/javascript', font: 'font/woff2', image: 'image/png' };
async function openPage(browser, url, o, closeBrowser) {
  o = Object.assign({ width: 1440, height: 900, dpr: 1, waitUntil: 'load', timeout: 60000, thirdParty: 'stub', routes: null,
                     init: null, media: null }, o || {});
  const page = await browser.newPage();
  const errors = [], messages = [];
  page.on('console', m => {
    const e = { type: m.type(), text: m.text(), url: (m.location() || {}).url || '' };
    messages.push(e);
    if (e.type === 'error') errors.push(e);
  });
  page.on('pageerror', e => errors.push({ type: 'pageerror', text: (e && e.message) || String(e) }));
  page.on('requestfailed', r => errors.push({ type: 'requestfailed', text: r.url() + ' ' + ((r.failure() || {}).errorText || '') }));
  page.on('response', r => { if (r.status() >= 400) errors.push({ type: 'http', text: r.status() + ' ' + r.url() }); });
  await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: o.dpr });
  if (o.init) await page.evaluateOnNewDocument(o.init);
  if (o.media) await page.emulateMediaFeatures(o.media);
  const origin = new URL(url).origin;
  if (o.thirdParty !== 'allow' || o.routes) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (!/^https?:/i.test(u)) { req.continue(); return; }
      const at = new URL(u);
      if (at.origin === origin) {
        const r = o.routes && o.routes[at.pathname];
        if (r) {
          r.hits = (r.hits || 0) + 1;
          req.respond({ status: r.status || 200, contentType: r.contentType || 'text/plain', body: r.body || '' });
        } else req.continue();
        return;
      }
      if (o.thirdParty === 'block') { req.abort(); return; }
      if (o.thirdParty === 'stub') { req.respond({ status: 200, contentType: STUB_TYPES[req.resourceType()] || 'text/plain', body: '' }); return; }
      req.continue();
    });
  }
  await page.goto(url, { waitUntil: o.waitUntil, timeout: o.timeout });
  return {
    page, errors, messages,
    /* resolves after n animation frames in the page (rejects after ms) */
    frames(n, ms) {
      return withTimeout(page.evaluate(k => new Promise(res => {
        let i = 0;
        const f = () => { if (++i >= k) res(i); else requestAnimationFrame(f); };
        requestAnimationFrame(f);
      }), n), ms || o.timeout, 'waiting for ' + n + ' animation frames');
    },
    evaluate: (fn, ...args) => page.evaluate(fn, ...args),
    /* a PNG of the viewport, as a Buffer; opts as page.screenshot */
    async screenshot(opts) {
      return Buffer.from(await page.screenshot(Object.assign({ type: 'png', captureBeyondViewport: false }, opts || {})));
    },
    async close() {
      try { await page.close(); } catch (e) { /* already gone */ }
      if (closeBrowser) await closeBrowser();
    }
  };
}
function withTimeout(p, ms, what) {
  let timer;
  return Promise.race([p, new Promise((res, rej) => { timer = setTimeout(() => rej(new Error('browser: timed out ' + what)), ms); })])
    .finally(() => clearTimeout(timer));
}

/* ---- pictures --------------------------------------------------------------
   decodePNG: 8-bit RGB or RGBA, non-interlaced (what Chrome's screenshots
   are), to { width, height, data } with data RGBA. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('decodePNG: not a PNG');
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace) {
    throw new Error('decodePNG: only 8-bit RGB/RGBA, non-interlaced (got depth ' + depth + ', colour type ' + ctype + ', interlace ' + interlace + ')');
  }
  const bpp = ctype === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1), f = raw[base];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = raw[base + 1 + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}
/* encodePNG: { width, height, data } (RGBA bytes) to an 8-bit RGBA PNG, for
   the pictures the checks and tools write out (filter 0, no interlace) */
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function encodePNG(img) {
  const { width, height, data } = img, stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/* share of pixels whose colour is more than tol (any channel) from rgb */
function offColour(img, rgb, tol) {
  const d = img.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - rgb[0]) > tol || Math.abs(d[i + 1] - rgb[1]) > tol || Math.abs(d[i + 2] - rgb[2]) > tol) n++;
  }
  return n / (img.width * img.height);
}
/* share of pixels that differ by more than tol (any channel) between two pictures of one size */
function changed(a, b, tol) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol
        || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
  }
  return n / (a.width * a.height);
}

module.exports = { ROOT, CHROME_ARGS, LAUNCH_TIMEOUT, chromePath, unavailable, serve, launch, open, decodePNG, encodePNG, offColour, changed };
