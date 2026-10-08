'use strict';
/* Text contrast, measured on the rendered page, not assumed from the tokens.
   Headless Chrome (browser.js) loads index.html and the post template and
   every visible piece of text is measured against the background actually
   behind it (the computed colours, composited out to the first opaque
   layer), by the WCAG 2.x formula in a11y.js:

     index.html with each tab selected, every tab hovered with each tab
     selected (a hovered selected tab was 4.19:1), every rail link hovered,
     and a real pill link (<a class="btn">, which README says replaces a
     pending slot) at rest and hovered;
     blog/post-template.html, with its tabs and back link hovered.

   Text needs 4.5:1 (3:1 at 24px, or 18.66px bold), all of it, the pending
   pdf/blog slots included (they were 1.91:1). Text with nothing opaque
   between it and the moving #cosmos art cannot be measured and fails. The dice glyph is the only thing
   that shows the dice control is there, so it needs the non-text 3:1
   (1.4.11) at rest, hovered and focused.

   Colours are read as Chrome computes them: the hover wash is
   rgba(30, 30, 32, 0.043), not the 0.045 site.css writes (alpha is stored
   in 8 bits), which is why a figure here can differ from a hand calculation
   in the second decimal.

   Without Chrome it falls back to the token pairs site.css documents and
   says so. Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');
const A = require('./a11y');

const NEED_GLYPH = 3;

function staticFallback(why) {
  const css = fs.readFileSync(path.join(B.ROOT, 'assets', 'css', 'site.css'), 'utf8');
  const t = A.tokens(css);
  const col = k => { const p = A.parse(t[k] || ''); if (!p) throw new Error('site.css :root has no colour ' + k); return p; };
  const wash = A.parse(t['--hover'].replace(/\s+/g, ' '));
  const onWash = A.over(wash, wash[3], col('--surface'));
  const pairs = [
    ['--mist text on --surface', col('--mist'), col('--surface')],
    ['--accent text on --surface', col('--accent'), col('--surface')],
    ['--accent-deep (.btn) on --coat', col('--accent-deep'), col('--coat')],
    ['--accent-deep (selected tab, hovered) on the hover wash', col('--accent-deep'), onWash],
    ['--body (tab, hovered) on the hover wash', col('--body'), onWash]
  ];
  const bad = pairs.map(([n, f, b]) => [n, A.ratio(f, b)]).filter(([, r]) => r < 4.5);
  if (bad.length) {
    console.log('check-contrast: FAIL - (static fallback, ' + why + ') ' + bad.map(([n, r]) => n + ' ' + A.fmt(r)).join('; '));
    process.exit(1);
  }
  console.log('check-contrast: OK - static fallback only (' + why + '): ' + pairs.length + ' token pairs at least 4.5:1');
}

async function main() {
  const why = B.unavailable();
  if (why) { staticFallback(why); return; }
  const site = await A.pages();
  const fails = [];
  let runs = 0, states = 0, lowest = null;
  const glyph = {};
  const take = (label, measured) => {
    states++;
    for (const r of measured) {
      runs++;
      const id = r.where + ' "' + r.text + '"';
      if (r.problem) { fails.push(label + ': ' + id + ': ' + r.problem); continue; }
      if (r.ratio < r.need) fails.push(label + ': ' + id + ' ' + A.fmt(r.ratio) + ' (needs ' + r.need + ':1; ' + r.color + ' on rgb(' + r.bg.join(', ') + '))');
      if (!lowest || r.ratio < lowest.ratio) lowest = Object.assign({ label }, r);
    }
  };
  const scan = async (s, label, root) => take(label, A.measureRuns(await s.evaluate(A.textRuns, root || null), 'screen'));
  /* select a tab the way a deep link does, and wait until the controller has run */
  const goto = (s, hash) => s.evaluate(h => new Promise(res => {
    if (location.hash === h) { res(); return; }
    window.addEventListener('hashchange', () => res(), { once: true });
    location.hash = h;
  }), hash);
  const hover = async (s, sel, label) => {
    await s.page.hover(sel);
    await A.settle(s.page);
    await scan(s, label, sel);
    await s.page.mouse.move(1, 1);
    await A.settle(s.page);
  };
  /* the dice glyph against the background behind the dice */
  const dice = async (s, label) => {
    const g = await s.evaluate(() => {
      const d = document.getElementById('dice');
      if (!d) return null;
      const layers = [];
      let opaque = false;
      for (let n = d; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor, m = /rgba?\(([^)]*)\)/.exec(c);
        const p = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
        const a = p.length > 3 ? parseFloat(p[3]) : p.length ? 1 : 0;
        if (a > 0) layers.push(c);
        if (a >= 1) { opaque = true; break; }
      }
      return { color: getComputedStyle(d.querySelector('svg')).color, layers, opaque };
    });
    if (!g) return;
    if (!g.opaque) { fails.push('dice glyph ' + label + ': nothing opaque behind the dice but the #cosmos art'); return; }
    const b = g.layers.slice().reverse().reduce((bg, l) => { const p = A.parse(l); return A.over(p, p[3], bg); }, [255, 255, 255]);
    const c = A.parse(g.color);
    glyph[label] = A.ratio(A.over(c, c[3], b), b);
    if (glyph[label] < NEED_GLYPH) fails.push('dice glyph ' + label + ' ' + A.fmt(glyph[label]) + ' (needs ' + NEED_GLYPH + ':1, non-text; ' + g.color + ' on rgb(' + b.map(Math.round).join(', ') + '))');
  };
  try {
    /* ---- index.html ---- */
    let s = await site.open('index.html', { width: 1440, height: 900 });
    try {
      const tabs = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => t.id));
      for (const sel of tabs) {
        await goto(s, '#' + sel.replace('tab-', ''));
        await A.settle(s.page);
        await scan(s, 'index #' + sel.replace('tab-', '') + ' selected');
        for (const other of tabs) await hover(s, '#' + other, 'index #' + sel.replace('tab-', '') + ' selected, ' + other + ' hovered');
      }
      /* the rail's links show on the about tab only (site.css) */
      await goto(s, '#about');
      await A.settle(s.page);
      const rail = await s.evaluate(() => document.querySelectorAll('.social a').length);
      for (let i = 1; i <= rail; i++) await hover(s, '.social a:nth-of-type(' + i + ')', 'index rail link ' + i + ' hovered');
      await dice(s, 'at rest');
      await s.page.hover('#dice');
      await A.settle(s.page);
      await dice(s, 'hovered');
      await s.page.mouse.move(1, 1);
      for (let i = 0; i < 40; i++) {
        await s.page.keyboard.press('Tab');
        if (await s.evaluate(() => document.activeElement && document.activeElement.id === 'dice')) break;
      }
      await A.settle(s.page);
      if (await s.evaluate(() => document.activeElement && document.activeElement.id === 'dice')) await dice(s, 'focused');
      else fails.push('the dice never took keyboard focus (40 Tab presses)');
      /* a real pill link, as README's recipe makes one */
      await goto(s, '#research');
      await s.evaluate(() => {
        const row = document.querySelector('.pub .links') || document.querySelector('main');
        const a = document.createElement('a');
        a.className = 'btn'; a.id = 'contrast-probe'; a.href = '#research'; a.textContent = 'pdf';
        row.appendChild(a);
      });
      await A.settle(s.page);
      await scan(s, 'index a.btn at rest', '#contrast-probe');
      await hover(s, '#contrast-probe', 'index a.btn hovered');
      for (const e of s.errors) fails.push('index.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }

    /* ---- the post template ---- */
    s = await site.open('blog/post-template.html', { width: 1440, height: 900 });
    try {
      await A.settle(s.page);
      await scan(s, 'template');
      const n = await s.evaluate(() => document.querySelectorAll('.tabs .tab').length);
      for (let i = 1; i <= n; i++) await hover(s, '.tabs .tab:nth-of-type(' + i + ')', 'template tab ' + i + ' hovered');
      if (await s.evaluate(() => !!document.querySelector('.back'))) await hover(s, '.back', 'template back link hovered');
      for (const e of s.errors) fails.push('post-template.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
  } finally {
    await site.close();
  }
  if (!('focused' in glyph) && !fails.length) fails.push('dice glyph not measured when focused');
  if (fails.length) {
    console.log('check-contrast: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-contrast: OK - ' + runs + ' text runs in ' + states + ' states (index.html: 3 tabs, every tab hovered under each, rail links, a.btn; the template): all at least 4.5:1 (3:1 large); lowest '
              + A.fmt(lowest.ratio) + ' (' + lowest.where + ' "' + lowest.text + '", ' + lowest.label + '); dice glyph '
              + ['at rest', 'hovered', 'focused'].map(k => A.fmt(glyph[k])).join(' / ') + ' at rest / hovered / focused (needs 3:1)');
}
main().catch(e => { console.log('check-contrast: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
