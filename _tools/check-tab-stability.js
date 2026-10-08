'use strict';
/* Switching tabs moves nothing (README: "switching tabs never reflows the
   content column"). Headless Chrome with real, layout-taking scrollbars
   (a11y.js; puppeteer hides them by default, and hidden scrollbars can never
   shift anything) loads index.html at four sizes and selects each tab:

     the card (.shell) and the content column (main) keep their place and
       width, to 0.01px. The panels differ a lot in height, so where the page
       scrolls on one tab and not another the scrollbar came and went and the
       centred card hopped sideways by half the scrollbar's width;
     the active panel starts at the top of the content column. Research and
       writing started 56px lower than about, from a margin meant only for
       the no-JS layout. Where the rail stands beside the column, the
       column's top stays put too; where it stacks above (phones), the
       about-only portrait changes the rail's height by design, so there only
       the panel's offset inside the column is held;
     #cosmos's box is the layout viewport's width (the root element's box)
       on every tab, so a renderer sizing from its own box sees one width
       throughout. Not documentElement.clientWidth: with the gutter reserved
       and no scrollbar showing, Chrome reports the width with the unused
       gutter in it (1699 against a 1684px layout at 1699x887).

   Control: at least one size must actually scroll on one tab and not on
   another, or the scrollbar half proves nothing; one size is chosen from
   the panels' own heights so that it does. With scripting off, every
   panel shows, stacked 56px apart (the no-JS long read).
   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

const SIZES = [[1699, 887], [1280, 720], [880, 700], [390, 844]];
const TOL = 0.01, NOJS_GAP = 56;

/* One more size whatever the content: 1440 wide, and tall enough that the
   shortest tab fits while the tallest scrolls (half way between their
   heights), so the scrollbar is made to come and go even once the panels
   grow past every fixed size above. */
