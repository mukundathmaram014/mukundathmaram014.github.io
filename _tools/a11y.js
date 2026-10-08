'use strict';
/* Shared by the page-styling checks: check-contrast, check-focus-ring,
   check-forced-colors, check-print, check-reduced-motion and
   check-tab-stability. Three parts:

     the WCAG 2.x contrast maths (one copy, so every check measures alike);
     pages(): a SITE_ROOT server plus a headless browser (browser.js), and on
       request one with real scrollbars. puppeteer starts Chrome with
       --hide-scrollbars, and with scrollbars that take no layout space a
       scrollbar-driven layout shift cannot happen at all, so a check for one
       would be blind;
     in-page probes, passed to page.evaluate, which read the rendered page.

   Nothing here downloads anything. A check SKIPs when B.unavailable() says
   the browser cannot run here. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./browser');

/* ---- WCAG 2.x relative luminance and contrast ----------------------------- */
function channel(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(rgb) { return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]); }
function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/* fg at alpha a, composited onto an opaque bg */
function over(fg, a, bg) { return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); }
/* '#RRGGBB', or a computed 'rgb(r, g, b)' / 'rgba(r, g, b, a)', to [r, g, b, a] */
function parse(s) {
  s = String(s).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16)).concat(1);
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
/* the custom properties of site.css's :root block, as { '--name': 'value' } */
function tokens(cssText) {
  const m = /:root\s*\{([\s\S]*?)\}/.exec(cssText.replace(/\/\*[\s\S]*?\*\//g, ''));
  const out = {};
  if (m) for (const d of m[1].split(';')) {
    const i = d.indexOf(':');
    if (i > 0 && d.slice(0, i).trim().startsWith('--')) out[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}
const fmt = r => r.toFixed(2) + ':1';

/* ---- the browser ------------------------------------------------------------
   pages({ scrollbars }) resolves to { url, open(file, o), close() }. Without
   scrollbars, open() is browser.js's (its own temporary profile, third-party
   requests stubbed, errors collected). With scrollbars, Chrome is started
   here instead, minus puppeteer's default --hide-scrollbars, in the same kind
   of private temporary profile, and pages get the same stubbing; o.javaScript
   false loads a page with scripting off (the no-JS layout).
   SITE_URL=<base url> tests a running server instead of serving SITE_ROOT. */
async function pages(opts) {
  opts = opts || {};
  const site = process.env.SITE_URL ? null : await B.serve();
  const base = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : site.url;
  let b;
  try {
    b = opts.scrollbars ? await launchWithScrollbars() : await B.launch();
  } catch (e) {
    if (site) await site.close();
    throw e;
  }
  return {
    url: base,
    open: async (file, o) => pause(await b.open(base + file, o)),
    async close() { await b.close(); if (site) await site.close(); }
  };
}
/* These checks read the page, not the animation, so open() pauses the
   background through its motion contract (the 'bgmotion' event the pause
   toggle sends; a page that ignores it just keeps animating). Each frame a
   check waits for is then a cheap one: the six checks took 53s with the
   background running and 36s paused. Call it again after a reload. */
async function pause(s) {
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true } })));
  return s;
}
async function launchWithScrollbars() {
  const puppeteer = require('puppeteer-core');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-chrome-'));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: B.chromePath(), userDataDir: profile, headless: true, timeout: B.LAUNCH_TIMEOUT,
                                       args: B.CHROME_ARGS, ignoreDefaultArgs: ['--hide-scrollbars'] });
  } catch (e) { removeProfile(profile); throw e; }
  /* a caller that dies without closing must not leave Chrome or its profile behind */
  const kill = () => { try { const p = browser.process(); if (p) p.kill('SIGKILL'); } catch (e) { /* gone */ } removeProfile(profile); };
  process.on('exit', kill);
  return {
    open: (url, o) => openPage(browser, url, o),
    async close() {
      process.removeListener('exit', kill);
      try { await browser.close(); } catch (e) { /* already gone */ }
      removeProfile(profile);
    }
  };
}
function removeProfile(dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* a temp dir */ } }
async function openPage(browser, url, o) {
  o = Object.assign({ width: 1440, height: 900, dpr: 1, javaScript: true }, o || {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push({ type: 'pageerror', text: (e && e.message) || String(e) }));
  page.on('console', m => { if (m.type() === 'error') errors.push({ type: 'error', text: m.text() }); });
  await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: o.dpr });
  if (!o.javaScript) await page.setJavaScriptEnabled(false);
  const origin = new URL(url).origin;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (/^https?:/i.test(u) && new URL(u).origin !== origin) req.respond({ status: 200, contentType: 'text/plain', body: '' });
    else req.continue();
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  return {
    page, errors,
    evaluate: (fn, ...args) => page.evaluate(fn, ...args),
    async close() { try { await page.close(); } catch (e) { /* already gone */ } }
  };
}

/* Jump every running CSS transition to its end, then let two frames paint,
   so a reading after a hover or a click is of the settled state rather than
   a frame of a fade. */
