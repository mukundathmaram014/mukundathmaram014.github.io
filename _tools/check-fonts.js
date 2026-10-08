'use strict';
/* The web fonts are the site's own, load without blocking on another
   origin, and every piece of text gets a real face: nothing bolded or
   slanted by the browser (audit F40, F28).

   Static, on index.html and the post template (under SITE_ROOT):
     no stylesheet or preconnect from another origin (Google Fonts' was a
       render-blocking request: 125-297ms of DNS, TCP and TLS on a cold load);
     every page links assets/css/fonts.css, and fonts.css holds nothing but
       @font-face rules: a stylesheet with media queries is re-read when
       the media change, and its faces were rebuilt with it, so text shown
       for the first time then (the hidden panels, on a switch to print)
       painted in the fallback for a frame;
     every face's file exists, is WOFF2, and can do what the rule declares:
       a weight range must lie inside the file's own wght axis (read from
       its fvar table), a single weight needs no axis;
     each family's licence (SIL OFL) sits in assets/fonts;
     what a page's inline script preloads is a file a face uses, so the
       preload is not a second download.
   In headless Chrome, index.html on each tab and the template:
     every visible run of text has a loaded face of its family covering its
       weight and style (Blink fakes a bold for 600+ asked of a face that
       stops below 600, and a slant for italic asked of an upright face);
     and switching synthesis off (font-synthesis: none) changes no pixel:
       nothing was synthesized;
     no request goes to another origin, and each font file is fetched once;
     opened on about, the italic face (research and writing only) is
       loaded once the page has, without a visit there (it used to swap in
       view on the first click);
     opened from disk (file://), the pages log no error and their faces load.
   SKIP of the browser half when puppeteer-core or Chrome is missing.
   Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const B = require('./browser');
const A = require('./a11y');

const ROOT = B.ROOT;
const PAGES = ['index.html', 'blog/post-template.html'];
const fails = [];
const fail = m => fails.push(m);

/* ---- WOFF2: the fvar axes ------------------------------------------------ */
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat',
  'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Axes(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let off = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[off++]; v = v * 128 + (b & 127); if (!(b & 128)) return v; } throw new Error('bad UIntBase128'); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[off++];
    let tag = KNOWN[flags & 63];
    if ((flags & 63) === 63) { tag = buf.toString('latin1', off, off + 4); off += 4; }
    const version = flags >> 6, orig = base128();
    /* glyf and loca are transformed at version 0; every other table only at a non-zero version */
    const transformed = (tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : orig });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(off, off + compressed));
  let at = 0;
  for (const t of tables) { t.at = at; at += t.length; }
  const fvar = tables.find(t => t.tag === 'fvar');
  const axes = {};
  if (!fvar) return axes;
  const f = data.subarray(fvar.at, fvar.at + fvar.length);
  const first = f.readUInt16BE(4), count = f.readUInt16BE(8), size = f.readUInt16BE(10);
  for (let i = 0; i < count; i++) {
    const r = first + i * size;
    axes[f.toString('latin1', r, r + 4)] = { min: f.readInt32BE(r + 4) / 65536, def: f.readInt32BE(r + 8) / 65536, max: f.readInt32BE(r + 12) / 65536 };
  }
  return axes;
}