async function adaptiveSize(site) {
  const s = await site.open('index.html', { width: 1440, height: 4000 });
  try {
    const heights = [];
    for (const n of await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => t.dataset.tab))) {
      await s.evaluate(hash => new Promise(res => {
        if (location.hash === hash) { res(); return; }
        window.addEventListener('hashchange', () => res(), { once: true });
        location.hash = hash;
      }), '#' + n);
      await A.settle(s.page);
      heights.push(await s.evaluate(() => document.documentElement.getBoundingClientRect().height));
    }
    const lo = Math.min(...heights), hi = Math.max(...heights);
    return hi - lo > 4 ? [1440, Math.round((lo + hi) / 2)] : null;
  } finally { await s.close(); }
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-tab-stability: SKIP - ' + why); return; }
  const site = await A.pages({ scrollbars: true });
  const fails = [];
  let toggles = 0, gutter = 0, maxDrift = 0, cases = 0, stacked = 0;
  const sizes = SIZES.slice();
  try {
    const extra = await adaptiveSize(site);
    if (extra) sizes.push(extra);
    for (const [w, h] of sizes) {
      const s = await site.open('index.html', { width: w, height: h });
      try {
        const names = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => t.dataset.tab));
        const rows = [];
        for (const n of names) {
          await s.evaluate(hash => new Promise(res => {
            if (location.hash === hash) { res(); return; }
            window.addEventListener('hashchange', () => res(), { once: true });
            location.hash = hash;
          }), '#' + n);
          await A.settle(s.page);
          rows.push(await s.evaluate(() => {
            const r = el => { const b = el.getBoundingClientRect(); return { left: b.left + scrollX, top: b.top + scrollY, width: b.width, right: b.right + scrollX }; };
            const panel = document.querySelector('.panel.is-active');
            const de = document.documentElement;
            return {
              tab: document.body.dataset.tab, shell: r(document.querySelector('.shell')), main: r(document.querySelector('main')),
              rail: r(document.querySelector('.rail')),
              panel: panel ? r(panel) : null, margin: panel ? parseFloat(getComputedStyle(panel).marginTop) : NaN,
              client: de.getBoundingClientRect().width, inner: window.innerWidth, scrolls: de.scrollHeight > window.innerHeight,
              cosmos: document.getElementById('cosmos').getBoundingClientRect().width
            };
          }));
          cases++;
        }
        const at = w + 'x' + h;
        if (new Set(rows.map(r => r.scrolls)).size > 1) toggles++;
        gutter = Math.max(gutter, ...rows.map(r => r.inner - r.client));
        const ref = rows[0];
        for (const r of rows) {
          const drift = [['card left', r.shell.left - ref.shell.left], ['card width', r.shell.width - ref.shell.width],
                         ['content column left', r.main.left - ref.main.left], ['content column width', r.main.width - ref.main.width],
                         ['panel offset in the column', r.panel && ref.panel ? (r.panel.top - r.main.top) - (ref.panel.top - ref.main.top) : NaN]];
          /* rail beside the column: the column itself must not move down either */
          if (r.rail.right <= r.main.left + 0.5 && ref.rail.right <= ref.main.left + 0.5) drift.push(['content column top', r.main.top - ref.main.top]);
          for (const [what, d] of drift) {
            if (!(Math.abs(d) <= TOL)) fails.push(at + ' ' + ref.tab + ' -> ' + r.tab + ': ' + what + ' moves ' + d.toFixed(2) + 'px'
                                                + (what.startsWith('card') ? ' (page ' + (ref.scrolls ? 'scrolls' : 'fits') + ' -> ' + (r.scrolls ? 'scrolls' : 'fits') + ', layout width ' + ref.client + ' -> ' + r.client + ')' : ''));
            else maxDrift = Math.max(maxDrift, Math.abs(d));
          }
          if (r.margin !== 0) fails.push(at + ' ' + r.tab + ': the active panel has margin-top ' + r.margin + 'px with tabs on (0 expected)');
          if (Math.abs(r.cosmos - r.client) > TOL) fails.push(at + ' ' + r.tab + ': #cosmos is ' + r.cosmos + 'px wide, the layout viewport ' + r.client + 'px');
          if (Math.abs(r.cosmos - ref.cosmos) > TOL) fails.push(at + ' ' + ref.tab + ' -> ' + r.tab + ': #cosmos changes width ' + ref.cosmos + ' -> ' + r.cosmos + 'px');
        }
        for (const e of s.errors) fails.push(at + ': ' + e.type + ': ' + e.text);
      } finally { await s.close(); }
    }
    if (!toggles) fails.push('control: at no size does the page scroll on one tab and fit on another, so the scrollbar half proved nothing');
    if (!gutter) fails.push('control: scrollbars take no layout space in this browser, so the scrollbar half proved nothing');
    /* the no-JS long read */
    const s = await site.open('index.html', { width: 1440, height: 900, javaScript: false });
    let nojs;
    try {
      nojs = await s.evaluate(() => Array.from(document.querySelectorAll('main .panel')).map(p => ({
        id: p.id, shown: p.getClientRects().length > 0, margin: parseFloat(getComputedStyle(p).marginTop) })));
    } finally { await s.close(); }
    stacked = nojs.length;
    if (nojs.length < 3) fails.push('no-JS: only ' + nojs.length + ' panels found');
    nojs.forEach((p, i) => {
      if (!p.shown) fails.push('no-JS: ' + p.id + ' is hidden (every panel must show without JS)');
      const want = i ? NOJS_GAP : 0;
      if (p.margin !== want) fails.push('no-JS: ' + p.id + ' margin-top ' + p.margin + 'px (' + want + ' expected)');
    });
  } finally {
    await site.close();
  }
  if (fails.length) {
    console.log('check-tab-stability: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-tab-stability: OK - ' + sizes.map(z => z.join('x')).join(', ') + ' x 3 tabs (' + cases + ' cases) with real ' + gutter + 'px scrollbars, the page scrolling on one tab and not another at '
              + toggles + ' sizes: the card and the content column never move and the active panel starts at the top of the column (largest drift '
              + maxDrift.toFixed(2) + 'px); #cosmos one width on every tab, the layout viewport width; no JS: ' + stacked + ' panels shown, ' + NOJS_GAP + 'px apart');
}
main().catch(e => { console.log('check-tab-stability: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
