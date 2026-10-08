'use strict';
/* Each live page's head, headings and share of the site's code: index.html
   and the post template every new post is copied from (under SITE_ROOT).

   Static:
     a meta description (index: 50-160 characters, so a search result does
       not cut it) and the social-preview tags a shared link needs:
       og:title, og:description (the same text), og:type (website; the
       template: article), twitter:card; og:url and og:image only as
       absolute https URLs, since a relative one is ignored (audit F37);
     one h1 per page: on the template the post title, not the site name
       (F38);
     the template runs the site's own assets/js/site.js and declares no copy
       of what site.js or site.css hold (the dice, the category dots), and
       its masthead is index.html's (F53).
   In headless Chrome:
     the favicon (one icon, the same on both pages) shows on light and dark
       tab strips whichever colour scheme the browser is in: at least 8% of
       its box has 3:1 against the strip, at 16 and 32px (it was #1E1E20
       alone: 1.03:1 on Chrome's dark strip; F39);
     on the template the category dot sits the meta row's own gap from the
       date (it was 21px against a 10px gap), and the dice roll and are
       announced, i.e. site.js runs there.
   The browser half SKIPs when puppeteer-core or Chrome is missing.
   Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const B = require('./browser');

const ROOT = B.ROOT;
const fails = [];
const fail = m => fails.push(m);
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { fail(p + ' cannot be read'); return ''; } };
const index = read('index.html'), tpl = read('blog/post-template.html');
const headOf = h => h.slice(0, Math.max(0, h.indexOf('</head>')));
const metas = h => {
  const out = {};
  for (const m of headOf(h).matchAll(/<meta\b([^>]*)>/gi)) {
    const k = (/\b(?:name|property)\s*=\s*"([^"]+)"/i.exec(m[1]) || [])[1];
    const v = (/\bcontent\s*=\s*"([^"]*)"/i.exec(m[1]) || [])[1];
    if (k) out[k] = v === undefined ? '' : v.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }
  return out;
};
const icons = h => Array.from(headOf(h).matchAll(/<link\s+rel="icon"\s+href="([^"]+)"/gi)).map(m => m[1]);

/* ---- F37 ---- */
for (const [p, h, type] of [['index.html', index, 'website'], ['blog/post-template.html', tpl, 'article']]) {
  const m = metas(h);
  const title = ((/<title>([^<]*)<\/title>/i.exec(h) || [])[1] || '').trim();
  if (!m.description) fail(p + ': no <meta name="description">');
  else if (p === 'index.html' && (m.description.length < 50 || m.description.length > 160)) fail(p + ': the description is ' + m.description.length + ' characters (50-160)');
  if (!m['og:title']) fail(p + ': no og:title');
  if (m['og:description'] !== m.description) fail(p + ': og:description ' + JSON.stringify(m['og:description']) + ' differs from the description');
  if (m['og:type'] !== type) fail(p + ': og:type is ' + JSON.stringify(m['og:type']) + ', expected ' + type);
  if (!/^summary(_large_image)?$/.test(m['twitter:card'] || '')) fail(p + ': twitter:card is ' + JSON.stringify(m['twitter:card']) + ' (summary or summary_large_image; without it X ignores the og: tags)');
  for (const k of ['og:url', 'og:image']) if (k in m && !/^https:\/\//.test(m[k])) fail(p + ': ' + k + ' ' + JSON.stringify(m[k]) + ' is not an absolute https URL, which unfurlers ignore');
  if (p === 'index.html' && m['og:title'] && title && !title.includes(m['og:title']) && !m['og:title'].includes(title)) fail(p + ': og:title ' + JSON.stringify(m['og:title']) + ' does not match the <title> ' + JSON.stringify(title));
}

/* ---- F38 ---- */
for (const [p, h] of [['index.html', index], ['blog/post-template.html', tpl]]) {
  const body = h.slice(h.indexOf('<body')).replace(/<!--[\s\S]*?-->/g, '');
  const n = (body.match(/<h1\b/gi) || []).length;
  if (n !== 1) fail(p + ': ' + n + ' <h1> elements (one per page)');
}
if (!/<article>[\s\S]*<h1 class="post-h">/.test(tpl.replace(/<!--[\s\S]*?-->/g, ''))) fail('blog/post-template.html: its h1 is not the post title inside <article>');

/* ---- F53 ---- */
{
  const scripts = Array.from(tpl.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  const srcs = scripts.map(m => (/\bsrc\s*=\s*"([^"]+)"/i.exec(m[1]) || [])[1]).filter(Boolean).map(u => u.replace(/\?v=[0-9a-f]+$/, ''));   /* less the stamp (stamp.js) */
  if (!srcs.includes('../assets/js/site.js')) fail('the template does not load ../assets/js/site.js (' + JSON.stringify(srcs) + ')');
  const site = read('assets/js/site.js');
  for (const m of scripts) {
    const body = m[2];
    if (/\bPIPS\b|getElementById\('dice'\)|\.tab\[role/.test(body)) fail('the template has an inline copy of site.js code (' + JSON.stringify(body.trim().slice(0, 40)) + '...)');
    if (body.trim() && site.includes(body.trim().slice(0, 80))) fail('an inline template script repeats site.js');
  }
  const styles = Array.from(headOf(tpl).matchAll(/<style>([\s\S]*?)<\/style>/gi)).map(m => m[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  if (/(^|[\s,}])\.cat(-\w+)?\s*[{,]/.test(styles)) fail('the template declares its own .cat rules (site.css has them; a retune there never reached a post)');
  const brand = h => ((/<a class="brand"[^>]*>([\s\S]*?)<\/a>/.exec(h) || [])[1] || '').trim();
  if (brand(tpl) !== brand(index)) fail('the template\'s masthead (' + JSON.stringify(brand(tpl).slice(0, 60)) + ') differs from index.html\'s (' + JSON.stringify(brand(index).slice(0, 60)) + ')');
}

/* ---- the browser half: favicon, the template ---- */
const STRIPS = { light: ['#FFFFFF', '#DEE1E6'], dark: ['#202124', '#35363A'] };
const SIZES = [16, 32], ICON_SHARE = 0.08;
async function browserHalf() {
  const why = B.unavailable();
  if (why) return 'browser half skipped (' + why + ')';
  const A = require('./a11y');
  const ix = icons(index), tp = icons(tpl);
  if (ix.length !== 1) fail('index.html has ' + ix.length + ' icon links');
  if (tp.length !== 1 || tp[0] !== ix[0]) fail('the template\'s favicon is not index.html\'s');
  const site = await B.serve();
  const b = await B.launch();
  let lowest = Infinity, where = '';
  const facts = {};
  try {
    if (ix.length === 1) {
      const href = ix[0].replace(/&amp;/g, '&');
      for (const scheme of ['light', 'dark']) {
        const s = await b.open(site.url + 'index.html', { width: 400, height: 200, dpr: 1 });
        try {
          await s.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
          const cells = [];
          for (const c of [].concat(STRIPS.light, STRIPS.dark)) for (const z of SIZES) cells.push({ c, z });
          await s.page.setContent('<!DOCTYPE html><body style="margin:0;display:flex;flex-wrap:wrap">' + cells.map((x, i) =>
            '<div style="background:' + x.c + ';padding:4px;line-height:0"><img id="i' + i + '" width="' + x.z + '" height="' + x.z + '" src="' + href.replace(/"/g, '&quot;') + '"></div>').join('') + '</body>', { waitUntil: 'load' });
          const boxes = await s.evaluate(n => Array.from({ length: n }, (_, i) => {
            const im = document.getElementById('i' + i), r = im.getBoundingClientRect();
            return { ok: im.complete && im.naturalWidth > 0, x: r.left, y: r.top, w: r.width, h: r.height };
          }), cells.length);
          const img = B.decodePNG(await s.screenshot());
          boxes.forEach((bx, i) => {
            const label = scheme + ' scheme, ' + cells[i].c + ' strip, ' + cells[i].z + 'px';
            if (!bx.ok) { fail('the favicon does not render (' + label + '): a mis-encoded data URI'); return; }
            const bg = A.parse(cells[i].c);
            let n = 0, hit = 0;
            for (let y = Math.round(bx.y); y < Math.round(bx.y + bx.h); y++) for (let x = Math.round(bx.x); x < Math.round(bx.x + bx.w); x++) {
              const o = (y * img.width + x) * 4;
              n++;
              if (A.ratio([img.data[o], img.data[o + 1], img.data[o + 2]], bg) >= 3) hit++;
            }
            const share = hit / n;
            facts[label] = share;
            if (share < lowest) { lowest = share; where = label; }
            if (share < ICON_SHARE) fail('the favicon nearly vanishes (' + label + '): ' + (100 * share).toFixed(1) + '% of it has 3:1 on the strip (needs ' + 100 * ICON_SHARE + '%)');
          });
        } finally { await s.close(); }
      }
    }
    /* the template: the dot's gap, and site.js at work */
    const s = await b.open(site.url + 'blog/post-template.html', { width: 1200, height: 900 });
    try {
      const g = await s.evaluate(() => {
        const row = document.querySelector('.post-meta'), dot = row && row.querySelector('.cat'), next = dot && dot.nextElementSibling;
        return row && dot && next ? { gap: parseFloat(getComputedStyle(row).columnGap), dist: next.getBoundingClientRect().left - dot.getBoundingClientRect().right } : null;
      });
      if (!g) fail('the template has no .post-meta row with a .cat dot');
      else {
        facts.gap = g;
        if (Math.abs(g.dist - g.gap) > 0.5) fail('the template\'s category dot sits ' + g.dist.toFixed(1) + 'px from the date, the row\'s gap is ' + g.gap + 'px');
      }
      await s.page.click('#dice');
      const said = await s.evaluate(() => new Promise(r => setTimeout(() => r((document.getElementById('dice-out') || {}).textContent || ''), 150)));
      const pips = await s.evaluate(() => document.querySelectorAll('#dice circle').length);
      if (!pips || !/^rolled [1-6] and [1-6]$/.test(said)) fail('on the template the dice do not roll and announce (' + pips + ' pips, said ' + JSON.stringify(said) + '): site.js is not running there');
      facts.said = said;
      for (const e of s.errors) fail('post-template.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
  } finally {
    await b.close();
    await site.close();
  }
  return 'favicon on light and dark strips in both colour schemes, 16 and 32px: lowest ' + (100 * lowest).toFixed(1) + '% of it at 3:1 (' + where + '; needs ' + 100 * ICON_SHARE
         + '%); template: dot ' + (facts.gap ? facts.gap.dist.toFixed(1) + 'px from the date, gap ' + facts.gap.gap + 'px' : '?') + ', dice "' + facts.said + '"';
}

(async () => {
  let browser = '';
  try { browser = await browserHalf(); }
  catch (e) { fail('browser: ' + ((e && e.stack) || e)); }
  if (fails.length) {
    console.log('check-pages: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  const d = metas(index).description || '';
  console.log('check-pages: OK - description (' + d.length + ' chars) and og:/twitter: tags on index.html, placeholders and og:type article on the template; one h1 each; the template runs site.js with no copy of its code or of the .cat rules, masthead as index.html; ' + browser);
})();
