'use strict';
/* The scene runs on its own. assets/js/bg/scene.js holds everything about
   the background except drawing (W0), and it has to stay that way: the
   WebGL renderer is built on it, and the tools test it in node.

   Static: the only globals scene.js may name are the language's own data
   builtins (Math, Object, Array, Number ...) and globalThis, to publish Bg.
   No window, document, canvas, performance or timers, and nothing that
   makes it nondeterministic or does I/O: no Date, Math.random, console,
   eval, Intl, WeakRef. A free name is found by scope analysis
   (jsscope.js), so a reference in a branch that never runs still counts.

   Live: scene.js alone in a bare node vm context - no DOM, no canvas stub,
   no other script; console and Date removed, Math.random trapped. Six runs
   (1440x900, 390x844, 3840x2160; moving, and paused: every frame a still
   one, Bg.hold, as main.js draws while the motion is paused) of 600 frames: a
   scripted pointer (along the sheet, across the horizon, over the sky,
   flicks from corner to corner, leaving and coming back), a 250ms stall at
   frame 300 and a resize at frame 400. Every frame it asks for everything
   the renderer reads from it (render-webgl.js): sunAt and bodiesAt, the
   frame's moving state; ridgeSummits, peakPlace and treeLevels, the layout
   it builds its meshes from (once per size on the page, every frame here);
   and the CPU copies the tools hold its shaders to: a grid of surfacePoint
   and the terrain's pushes (terrainPushDip, terrainPushSide) over the
   width. Nothing may throw, and every number in the state (every field of
   look, ptr, mk, CUR, RIP, EVF, bodiesW, bodyPull, bodyRoll, TPUSH,
   lastNow, simNow, W, H) and in every answer must be finite.

   Parity: the same inputs through the whole page - harness.js running every
   background script, main.js's listeners and loop, the quality governor and
   the WebGL renderer drawing into the recording stub - must leave the scene
   in exactly the same state, bit for bit, after every frame. That is the
   proof that the scene is self-contained: nothing main.js, the governor or
   the renderer does feeds back into it. The page runs at ?bgq=0, the
   governor's top level held, so that it draws every frame the scene alone
   is stepped (adapting, it skips one frame early on to sample the vsync:
   check-governor.js).

   SKIP for a pre-split SITE_ROOT (no assets/js/bg/scene.js). Exit 1 on any
   failure. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./jsscope');
S.reexecWithInternals(__filename);
const H = require('./harness');

const file = path.join(H.ROOT, 'assets', 'js', 'bg', 'scene.js');
if (!fs.existsSync(path.join(H.ROOT, 'assets', 'js', 'bg'))) {
  console.log('check-scene-headless: SKIP - no assets/js/bg/ under ' + H.ROOT + ' (a pre-split layout)');
  process.exit(0);
}
const fails = [];
function fail(msg) { fails.push(msg); }
if (!fs.existsSync(file)) { console.log('check-scene-headless: FAIL - ' + file + ' does not exist'); process.exit(1); }
const src = fs.readFileSync(file, 'utf8');

/* ---- static: the globals scene.js names -------------------------------- */
const DENY = new Set(['console', 'Date', 'eval', 'Function', 'Intl', 'WebAssembly', 'SharedArrayBuffer',
                      'Atomics', 'FinalizationRegistry', 'WeakRef', 'escape', 'unescape']);
const ALLOWED = new Set(Object.getOwnPropertyNames(vm.runInNewContext('globalThis')).filter(n => !DENY.has(n)));
const acorn = S.acorn();
const used = new Set();
if (!acorn) fail('cannot analyse scene.js: this node (' + process.version + ') does not ship acorn internally');
else {
  const ast = S.parse(acorn, src, file);
  for (const g of S.analyse(ast).globals) {
    used.add(g.name);
    if (!ALLOWED.has(g.name)) fail('scene.js:' + g.node.loc.start.line + ' names the global ' + g.name
                                   + (DENY.has(g.name) ? ', which would make the scene nondeterministic or do I/O'
                                                       : '; the scene must not touch the page - let main.js pass it in'));
  }
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'Math'
        && n.property.name === 'random') fail('scene.js:' + n.loc.start.line + ' calls Math.random; use hash1 so the scene stays deterministic');
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
}

