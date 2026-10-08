'use strict';
/* The card's depth: when there is one, and where (audit F14; main.js
   occlusion, render-webgl.js THE CARD). check-occluder.js holds what the
   rect does to the pixels, in a browser; this holds main.js's gating of it,
   in node, on the page's own scripts (harness.js). The harness gives the
   page no card and a getComputedStyle that answers '' for everything,
   which turns the occlusion off in every other node check; here the page
   gets a card (.shell) of our own with a computed style of our own, a
   MutationObserver as a browser has one (put on the page before its
   scripts run; a record is delivered between frames, as a browser
   delivers it before the next one), and renderer.occlude wrapped to record
   what each frame hands it. 1440x900@1.5, every frame drawn (?bgq=0),
   16.7ms frames.

   (a) the rect is the card's, inset by its corner radius and by SLACK =
       160px above and below, rounded inward to whole px and clipped to the
       canvas: a card at fractional px, its bottom below the fold;
   (b) none from a 'scroll' until SCROLL_QUIET = 200ms after it, judged on
       the frame's own time: every frame of a 30-frame fling and of the
       200ms after it, and the rect at the first frame past that;
   (c) past the quiet time, the rect follows window.scrollY (600px down:
       its top clipped at 0, its bottom 600px up);
   (d) the card's height changing
       - by a change in it - a tab switch (a class on a panel inside it),
         content added or removed, text edited: a MutationObserver reports
         it before the next frame, so the very next frame's rect follows,
         here from 1400 to 371px tall. A tab switch used to wait for the
         card's ResizeObserver, which reports only after that frame has
         drawn: in headless Chrome, from about to writing, the first frame
         kept the old hole under the shorter card, 501px of page grey at
         1440x900@1.5 and 361px at 390x844@3 (found writing this check for
         the W3 review);
       - by anything else (a font or an image arriving: only the
         ResizeObserver sees it): within two frames;
   (e) no rect while the card is not fully opaque - opacity 0.5, an rgba()
       or transparent background, visibility hidden, display none - each
       restyle reported as a browser reports one (its style attribute), and
       the rect again once it is opaque;
   (f) none in a still frame (the motion paused), the rect again when it
       resumes, and none on a page with no card;
   (g) the card is never measured (its computed style read) on a frame
       where nothing can have changed it: 30 idle frames and 30 with the
       pointer moving, after load.
   Each drawn frame hands occlude exactly one rect or none. SKIP on a root
   whose main.js has no occlusion (before W3). Exit 1 on failure. */
const H = require('./harness');

const W = 1440, HH = 900, DPR = 1.5, DT = 16.7, SLACK = 160, QUIET = 200;
const fails = [], notes = [];
const fail = m => fails.push(m);

const files = H.source('background').files;
if (!files.some(f => f.src.includes('function occlusion('))) {
  console.log('check-occluder-gate: SKIP - no occlusion in the background scripts under ' + H.ROOT + ' (before W3)');
  process.exit(0);
}

/* a MutationObserver as a browser has one, on the page before its scripts */
const MO = [
  'globalThis.__mo = [];',
  'globalThis.MutationObserver = class MutationObserver {',
  '  constructor(cb) { this.cb = cb; this.on = []; globalThis.__mo.push(this); }',
  '  observe(target, o) { this.on.push({ target, o: Object.assign({}, o) }); }',
  '  disconnect() { this.on = []; }',
  '  takeRecords() { return []; }',
  '};'
].join('\n');
/* renderer.occlude, recorded: each call's arguments */
const PRELUDE = 'globalThis.__occ = []; { const o = renderer.occlude; renderer.occlude = function () { '
              + 'globalThis.__occ.push(Array.prototype.slice.call(arguments)); return o.apply(this, arguments); }; }';

/* the card: its box in document px (top as with the page scrolled to the
   top), a panel inside it and a text node in the panel; its computed style */