/* ---- static ---------------------------------------------------------------- */
const fontsCss = path.join(ROOT, 'assets', 'css', 'fonts.css');
const faces = [];
if (!fs.existsSync(fontsCss)) fail('assets/css/fonts.css does not exist');
else {
  const css = fs.readFileSync(fontsCss, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rest = css.replace(/@font-face\s*\{[^}]*\}/g, '').trim();
  if (rest) fail('fonts.css holds more than @font-face rules (' + JSON.stringify(rest.slice(0, 60)) + '): with a media query in it, its faces are rebuilt on every media change');
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const d = {};
    for (const decl of m[1].split(';')) { const i = decl.indexOf(':'); if (i > 0) d[decl.slice(0, i).trim()] = decl.slice(i + 1).trim(); }
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(d.src || '');
    const w = (d['font-weight'] || '400').split(/\s+/).map(Number);
    faces.push({ family: (d['font-family'] || '').replace(/['"]/g, ''), style: d['font-style'] || 'normal', lo: w[0], hi: w.length > 1 ? w[1] : w[0],
                 display: d['font-display'], file: url ? path.resolve(path.dirname(fontsCss), url[1]) : null });
  }
  if (!faces.length) fail('fonts.css declares no @font-face');
  for (const f of faces) {
    const name = f.family + ' ' + f.style + ' ' + f.lo + (f.hi !== f.lo ? '-' + f.hi : '');
    if (!f.file || !fs.existsSync(f.file)) { fail(name + ': its file ' + (f.file || '(no url)') + ' does not exist'); continue; }
    if (f.display !== 'swap') fail(name + ': font-display ' + f.display + ' (swap keeps text visible while it loads, as Google served it)');
    let axes;
    try { axes = woff2Axes(fs.readFileSync(f.file)); } catch (e) { fail(name + ': ' + path.basename(f.file) + ': ' + e.message); continue; }
    f.axes = axes;
    if (f.hi !== f.lo) {
      if (!axes.wght) fail(name + ': declares a weight range, but ' + path.basename(f.file) + ' has no wght axis');
      else if (f.lo < axes.wght.min || f.hi > axes.wght.max) fail(name + ': declares ' + f.lo + '-' + f.hi + ', the file only does ' + axes.wght.min + '-' + axes.wght.max);
    }
  }
  for (const fam of new Set(faces.map(f => f.family))) {
    const dir = path.join(ROOT, 'assets', 'fonts');
    const lic = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => /^OFL.*\.txt$/i.test(x)).map(x => fs.readFileSync(path.join(dir, x), 'utf8')) : [];
    if (!lic.some(t => /SIL OPEN FONT LICENSE/i.test(t) && t.includes(fam))) fail('no SIL OFL licence naming ' + fam + ' in assets/fonts');
  }
}
const preloaded = {};
for (const p of PAGES) {
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file)) { fail(p + ' does not exist'); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (/\brel\s*=\s*["']([^"']+)/i.exec(m[0]) || [])[1] || '';
    const href = (/\bhref\s*=\s*["']([^"']+)/i.exec(m[0]) || [])[1] || '';
    if (/stylesheet|preconnect|preload|dns-prefetch/i.test(rel) && /^(https?:)?\/\//i.test(href)) fail(p + ': <link rel="' + rel + '"> to another origin: ' + href);
  }
  const links = Array.from(head.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)).map(m => ((/\bhref\s*=\s*["']([^"']+)/i.exec(m[0]) || [])[1] || '').replace(/\?v=[0-9a-f]+$/, ''));   /* less the stamp (stamp.js) */
  const fi = links.findIndex(h => /(^|\/)assets\/css\/fonts\.css$/.test(h || '')), si = links.findIndex(h => /(^|\/)assets\/css\/site\.css$/.test(h || ''));
  if (fi < 0) fail(p + ' does not link assets/css/fonts.css');
  else if (si >= 0 && fi > si) fail(p + ' links fonts.css after site.css');
  /* the preload script's list, resolved against the page */
  const script = Array.from(head.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(m => m[1]).find(s => /rel\s*=\s*'preload'/.test(s));
  preloaded[p] = [];
  if (script) {
    const list = /for \(const f of \[([^\]]*)\]\)/.exec(script);
    const prefix = /l\.href\s*=\s*'([^']*)'\s*\+\s*f\s*\+\s*'([^']*)'/.exec(script);
    if (!list || !prefix) fail(p + ': cannot read the font preload script');
    else {
      for (const name of list[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean)) {
        const target = path.resolve(path.dirname(file), prefix[1] + name + prefix[2]);
        preloaded[p].push(target);
        if (!faces.some(f => f.file === target)) fail(p + ' preloads ' + path.relative(ROOT, target) + ', which no @font-face uses: a second download');
      }
      if (!/crossOrigin\s*=\s*''/.test(script)) fail(p + ': the preload is not crossorigin, so the font request would not reuse it');
      if (!/location\.protocol\s*!==\s*'file:'/.test(script)) fail(p + ': the preload runs on file://, where a CORS request only logs errors');
    }
  }
}

/* ---- in the browser ------------------------------------------------------- */
/* every visible text run: its primary family, weight and style, and whether
   a loaded face of that family covers them */
function coverage() {
  const faces = Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => {
    const w = f.weight.split(/\s+/).map(Number);
    return { family: f.family.replace(/['"]/g, ''), style: f.style, lo: w[0], hi: w.length > 1 ? w[1] : w[0] };
  });
  const out = [], seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const el = t.parentElement;
    if (!t.nodeValue.trim() || !el || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const family = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
    const weight = parseInt(cs.fontWeight, 10), style = cs.fontStyle === 'normal' ? 'normal' : 'italic';
    const key = family + '|' + weight + '|' + style;
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = faces.some(f => f.family === family && f.style === style && weight >= f.lo && weight <= f.hi);
    const any = faces.some(f => f.family === family);
    out.push({ key, ok, any, where: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''), text: t.nodeValue.trim().slice(0, 24) });
  }
  return out;
}

async function browserHalf() {
  const why = B.unavailable();
  if (why) return 'browser half skipped (' + why + ')';
  const site = await B.serve();
  const b = await B.launch();
  const stats = { runs: 0, keys: new Set(), synth: 0 };
  try {
    for (const p of [['index.html#about', 'about'], ['index.html#research', 'research'], ['index.html#writing', 'writing'], ['blog/post-template.html', 'the template']]) {
      const s = await b.open(site.url + p[0], { width: 1200, height: 900, dpr: 1 });
      try {
        await A.pause(s);
        await s.evaluate(() => document.fonts.ready);
        await A.settle(s.page);
        for (const r of await s.evaluate(coverage)) {
          stats.runs++;
          stats.keys.add(r.key);
          if (!r.ok) fail(p[1] + ': ' + r.where + ' "' + r.text + '" asks for ' + r.key.replace(/\|/g, ' ') + (r.any
            ? ', which no loaded face of that family covers: the browser synthesizes it'
            : ': no face of that family loaded at all, it is in the fallback font'));
        }
        /* nothing synthesized: switching synthesis off changes nothing */
        await s.evaluate(() => { document.getElementById('cosmos') && (document.getElementById('cosmos').style.visibility = 'hidden'); });
        const shot = async () => B.decodePNG(await s.screenshot({ fullPage: true, captureBeyondViewport: true }));
        const a = await shot();
        await s.evaluate(() => { const k = document.createElement('style'); k.id = 'no-synth'; k.textContent = '* { font-synthesis: none !important; }'; document.head.appendChild(k); });
        await A.settle(s.page);
        const z = await shot();
        const share = B.changed(a, z, 8);
        stats.synth = Math.max(stats.synth, share);
        if (share > 0) fail(p[1] + ': switching font synthesis off changes ' + (100 * share).toFixed(2) + '% of the page: something was a synthesized bold or slant');
        /* each font file fetched once */
        const counts = await s.evaluate(() => {
          const c = {};
          for (const r of performance.getEntriesByType('resource')) if (/\.woff2(\?|$)/.test(r.name)) c[r.name] = (c[r.name] || 0) + 1;
          return c;
        });
        for (const [u, n] of Object.entries(counts)) if (n > 1) fail(p[1] + ': ' + u.replace(site.url, '') + ' fetched ' + n + ' times');
        if (p[1] === 'about') {
          await s.evaluate(() => new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r))));
          const italic = await s.evaluate(async () => {
            for (let i = 0; i < 50; i++) {
              const f = Array.from(document.fonts).find(x => x.style === 'italic' && /Newsreader/.test(x.family));
              if (f && f.status === 'loaded') return 'loaded';
              await new Promise(r => setTimeout(r, 40));
            }
            const f = Array.from(document.fonts).find(x => x.style === 'italic' && /Newsreader/.test(x.family));
            return f ? f.status : 'no italic face';
          });
          if (italic !== 'loaded') fail('opened on about, the italic face is ' + italic + ' 2s after load: research would swap it in in view');
        }
        for (const e of s.errors) fail(p[1] + ': ' + e.type + ': ' + e.text);
        /* everything the page fetched, from the page's own record of it */
        const external = await s.evaluate(() => performance.getEntriesByType('resource').map(r => r.name)
          .filter(u => /^https?:/i.test(u) && new URL(u).origin !== location.origin));
        if (external.length) fail(p[1] + ': requests to another origin: ' + external.slice(0, 3).join(', '));
      } finally { await s.close(); }
    }
    /* from disk */
    for (const p of PAGES) {
      const url = 'file:///' + path.join(ROOT, p).split(path.sep).join('/');
      const s = await b.open(url, { width: 1200, height: 900 });
      try {
        await s.frames(2);
        const st = await s.evaluate(async () => { await document.fonts.ready; return Array.from(document.fonts).filter(f => f.status === 'error').map(f => f.family + ' ' + f.style); });
        for (const f of st) fail(p + ' from file://: the face ' + f + ' failed to load');
        for (const e of s.errors) fail(p + ' from file://: ' + e.type + ': ' + e.text);
        const warn = s.messages.filter(m => /preload/i.test(m.text));
        for (const w of warn) fail(p + ' from file://: ' + w.type + ': ' + w.text);
      } finally { await s.close(); }
    }
  } finally {
    await b.close();
    await site.close();
  }
  return 'the text on 3 tabs and the template uses ' + stats.keys.size + ' family/weight/style combinations (' + Array.from(stats.keys).sort().join(', ').replace(/\|/g, ' ')
         + '), each on a loaded face; synthesis off changes ' + (100 * stats.synth).toFixed(2) + '% of any page; nothing from another origin, each font fetched once; the italic loads on about; file:// clean';
}

(async () => {
  let browser;
  try { browser = await browserHalf(); }
  catch (e) { fail('browser: ' + ((e && e.stack) || e)); }
  if (fails.length) {
    console.log('check-fonts: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  const desc = faces.map(f => f.family + ' ' + f.style + ' ' + f.lo + (f.hi !== f.lo ? '-' + f.hi : '') + (f.axes && f.axes.wght ? ' (file ' + f.axes.wght.min + '-' + f.axes.wght.max + ')' : '')).join(', ');
  console.log('check-fonts: OK - self-hosted, no other origin in any <head>; ' + faces.length + ' faces in fonts.css (' + desc + '), licences present; '
              + Object.values(preloaded).reduce((n, l) => n + l.length, 0) + ' preloads, each a face\'s file; ' + browser);
})();
