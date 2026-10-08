'use strict';
/* The background can be paused, and stays paused (WCAG 2.2.2 Pause, Stop,
   Hide; audit G5.1), and the reduced-motion setting is followed while the
   page is open (F10). Headless Chrome, index.html served from SITE_ROOT,
   the real background (assets/js/bg/) and the footer toggle (site.js):

     at load, with nothing saved: data-motion 'running', the toggle shown
       (it ships hidden), aria-pressed false, the background moving;
     a click pauses it: pressed, data-motion 'paused', saved
       (localStorage 'bg-motion'), the background still; a reload starts
       paused and draws its still frame; a second click resumes it;
     reduced motion at load starts paused; turned on while the page is open
       it pauses, turned off it resumes, and none of that is saved; a saved
       choice outranks the setting;
     a pause the toggle did not cause (the background's own 'bgmotion'
       { paused: true, reason: 'performance' }) shows as pressed, is not
       saved and is not sent on: one event, not two;
     storage that throws: no error, the toggle still works;
     the label never changes ("pause motion"); its states keep 4.5:1 (the
       label) and 3:1 (the border at rest); in forced colours, light and
       dark, pressed is filled at 3:1 against Canvas (forced colours drop
       author backgrounds, which would make the states look alike); the
       target is at least 24px tall (2.5.8); without JS the toggle is not
       there at all;
     no console error anywhere.

   "Moving" is more than 1% of the viewport changing in 0.4s with the card
   hidden (running: 13-19% measured); "still" is at most 0.1% (0.0%).
   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

const MOVING = 0.01, STILL = 0.001, DRAWN = 0.05, TOL = 12, WAIT = 400;
const THROWING_STORAGE = `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`;

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-motion-toggle: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  const fails = [], notes = [];
  const fail = m => fails.push(m);
  let grey = null;
  /* share of the viewport off the page grey, and changing over WAIT ms, with the card hidden */
  const look = async s => {
    await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
    await s.frames(2);
    const a = B.decodePNG(await s.screenshot());
    await new Promise(r => setTimeout(r, WAIT));
    await s.frames(2);
    const z = B.decodePNG(await s.screenshot());
    await s.evaluate(() => { document.querySelector('.shell').style.visibility = ''; });
    if (!grey) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(await s.evaluate(() => getComputedStyle(document.body).backgroundColor));
      grey = [+m[1], +m[2], +m[3]];
    }
    return { drawn: B.offColour(z, grey, TOL), moving: B.changed(a, z, TOL) };
  };
  const pct = v => (100 * v).toFixed(1) + '%';
  const state = s => s.evaluate(() => {
    const m = document.getElementById('motion');
    let stored;
    try { stored = localStorage.getItem('bg-motion'); } catch (e) { stored = 'throws'; }
    return { motion: document.documentElement.dataset.motion || null, shown: !!m && m.getClientRects().length > 0,
             pressed: m ? m.getAttribute('aria-pressed') : null, label: m ? m.textContent.trim() : null, stored };
  });
  const expect = async (s, label, want, moving) => {
    const st = await state(s);
    for (const k of Object.keys(want)) if (st[k] !== want[k]) fail(label + ': ' + k + ' is ' + JSON.stringify(st[k]) + ', expected ' + JSON.stringify(want[k]));
    if (st.label !== 'pause motion') fail(label + ': the label changed to ' + JSON.stringify(st.label));
    if (moving !== undefined) {
      const v = await look(s);
      if (moving && !(v.moving > MOVING)) fail(label + ': the background should move (' + pct(v.moving) + ' changed in ' + WAIT + 'ms)');
      if (!moving && !(v.moving <= STILL)) fail(label + ': the background should be still (' + pct(v.moving) + ' changed in ' + WAIT + 'ms)');
      if (!(v.drawn > DRAWN)) fail(label + ': the background is not drawn (' + pct(v.drawn) + ' off the page grey)');
      notes.push(label + ' ' + pct(v.moving));
    }
    return st;
  };
  const media = (s, reduce) => s.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]);
  const errorsOf = (s, label) => { for (const e of s.errors) fail(label + ': ' + e.type + ': ' + e.text); };
  try {
    /* ---- the toggle, saved across a reload ---- */
    let s = await b.open(site.url + 'index.html?bgq=0', { width: 900, height: 640 });
    if (!(await s.evaluate(() => !!document.getElementById('motion') && document.getElementById('motion').tagName === 'BUTTON'))) {
      await s.close();
      throw new Error('index.html has no <button id="motion">: there is no way to pause the background');
    }
    try {
      await s.frames(3);
      await expect(s, 'load', { motion: 'running', shown: true, pressed: 'false', stored: null }, true);
      const box = await s.evaluate(() => { const r = document.getElementById('motion').getBoundingClientRect(); return { w: r.width, h: r.height }; });
      if (box.h < 24) fail('the toggle is ' + box.h + 'px tall (2.5.8 asks 24)');
      await s.page.click('#motion');
      await s.frames(2);
      await expect(s, 'clicked', { motion: 'paused', pressed: 'true', stored: 'paused' }, false);
      await s.page.reload({ waitUntil: 'load' });
      await s.frames(3);
      await expect(s, 'reloaded', { motion: 'paused', shown: true, pressed: 'true', stored: 'paused' }, false);
      await s.page.click('#motion');
      await s.frames(2);
      await expect(s, 'clicked again', { motion: 'running', pressed: 'false', stored: 'running' }, true);
      /* the button's colours in each state */
      const colours = async label => {
        const c = await s.evaluate(() => {
          const m = document.getElementById('motion'), cs = getComputedStyle(m);
          return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, card: getComputedStyle(document.querySelector('.shell')).backgroundColor };
        });
        const card = A.parse(c.card), bg = A.parse(c.bg), fg = A.parse(c.color), bd = A.parse(c.border);
        const ground = bg[3] > 0 ? A.over(bg, bg[3], card) : card;
        const k = A.ratio(A.over(fg, fg[3], ground), ground);
        if (k < 4.5) fail('the toggle ' + label + ': label ' + A.fmt(k) + ' (needs 4.5:1)');
        notes.push(label + ' ' + A.fmt(k));
        return { ground, border: A.ratio(A.over(bd, bd[3], card), card) };
      };
      await s.page.mouse.move(1, 1);
      await A.settle(s.page);
      const rest = await colours('at rest');
      if (rest.border < 3) fail('the toggle at rest: border ' + A.fmt(rest.border) + ' on the card (needs 3:1)');
      await s.page.hover('#motion');
      await A.settle(s.page);
      await colours('hovered');
      await s.page.click('#motion');
      await A.settle(s.page);
      await colours('pressed and hovered');
      await s.page.mouse.move(1, 1);
      await A.settle(s.page);
      await colours('pressed');
      /* forced colours repaint every background as Canvas: pressed must
         still look pressed, in the light and the dark palette */
      const cdp = await s.page.target().createCDPSession();
      for (const scheme of ['light', 'dark']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: scheme }] });
        const look2 = [];
        for (const paused of [false, true]) {
          await s.evaluate(p => document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: p } })), paused);
          await A.settle(s.page);
          look2.push(await s.evaluate(() => ({ bg: getComputedStyle(document.getElementById('motion')).backgroundColor, canvas: getComputedStyle(document.querySelector('.shell')).backgroundColor })));
        }
        const canvas = A.parse(look2[1].canvas), fill = A.parse(look2[1].bg);
        const k = fill && fill[3] > 0 ? A.ratio(fill, canvas) : 1;
        if (k < 3) fail('forced colours (' + scheme + '): pressed is ' + look2[1].bg + ' on ' + look2[1].canvas + ', ' + A.fmt(k) + ' (needs 3:1 to show the state)');
        notes.push('forced colours ' + scheme + ' pressed fill ' + A.fmt(k));
      }
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      errorsOf(s, 'toggle');
    } finally { await s.close(); }

    /* ---- the reduced-motion setting, at load and live ---- */
    s = await b.open(site.url + 'index.html?bgq=0', { width: 900, height: 640 });
    try {
      await s.evaluate(() => localStorage.clear());
      await media(s, true);
      await s.page.reload({ waitUntil: 'load' });
      await s.frames(3);
      await expect(s, 'reduced motion at load', { motion: 'paused', pressed: 'true', stored: null }, false);
      await media(s, false);
      await s.frames(2);
      await expect(s, 'reduced motion turned off', { motion: 'running', pressed: 'false', stored: null }, true);
      await media(s, true);
      await s.frames(2);
      await expect(s, 'reduced motion turned on', { motion: 'paused', pressed: 'true', stored: null }, false);
      /* a saved choice outranks it */
      await s.evaluate(() => localStorage.setItem('bg-motion', 'running'));
      await s.page.reload({ waitUntil: 'load' });
      await s.frames(3);
      await expect(s, 'saved running under reduced motion', { motion: 'running', pressed: 'false' }, true);
      await media(s, false);
      await media(s, true);
      await s.frames(2);
      await expect(s, 'saved running, setting flipped', { motion: 'running', pressed: 'false', stored: 'running' }, true);
      /* a pause it did not cause */
      const events = await s.evaluate(() => new Promise(res => {
        let n = 0;
        document.addEventListener('bgmotion', () => { n++; });
        document.documentElement.dataset.motion = 'paused';
        document.dispatchEvent(new CustomEvent('bgmotion', { detail: { paused: true, reason: 'performance' } }));
        setTimeout(() => res(n), 50);
      }));
      if (events !== 1) fail('a performance pause produced ' + events + ' bgmotion events (expected the one sent: the toggle must not echo it)');
      await s.frames(2);
      await expect(s, 'paused for performance', { motion: 'paused', pressed: 'true', stored: 'running' }, false);
      errorsOf(s, 'reduced motion');
    } finally { await s.close(); }

    /* ---- storage that throws ---- */
    s = await b.open(site.url + 'index.html?bgq=0', { width: 900, height: 640, init: THROWING_STORAGE });
    try {
      await s.frames(3);
      await expect(s, 'storage blocked', { motion: 'running', shown: true, pressed: 'false', stored: 'throws' }, true);
      await s.page.click('#motion');
      await s.frames(2);
      await expect(s, 'storage blocked, clicked', { motion: 'paused', pressed: 'true' }, false);
      errorsOf(s, 'storage blocked');
    } finally { await s.close(); }

    /* ---- no JS ---- */
    s = await b.open(site.url + 'index.html?bgq=0', { width: 900, height: 640 });
    try {
      await s.page.setJavaScriptEnabled(false);
      await s.page.reload({ waitUntil: 'load' });
      const shown = await s.evaluate(() => { const m = document.getElementById('motion'); return !!m && m.getClientRects().length > 0; });
      if (shown) fail('without JS the toggle is shown, and would do nothing');
    } finally { await s.close(); }
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-motion-toggle: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-motion-toggle: OK - toggle pauses (saved, survives a reload) and resumes; reduced motion at load and turned on/off live is followed unless a choice was saved; a performance pause shows, unsaved and not echoed; blocked storage works; label constant, 24px target; not there without JS. Changed in '
              + WAIT + 'ms: ' + notes.filter(n => /%$/.test(n)).join(', ') + '; label contrast: ' + notes.filter(n => /:1$/.test(n) && !/^forced/.test(n)).join(', ')
              + '; ' + notes.filter(n => /^forced/.test(n)).join(', '));
}
main().catch(e => { console.log('check-motion-toggle: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