/* ---- the inputs: one scripted session, as calls on the scene ------------ */
const FRAMES = 600, NOW0 = 1200;
const dtAt = i => (i === 300 ? 250 : 16.7);
/* the inputs that arrive before frame i: ['move', x, y] | ['gone'] | ['size', W, H] */
function inputs(i, W, Hh) {
  const out = [];
  const move = (fx, fy) => out.push(['move', fx * W, fy * Hh]);
  if (i >= 30 && i < 120) move(0.1 + 0.8 * (i - 30) / 89, 0.85);                         /* along the sheet */
  else if (i >= 120 && i < 220) move(0.5 + 0.4 * Math.sin(i * 0.07), 0.30 + 0.30 * (i - 120) / 99);  /* across the horizon */
  else if (i >= 220 && i < 260 && i % 3 === 0) move((i / 3) % 2 ? 0.02 : 0.98, (i / 6) % 2 ? 0.05 : 0.95);  /* corner flicks */
  else if (i === 260) out.push(['gone']);                                                 /* leaves the window */
  else if (i >= 330 && i < 420) move(0.95 - 0.5 * (i - 330) / 89, i < 360 ? 0.9 : 0.1);  /* back, far away; then the sky */
  else if (i >= 420 && i < 470) move(0.2 + 0.6 * ((i - 420) % 10) / 9, 0.7);            /* fast sweeps, then it stops */
  else if (i === 480) out.push(['gone']);                                                 /* the window loses focus */
  if (i === 400) out.push(['size', Math.round(W * 0.8), Math.round(Hh * 1.1)]);
  return out;
}

/* ---- the scene's state, flattened: [label, value] ------------------------
   Every own field of every state object, so a field added to the scene is
   compared without this list knowing about it. */
