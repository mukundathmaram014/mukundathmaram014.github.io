'use strict';
/* With prefers-reduced-motion: reduce, no CSS transition or animation moves
   anything (WCAG 2.3.3). Headless Chrome loads index.html and the post
   template with the preference emulated and works every control: each tab
   by click and by arrow key, a hover over every tab, rail link and the dice,
   a press on the dice, and a real pill link (<a class="btn">, injected the
   way README's recipe makes one) hovered and pressed; the template's tabs
   and back link hovered. After each, it lists the transitions and
   animations that started (document.getAnimations()). Only opacity,
   visibility and colours may change: a transform, a size or a position is
   motion. The tab underline grew from 0.6 to full width and the dice hopped
   2px while the preference was set.

   Also: the underline's transform is the same on the selected and the other
   tabs, so it does not change size as it appears; and a pressed dice keeps
   its resting transform.

   Control: the same run without the preference must start at least one
   moving transition, or the check could not see motion at all.
   SKIP when puppeteer-core or Chrome is missing. Exit 1 on failure. */
const B = require('./browser');
const A = require('./a11y');

/* properties whose transition is not motion */
const still = p => p === 'opacity' || p === 'visibility' || p === 'fill' || p === 'stroke' || /(^|-)color$/.test(p);

function startedNow() {
  const name = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList.length ? '.' + Array.from(n.classList).join('.') : '');
  return document.getAnimations().map(a => {
    const fx = a.effect || {};
    const props = a.transitionProperty ? [a.transitionProperty]
      : (fx.getKeyframes ? Array.from(new Set([].concat(...fx.getKeyframes().map(k => Object.keys(k)))))
          .filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)) : []);
    return { kind: a.transitionProperty ? 'transition' : 'animation', props,
             target: fx.target ? name(fx.target) + (fx.pseudoElement || '') : '?' };
  });
}

async function run(site, reduce) {
  const log = [], moving = [], facts = {};
  let started = 0;
  const watch = async (s, label, act) => {
    await act();
    const list = await s.evaluate(startedNow);
    started += list.length;
    for (const a of list) for (const p of a.props) {
      if (!still(p.replace(/[A-Z]/g, c => '-' + c.toLowerCase()))) moving.push(label + ': ' + a.kind + ' of ' + p + ' on ' + a.target);
    }
    log.push(label);
    await A.settle(s.page);
  };
  const open = async file => {
    const s = await site.open(file, { width: 1440, height: 900 });
    await s.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]);
    await s.page.reload({ waitUntil: 'load' });
    await A.pause(s);
    await s.page.mouse.move(1, 1);
    await A.settle(s.page);
    return s;
  };
  let s = await open('index.html');
  try {
    const tabs = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]')).map(t => '#' + t.id));
    for (const t of tabs.slice(1).concat(tabs[0])) await watch(s, 'click ' + t, () => s.page.click(t));
    await s.page.mouse.move(1, 1);
    await A.settle(s.page);
    await s.page.focus(tabs[0]);
    for (let i = 0; i < tabs.length; i++) await watch(s, 'ArrowRight on the tablist', () => s.page.keyboard.press('ArrowRight'));
    facts.underline = await s.evaluate(() => Array.from(document.querySelectorAll('.tab[role="tab"]'))
      .map(t => ({ sel: t.getAttribute('aria-selected'), transform: getComputedStyle(t, '::after').transform })));
    for (const t of tabs) await watch(s, 'hover ' + t, () => s.page.hover(t));
    const rail = await s.evaluate(() => document.querySelectorAll('.social a').length);
    for (let i = 1; i <= rail; i++) await watch(s, 'hover rail link ' + i, () => s.page.hover('.social a:nth-of-type(' + i + ')'));
    if (await s.evaluate(() => !!document.getElementById('motion') && !document.getElementById('motion').hidden)) {
      await watch(s, 'hover #motion', () => s.page.hover('#motion'));
    }
    await watch(s, 'hover the dice', () => s.page.hover('#dice'));
    const rest = await s.evaluate(() => Array.from(document.querySelectorAll('#dice svg')).map(g => getComputedStyle(g).transform));
    await watch(s, 'press the dice', () => s.page.mouse.down());
    facts.dice = { rest, pressed: await s.evaluate(() => Array.from(document.querySelectorAll('#dice svg')).map(g => getComputedStyle(g).transform)) };
    await s.page.mouse.up();
    await A.settle(s.page);
    /* select research the way a deep link does, and wait for the controller */
    await s.evaluate(h => new Promise(res => {
      if (location.hash === h) { res(); return; }
      window.addEventListener('hashchange', () => res(), { once: true });
      location.hash = h;
    }), '#research');
    await s.evaluate(() => {
      const a = document.createElement('a');
      a.className = 'btn'; a.id = 'motion-probe'; a.href = '#research'; a.textContent = 'pdf';
      (document.querySelector('.pub .links') || document.querySelector('main')).appendChild(a);
    });
    await A.settle(s.page);
    await watch(s, 'hover a.btn', () => s.page.hover('#motion-probe'));
    await watch(s, 'press a.btn', () => s.page.mouse.down());
    await s.page.mouse.up();
    for (const e of s.errors) moving.push('index.html: ' + e.type + ': ' + e.text);
  } finally { await s.close(); }
  s = await open('blog/post-template.html');
  try {
    const n = await s.evaluate(() => document.querySelectorAll('.tabs .tab').length);
    for (let i = 1; i <= n; i++) await watch(s, 'template: hover tab ' + i, () => s.page.hover('.tabs .tab:nth-of-type(' + i + ')'));
    if (await s.evaluate(() => !!document.querySelector('.back'))) await watch(s, 'template: hover back link', () => s.page.hover('.back'));
  } finally { await s.close(); }
  return { log, moving, started, facts };
}

async function main() {
  const why = B.unavailable();
  if (why) { console.log('check-reduced-motion: SKIP - ' + why); return; }
  const site = await A.pages();
  let reduced, control;
  try {
    reduced = await run(site, true);
    control = await run(site, false);
  } finally {
    await site.close();
  }
  const fails = reduced.moving.slice();
  /* 'none' and the identity matrix draw the same */
  const same = t => (t === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : t);
  const under = (reduced.facts.underline || []).map(u => Object.assign({}, u, { transform: same(u.transform) }));
  if (new Set(under.map(u => u.transform)).size > 1) {
    fails.push('the tab underline changes size as it appears: ' + under.map(u => (u.sel === 'true' ? 'selected ' : 'other ') + u.transform).join(', '));
  }
  const d = reduced.facts.dice;
  if (d && d.rest.join() !== d.pressed.join()) fails.push('a pressed dice moves: ' + d.rest.join(' ') + ' -> ' + d.pressed.join(' '));
  if (!control.moving.length) fails.push('control: without the preference no moving transition started at all, so this check cannot see motion');
  if (fails.length) {
    console.log('check-reduced-motion: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-reduced-motion: OK - with reduce, ' + reduced.log.length + ' interactions on index.html and the template started '
              + reduced.started + ' transitions, none of them motion (opacity and colour only); the underline is ' + under[0].transform
              + ' on every tab; a pressed dice keeps its rest transform; control without reduce: ' + control.moving.length + ' moving transitions');
}
main().catch(e => { console.log('check-reduced-motion: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