async function settle(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) { /* endless */ } } });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/* ---- in-page probes (self-contained: each runs inside the page) -----------

   textRuns(rootSelector): every visible element that holds text directly,
   with what measuring it needs: its colour, its opacity chain, the
   background colours behind it out to the first opaque one, and whether
   anything got in the way (a background image; or nothing opaque before the
   page itself while the fixed #cosmos art is showing, i.e. text drawn
   straight over the animation). Text clipped below 1px (the sr-only
   pattern) is not visible and is skipped. Nothing visible is exempt, not
   even a disabled-looking slot: WCAG 1.4.3 would excuse an inactive
   component, but a reader still has to make out what the slot is for. */
function textRuns(rootSel) {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return [];
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
    + (el.classList.length ? '.' + Array.from(el.classList).join('.') : '');
  const alphaOf = c => { const m = /rgba?\(([^)]*)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const cosmos = document.getElementById('cosmos');
  const art = !!(cosmos && cosmos.getClientRects().length && getComputedStyle(cosmos).visibility === 'visible');
  const out = [], seen = new Set();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const el = t.parentElement;
    if (!t.nodeValue.trim() || !el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const box = range.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    let opacity = 1;
    for (let n = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
    if (opacity === 0) continue;
    const layers = [];
    let image = null, opaque = false;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== 'none') { image = name(n); break; }
      const a = alphaOf(s.backgroundColor);
      if (a > 0) layers.push(s.backgroundColor);
      if (a >= 1) { opaque = true; break; }
    }
    out.push({
      where: name(el), text: t.nodeValue.trim().replace(/\s+/g, ' ').slice(0, 40),
      color: cs.color, opacity, layers, image, opaque, art,
      page: [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor],
      size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400
    });
  }
  return out;
}

/* focusRing(): the focused element's outline as drawn (style, width,
   offset, colour), the box its outer edge reaches, and every ancestor that
   clips it. An element whose overflow is not visible on an axis clips that
   axis at its padding box; overflow-x: auto alone makes overflow-y auto too. */
function focusRing() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const name = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')
    + (n.classList.length ? '.' + Array.from(n.classList).join('.') : '');
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const drawn = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const width = drawn ? parseFloat(cs.outlineWidth) : 0;
  const offset = parseFloat(cs.outlineOffset) || 0;
  const grow = drawn ? offset + width : 0;
  const outer = { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow };
  const clips = [];
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    const cx = s.overflowX !== 'visible', cy = s.overflowY !== 'visible';
    if (!cx && !cy) continue;
    const b = n.getBoundingClientRect();
    const pad = { left: b.left + parseFloat(s.borderLeftWidth), right: b.right - parseFloat(s.borderRightWidth),
                  top: b.top + parseFloat(s.borderTopWidth), bottom: b.bottom - parseFloat(s.borderBottomWidth) };
    const cut = [];
    if (cx && outer.left < pad.left - 0.01) cut.push('left ' + (pad.left - outer.left).toFixed(2) + 'px');
    if (cx && outer.right > pad.right + 0.01) cut.push('right ' + (outer.right - pad.right).toFixed(2) + 'px');
    if (cy && outer.top < pad.top - 0.01) cut.push('top ' + (pad.top - outer.top).toFixed(2) + 'px');
    if (cy && outer.bottom > pad.bottom + 0.01) cut.push('bottom ' + (outer.bottom - pad.bottom).toFixed(2) + 'px');
    if (cut.length) clips.push(name(n) + ' (overflow ' + s.overflowX + '/' + s.overflowY + ') cuts ' + cut.join(', '));
  }
  return {
    where: name(el), label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
    style: cs.outlineStyle, width, offset, color: cs.outlineColor, drawn,
    box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, outer, clips,
    scroll: [window.scrollX, window.scrollY]
  };
}

/* ---- measuring textRuns() in node -----------------------------------------
   mode 'screen': against the computed backgrounds. mode 'print': against the
   worse of the two papers a printout can have, backgrounds dropped (the
   browsers' default, "background graphics" off, so all text lands on white)
   and backgrounds printed (the computed layers over white). Each run gains
   ratio, need (4.5:1; 3:1 for large text, 24px or 18.66px bold), bg, and
   problem (null when the run could be measured). */
function measureRuns(runs, mode) {
  const WHITE = [255, 255, 255];
  const stack = (list, base) => list.slice().reverse().reduce((bg, l) => {
    const p = parse(l);
    return p && p[3] > 0 ? over(p, p[3], bg) : bg;
  }, base);
  return runs.map(r => {
    const need = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700) ? 3 : 4.5;
    let problem = null;
    if (r.image) problem = 'text over a background image (' + r.image + ')';
    else if (!r.opaque && r.art && mode !== 'print') problem = 'nothing opaque between this text and the #cosmos art';
    const c = parse(r.color);
    if (!c) return Object.assign({}, r, { ratio: 0, need, bg: WHITE, problem: 'a colour this check cannot read: ' + r.color });
    const pageBase = stack(r.page, WHITE);
    const printed = stack(r.layers, r.opaque ? WHITE : pageBase);
    const papers = mode === 'print' ? [WHITE, printed] : [printed];
    let worst = Infinity, bg = null;
    for (const p of papers) {
      const k = ratio(over(c, c[3] * r.opacity, p), p);
      if (k < worst) { worst = k; bg = p; }
    }
    return Object.assign({}, r, { ratio: worst, need, bg: bg.map(v => Math.round(v * 100) / 100), problem });
  });
}

module.exports = { ratio, over, parse, tokens, fmt, pages, pause, settle, textRuns, focusRing, measureRuns };