const STATE = ['look', 'ptr', 'mk', 'CUR', 'RIP', 'EVF'];
const STATE_LISTS = ['bodiesW', 'bodyPull', 'bodyRoll', 'TPUSH'];
function state(Bg) {
  const out = [];
  const obj = (label, o) => { for (const k of Object.keys(o).sort()) out.push([label + '.' + k, o[k]]); };
  for (const n of STATE) if (Bg[n]) obj(n, Bg[n]);
  for (const n of STATE_LISTS) (Bg[n] || []).forEach((b, i) => obj(n + '[' + i + ']', b));
  out.push(['lastNow', Bg.lastNow], ['simNow', Bg.simNow], ['W', Bg.W], ['H', Bg.H]);
  return out;
}
/* every number in an answer, however nested */
function numbers(v, out) {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => numbers(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbers(v[k], out);
  return out;
}
/* everything the renderer reads from the scene, and the CPU copies of its
   shaders' math */
function query(Bg, t) {
  const got = [Bg.sunAt(), Bg.bodiesAt(t)];
  for (const r of Bg.RIDGES) got.push(Bg.ridgeSummits(r));
  for (const b of Bg.BANDS) for (let k = 0; k < b.n; k++) got.push(Bg.peakPlace(b, k));
  for (let r = 0; r <= 8; r++) for (let c = -6; c <= 6; c++) got.push(Bg.surfacePoint(c * 0.4, 1 + r * 0.7, t));
  for (let x = -0.1; x <= 1.1; x += 0.05) {
    const sx = x * Bg.W, rest = Bg.restAt(5.5);
    got.push(Bg.terrainPushDip(sx, rest - 0.3 * Bg.H, rest), Bg.terrainPushSide(sx, rest - 0.3 * Bg.H, rest, Bg.CUR_TERR_SIDE * Bg.S));
  }
  return got;
}

/* the scene alone: a bare context with nothing but the language */
function alone(W, Hh) {
  const ctx = vm.createContext({});
  vm.runInContext('delete globalThis.console; delete globalThis.Date;'
                  + ' Math.random = function () { throw new Error("the scene called Math.random"); };', ctx);
  vm.runInContext(src, ctx, { filename: file });
  const Bg = ctx.Bg;
  if (!Bg || typeof Bg.advance !== 'function') throw new Error('scene.js did not publish globalThis.Bg with advance()');
  Bg.setSize(W, Hh);
  return Bg;
}
/* the whole page, through the harness: paused from load (the reduced-motion
   setting, with no saved choice) for a still run */
function page(W, Hh, still) {
  return H.load({ W, H: Hh, dpr: 1.5, reduced: still, now: NOW0, search: '?bgq=0' });
}

const RUNS = [[1440, 900, false], [390, 844, false], [3840, 2160, false], [1440, 900, true], [390, 844, true], [3840, 2160, true]];
let checkedValues = 0, frames = 0, answers = 0;
for (const [W, Hh, still] of RUNS) {
  const tag = W + 'x' + Hh + (still ? ' still' : '');
  let Bg, sim;
  try { Bg = alone(W, Hh); } catch (e) { fail(tag + ': scene.js alone: ' + e.message); continue; }
  try { sim = page(W, Hh, still); } catch (e) { fail(tag + ': the page: ' + e.message); continue; }
  const PB = sim.window.Bg;
  /* the fractal layouts are static: a renderer builds them once */
  for (const v of numbers(Bg.TREES.map(c => Bg.treeLevels(c)), [])) {
    checkedValues++;
    if (!Number.isFinite(v)) { fail(tag + ": treeLevels gives a non-finite value (" + v + ")"); break; }
  }
  let now = NOW0, firstDiff = null, bad = null;
  for (let i = 0; i < FRAMES && !bad; i++) {
    const events = inputs(i, Bg.W, Bg.H), dt = dtAt(i);
    now += dt;
    let got;
    try {
      for (const [kind, a, b] of events) {
        /* stamped as the page's pointermove will be (the page clock before its frame): main.js passes
           event times, and the scene paces the pointer by them (scene.js smoothAt) */
        if (kind === 'move') Bg.pointerAt(a, b, sim.now);
        else if (kind === 'gone') Bg.pointerGone();
        else if (kind === 'size') Bg.setSize(a, b);
      }
      const t = still ? Bg.hold() : Bg.advance(now);
      got = query(Bg, t);
    } catch (e) { bad = tag + ' frame ' + i + ': scene.js alone threw: ' + e.message; break; }
    /* the page gets the same inputs as DOM events, through main.js */
    try {
      for (const [kind, a, b] of events) {
        if (kind === 'move') sim.move(a, b);
        else if (kind === 'gone') { if (i === 480) sim.blur(); else sim.leave(); }
        else if (kind === 'size') sim.resize(a, b);
      }
      sim.frame(dt);
    } catch (e) { bad = tag + ' frame ' + i + ': the page threw: ' + e.message; break; }
    frames++;
    answers += got.length;
    for (const v of numbers(got, [])) { checkedValues++; if (!Number.isFinite(v)) { bad = tag + ' frame ' + i + ': a non-finite value (' + v + ') in what a renderer is given'; break; } }
    const a = state(Bg), p = state(PB);
    for (const [label, v] of a) {
      checkedValues++;
      if (typeof v === 'number' && !Number.isFinite(v)) { bad = tag + ' frame ' + i + ': ' + label + ' = ' + v; break; }
      if (typeof v !== 'number' && typeof v !== 'boolean') { bad = tag + ' frame ' + i + ': ' + label + ' is ' + typeof v; break; }
    }
    if (!firstDiff) {
      if (a.length !== p.length) firstDiff = 'frame ' + i + ': ' + a.length + ' state values alone vs ' + p.length + ' in the page';
      else for (let k = 0; k < a.length; k++) {
        if (a[k][0] !== p[k][0] || !Object.is(a[k][1], p[k][1])) {
          firstDiff = 'frame ' + i + ': ' + a[k][0] + ' = ' + a[k][1] + ' alone, ' + p[k][0] + ' = ' + p[k][1] + ' in the page';
          break;
        }
      }
    }
  }
  if (bad) fail(bad);
  if (firstDiff) fail(tag + ': the scene alone and the page diverge at ' + firstDiff);
}

if (fails.length) {
  console.log('check-scene-headless: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-scene-headless: OK - scene.js alone in a bare context (globals named: ' + [...used].sort().join(', ')
            + '), ' + RUNS.length + ' runs x ' + FRAMES + ' frames (3 viewports, moving and paused), '
            + answers.toLocaleString('en-US') + ' renderer queries: no throw, '
            + checkedValues.toLocaleString('en-US') + ' values all finite, and bit-identical to the full page '
            + '(main.js, the governor, the WebGL renderer) after every frame');
