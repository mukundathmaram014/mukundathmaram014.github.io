'use strict';
/* Every keyboard focus stop shows a whole focus ring (WCAG 2.4.7).
   Headless Chrome tabs through index.html (and arrows through its tablist,
   which uses a roving tabindex, so only the selected tab is a Tab stop) and
   through the post template. At each stop:

     the ring is drawn: an outline with a style and a width;
     no ancestor clips it: an element with overflow other than visible on an
       axis clips that axis at its padding box, and overflow-x: auto alone
       makes overflow-y auto too. .tabs scrolls sideways on narrow screens,
       so it clipped the tabs' outset ring down to the vertical slivers
       between them;
     it shows on all four sides, in pixels: along each side of the ring's
       band, at least 90% of positions hold a pixel nearer the ring colour
       than the background (dpr 2, 4px trimmed at the corners; a side off
       screen, around something larger than the viewport, is left to the
       clipping test);
     it has 3:1 against the colours on either side of it (1.4.11): the
       commonest colour just outside its band, and just inside it (between
       the band and the element, when the ring sits out from it). The
       commonest colour of the whole shot was the element's own fill around
       a large dark one: the template's code block read 1.06:1 against its
       own #232326, though its ring is drawn on the card.

   On the template the code block is one of the stops: it scrolls sideways,
   and Safari lets the keyboard into a scroller only through its tabindex.

   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

const DPR = 2, COVER = 0.9, TRIM = 4, NEED = 3, MAX_STOPS = 40;
/* the template's stops: the masthead's name, three tabs, the back link, the
   code block and the dice */
const TEMPLATE_STOPS = 7;

/* coverage of the ring's band along each side, from a screenshot of its
   box, and the colours either side of the band */
