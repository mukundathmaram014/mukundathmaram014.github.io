/* Exercises assets/js/site.js (under SITE_ROOT, loaded through harness.js)
   against minimal DOM stubs, plus the motion-state script in index.html's
   <head>. Run directly it prints every case; check-tabs.js runs the same
   cases through run(). Sections:

     tabs        the 17 original cases: default tab, click, hash update,
                 body data-tab, deep link, garbage hash, ArrowLeft/Right
                 wrap, Home/End
     panels      the controller gives each panel role=tabpanel, its tab as
                 label and tabindex 0 (audit F34, F36)
     shortcuts   Alt/Ctrl/Meta/Shift with the tab keys, and modified or
                 non-primary clicks, are left to the browser: not
                 prevented, nothing switched, no focus moved (F35)
     motion      the footer toggle (G5.1) and the reduced-motion setting
                 followed live (F10): its state, saving, the 'bgmotion'
                 events it sends and the ones it only follows, storage that
                 throws or is missing
     head        the inline <head> script that sets data-motion
     dice        a roll the visitor asks for is announced in #dice-out,
                 the roll on load is not, a repeat is announced again (F12);
                 index.html and the post template ship the dice hidden, and
                 site.js reveals them with their first roll drawn: without
                 it they were a "roll the dice" button that did nothing (the
                 motion toggle ships hidden too) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');

const NAMES = ['about', 'research', 'writing'];

function makeEl(id, focused) {
  return {
    id,
    _attrs: {},
    dataset: {},
    tabIndex: 0,
    _handlers: {},
    getAttribute(k) { return this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    focus() { focused.id = this.id; },
    classList: { toggle() {} },
  };
}

/* the tab controller on a stub tab bar; returns the pieces the cases poke */
function tabPage() {
  const focused = { id: null };
  const tabs = NAMES.map((n, i) => {
    const t = makeEl('tab-' + n, focused);
    t.dataset.tab = n;
    t._attrs.role = 'tab';
    t._attrs['aria-controls'] = 'panel-' + n;
    t._attrs['aria-selected'] = i === 0 ? 'true' : 'false';
    return t;
  });
  const panels = NAMES.map((n) => {
    const p = makeEl('panel-' + n, focused);
    p.tabIndex = -1;                      /* what a <section> has by default */
    p._active = false;
    p.classList = { toggle: (c, on) => { p._active = !!on; } };
    return p;
  });
  const winHandlers = {};
  const location = { hash: '' };
  const document = {
    querySelectorAll: () => tabs,
    getElementById: (id) => panels[NAMES.indexOf(id.replace('panel-', ''))],
    body: { dataset: {} },
  };
  H.loadSite({
    document, location,
    history: { replaceState: (a, b, h) => { location.hash = h; } },
    window: { addEventListener: (ev, fn) => { winHandlers[ev] = fn; } },
  });
  return { tabs, panels, focused, location, document, winHandlers };
}

/* the motion toggle on a stub page. o: motion (data-motion at load),
   stored ({ key: value }), storage ('ok' | 'throw' | 'absent'), reduce,
   legacy (MediaQueryList.addListener only), button, cosmos (default true) */
