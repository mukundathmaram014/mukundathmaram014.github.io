'use strict';
/* The page prints as a readable document: the card's content on white, with
   none of the background art behind it. A canvas is content, not a
   background, so a browser prints it even with "background graphics" off,
   while it drops the card's grey; and #cosmos is position: fixed, so it was
   repeated behind the text on every page. Headless Chrome, with print media
   emulated at about a printed page's width, starting from each tab of
   index.html and on the post template:

     hidden: #cosmos, the tab bar, the dice and the motion toggle (#motion,
       if present): on paper they do nothing;
     shown: every panel and the portrait, i.e. the no-JS long read, since the
       tab bar that would say other sections exist is gone;
     html, body and the card print white or nothing, with no background image;
     every text run has 4.5:1 (3:1 large) on both papers a printout can
       have: backgrounds dropped (all text on white) and backgrounds printed;
     pixels: the print rendering is identical with #cosmos forcibly removed;
     a real print, page.pdf(), embeds no picture but the page's own
       <img>s: the canvas bitmap went in several times over, and a blurred
       box-shadow goes in as a picture too (the card's did, on the template);
     and every link in the rail prints its address after its label (the
       labels alone, "email github linkedin", left no way to reach the
       person): the ::after's content holds the address its href points at
       (mailto: and https:// aside, so a data-print gone stale fails), as
       written (no text-transform), at 4.5:1 on either paper, and drawn: the
       link's pixels change when the content is taken away. The text runs
       above are read from the DOM, which generated content is not in.

   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

const PAGE_W = 718, PAGE_H = 1000, TOL = 8;

function pdfImages(buf) {
  const t = buf.toString('latin1');
  return { images: (t.match(/\/Subtype\s*\/Image\b/g) || []).length, pages: (t.match(/\/Type\s*\/Page\b(?!s)/g) || []).length };
}
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
function rasterNote(file, p, imgs) {
  return file + ' printed to PDF embeds ' + plural(p.images, 'picture') + ' for ' + plural(imgs, '<img>')
         + ' (the canvas, or a blurred shadow, is printing as a picture)';
}

/* the address a rail link's href points at, as one would type it */
function address(href) {
  const h = String(href || '').trim();
  if (/^mailto:/i.test(h)) return decodeURIComponent(h.slice(7).split('?')[0]);
  return h.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}
/* a computed content value as the text it draws: its strings and attr()s */
function contentText(value, attrs) {
  if (!value || value === 'none' || value === 'normal') return '';
  let text = '';
  for (const m of value.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([\w-]+)\s*\)/g)) {
    text += m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (attrs[m[2]] || '');
  }
  return text;
}

/* each .social link's ::after, in print media: what it says, how it is
   styled, and what is behind it (as textRuns() reads it) */
