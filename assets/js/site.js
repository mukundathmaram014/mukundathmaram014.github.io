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

/* thoughts: hovering a paper or a post (or tabbing into one) shows its
   <template class="gist"> - a line drawing and a sentence - in the empty rail
   beside it, with a thin branch drawn to it from the title. For a mouse or a
   pen only, and only where the rail is a column of its own; site.css has the
   look, under "thoughts". */
(function () {
  if (typeof document.querySelector !== 'function' || typeof document.querySelectorAll !== 'function' || !window.matchMedia) return;
  const notes = Array.prototype.filter.call(document.querySelectorAll('template.gist'),
    t => t.tagName === 'TEMPLATE' && t.content && t.parentElement);
  const cols = document.querySelector('.columns');
  const rail = cols && cols.querySelector('.rail');
  if (!notes.length || !rail) return;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const NS = 'http://www.w3.org/2000/svg';
  const box = document.createElement('div');
  box.className = 'thought';
  box.setAttribute('aria-hidden', 'true');
  const branch = document.createElementNS(NS, 'svg');
  branch.setAttribute('class', 'branch');
  branch.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('pathLength', '1');
  branch.appendChild(path);
  cols.appendChild(branch);
  cols.appendChild(box);
  let current = null, hideTimer = 0, raf = 0;

  function hide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      box.classList.remove('on');
      branch.classList.remove('on');
      current = null;
      const fig = box.querySelector('svg');
      if (fig && fig.pauseAnimations) fig.pauseAnimations();
    }, 60);
  }
  function show(item, tpl) {
    window.clearTimeout(hideTimer);
    if (!fine.matches) return;
    const c = cols.getBoundingClientRect(), r = rail.getBoundingClientRect();
    const head = item.querySelector('.ptitle, .post-title') || item;
    const h = head.getBoundingClientRect();
    /* the rail's column, short of the branch's run to the title */
    const w = Math.min(r.width - 10, h.left - r.left - 34);
    if (w < 120) { hide(); return; }
    if (current !== item) {
      current = item;
      box.classList.remove('on');
      branch.classList.remove('on');
      box.replaceChildren(tpl.content.cloneNode(true));
      /* the drawing loops; where motion is reduced or paused it holds one
         frame instead, the moment its data-still names */
      const fig = box.querySelector('svg');
      if (fig && fig.pauseAnimations && (still.matches || document.documentElement.dataset.motion === 'paused')) {
        fig.pauseAnimations();
        fig.setCurrentTime(+fig.getAttribute('data-still') || 0);
      }
    }
    box.style.left = (r.left - c.left) + 'px';
    box.style.width = w + 'px';
    /* centred on the item, every one alike (the last runs on into the space
       above the footer rather than rising) */
    const it = item.getBoundingClientRect();
    const top = Math.max(0, it.top - c.top + (it.height - box.offsetHeight) / 2);
    box.style.top = top + 'px';
    const fig = box.querySelector('svg');
    const lineH = parseFloat(window.getComputedStyle(head).lineHeight) || 24;
    const sx = h.left - c.left - 8, sy = h.top - c.top + lineH / 2;
    const fr = fig && fig.getBoundingClientRect();
    const ex = r.left - c.left + w + 8, ey = fr ? fr.top - c.top + fr.height / 2 : top + 10;
    path.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + (sx - 14) + ' ' + sy + ', ' + (ex + 14) + ' ' + ey + ', ' + ex + ' ' + ey);
    window.cancelAnimationFrame(raf);
    /* two frames: the cleared state paints first, so each thought draws anew */
    raf = window.requestAnimationFrame(() => {
      raf = window.requestAnimationFrame(() => {
        box.classList.add('on');
        branch.classList.add('on');
      });
    });
  }
  for (const tpl of notes) {
    const item = tpl.parentElement;
    item.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') show(item, tpl); });
    item.addEventListener('pointerleave', hide);
    item.addEventListener('focusin', () => show(item, tpl));
    item.addEventListener('focusout', e => { if (!item.contains(e.relatedTarget)) hide(); });
  }
  window.addEventListener('resize', hide);
})();

/* clips: an <img class="clip" data-clip="....mp4"> (the tea panel's) is the
   first frame of a short muted loop. While it is on screen and motion runs,
   the clip plays over it like a gif; made only then, so a visit that never
   opens the panel never fetches it. It is aria-hidden: the picture's alt
   says what it shows, and its media buttons would be stops that do nothing
   useful. Where the visitor has paused motion, or asked for less of it, the
   still frame shows instead: the state the background follows (data-motion
   and the 'bgmotion' event, under "motion" above). The background pausing
   itself for speed ({ reason: 'performance' }) is not a choice and leaves
   it be. */
(function () {
  if (typeof document.querySelectorAll !== 'function') return;
  const stills = Array.prototype.filter.call(document.querySelectorAll('img.clip[data-clip]'), i => i.parentNode);
  if (!stills.length) return;
  let paused = document.documentElement.dataset.motion === 'paused';
  const inView = new Set(), clips = new Map();
  function clipFor(img) {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.poster = img.currentSrc || img.src;
    v.src = img.getAttribute('data-clip');
    img.parentNode.appendChild(v);
    return v;
  }
  function sync() {
    for (const img of stills) {
      const run = !paused && inView.has(img);
      let v = clips.get(img);
      if (run && !v) { v = clipFor(img); clips.set(img, v); }
      if (!v) continue;
      v.hidden = paused;
      if (run) {
        const p = v.play();
        if (p && p.catch) p.catch(() => { /* autoplay refused: the still shows */ });
      } else v.pause();
    }
  }
  document.addEventListener('bgmotion', e => {
    const d = (e && e.detail) || {};
    if (d.reason === 'performance') return;
    paused = !!d.paused;
    sync();
  });
  if (!('IntersectionObserver' in window)) return;
  const io = new window.IntersectionObserver(entries => {
    for (const en of entries) { if (en.isIntersecting) inView.add(en.target); else inView.delete(en.target); }
    sync();
  });
  stills.forEach(i => io.observe(i));
})();