function motionPage(o) {
  o = o || {};
  const doc = H.listenerHost({});
  doc.documentElement = { dataset: {} };
  if (o.motion) doc.documentElement.dataset.motion = o.motion;
  const els = {};
  if (o.button !== false) {
    const b = H.makeElement('button', 'motion');
    b.hidden = true;
    b.setAttribute('aria-pressed', 'false');
    els.motion = b;
  }
  if (o.cosmos !== false) els.cosmos = H.makeElement('canvas', 'cosmos');
  doc.getElementById = id => els[id] || null;
  doc.querySelectorAll = () => [];
  doc.body = { dataset: {} };
  /* every 'bgmotion' on document, in order: registered first, as main.js's is */
  const seen = [];
  doc.addEventListener('bgmotion', e => seen.push(e.detail));
  const mq = { matches: !!o.reduce, media: '(prefers-reduced-motion: reduce)', listeners: [] };
  if (o.legacy) mq.addListener = fn => mq.listeners.push(fn);
  else mq.addEventListener = (type, fn) => { if (type === 'change') mq.listeners.push(fn); };
  const store = new Map(Object.entries(o.stored || {}));
  const writes = [];
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push(k + '=' + v); store.set(k, String(v)); } };
  const win = H.listenerHost({});
  win.matchMedia = q => (q === mq.media ? mq : { matches: false, addEventListener() {} });
  win.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init ? init.detail : null; } };
  if (o.storage === 'throw') Object.defineProperty(win, 'localStorage', { get() { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; } });
  else if (o.storage !== 'absent') win.localStorage = storage;
  H.loadSite({ document: doc, window: win });
  const change = matches => { mq.matches = matches; for (const fn of mq.listeners.slice()) fn({ matches, media: mq.media }); };
  const pressed = () => (els.motion ? els.motion.getAttribute('aria-pressed') : '(no button)');
  return { doc, els, btn: els.motion, seen, writes, store, change, pressed, state: () => doc.documentElement.dataset.motion };
}

/* Whether the element with this id ships with the hidden attribute, in a
   page under SITE_ROOT: its start tag, comments left out. null when there
   is no such element. */
function shipsHidden(file, id) {
  const html = fs.readFileSync(path.join(H.ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const tag = new RegExp('<[a-z][\\w-]*\\s[^>]*\\bid="' + id + '"[^>]*>', 'i').exec(html);
  return tag ? /\shidden(?=[\s>=\/])/i.test(tag[0]) : null;
}

/* the inline <head> script that sets data-motion, from index.html */
function headScript() {
  const html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(head))) if (m[1].includes('bg-motion')) return m[1];
  return null;
}
function runHead(src, o) {
  const root = { dataset: {} };
  const g = { document: { documentElement: root }, console };
  const mq = { matches: !!o.reduce };
  g.matchMedia = q => (q === '(prefers-reduced-motion: reduce)' ? mq : { matches: false });
  g.window = g;
  if (o.storage === 'throw') Object.defineProperty(g, 'localStorage', { get() { throw new Error('SecurityError'); } });
  else if (o.storage !== 'absent') g.localStorage = { getItem: k => (o.stored && k in o.stored ? o.stored[k] : null) };
  vm.runInContext(src, vm.createContext(g));
  return root.dataset.motion;
}