function makeCard(box, style) {
  let win = null;
  const card = H.makeElement('div'), panel = H.makeElement('section'), text = { nodeType: 3, parentNode: panel, data: '' };
  card.appendChild(panel);
  card.getBoundingClientRect = () => {
    if (style.display === 'none') return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const y = win ? win.scrollY || 0 : 0;
    return { x: box.left, y: box.top - y, left: box.left, right: box.right, top: box.top - y, bottom: box.top + box.height - y,
             width: box.right - box.left, height: box.height };
  };
  return { card, panel, text, box, style, attach(w) { win = w; } };
}
function page(withCard) {
  const box = { left: 290.4, right: 1150.6, top: 28.3, height: 1400.4 };
  const style = { visibility: 'visible', opacity: '1', display: 'block', 'background-color': 'rgb(232, 232, 228)',
                  'border-top-left-radius': '8px' };
  const c = makeCard(box, style);
  const sim = H.load({ W, H: HH, dpr: DPR, search: '?bgq=0', prelude: PRELUDE,
                       files: [{ src: MO, file: 'MutationObserver (check-occluder-gate.js)' }].concat(files),
                       querySelector: s => (withCard && s === '.shell' ? c.card : null) });
  c.attach(sim.window);
  sim.window.scrollY = 0;
  const out = Object.assign(c, { sim, styleReads: 0 });
  sim.window.getComputedStyle = el => {
    if (el === c.card) out.styleReads++;
    return { getPropertyValue: n => (el === c.card && Object.prototype.hasOwnProperty.call(style, n) ? style[n] : '') };
  };
  return out;
}
/* one frame: what it handed occlude ([] for none) */
function frame(p) {
  const occ = p.sim.window.__occ, n = occ.length;
  p.sim.frame(DT);
  const got = occ.slice(n);
  if (got.length !== 1) fail('frame ' + p.sim.frameIndex + ': occlude called ' + got.length + ' times (need exactly once a drawn frame)');
  return got.length ? got[got.length - 1] : [];
}
/* the rect for the card as it stands: inset by its radius and by SLACK
   above and below, rounded inward, clipped to the canvas; [] if nothing is left */
function want(p) {
  const b = p.box, y = p.sim.window.scrollY || 0, r = parseFloat(p.style['border-top-left-radius']) || 0;
  const x0 = Math.ceil(Math.max(0, b.left + r)), x1 = Math.floor(Math.min(W, b.right - r));
  const y0 = Math.ceil(Math.max(0, b.top - y + r + SLACK)), y1 = Math.floor(Math.min(HH, b.top + b.height - y - r - SLACK));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [];
}
const str = r => (r.length ? '[' + r.join(', ') + ']' : 'none');
const same = (a, b) => str(a) === str(b);
/* a DOM change, reported to every observer that asks for it, as a browser would */
function mutate(p, node, type, attr) {
  const within = (n, t) => { for (let q = n; q; q = q.parentNode) if (q === t) return true; return false; };
  let told = 0;
  for (const mo of p.sim.window.__mo) {
    const hit = mo.on.some(({ target, o }) => (node === target || (o.subtree && within(node, target)))
      && (type === 'attributes' ? (o.attributes || o.attributeFilter) && (!o.attributeFilter || o.attributeFilter.includes(attr))
        : type === 'childList' ? o.childList : o.characterData));
    if (hit) { mo.cb([{ type, target: node, attributeName: type === 'attributes' ? attr : null }], mo); told++; }
  }
  return told;
}
function scrollTo(p, y) { p.sim.window.scrollY = y; p.sim.fire('scroll'); }
/* frames until the quiet time after the last scroll is over */
function settle(p) { for (let i = 0; i < Math.ceil(QUIET / DT) + 1; i++) frame(p); }

const p = page(true), sim = p.sim;

/* main.js's own numbers are the ones this holds */
const own = /const SLACK = (\d+), SCROLL_QUIET = (\d+);/.exec(files.map(f => f.src).join('\n'));
if (!own) fail('main.js: no "const SLACK = <px>, SCROLL_QUIET = <ms>;" to compare with');
else if (+own[1] !== SLACK || +own[2] !== QUIET) {
  fail('main.js: SLACK ' + own[1] + 'px, SCROLL_QUIET ' + own[2] + 'ms (documented: 160px and 200ms, in README and here)');
}

/* (a) at load */
for (let i = 0; i < 3; i++) {
  const got = frame(p);
  if (!same(got, want(p))) {
    fail('(a) frame ' + (i + 1) + ' at load: the rect is ' + str(got) + ', need ' + str(want(p))
         + ' (the card inset by its radius and 160px above and below, rounded inward, clipped)');
  }
}
notes.push('(a) ' + str(want(p)) + ' for a card at [290.4, 28.3, 1150.6, 1428.7], radius 8');

/* (g) nothing changed: no measuring */
let noteG = '';
{
  const reads = p.styleReads;
  for (let i = 0; i < 30; i++) frame(p);
  for (let i = 0; i < 30; i++) { sim.move(100 + 40 * i, 500 + 5 * i); frame(p); }
  if (!(reads > 0)) fail('(g) precondition: the card was never measured at load');
  if (p.styleReads !== reads) fail('(g) the card was measured ' + (p.styleReads - reads) + ' times in 60 frames where nothing changed it (need 0: never every frame)');
  else noteG = '(g) not measured on 60 frames with nothing changed';
}

