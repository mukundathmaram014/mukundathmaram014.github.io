'use strict';
/* What assistive technology is given: the accessibility tree Chrome builds
   for index.html and the post template, read through the DevTools protocol
   (puppeteer's accessibility snapshot), with and without JS.

     no JS: the tab bar is not shown, and nothing claims the tabs pattern
       (no tablist, tab or tabpanel: three "tab panels" with no tab list
       above them, and tabs whose keys did nothing; audit F34); every panel
       shows; the motion toggle is not there;
     no JS, on both pages: no button at all. site.js is what draws the
       dice's pips and answers a click, and without it they were a
       focusable "roll the dice" button showing two empty squares: they
       ship hidden, like the motion toggle;
     the outline (no JS, every panel showing; and the open research panel):
       each paper's title is an h3 under its section's h2 (research, in
       progress), so a heading jump goes from paper to paper (they were
       spans), and no level is skipped;
     the template's code blocks: each <pre> is a Tab stop in the markup
       (tabindex="0"; Chrome makes an overflowing scroller one by itself,
       Safari does not), and is a region or group with a name of its own;
       at 320px, where the code overflows, Tab reaches it and ArrowRight
       scrolls it;
     aria-current: a valid token, and "page" only on a link to the page
       itself: the template's writing link leads to index.html#writing, the
       section the post belongs to, so it is "true";
     JS: one tablist of three tabs; the open panel is a tabpanel named by
       its tab, on every tab; it is a Tab stop after the rail's links
       (F36), with a drawn ring;
     every pending pdf/blog slot reads "<slot> (coming soon)", the words
       hidden on screen (1px, clipped), and none relies on aria-disabled,
       which a plain span does not expose (F31);
     the dice: a status region beside the button, not inside it (a
       button's content is presentational); silent after the roll on load;
       a click or Space announces "rolled X and Y", the pips drawn; the
       button keeps its name (F12);
     the motion toggle: a button named "pause motion" whose pressed state
       follows it, the name never changing (G5.1).
   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

function find(node, pred, out) {
  out = out || [];
  if (!node) return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) find(c, pred, out);
  return out;
}
/* the text a screen reader walks through, in order */
const reading = tree => find(tree, n => n.role === 'StaticText').map(n => n.name).join(' ').replace(/\s+/g, ' ');

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-a11y-tree: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  const fails = [], facts = {};
  const fail = m => fails.push(m);
  const snap = s => s.page.accessibility.snapshot({ interestingOnly: false });
  const goto = (s, hash) => s.evaluate(h => new Promise(res => {
    if (location.hash === h) { res(); return; }
    window.addEventListener('hashchange', () => res(), { once: true });
    location.hash = h;
  }), hash);
  /* no JS: no button at all, and the dice not shown */
  const noButtons = async (s, t, page) => {
    const buttons = find(t, n => n.role === 'button').map(n => n.name);
    if (buttons.length) fail('no JS, ' + page + ': ' + buttons.length + ' button(s) that would do nothing (' + JSON.stringify(buttons) + ')');
    if (await s.evaluate(() => { const d = document.getElementById('dice'); return !!d && d.getClientRects().length > 0; })) fail('no JS, ' + page + ': the dice show, though nothing draws their pips or rolls them');
  };
  /* each paper (.pub): its title and the heading of its section, from the DOM */
  const papers = () => Array.from(document.querySelectorAll('.pub')).map(p => {
    let h = p.previousElementSibling;
    while (h && !/^H[1-6]$/.test(h.tagName)) h = h.previousElementSibling;
    const title = p.querySelector('.ptitle');
    return { section: h ? h.textContent.trim() : null, title: title ? title.textContent.trim().replace(/\s+/g, ' ') : null };
  });
  /* the tree's headings in order: every paper an h3 under its section's h2,
     and no level skipped; returns the h3 count per section */
  const outlineOf = (t, pubs, label) => {
    const key = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const hs = find(t, n => n.role === 'heading').map(n => ({ level: n.level, name: key(n.name) }));
    const per = {};
    if (!pubs.length) fail(label + ': no papers (.pub) found');
    for (const p of pubs) {
      const i = hs.findIndex(h => h.name === key(p.title));
      if (i < 0 || hs[i].level !== 3) { fail(label + ': the paper "' + p.title + '" is ' + (i < 0 ? 'not a heading' : 'an h' + hs[i].level) + ' (an h3 under its section, so a heading jump goes from paper to paper)'); continue; }
      let j = i - 1;
      while (j >= 0 && hs[j].level > 2) j--;
      if (j < 0 || hs[j].level !== 2 || hs[j].name !== key(p.section)) { fail(label + ': the paper "' + p.title + '" is not under its section\'s h2 ("' + p.section + '")'); continue; }
      per[key(p.section)] = (per[key(p.section)] || 0) + 1;
    }
    for (let i = 1; i < hs.length; i++) {
      if (hs[i].level > hs[i - 1].level + 1) fail(label + ': the outline skips a level, h' + hs[i - 1].level + ' "' + hs[i - 1].name + '" then h' + hs[i].level + ' "' + hs[i].name + '"');
    }
    return per;
  };
  try {
    /* ---- without JS ---- */
    let s = await b.open(site.url + 'index.html?bgq=0', { width: 1280, height: 900 });
    try {
      await s.page.setJavaScriptEnabled(false);
      await s.page.reload({ waitUntil: 'load' });
      const dom = await s.evaluate(() => ({
        bar: document.querySelector('.tabs').getClientRects().length > 0,
        panels: Array.from(document.querySelectorAll('main .panel')).map(p => ({ id: p.id, shown: p.getClientRects().length > 0, role: p.getAttribute('role'), tabindex: p.getAttribute('tabindex') })),
        motion: !!document.getElementById('motion') && document.getElementById('motion').getClientRects().length > 0
      }));
      const t = await snap(s);
      const roles = { tablist: find(t, n => n.role === 'tablist').length, tab: find(t, n => n.role === 'tab').length, tabpanel: find(t, n => n.role === 'tabpanel').length };
      facts.nojs = roles;
      if (dom.bar) fail('no JS: the tab bar shows, and its links go nowhere');
      if (roles.tablist + roles.tab + roles.tabpanel) fail('no JS: the tabs pattern is still claimed (' + JSON.stringify(roles) + ')');
      for (const p of dom.panels) {
        if (!p.shown) fail('no JS: ' + p.id + ' is hidden');
        if (p.role || p.tabindex) fail('no JS: ' + p.id + ' carries role=' + p.role + ' tabindex=' + p.tabindex + ' in the markup (site.js adds them)');
      }
      if (dom.motion) fail('no JS: the motion toggle shows, and would do nothing');
      await noButtons(s, t, 'index.html');
      /* the outline, every panel showing */
      const pubs = await s.evaluate(papers);
      facts.outline = outlineOf(t, pubs, 'no JS');
      for (const e of s.errors) fail('no JS: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
    s = await b.open(site.url + 'blog/post-template.html', { width: 1280, height: 900 });
    try {
      await s.page.setJavaScriptEnabled(false);
      await s.page.reload({ waitUntil: 'load' });
      await noButtons(s, await snap(s), 'the template');
      for (const e of s.errors) fail('no JS, the template: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }

    /* ---- with JS ---- */
    s = await b.open(site.url + 'index.html?bgq=0', { width: 1280, height: 900, dpr: 2 });
    try {
      await A.pause(s);
      await s.page.mouse.move(1, 1);
      const names = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => t.dataset.tab));
      facts.stops = [];
      for (const n of names) {
        await goto(s, '#' + n);
        await A.settle(s.page);
        const t = await snap(s);
        const lists = find(t, x => x.role === 'tablist'), tabs = find(t, x => x.role === 'tab'), panels = find(t, x => x.role === 'tabpanel');
        if (lists.length !== 1 || tabs.length !== names.length) fail('#' + n + ': ' + lists.length + ' tablist and ' + tabs.length + ' tabs (expected 1 and ' + names.length + ')');
        if (panels.length !== 1 || panels[0].name !== n) fail('#' + n + ': the open panel is ' + (panels.map(p => 'a tabpanel named "' + p.name + '"').join(', ') || 'not a tabpanel') + ' (expected one named "' + n + '")');
        /* the Tab order from the selected tab: the open panel is a stop */
        await s.page.focus('#tab-' + n);
        const order = [];
        for (let i = 0; i < 8; i++) {
          await s.page.keyboard.press('Tab');
          const k = await s.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : (a.id || a.textContent.trim().slice(0, 12)); });
          order.push(k);
          if (k === 'panel-' + n || k === 'body') break;
        }
        if (order[order.length - 1] !== 'panel-' + n) fail('#' + n + ': Tab from the tab never reaches the open panel (' + order.join(' > ') + ')');
        else {
          facts.stops.push(order.join(' > '));
          const ring = await s.evaluate(A.focusRing);
          if (!ring || !ring.drawn) fail('#' + n + ': the focused panel draws no focus ring');
        }
      }
      /* pending slots */
      await goto(s, '#research');
      await A.settle(s.page);
      const rt = await snap(s);
      const text = reading(rt);
      /* the open research panel's outline: its papers are h3s */
      const open = find(rt, n => n.role === 'tabpanel')[0];
      const pubs = await s.evaluate(papers);
      const h3 = find(open, n => n.role === 'heading' && n.level === 3).length;
      if (h3 !== pubs.length) fail('#research: the open panel has ' + h3 + ' h3 headings for ' + pubs.length + ' papers');
      const slots = await s.evaluate(() => Array.from(document.querySelectorAll('.btn.pending')).map(e => {
        const h = e.querySelector('.sr-only'), r = h ? h.getBoundingClientRect() : null;
        return { label: e.firstChild ? e.firstChild.nodeValue.trim() : '', hidden: !!r && r.width <= 1 && r.height <= 1, disabled: e.hasAttribute('aria-disabled'), visible: e.getBoundingClientRect().width > 1 };
      }));
      facts.slots = slots.length;
      for (const [i, sl] of slots.entries()) {
        if (!sl.visible) continue;
        /* a slot that says so on its face ("coming soon") needs no hidden words */
        const plain = /coming soon/i.test(sl.label), said = plain ? sl.label : sl.label + ' (coming soon)';
        if (!text.includes(said)) fail('pending slot ' + (i + 1) + ' ("' + sl.label + '") is not read as "' + said + '"');
        if (!plain && !sl.hidden) fail('pending slot ' + (i + 1) + ': its "(coming soon)" is not visually hidden');
        if (sl.disabled) fail('pending slot ' + (i + 1) + ': aria-disabled on a plain span (not exposed)');
      }
      if (!slots.length) facts.slots = 0;
      /* the dice */
      await goto(s, '#about');
      const dice = await s.evaluate(() => {
        const d = document.getElementById('dice'), out = document.getElementById('dice-out');
        return { out: !!out, inside: !!out && d.contains(out), role: out ? out.getAttribute('role') || out.getAttribute('aria-live') : null, text: out ? out.textContent : null };
      });
      if (!dice.out) fail('the dice have no status region (#dice-out): a roll is never announced');
      else {
        if (dice.inside) fail('#dice-out is inside the dice button, whose content is presentational');
        if (dice.role !== 'status' && dice.role !== 'polite') fail('#dice-out is not a live region (role ' + dice.role + ')');
        if (dice.text) fail('the roll on load was announced ("' + dice.text + '")');
        const drawn = () => s.evaluate(() => Array.from(document.querySelectorAll('#dice .pips')).map(g => g.querySelectorAll('circle').length).join(' and '));
        const said = () => s.evaluate(() => new Promise(res => setTimeout(() => res(document.getElementById('dice-out').textContent), 120)));
        await s.page.click('#dice');
        const a = await said();
        if (a !== 'rolled ' + (await drawn())) fail('after a click the status says "' + a + '", the dice show ' + (await drawn()));
        await s.page.focus('#dice');
        await s.page.keyboard.press('Space');
        const z = await said();
        if (z !== 'rolled ' + (await drawn())) fail('after Space the status says "' + z + '", the dice show ' + (await drawn()));
        facts.dice = [a, z];
        const t = await snap(s);
        const btn = find(t, n => n.role === 'button' && /dice/.test(n.name || ''));
        if (btn.length !== 1 || btn[0].name !== 'roll the dice') fail('the dice button is ' + JSON.stringify(btn.map(x => x.name)) + ' (expected one named "roll the dice")');
        const status = find(t, n => n.role === 'status');
        if (!status.length || !reading(status[0]).includes(z)) fail('the status region is not in the accessibility tree with the roll');
      }
      /* the motion toggle */
      const toggle = async () => find(await snap(s), n => n.role === 'button' && /motion/.test(n.name || ''));
      let m = await toggle();
      const before = m.length === 1 ? m[0] : null;
      if (!before) fail('the motion toggle is not one button in the tree (' + m.length + ')');
      else {
        await s.page.click('#motion');
        m = await toggle();
        const after = m[0];
        facts.toggle = [before.name + ' pressed=' + before.pressed, after && after.name + ' pressed=' + after.pressed];
        if (!after || after.name !== 'pause motion' || before.name !== 'pause motion') fail('the toggle\'s name is ' + JSON.stringify([before.name, after && after.name]) + ' (expected "pause motion" throughout)');
        if (!after || String(after.pressed) === String(before.pressed)) fail('clicking the toggle does not change its pressed state (' + facts.toggle.join(' -> ') + ')');
      }
      for (const e of s.errors) fail('index.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }

    /* ---- the post template, with JS ---- */
    s = await b.open(site.url + 'blog/post-template.html', { width: 1280, height: 900 });
    try {
      await s.page.mouse.move(1, 1);
      /* aria-current: a valid token, and "page" only on a link to this page */
      const cur = await s.evaluate(() => Array.from(document.querySelectorAll('[aria-current]')).map(e => ({
        text: e.textContent.trim(), token: e.getAttribute('aria-current'), href: e.getAttribute('href'),
        here: e.href ? new URL(e.href).pathname === location.pathname : null })));
      facts.current = cur.map(c => c.text + '=' + c.token);
      for (const c of cur) {
        if (!['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(c.token)) fail('the template: aria-current="' + c.token + '" on "' + c.text + '" is not a token (page, step, location, date, time, true, false)');
        if (c.token === 'page' && !c.here) fail('the template: aria-current="page" on "' + c.text + '", which leads to ' + c.href + ', not to this page: "page, current" on a link away (aria-current="true" is the section\'s)');
      }
      /* the code blocks: in the markup a Tab stop, and named in the tree */
      const blocks = await s.page.$$('article pre');
      if (!blocks.length) fail('the template has no code block (article pre)');
      const named = [];
      for (const [i, el] of blocks.entries()) {
        const id = 'the template\'s code block ' + (i + 1);
        const tabindex = await el.evaluate(p => p.getAttribute('tabindex'));
        if (tabindex !== '0') fail(id + ' has tabindex ' + JSON.stringify(tabindex) + ': without "0" Safari keeps the keyboard out of its sideways scroll');
        const node = await s.page.accessibility.snapshot({ root: el, interestingOnly: false });
        const role = node && node.role, name = node && (node.name || '').trim();
        if (!node || !name || ['generic', 'none', 'presentation', 'StaticText'].includes(role)) fail(id + ' is ' + (role || 'not in the tree') + (name ? ' "' + name + '"' : ' with no name') + ': a region (or group) with an aria-label, so a screen reader says what it reached');
        else if (named.includes(name)) fail(id + ' has the name "' + name + '" of another code block');
        else named.push(name);
        facts.code = (facts.code || []).concat(role + ' "' + name + '"');
      }
      /* Tab reaches each block. At 1280px the template's code fits its box,
         so Chrome does not make it a stop by itself: the stop is its tabindex */
      let stops = 0;
      for (let i = 0; i < 20 && stops < blocks.length; i++) {
        await s.page.keyboard.press('Tab');
        if (await s.evaluate(() => !!document.activeElement && document.activeElement.matches('article pre'))) stops++;
        if (await s.evaluate(() => document.activeElement === document.body)) break;
      }
      if (blocks.length && stops < blocks.length) fail('Tab reaches ' + stops + ' of the template\'s ' + blocks.length + ' code blocks at 1280px');
      const t = await snap(s);
      if (find(t, n => n.role === 'button' && n.name === 'roll the dice').length !== 1) fail('the template: site.js did not reveal the dice (no "roll the dice" button)');
      for (const e of s.errors) fail('post-template.html: ' + e.type + ': ' + e.text);
    } finally { await s.close(); }
    /* at 320px the code overflows its box: Tab gets there, ArrowRight scrolls it */
    s = await b.open(site.url + 'blog/post-template.html', { width: 320, height: 640, dpr: 2 });
    try {
      await s.page.mouse.move(1, 1);
      let at = false;
      for (let i = 0; i < 20 && !at; i++) {
        await s.page.keyboard.press('Tab');
        at = await s.evaluate(() => !!document.activeElement && document.activeElement.matches('article pre'));
      }
      const box = await s.evaluate(() => { const p = document.querySelector('article pre'); return p ? { sw: p.scrollWidth, cw: p.clientWidth } : null; });
      if (!box) fail('the template has no code block at 320px');
      else if (box.sw <= box.cw) facts.scroll = 'no overflow at 320px (' + box.sw + '/' + box.cw + '), nothing to scroll';
      else if (!at) fail('at 320px Tab never reaches the code block, which overflows (' + box.sw + 'px of code in ' + box.cw + 'px)');
      else {
        for (let i = 0; i < 3; i++) await s.page.keyboard.press('ArrowRight');
        const left = await s.evaluate(() => new Promise(res => setTimeout(() => res(document.querySelector('article pre').scrollLeft), 300)));
        if (!(left > 0)) fail('at 320px ArrowRight does not scroll the focused code block (scrollLeft ' + left + ')');
        facts.scroll = box.sw + 'px of code in a ' + box.cw + 'px box at 320px, ArrowRight x3 scrolls it ' + left + 'px';
      }
    } finally { await s.close(); }
  } finally {
    await b.close();
    await site.close();
  }
  if (fails.length) {
    console.log('check-a11y-tree: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-a11y-tree: OK - no JS: no tab bar and no tabs pattern (' + JSON.stringify(facts.nojs) + '), every panel shown, no button on either page (the dice hidden); outline: each paper an h3 under its section ('
              + Object.entries(facts.outline).map(([k, n]) => k + ' ' + n).join(', ') + '); JS: 1 tablist, the open panel a tabpanel named by its tab on every tab and a Tab stop with a ring ('
              + facts.stops[0] + '); ' + facts.slots + ' pending slots read "... (coming soon)"; dice announce "' + facts.dice.join('", "') + '" (silent on load); toggle '
              + facts.toggle.join(' -> ') + '; template: code block ' + facts.code.join(', ') + ', a Tab stop, ' + facts.scroll + '; aria-current ' + facts.current.join(', '));
}
main().catch(e => { console.log('check-a11y-tree: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