/* the dice on a stub page; rolls come from `rolls` (1-6) in order */
function dicePage(rolls) {
  const dice = H.makeElement('span', 'dice');
  dice.hidden = true;                     /* as the pages ship it */
  const groups = [H.makeElement('g'), H.makeElement('g')];
  dice.querySelectorAll = () => groups;
  const out = H.makeElement('span', 'dice-out');
  let text = '';
  const said = [];
  Object.defineProperty(out, 'textContent', { get: () => text, set: v => { text = String(v); said.push(text); } });
  const timers = new Map();
  let next = 1;
  const win = H.listenerHost({});
  win.setTimeout = (fn, ms) => { const id = next++; timers.set(id, fn); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  const queue = rolls.slice();
  const fakeMath = Object.create(Math);
  fakeMath.random = () => { const n = queue.length ? queue.shift() : 1; return (n - 1) / 6 + 0.01; };
  const doc = { getElementById: id => ({ dice, 'dice-out': out })[id] || null, querySelectorAll: () => [] };
  H.loadSite({ document: doc, window: win, globals: { Math: fakeMath } });
  const flush = () => { const fns = Array.from(timers.values()); timers.clear(); fns.forEach(f => f()); };
  const shown = () => groups.map(g => (g.innerHTML.match(/<circle/g) || []).length).join(' and ');
  return { dice, out, said, flush, shown, pending: () => timers.size };
}

function run(log) {
  log = log || console.log;
  let pass = 0, fail = 0, section = 'tabs';
  const sections = {};
  function check(label, got, want) {
    const ok = got === want;
    if (ok) pass++; else fail++;
    sections[section] = (sections[section] || 0) + 1;
    log((ok ? '  ok   ' : '  FAIL ') + label + '  ->  ' + got + (ok ? '' : '   (wanted ' + want + ')'));
  }

  /* ---------- tabs: the original 17 ---------- */
  {
    const { tabs, panels, focused, location, document, winHandlers } = tabPage();
    const state = () => NAMES.filter((n, i) => panels[i]._active).join(',') || '(none)';
    const selected = () => tabs.filter(t => t._attrs['aria-selected'] === 'true').map(t => t.dataset.tab).join(',') || '(none)';

    log('default (no hash):');
    check('one panel active', state(), 'about');
    check('one tab selected', selected(), 'about');
    check('body data-tab (portrait shows)', document.body.dataset.tab, 'about');

    log('click research:');
    tabs[1]._handlers.click({ preventDefault() {} });
    check('panel', state(), 'research');
    check('tab', selected(), 'research');
    check('hash updated', location.hash, '#research');
    check('body data-tab (portrait hides off about)', document.body.dataset.tab, 'research');

    log('click writing:');
    tabs[2]._handlers.click({ preventDefault() {} });
    check('panel', state(), 'writing');
    check('body data-tab', document.body.dataset.tab, 'writing');
    check('exactly one tab selected', selected(), 'writing');

    log('deep link #research via hashchange:');
    location.hash = '#research';
    winHandlers.hashchange();
    check('panel', state(), 'research');

    log('garbage hash falls back to first tab:');
    location.hash = '#nonsense';
    winHandlers.hashchange();
    check('panel', state(), 'about');

    log('ArrowRight from about:');
    location.hash = '';
    winHandlers.hashchange();
    tabs[0]._handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
    check('panel', state(), 'research');
    check('focus moved', focused.id, 'tab-research');

    log('ArrowLeft wraps from about to writing:');
    tabs[0]._handlers.keydown({ key: 'ArrowLeft', preventDefault() {} });
    check('panel', state(), 'writing');

    log('End / Home:');
    tabs[0]._handlers.keydown({ key: 'Home', preventDefault() {} });
    check('Home -> about', state(), 'about');
    tabs[0]._handlers.keydown({ key: 'End', preventDefault() {} });
    check('End -> writing', state(), 'writing');

    /* ---------- panels ---------- */
    section = 'panels';
    log('panels (the controller adds the tabpanel half):');
    check('every panel role=tabpanel', panels.map(p => p._attrs.role).join(','), 'tabpanel,tabpanel,tabpanel');
    check('each labelled by its tab', panels.map(p => p._attrs['aria-labelledby']).join(','), 'tab-about,tab-research,tab-writing');
    check('each a Tab stop (tabindex 0)', panels.map(p => p.tabIndex).join(','), '0,0,0');
    check('the italic face is loaded after the page', typeof winHandlers.load, 'function');
  }

  /* ---------- shortcuts ---------- */
  section = 'shortcuts';
  {
    const { tabs, panels, focused, location, winHandlers } = tabPage();
    const state = () => NAMES.filter((n, i) => panels[i]._active).join(',') || '(none)';
    log('modified keys belong to the browser:');
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        location.hash = '';
        winHandlers.hashchange();
        focused.id = 'tab-about';
        let prevented = false;
        tabs[0]._handlers.keydown({ key, [mod]: true, preventDefault() { prevented = true; } });
        check(mod.replace('Key', '') + '+' + key + ': not prevented, still about, focus kept',
              (prevented ? 'prevented' : 'free') + ' ' + state() + ' ' + focused.id, 'free about tab-about');
      }
    }
    log('modified and non-primary clicks belong to the browser:');
    for (const [label, props] of [['ctrl', { ctrlKey: true }], ['meta (Cmd)', { metaKey: true }], ['shift', { shiftKey: true }],
                                  ['alt', { altKey: true }], ['middle button', { button: 1 }]]) {
      location.hash = '';
      winHandlers.hashchange();
      let prevented = false;
      tabs[2]._handlers.click(Object.assign({ button: 0, preventDefault() { prevented = true; } }, props));
      check(label + '+click writing: not prevented, still about, hash kept',
            (prevented ? 'prevented' : 'free') + ' ' + state() + ' ' + (location.hash || '(none)'), 'free about (none)');
    }
    log('unmodified still works:');
    let prevented = false;
    tabs[2]._handlers.click({ button: 0, preventDefault() { prevented = true; } });
    check('plain click writing', (prevented ? 'prevented' : 'free') + ' ' + state(), 'prevented writing');
    prevented = false;
    tabs[2]._handlers.keydown({ key: 'Home', preventDefault() { prevented = true; } });
    check('plain Home', (prevented ? 'prevented' : 'free') + ' ' + state(), 'prevented about');
  }

  /* ---------- motion ---------- */
  section = 'motion toggle';
  log('motion toggle, loaded running:');
  {
    check('index.html ships it hidden', shipsHidden('index.html', 'motion'), true);
    const p = motionPage({ motion: 'running' });
    check('revealed by JS', p.btn.hidden, false);
    check('aria-pressed false', p.pressed(), 'false');
    check('nothing sent at load', p.seen.length, 0);
    p.btn.dispatchEvent(H.makeEvent('click'));
    check('click: pressed', p.pressed(), 'true');
    check('click: data-motion paused', p.state(), 'paused');
    check('click: saved', p.writes.join(';'), 'bg-motion=paused');
    check('click: one bgmotion { paused: true }', JSON.stringify(p.seen), '[{"paused":true}]');
    p.btn.dispatchEvent(H.makeEvent('click'));
    check('click again: running, saved, sent', p.pressed() + ' ' + p.state() + ' ' + p.writes.join(';') + ' ' + JSON.stringify(p.seen),
          'false running bg-motion=paused;bg-motion=running [{"paused":true},{"paused":false}]');
    p.change(true);
    check('reduced motion turned on after a choice: ignored', p.pressed() + ' ' + p.seen.length, 'false 2');
  }
  log('motion toggle, loaded paused (reduced motion, nothing saved):');
  {
    const p = motionPage({ motion: 'paused', reduce: true });
    check('aria-pressed true', p.pressed(), 'true');
    p.change(false);
    check('reduce turned off, no choice: follows', p.pressed() + ' ' + p.state() + ' ' + JSON.stringify(p.seen), 'false running [{"paused":false}]');
    check('following is not saving', p.writes.length, 0);
    p.change(true);
    check('and back on', p.pressed() + ' ' + p.state() + ' ' + p.seen.length, 'true paused 2');
  }
  log('a pause it did not cause (the background, too slow to animate):');
  {
    const p = motionPage({ motion: 'running' });
    p.doc.dispatchEvent(new (class { constructor() { this.type = 'bgmotion'; this.detail = { paused: true, reason: 'performance' }; } })());
    check('pressed, data-motion paused', p.pressed() + ' ' + p.state(), 'true paused');
    check('not saved', p.writes.length, 0);
    check('not sent on (only the one event)', p.seen.length, 1);
    p.btn.dispatchEvent(H.makeEvent('click'));
    check('the visitor resumes it: saved and sent', p.state() + ' ' + p.writes.join(';') + ' ' + JSON.stringify(p.seen[1]), 'running bg-motion=running {"paused":false}');
  }
  log('saved choice and odd storage:');
  {
    const p = motionPage({ motion: 'paused', stored: { 'bg-motion': 'paused' } });
    p.change(false);
    check('saved paused outranks the setting', p.pressed() + ' ' + p.seen.length, 'true 0');
    const t = motionPage({ motion: 'running', storage: 'throw' });
    let threw = 'no';
    try { t.btn.dispatchEvent(H.makeEvent('click')); t.change(true); } catch (e) { threw = e.message; }
    check('storage that throws: no exception', threw, 'no');
    check('storage that throws: still toggles and sends', t.state() + ' ' + t.seen.length, 'paused 2');
    const a = motionPage({ motion: 'running', storage: 'absent' });
    a.btn.dispatchEvent(H.makeEvent('click'));
    check('no storage at all: toggles and sends', a.pressed() + ' ' + a.seen.length, 'true 1');
    const l = motionPage({ motion: 'running', legacy: true });
    l.change(true);
    check('MediaQueryList.addListener only (old Safari): follows', l.state() + ' ' + l.seen.length, 'paused 1');
    const n = motionPage({ storage: 'ok', reduce: true });
    check('no data-motion (no head script): starts from the setting', n.pressed() + ' ' + n.state(), 'true paused');
    const nb = motionPage({ motion: 'running', button: false });
    nb.change(true);
    check('no button: the setting is still followed', nb.state() + ' ' + nb.seen.length, 'paused 1');
    const none = motionPage({ motion: 'running', button: false, cosmos: false });
    none.change(true);
    check('no background and no button: nothing listens', none.state() + ' ' + none.seen.length, 'running 0');
  }

  /* ---------- head ---------- */
  section = '<head> script';
  log('the <head> script that sets data-motion:');
  {
    const src = headScript();
    check('found in index.html', !!src, true);
    if (src) {
      check('nothing saved, no preference', runHead(src, {}), 'running');
      check('nothing saved, reduced motion', runHead(src, { reduce: true }), 'paused');
      check('saved running beats reduced motion', runHead(src, { reduce: true, stored: { 'bg-motion': 'running' } }), 'running');
      check('saved paused', runHead(src, { stored: { 'bg-motion': 'paused' } }), 'paused');
      check('garbage saved: the setting decides', runHead(src, { reduce: true, stored: { 'bg-motion': 'yes' } }), 'paused');
      check('storage that throws', runHead(src, { storage: 'throw', reduce: true }), 'paused');
      check('no storage at all', runHead(src, { storage: 'absent' }), 'running');
    }
  }

  /* ---------- dice ---------- */
  section = 'dice';
  log('dice:');
  {
    check('index.html ships them hidden', shipsHidden('index.html', 'dice'), true);
    check('the post template ships them hidden', shipsHidden('blog/post-template.html', 'dice'), true);
    const d = dicePage([2, 5, 3, 6, 3, 6, 1, 1, 4, 2]);
    d.flush();
    check('roll on load: drawn', d.shown(), '2 and 5');
    check('revealed by JS, the first roll drawn', d.dice.hidden + ' ' + d.shown(), 'false 2 and 5');
    check('roll on load: says nothing', d.said.length + ' "' + d.out.textContent + '"', '0 ""');
    d.dice.dispatchEvent(H.makeEvent('click'));
    check('click: emptied first', d.out.textContent, '');
    d.flush();
    check('click: announced, matching the pips', d.out.textContent, 'rolled ' + d.shown());
    check('the pips', d.shown(), '3 and 6');
    d.dice.dispatchEvent(H.makeEvent('click'));
    d.flush();
    check('the same pair again: said again', d.said.slice(-2).join('|'), '|rolled 3 and 6');
    const k = H.makeEvent('keydown', { key: 'Enter' });
    d.dice.dispatchEvent(k);
    d.flush();
    check('Enter: announced, default prevented', d.out.textContent + ' ' + k.defaultPrevented, 'rolled 1 and 1 true');
    const sp = H.makeEvent('keydown', { key: ' ' });
    d.dice.dispatchEvent(sp);
    d.dice.dispatchEvent(H.makeEvent('click'));
    check('two rolls in a row: one announcement pending', d.pending(), 1);
    d.flush();
    check('it is the last roll', d.out.textContent, 'rolled ' + d.shown());
    const tab = H.makeEvent('keydown', { key: 'Tab' });
    const before = d.said.length;
    d.dice.dispatchEvent(tab);
    d.flush();
    check('other keys: nothing', d.said.length - before + ' ' + tab.defaultPrevented, '0 false');
  }

  return { pass, fail, sections };
}

module.exports = { run };

if (require.main === module) {
  let r;
  try { r = run(); }
  catch (e) { console.error('FAIL: ' + e.message); process.exit(1); }
  console.log('\n' + r.pass + ' passed, ' + r.fail + ' failed');
  process.exit(r.fail ? 1 : 0);
}