function railLinks() {
  const alphaOf = c => { const m = /rgba?\(([^)]*)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  return Array.from(document.querySelectorAll('.social a')).map(a => {
    const c = getComputedStyle(a, '::after');
    let opacity = 1;
    for (let n = a; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
    const layers = [];
    let image = null, opaque = false;
    for (let n = a; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.backgroundImage !== 'none') { image = n.tagName.toLowerCase(); break; }
      const al = alphaOf(st.backgroundColor);
      if (al > 0) layers.push(st.backgroundColor);
      if (al >= 1) { opaque = true; break; }
    }
    const r = a.getBoundingClientRect();
    return {
      label: a.textContent.trim(), attrs: { href: a.getAttribute('href'), 'data-print': a.getAttribute('data-print') },
      content: c.content, display: c.display, visibility: c.visibility, transform: c.textTransform,
      color: c.color, size: parseFloat(c.fontSize), weight: parseInt(c.fontWeight, 10) || 400, opacity, layers, image, opaque, art: false,
      page: [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor],
      box: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
    };
  });
}

async function inspect(s, label, fails, stats, opts) {
  await s.page.emulateMediaType('print');
  await A.settle(s.page);
  const st = await s.evaluate(() => {
    const shown = el => !!el && el.getClientRects().length > 0;
    const bg = el => { const c = getComputedStyle(el); return { colour: c.backgroundColor, image: c.backgroundImage }; };
    return {
      hidden: ['#cosmos', '.tabs', '#dice', '#motion'].map(sel => ({ sel, el: !!document.querySelector(sel), shown: shown(document.querySelector(sel)) })),
      panels: Array.from(document.querySelectorAll('main .panel')).map(p => ({ id: p.id, shown: shown(p) })),
      portrait: document.querySelector('.rail .portrait') ? shown(document.querySelector('.rail .portrait')) : null,
      grounds: [['html', document.documentElement], ['body', document.body], ['.shell', document.querySelector('.shell')]]
        .filter(([, el]) => el).map(([n, el]) => Object.assign({ n }, bg(el))),
      imgs: Array.from(document.images).filter(shown).length
    };
  });
  for (const h of st.hidden) if (h.el && h.shown) fails.push(label + ': ' + h.sel + ' prints');
  for (const p of st.panels) if (!p.shown) fails.push(label + ': ' + p.id + ' does not print');
  if (st.portrait === false) fails.push(label + ': the portrait does not print');
  for (const g of st.grounds) {
    const c = A.parse(g.colour);
    const white = c && (c[3] === 0 || (c[0] === 255 && c[1] === 255 && c[2] === 255));
    if (!white) fails.push(label + ': ' + g.n + ' prints a ' + g.colour + ' background');
    if (g.image !== 'none') fails.push(label + ': ' + g.n + ' prints a background image');
  }
  const runs = A.measureRuns(await s.evaluate(A.textRuns, null), 'print');
  for (const r of runs) {
    stats.runs++;
    if (r.problem) fails.push(label + ': ' + r.where + ' "' + r.text + '": ' + r.problem);
    else if (r.ratio < r.need) fails.push(label + ': ' + r.where + ' "' + r.text + '" ' + A.fmt(r.ratio) + ' on paper rgb(' + r.bg.join(', ') + ') (needs ' + r.need + ':1)');
    else stats.low = Math.min(stats.low, r.ratio);
  }
  if (opts.rail) {
    const links = await s.evaluate(railLinks);
    if (!links.length) fails.push(label + ': no links in the rail (.social a)');
    const printed = links.map(l => Object.assign(l, { where: 'a::after (' + l.label + ')', text: contentText(l.content, l.attrs), want: address(l.attrs.href) }));
    for (const [i, r] of A.measureRuns(printed, 'print').entries()) {
      const l = printed[i], id = label + ': the rail\'s "' + l.label + '"';
      if (!l.want) { fails.push(id + ' has no address in its href'); continue; }
      if (!l.text.includes(l.want)) { fails.push(id + ' prints ' + (l.text ? '"' + l.text + '"' : 'no address') + ', not its address ' + l.want + ' (' + l.attrs.href + ')'); continue; }
      if (l.display === 'none' || l.visibility !== 'visible') fails.push(id + ': its address is not shown (display ' + l.display + ', visibility ' + l.visibility + ')');
      if (l.transform !== 'none') fails.push(id + ': its address prints with text-transform ' + l.transform + ', not as written');
      if (r.problem) fails.push(id + ': ' + r.problem);
      else if (r.ratio < r.need) fails.push(id + ': its address ' + A.fmt(r.ratio) + ' on paper rgb(' + r.bg.join(', ') + ') (needs ' + r.need + ':1)');
      else stats.addressLow = Math.min(stats.addressLow, r.ratio);
    }
    /* drawn: each link's pixels, with its address and with the content taken away */
    const clip = links.reduce((u, l) => {
      const b = l.box, x1 = Math.max(u.x + u.width, b.x + b.width), y1 = Math.max(u.y + u.height, b.y + b.height);
      const x = Math.min(u.x, b.x), y = Math.min(u.y, b.y);
      return { x, y, width: x1 - x, height: y1 - y };
    }, links.length ? links[0].box : { x: 0, y: 0, width: 1, height: 1 });
    clip.x = Math.max(0, Math.floor(clip.x)); clip.y = Math.max(0, Math.floor(clip.y));
    clip.width = Math.ceil(clip.width) + 1; clip.height = Math.ceil(clip.height) + 1;
    const a = B.decodePNG(await s.screenshot({ clip }));
    await s.evaluate(() => {
      const k = document.createElement('style');
      k.id = 'print-probe-rail';
      k.textContent = '.social a::after { content: none !important; }';
      document.head.appendChild(k);
    });
    await A.settle(s.page);
    const z = B.decodePNG(await s.screenshot({ clip }));
    await s.evaluate(() => document.getElementById('print-probe-rail').remove());
    await A.settle(s.page);
    const sx = a.width / clip.width, sy = a.height / clip.height;
    for (const l of printed) {
      let n = 0;
      for (let y = Math.floor((l.box.y - clip.y) * sy); y < Math.min(a.height, Math.ceil((l.box.y + l.box.height - clip.y) * sy)); y++) {
        for (let x = Math.floor((l.box.x - clip.x) * sx); x < Math.min(a.width, Math.ceil((l.box.x + l.box.width - clip.x) * sx)); x++) {
          const o = (y * a.width + x) * 4;
          if (Math.abs(a.data[o] - z.data[o]) > TOL || Math.abs(a.data[o + 1] - z.data[o + 1]) > TOL || Math.abs(a.data[o + 2] - z.data[o + 2]) > TOL) n++;
        }
      }
      if (n < 20) fails.push(label + ': the rail\'s "' + l.label + '" draws no address (' + n + ' px change when its content is taken away)');
      else stats.addressPx = Math.min(stats.addressPx, n);
    }
    stats.addresses = printed.map(l => l.text);
  }
  if (opts.art) {
    const a = B.decodePNG(await s.screenshot());
    await s.evaluate(() => {
      const k = document.createElement('style');
      k.id = 'print-probe';
      k.textContent = '#cosmos { display: none !important; }';
      document.head.appendChild(k);
    });
    await A.settle(s.page);
    const z = B.decodePNG(await s.screenshot());
    await s.evaluate(() => document.getElementById('print-probe').remove());
    const share = B.changed(a, z, TOL);
    stats.art = Math.max(stats.art, share);
    if (share > 0.001) fails.push(label + ': the background art prints: ' + (100 * share).toFixed(1) + '% of the page changes when #cosmos is removed');
  }
  await s.page.emulateMediaType(null);
  return st;
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-print: SKIP - ' + why); return; }
  const site = await A.pages();
  const fails = [], stats = { runs: 0, low: Infinity, art: 0, addresses: [], addressLow: Infinity, addressPx: Infinity };
  const pdfs = [];
  try {
    for (const tab of ['about', 'research', 'writing']) {
      const s = await site.open('index.html#' + tab, { width: PAGE_W, height: PAGE_H });
      try {
        await s.frames(3);
        const st = await inspect(s, 'index from #' + tab, fails, stats, { art: true, rail: true });
        if (tab === 'about') {
          const p = pdfImages(Buffer.from(await s.page.pdf({ format: 'A4' })));
          pdfs.push('index.html ' + plural(p.pages, 'page') + ', ' + plural(p.images, 'picture'));
          if (p.images > st.imgs) fails.push(rasterNote('index.html', p, st.imgs));
        }
        for (const e of s.errors) fails.push('index.html: ' + e.type + ': ' + e.text);
      } finally { await s.close(); }
    }
    const s = await site.open('blog/post-template.html', { width: PAGE_W, height: PAGE_H });
    try {
      const st = await inspect(s, 'template', fails, stats, { art: false });
      const p = pdfImages(Buffer.from(await s.page.pdf({ format: 'A4' })));
      pdfs.push('the template ' + plural(p.pages, 'page') + ', ' + plural(p.images, 'picture'));
      if (p.images > st.imgs) fails.push(rasterNote('the template', p, st.imgs));
      for (const e of s.errors) fails.push('post-template.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
  } finally {
    await site.close();
  }
  if (fails.length) {
    console.log('check-print: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-print: OK - print media from each tab and on the template: #cosmos, tabs, dice and motion toggle hidden; every panel and the portrait print; white grounds; '
              + stats.runs + ' text runs at least ' + A.fmt(stats.low) + ' on either paper; the rail prints its ' + stats.addresses.length + ' addresses ('
              + stats.addresses.join(', ') + ') at least ' + A.fmt(stats.addressLow) + ', each drawn (' + stats.addressPx + '+ px); removing #cosmos changes ' + (100 * stats.art).toFixed(2)
              + '% of the page; page.pdf(): ' + pdfs.join(', ') + ', one per <img>');
}
main().catch(e => { console.log('check-print: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
