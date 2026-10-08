/* Page behaviour: the footer dice, the tab controller, and the toggle that
   pauses the background.

   index.html and the post template load this with a plain synchronous
   <script src> at the end of <body> (on index.html after the background
   scripts, assets/js/bg/): each IIFE looks its elements up as soon as it
   runs, and does nothing on a page without them. What has to happen before
   the first paint is in small inline scripts in index.html's <head>
   instead: the font preloads, the js-tabs class that hides the inactive
   panels, and the motion state (data-motion) the background starts in.
   _tools/tabtest.js and check-tabs.js run this file in node. */
/* dice: a fresh roll on load, on click, and on Enter / Space. The pips are
   a picture inside a role=button, whose content assistive technology never
   reads, so a roll the visitor asked for is also put into words in the
   status region beside it, #dice-out (audit F12). The roll on load says
   nothing. The dice ship hidden and are revealed here, with that first
   roll drawn: everything they do is this script, so a visitor without it
   used to tab to a "roll the dice" button showing two empty squares, which
   did nothing (the motion toggle below works the same way). */
(function () {
  const dice = document.getElementById('dice');
  if (!dice) return;
  const out = document.getElementById('dice-out');
  const PIPS = {
    1: [[12,12]],
    2: [[7.5,7.5],[16.5,16.5]],
    3: [[7.5,7.5],[12,12],[16.5,16.5]],
    4: [[7.5,7.5],[16.5,7.5],[7.5,16.5],[16.5,16.5]],
    5: [[7.5,7.5],[16.5,7.5],[12,12],[7.5,16.5],[16.5,16.5]],
    6: [[7.5,6.5],[16.5,6.5],[7.5,12],[16.5,12],[7.5,17.5],[16.5,17.5]]
  };
  const groups = dice.querySelectorAll('.pips');
  let say = 0;
  function roll(announce) {
    const got = [];
    groups.forEach(g => {
      const n = 1 + Math.floor(Math.random() * 6);
      got.push(n);
      g.innerHTML = PIPS[n].map(([x, y]) =>
        '<circle cx="' + x + '" cy="' + y + '" r="1.9"/>').join('');
    });
    if (!announce || !out) return;
    /* A live region speaks when its text changes, and the same pair comes
       up one roll in 36: empty it, then fill it a moment later. */
    out.textContent = '';
    window.clearTimeout(say);
    say = window.setTimeout(() => { out.textContent = 'rolled ' + got.join(' and '); }, 50);
  }
  dice.addEventListener('click', () => roll(true));
  dice.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(true); } });
  roll(false);
  dice.hidden = false;
})();

/* tabs: in-page panels, hash-addressable, arrow-key navigable.
   The panels' half of the tabs pattern is put on here rather than written
   in the markup. Without JS every panel shows, as one long read, and
   index.html hides the tab bar, so a static role="tabpanel" was announced
   as three tab panels belonging to no tab list (audit F34). The tabs keep
   theirs in the markup: they are hidden with the bar, and so are right at
   the first paint. Each tab names its panel in aria-controls. */