/* (b) a fling, then the quiet time; (c) the rect follows the scroll */
{
  let during = 0, scrolledAt = 0;
  for (let i = 1; i <= 30; i++) {
    scrollTo(p, 20 * i);
    scrolledAt = sim.now;
    if (frame(p).length) during++;
  }
  if (during) fail('(b) a rect on ' + during + ' of the 30 frames of a fling (need none while it scrolls)');
  let early = 0, first = null, firstAt = 0;
  for (let i = 0; i < 20 && !first; i++) {
    const got = frame(p);
    if (sim.now - scrolledAt < QUIET) { if (got.length) early++; } else { first = got; firstAt = sim.now - scrolledAt; }
  }
  if (early) fail('(b) a rect on ' + early + ' frames less than ' + QUIET + 'ms after the last scroll');
  if (!first || !same(first, want(p))) {
    fail('(c) ' + (first ? firstAt.toFixed(1) + 'ms' : 'no frame') + ' after the last scroll (scrollY 600): the rect is '
         + str(first || []) + ', need ' + str(want(p)));
  } else notes.push('(b) none while scrolling and ' + QUIET + 'ms after; (c) ' + str(first) + ' at scrollY 600, ' + firstAt.toFixed(1) + 'ms after');
}
scrollTo(p, 0);
settle(p);

/* (d) the card's height changing by a change in it: the very next frame */
const TALL = 1400.4, SHORT = 371.4;
for (const [label, node, type, attr] of [['a tab switch (a class on a panel in it)', p.panel, 'attributes', 'class'],
                                         ['content removed from it', p.panel, 'childList'],
                                         ['its text edited', p.text, 'characterData']]) {
  p.box.height = TALL;
  frame(p); frame(p);                        /* tall again, through its ResizeObserver */
  const before = frame(p);
  if (!same(before, want(p))) fail('(d) ' + label + ': precondition: the tall card has the rect ' + str(before) + ', need ' + str(want(p)));
  p.box.height = SHORT;
  const told = mutate(p, node, type, attr);
  const got = frame(p);
  if (!same(got, want(p))) {
    const under = got.length ? Math.round(got[3] - (p.box.top + p.box.height)) : 0;
    fail('(d) ' + label + ', the card ' + TALL + ' -> ' + SHORT + 'px tall: the next frame has the rect ' + str(got) + ', need ' + str(want(p))
         + (told ? '' : ' (no MutationObserver of the page was told: none watches inside the card)')
         + (under > 0 ? ': ' + under + 'px of page grey under the card' : ''));
  }
}
notes.push('(d) a tab switch, content or text changing in it: the next frame');
/* (d) by anything else: within two frames */
{
  p.box.height = TALL;
  frame(p); frame(p);
  p.box.height = 600.4;
  frame(p);
  const got = frame(p);
  if (!same(got, want(p))) fail('(d) the card 600px tall with no change in it (a font, an image): two frames on, the rect is ' + str(got) + ', need ' + str(want(p)));
  else notes.push('a size change with no change in it: within 2 frames');
}

/* (e) not fully opaque: no rect, until it is again */
{
  const opaque = Object.assign({}, p.style);
  let clean = 0;
  for (const [k, v] of [['opacity', '0.5'], ['background-color', 'rgba(232, 232, 228, 0.5)'], ['background-color', 'transparent'],
                        ['visibility', 'hidden'], ['display', 'none']]) {
    p.style[k] = v;
    mutate(p, p.card, 'attributes', 'style');
    const off = frame(p);
    if (off.length) fail('(e) ' + k + ' ' + v + ': the rect is ' + str(off) + ' (need none: the card is not opaque)');
    Object.assign(p.style, opaque);
    mutate(p, p.card, 'attributes', 'style');
    const back = frame(p);
    if (!same(back, want(p))) fail('(e) ' + k + ' back to ' + opaque[k] + ': the rect is ' + str(back) + ', need ' + str(want(p)));
    else if (!off.length) clean++;
  }
  notes.push('(e) none for ' + clean + ' of 5 kinds of not opaque');
}

/* (f) a still frame, and a page with no card */
{
  sim.motion(true);
  const still = frame(p);
  if (still.length) fail('(f) the still frame (motion paused) hands occlude ' + str(still) + ' (need none)');
  sim.motion(false);
  const back = frame(p);
  if (!same(back, want(p))) fail('(f) resumed: the rect is ' + str(back) + ', need ' + str(want(p)));
  const q = page(false);
  let any = 0;
  for (let i = 0; i < 5; i++) if (frame(q).length) any++;
  if (any) fail('(f) no card: a rect on ' + any + ' of 5 frames');
  notes.push('(f) none paused or with no card');
  if (noteG) notes.push(noteG);
}
if (sim.problems.length) fail(sim.problems.length + ' GL calls rejected or non-finite (' + String(sim.problems[0]).slice(0, 80) + ')');

if (fails.length) {
  console.log('check-occluder-gate: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-occluder-gate: OK - ' + notes.join('; '));