function sides(img, ring, clip) {
  const rgb = A.parse(ring.color);
  const px = (x, y) => { const o = (y * img.width + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
  const commonest = pts => {
    const count = new Map();
    for (const [x, y] of pts) { const k = px(x, y).join(','); count.set(k, (count.get(k) || 0) + 1); }
    return count.size ? Array.from(count).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number) : null;
  };
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  /* the band in device px, relative to the shot: between the box edge
     moved out by offset and by offset + width (one px of slack each way) */
  const X = v => Math.round((v - clip.x) * DPR), Y = v => Math.round((v - clip.y) * DPR);
  const o = ring.offset, w = ring.width, b = ring.box;
  const lo = Math.min(o, o + w), hi = Math.max(o, o + w);
  const out = {};
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < img.width && y < img.height;
  const span = (from, to) => { const r = []; for (let v = Math.ceil(from); v <= Math.floor(to); v++) r.push(v); return r; };
  const band = (edge, dir) => span(Math.min(edge + dir * lo * DPR, edge + dir * hi * DPR) - 1, Math.max(edge + dir * lo * DPR, edge + dir * hi * DPR) + 1);
  const xs = span(X(b.left - lo) + TRIM * DPR, X(b.right + lo) - TRIM * DPR);
  const ys = span(Y(b.top - lo) + TRIM * DPR, Y(b.bottom + lo) - TRIM * DPR);
  /* what the ring is drawn against: two device px each side of the band,
     past its slack, outward of its outer edge (at(k) = hi + k) and inward
     of its inner one (lo - k), on all four sides; the whole shot's
     commonest colour where neither is on screen */
  const strip = at => {
    const pts = [];
    for (const k of [2, 3]) {
      const d = Math.round(at(k));
      for (const x of xs) pts.push([x, Y(b.top) - d], [x, Y(b.bottom) + d]);
      for (const y of ys) pts.push([X(b.left) - d, y], [X(b.right) + d, y]);
    }
    return pts.filter(inside);
  };
  const all = [];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) all.push([x, y]);
  const shot = commonest(all);
  const outer = commonest(strip(k => hi * DPR + k)) || shot;
  const inner = commonest(strip(k => lo * DPR - k)) || shot;
  /* a band pixel is the ring's when nearer its colour than what is outside it */
  const isRing = p => d2(p, rgb) < d2(p, outer);
  /* positions outside the shot (off screen) are not counted either way */
  const run = (name, along, across) => {
    let hit = 0, n = 0;
    for (const a of along) {
      const at = across.map(c => c(a)).filter(inside);
      if (!at.length) continue;
      n++;
      if (at.some(([x, y]) => isRing(px(x, y)))) hit++;
    }
    out[name] = n ? hit / n : 0;
  };
  run('top', xs, band(Y(b.top), -1).map(y => x => [x, y]));
  run('bottom', xs, band(Y(b.bottom), 1).map(y => x => [x, y]));
  run('left', ys, band(X(b.left), -1).map(x => y => [x, y]));
  run('right', ys, band(X(b.right), 1).map(x => y => [x, y]));
  return { cover: out, either: [outer, inner] };
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-focus-ring: SKIP - ' + why); return; }
  const site = await A.pages();
  const fails = [], seen = [];
  let low = Infinity, lowContrast = Infinity;
  const visit = async (s, label) => {
    const ring = await s.evaluate(A.focusRing);
    if (!ring) return null;
    const id = label + ' ' + ring.where + (ring.label ? ' "' + ring.label + '"' : '');
    seen.push(id);
    if (!ring.drawn) { fails.push(id + ': no focus ring (outline ' + ring.style + ' ' + ring.width + 'px)'); return ring; }
    for (const c of ring.clips) fails.push(id + ': ring clipped by ' + c);
    await A.settle(s.page);
    /* screenshot clips are in document coordinates, the ring's box in the
       viewport's. Only what is on screen can be shot: a side of a ring
       around something taller or wider than the viewport (a focusable panel)
       is left to the geometric test above. */
    const [sx, sy] = ring.scroll, b = ring.box;
    const doc = Object.assign({}, ring, { box: { left: b.left + sx, right: b.right + sx, top: b.top + sy, bottom: b.bottom + sy } });
    const pad = Math.abs(ring.offset) + ring.width + 4;
    const view = await s.evaluate(() => ({ x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }));
    const x0 = Math.max(Math.floor(doc.box.left - pad), view.x), y0 = Math.max(Math.floor(doc.box.top - pad), view.y);
    const x1 = Math.min(Math.ceil(doc.box.right + pad) + 1, view.x + view.w), y1 = Math.min(Math.ceil(doc.box.bottom + pad) + 1, view.y + view.h);
    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const img = B.decodePNG(await s.screenshot({ clip }));
    const { cover, either } = sides(img, doc, clip);
    const onScreen = { top: doc.box.top - pad >= view.y, bottom: doc.box.bottom + pad <= view.y + view.h,
                       left: doc.box.left - pad >= view.x, right: doc.box.right + pad <= view.x + view.w };
    for (const k of Object.keys(cover)) if (!onScreen[k]) delete cover[k];
    const missing = Object.keys(cover).filter(k => cover[k] < COVER);
    if (missing.length) fails.push(id + ': ring missing on the ' + missing.map(k => k + ' (' + Math.round(100 * cover[k]) + '%)').join(', '));
    low = Math.min(low, ...Object.values(cover));
    const [k, bg] = either.map(c => [A.ratio(A.parse(ring.color), c), c]).sort((p, q) => p[0] - q[0])[0];
    lowContrast = Math.min(lowContrast, k);
    if (k < NEED) fails.push(id + ': ring ' + A.fmt(k) + ' against rgb(' + bg.join(', ') + ') beside it (needs 3:1)');
    return ring;
  };
  const tabThrough = async (s, label, onStop) => {
    let first = null;
    for (let i = 0; i < MAX_STOPS; i++) {
      await s.page.keyboard.press('Tab');
      const key = await s.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? a.outerHTML.slice(0, 120) : null; });
      if (!key || key === first) break;
      if (!first) first = key;
      await visit(s, label);
      if (onStop) await onStop(s);
    }
  };
  try {
    let s = await site.open('index.html', { width: 1440, height: 900, dpr: DPR });
    try {
      await s.page.mouse.move(1, 1);
      await tabThrough(s, 'index', async st => {
        /* the tablist is one Tab stop; its other tabs are reached by arrow keys */
        if (await st.evaluate(() => document.activeElement.getAttribute('role') === 'tab')) {
          const n = await st.evaluate(() => document.querySelectorAll('[role="tab"]').length);
          for (let i = 1; i < n; i++) { await st.page.keyboard.press('ArrowRight'); await visit(st, 'index (arrow)'); }
          await st.page.keyboard.press('ArrowRight');
        }
      });
      for (const e of s.errors) fails.push('index.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
    const nIndex = seen.length;
    s = await site.open('blog/post-template.html', { width: 1440, height: 900, dpr: DPR });
    try {
      await s.page.mouse.move(1, 1);
      await tabThrough(s, 'template');
      for (const e of s.errors) fails.push('post-template.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
    if (nIndex < 6) fails.push('only ' + nIndex + ' focus stops found on index.html (expected at least 6)');
    if (seen.length - nIndex < TEMPLATE_STOPS) fails.push('only ' + (seen.length - nIndex) + ' focus stops found on the template (expected at least ' + TEMPLATE_STOPS + ')');
    if (!seen.slice(nIndex).some(id => /^template pre\b/.test(id))) fails.push('the template\'s code block is not a focus stop: a keyboard-only Safari visitor could not scroll it (tabindex="0" on its <pre>)');
    if (fails.length) {
      console.log('check-focus-ring: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
      for (const f of fails.slice(1)) console.log('  ' + f);
      process.exitCode = 1;
      return;
    }
    console.log('check-focus-ring: OK - ' + nIndex + ' focus stops on index.html (Tab, and arrows across the tablist) and '
                + (seen.length - nIndex) + ' on the template, its code block one: every ring drawn, clipped by no ancestor, and showing on every side in view (lowest side coverage '
                + Math.round(100 * low) + '%, needs 90%); ring contrast at least ' + A.fmt(lowContrast) + ' against the colours either side of it');
  } finally {
    await site.close();
  }
}
main().catch(e => { console.log('check-focus-ring: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