(function () {
  const tabs = Array.from(document.querySelectorAll('.tab[role="tab"]'));
  if (!tabs.length) return;
  const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const names = tabs.map(t => t.dataset.tab);
  tabs.forEach((t, j) => {
    panels[j].setAttribute('role', 'tabpanel');
    panels[j].setAttribute('aria-labelledby', t.id);
    /* Nothing in a panel takes focus, so the open panel is a Tab stop
       itself, the APG pattern (audit F36); the others are not displayed. */
    panels[j].tabIndex = 0;
  });

  function select(name, push) {
    let i = names.indexOf(name);
    if (i === -1) i = 0;
    tabs.forEach((t, j) => {
      const on = j === i;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      panels[j].classList.toggle('is-active', on);
    });
    /* publish the active tab so the rail (which lives outside the panels)
       can style itself — see the portrait rule in site.css */
    document.body.dataset.tab = names[i];
    if (push && location.hash !== '#' + names[i]) {
      history.replaceState(null, '', '#' + names[i]);
    }
  }

  tabs.forEach(t => {
    /* A modified click or key belongs to the browser (audit F35): Ctrl,
       Cmd or Shift+click opens the tab's #hash in a new tab or window,
       which the hash routing below then lands on; Alt+click downloads;
       Alt+Left/Right is Back/Forward, as Cmd+arrows are on a Mac; with
       caret browsing Shift+arrows select text. */
    t.addEventListener('click', function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      select(t.dataset.tab, true);
    });
    t.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const i = tabs.indexOf(t);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      tabs[j].focus();
      select(names[j], true);
    });
  });

  window.addEventListener('hashchange', function () { select(location.hash.slice(1), false); });
  select(location.hash.slice(1), false);

  /* The italic face is only on the research and writing panels, which are
     hidden when the page opens on about: the browser fetched it on the
     first visit there and swapped Georgia's italic for it in view (audit
     F40). Load it as soon as the page has loaded. A failure is the
     browser's to report (a failed request); the text keeps the fallback. */
  const italic = () => {
    if (document.fonts && document.fonts.load) document.fonts.load('italic 400 1em Newsreader').catch(() => {});
  };
  if (document.readyState === 'complete') italic();
  else window.addEventListener('load', italic);
})();

/* motion: the footer toggle that pauses the background (WCAG 2.2.2 Pause,
   Stop, Hide; audit G5.1).

   The state is document.documentElement.dataset.motion, 'paused' or
   'running'. The inline script in index.html's <head> sets it before the
   first frame, from the visitor's choice (localStorage 'bg-motion'), else
   from prefers-reduced-motion, and the background (assets/js/bg/main.js)
   starts that way. A change is a 'bgmotion' event on document, detail
   { paused }, which the background follows.

   The button is the APG toggle pattern: its label never changes and
   aria-pressed is the state, pressed = paused. It ships hidden, so a
   visitor without JS never meets a button that does nothing, and is
   revealed once, here. Where the background is a still picture in place of
   the animation there is nothing to pause, and site.css hides it again
   (html[data-bg="static"] #motion, which main.js's data-bg turns on).

   Three things change the state:
   - the button. The choice is saved, so it outlives the visit;
   - prefers-reduced-motion changing while the page is open, for a visitor
     who has not chosen: it used to be read once, at load (audit F10);
   - anything else that sends 'bgmotion', such as the background pausing
     itself on a machine too slow to animate it (detail { paused: true,
     reason: 'performance' }). The button only shows such a change: it is
     not saved and not sent on, so no two listeners can echo each other. */
(function () {
  const root = document.documentElement;
  const btn = document.getElementById('motion');
  if (!btn && !document.getElementById('cosmos')) return;
  const KEY = 'bg-motion';
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function chosen() {
    let v = null;
    try { v = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: nothing was saved */ }
    return v === 'paused' || v === 'running' ? v : null;
  }
  function show(paused) {
    root.dataset.motion = paused ? 'paused' : 'running';
    if (btn) btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }
  function send(paused) {
    show(paused);
    document.dispatchEvent(new window.CustomEvent('bgmotion', { detail: { paused: paused } }));
  }
  /* every change, ours included, arrives here; this only shows it */
  document.addEventListener('bgmotion', e => { show(!!(e && e.detail && e.detail.paused)); });
  if (reduce) {
    const follow = e => { if (!chosen()) send(!!e.matches); };
    if (reduce.addEventListener) reduce.addEventListener('change', follow);
    else if (reduce.addListener) reduce.addListener(follow);
  }
  /* as the head script left it; without it, main.js's own fallback */
  show(root.dataset.motion ? root.dataset.motion === 'paused' : !!(reduce && reduce.matches));
  if (!btn) return;
  btn.addEventListener('click', () => {
    const paused = btn.getAttribute('aria-pressed') !== 'true';
    try { window.localStorage.setItem(KEY, paused ? 'paused' : 'running'); } catch (e) { /* not remembered */ }
    send(paused);
  });
  btn.hidden = false;
})();
