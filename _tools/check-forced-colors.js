'use strict';
/* In forced colours (Windows Contrast themes) the selected tab is still
   marked. Forced colours repaint every author background in the theme's
   Canvas colour and every link in LinkText, so a selection drawn as an
   accent-coloured text and a 2px accent bar disappears: the three tabs
   looked the same. Headless Chrome emulates forced-colors: active (through
   the DevTools protocol, with both the light and the dark default palette)
   on index.html with each tab selected and on the post template, and reads
   the pixels of the bar under each tab:

     the selected (index) or current (template: aria-current="true", the
       section the post belongs to) tab's bar is drawn: at least 80% of its
       pixels have 3:1 against Canvas (1.4.11);
     every other tab's bar is not: at most 5%;
     and, as the control, the same reading in normal colours finds the bar
       under index.html's selected tab and the template's current one, and
       no other: a bar this test could not see would fail here, and so
       would a post's aria-current="true" not styled as index.html's
       selected tab (check-contrast passes it either way: unstyled, it is
       --mist, 4.64:1).

   At dpr 2 the two device rows at the bar's centre are sampled: a box edge
   on a fractional CSS px is snapped to a device pixel, which can move the
   bar half a pixel, so its edge rows are not reliable. (The tab bar's 1px
   divider runs under the bars; forced colours drop it, being a gradient.)
   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

const DPR = 2, ON = 0.8, OFF = 0.05, NEED = 3;

async function bars(s) {
  const tabs = await s.evaluate(() => Array.from(document.querySelectorAll('.tabs .tab')).map(t => {
    const b = t.getBoundingClientRect();
    return { name: t.textContent.trim(), marked: t.getAttribute('aria-selected') === 'true' || ['page', 'true'].includes(t.getAttribute('aria-current')),
             left: b.left + scrollX, right: b.right + scrollX, bottom: b.bottom + scrollY, top: b.top + scrollY };
  }));
  const canvas = A.parse(await s.evaluate(() => getComputedStyle(document.querySelector('.shell')).backgroundColor));
  const x0 = Math.floor(Math.min(...tabs.map(t => t.left))), x1 = Math.ceil(Math.max(...tabs.map(t => t.right)));
  const y0 = Math.floor(Math.min(...tabs.map(t => t.top))), y1 = Math.ceil(Math.max(...tabs.map(t => t.bottom)));
  const img = B.decodePNG(await s.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }));
  return tabs.map(t => {
    /* the bar: 6px in from each side, the two device rows at its centre */
    const c = Math.floor((t.bottom - 1 - y0) * DPR), ya = c - 1, yb = c + 1;
    const xa = Math.round((t.left + 6 - x0) * DPR), xb = Math.round((t.right - 6 - x0) * DPR);
    let n = 0, hit = 0;
    const seen = new Map();
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const o = (y * img.width + x) * 4, p = [img.data[o], img.data[o + 1], img.data[o + 2]];
      n++;
      if (A.ratio(p, canvas) >= NEED) { hit++; const k = p.join(','); seen.set(k, (seen.get(k) || 0) + 1); }
    }
    const top = Array.from(seen).sort((a, b) => b[1] - a[1])[0];
    return { name: t.name, marked: t.marked, share: n ? hit / n : 0, colour: top ? top[0] : null, contrast: top ? A.ratio(top[0].split(',').map(Number), canvas) : 0 };
  });
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-forced-colors: SKIP - ' + why); return; }
  const site = await A.pages();
  const fails = [], seen = [], control = [];
  let lowOn = 1, highOff = 0, lowContrast = Infinity;
  const judge = (label, list) => {
    if (list.filter(t => t.marked).length !== 1) fails.push(label + ': ' + list.filter(t => t.marked).length + ' tabs marked selected/current (expected 1)');
    for (const t of list) {
      if (t.marked) {
        lowOn = Math.min(lowOn, t.share);
        if (t.share < ON) fails.push(label + ': the selected tab "' + t.name + '" shows no bar (' + Math.round(100 * t.share) + '% of its pixels at 3:1 on Canvas, needs ' + 100 * ON + '%)');
        else lowContrast = Math.min(lowContrast, t.contrast);
      } else {
        highOff = Math.max(highOff, t.share);
        if (t.share > OFF) fails.push(label + ': the unselected tab "' + t.name + '" shows a bar (' + Math.round(100 * t.share) + '%)');
      }
    }
    seen.push(label);
  };
  try {
    for (const scheme of ['light', 'dark']) {
      const emulate = async s => {
        const cdp = await s.page.createCDPSession();
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: scheme }] });
        if (!(await s.evaluate(() => matchMedia('(forced-colors: active)').matches))) throw new Error('forced-colors emulation did not take');
        await s.page.mouse.move(1, 1);
      };
      let s = await site.open('index.html', { width: 1200, height: 800, dpr: DPR });
      try {
        await emulate(s);
        const names = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => t.dataset.tab));
        for (const n of names) {
          await s.evaluate(h => new Promise(res => {
            if (location.hash === h) { res(); return; }
            window.addEventListener('hashchange', () => res(), { once: true });
            location.hash = h;
          }), '#' + n);
          await A.settle(s.page);
          judge(scheme + ' index #' + n, await bars(s));
        }
      } finally { await s.close(); }
      s = await site.open('blog/post-template.html', { width: 1200, height: 800, dpr: DPR });
      try {
        await emulate(s);
        await A.settle(s.page);
        judge(scheme + ' template', await bars(s));
      } finally { await s.close(); }
    }
    for (const f of ['index.html', 'blog/post-template.html']) {
      const s = await site.open(f, { width: 1200, height: 800, dpr: DPR });
      try {
        await s.page.mouse.move(1, 1);
        await A.settle(s.page);
        const list = await bars(s), on = list.filter(t => t.marked);
        if (on.length !== 1 || on[0].share < ON) fails.push('normal colours, ' + f + ': ' + (on.length === 1 ? 'the marked tab "' + on[0].name + '" shows no bar (' + Math.round(100 * on[0].share) + '%)' : on.length + ' tabs marked (expected 1)'));
        for (const t of list) if (!t.marked && t.share > OFF) fails.push('normal colours, ' + f + ': the unmarked tab "' + t.name + '" shows a bar (' + Math.round(100 * t.share) + '%)');
        control.push(f + ' "' + (on[0] ? on[0].name + '" ' + Math.round(100 * on[0].share) + '%' : '?"'));
      } finally { await s.close(); }
    }
  } finally {
    await site.close();
  }
  if (fails.length) {
    console.log('check-forced-colors: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-forced-colors: OK - forced colours, light and dark palettes, ' + seen.length + ' states (index.html with each tab selected, the template): the selected tab\'s bar is drawn ('
              + Math.round(100 * lowOn) + '%+ of its pixels, ' + A.fmt(lowContrast) + '+ on Canvas) and no other tab shows one (at most ' + Math.round(100 * highOff) + '%); control, normal colours: the bar under '
              + control.join(', ') + ' and no other');
}
main().catch(e => { console.log('check-forced-colors: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
