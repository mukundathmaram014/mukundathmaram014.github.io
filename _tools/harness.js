'use strict';
/* Shared loader for every _tools check and probe.

   Runs the REAL background scripts (or assets/js/site.js) in a vm sandbox
   against a stub DOM and canvas, so we measure the shipped code rather than
   a reimplementation of it. The canvas hands out a recording WebGL stub
   (makeGL, below), so the WebGL renderer's real JS runs here, every call it
   makes on the GPU seen; or, for an older root whose page draws with
   Canvas 2D (before W3, _baseline), a recording 2D context.

   The background is whatever index.html loads: the split layout's
   assets/js/bg/ scripts (since W3 scene.js, governor.js, render-webgl.js,
   main.js), in page order, each evaluated as its own script in one shared
   context, as a browser does. They share nothing but window.Bg.

   SITE_ROOT (env) picks the site to load; it defaults to the folder above
   _tools. Older layouts load too: a root whose index.html loads the single
   pre-split assets/js/background.js, and one with the canvas script inline
   in index.html, like the untouched _baseline/ copy:
     SITE_ROOT=_baseline node _tools/check-seat.js

     const H = require('./harness');
     const sim = H.load({ W: 1440, H: 900, dpr: 1.5 });
     sim.move(300, 700);              pointermove on documentElement/document/window
     sim.frames(60, 16.7);            advance the clock, one tick() per frame
     sim.P.CUR.d, sim.P.W             internals, through the probe

   The probe replaces the loop-starter line (START, in main.js) by default,
   so the page never queues its own first frame and the harness owns the
   clock: frame(dt) advances performance.now() by dt and calls tick once -
   a still frame when the motion is paused, as main.js's tick decides.
   starter: 'keep' leaves the starter in place and injects the probe just
   before it; frame() then runs whatever rAF callbacks the page itself
   queued, as a browser would (one that throws lands in sim.uncaught). Use
   'keep' to test the loop's own scheduling (pause, re-arm, a frame that
   throws, motion paused at load). An older root whose starter is
   LEGACY_START (the pre-A1 line) loads the same way.

   After the frame's rAF callbacks, frame() delivers ResizeObserver
   notifications for any observed element whose box changed, as a browser
   does after layout: a callback that asks for a frame gets it on the next
   frame() call.

   The probe sits in main.js's scope, so it sees main.js's own names (tick,
   fit, paused, dpr, W, H) and reads every other name from the scene's
   namespace, Bg. In a pre-split root it sits inside the one IIFE and sees
   everything. A page that returns before its loop starter (no WebGL: the
   still picture) gets the probe at the top level instead, reading Bg
   (sim.early). The renderer's internals are not reachable through it;
   measure what it draws through `record` (its GL calls), `sim.setDraw`
   (its draws, with the GL state of each) or scenery-twin.js, or tag
   its functions with `patches`.

   Options (all optional):
     W, H, dpr        viewport in CSS px, window.devicePixelRatio
     box              [w, h]: the canvas's own box (getBoundingClientRect,
                      documentElement.clientWidth) when it differs from the
                      viewport, e.g. [W - 17, H] for a classic scrollbar
                      (live: sim.setBox); default [W, H]
     reduced          prefers-reduced-motion result (live: sim.setReduced)
     motion           document.documentElement.dataset.motion at load:
                      'paused', 'running', or unset (default); changes come
                      as sim.motion(paused), a 'bgmotion' event on document
     record           true: every context op goes to sim.ops: a GL call as
                        { op, args, target: 'gl' } (makeGL), a 2D one as
                        { op, args, set, target, fill, stroke, lw }
                      (fill/stroke/lw = the context state at that op)
                      a function: called with that record, nothing kept
                      false (default): ops are only validated
     strict           (default true) validate ops: on the GL stub, any
                      non-finite number in any argument (a uniform, a
                      buffer's data); on the 2D stub, the way Chrome does:
                      createRadialGradient with a non-finite argument and
                      arc with a negative radius throw; non-finite path
                      coordinates are ignored; an unparsable colour or a
                      non-positive lineWidth is ignored. Every case is
                      logged in sim.problems.
     webgl            what WebGL the canvas offers: 'webgl2' (default: both
                      kinds), 'webgl' (WebGL 1 only) or false (none: the
                      page shows its still picture)
     search           location.search, e.g. '?bgq=0' to hold the quality
                      governor at its top level (main.js; most checks do,
                      so that every frame is drawn at min(dpr, 2):
                      adapting, it skips one frame early on to sample the
                      vsync)
     probe            expression for the probe object (default: getters for
                      PROBE_NAMES plus `expose`, each undefined if the name
                      no longer exists, so a renamed internal cannot break
                      every check at once)
     expose           extra names for the default probe
     patches          [[from, to], ...] applied to the sources first; `from`
                      is a string (must occur exactly once across all the
                      background scripts) or a RegExp (must match in exactly
                      one of them; `to` may use $1), or load throws. This is
                      how a tool makes a frame throw, or counts what runs,
                      without the page knowing about it (check-robustness.js,
                      check-scene-alloc.js).
     prelude          code injected at the probe point (main.js's scope, see
                      above), just before the probe
     starter, start   see above; start overrides the starter text
     now              performance.now() at load (default 0)
     files            [{ src, file }, ...] the scripts to run, in order, as
                      source('background').files returns them
     src, file        one script's text / path instead of SITE_ROOT's
     elements         { id: element } for getElementById beyond #cosmos
     querySelector, querySelectorAll   functions answering document's
     storage          'ok' (default, a Map), 'throw' (SecurityError on use)
                      or 'absent'; stored = { key: value } seeds it
     hidden           document.hidden at load
     objectViewBox    true: window.CSS.supports says yes to object-view-box,
                      as Chromium does, so the renderer shows a level's
                      corner of the canvas with it (render-webgl.js THE
                      LEVELS); default: no window.CSS, and a CSS transform
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(process.env.SITE_ROOT || path.join(__dirname, '..'));
const START = '  rafId = requestAnimationFrame(tick);';
/* the loop starter before the motion pause (W0 and older, _baseline) */
const LEGACY_START = '  if (REDUCED) { tick(performance.now()); } else { requestAnimationFrame(tick); }';

/* Names the default probe exposes when they exist. Getters, so reassigned
   values (W, H, lastNow, simNow ...) read live.

   This is also the scene's declared test surface: a key of the Bg namespace
   that no page script reads must be listed here, or check-deadcode.js
   reports it as dead. Names only an older root has (LEGACY_NAMES) stay, so
   a tool can still load it: the Canvas renderer's lifts and shape
   functions, deleted in W3, the pre-A1 cursor's CUR_SLEW, REDUCED, and MW,
   the ring's own follower until the ring was drawn on the pointer. */
const LEGACY_NAMES = [
  'resize', 'REDUCED', 'MW', 'LIFTS', 'frameDt', 'terrainLift', 'groundAtX', 'smoothLift', 'cursorTerrain', 'cursorTerrainX',
  'blunt', 'parX', 'TERRAIN_RIDE', 'LIFT_EASE', 'TREE_EASE', 'CUR_SLEW', 'SEGS', 'SEGS_R',
  'cloudAt', 'ridgeShape', 'peakShape', 'coniferAt', 'treeAt'
];
const PROBE_NAMES = [
  /* main.js; gov, its quality governor (also Bg.gov, for QA) */
  'tick', 'fit', 'paused', 'dpr', 'gov',
  /* scene.js, through Bg */
  'W', 'H', 'look', 'ptr', 'mk', 'CUR', 'RIP', 'lastNow', 'simNow',
  'bodiesW', 'bodyPull', 'bodyRoll', 'EVF', 'orbitWorld', 'prepEvent', 'swellEvent',
  'waveBase', 'wave', 'surfacePoint', 'hash1',
  'horizonY', 'centreX', 'restAt', 'worldX', 'tiltY', 'shiftX', 'standX', 'skyX', 'PAR_D0', 'S', 'SW',
  'HORIZON', 'PERSP_X', 'PERSP_Y', 'LOOK_X', 'LOOK_Y', 'WAVE_Y',
  'RIDGES', 'BANDS', 'TREES', 'CONIFERS', 'CLOUDS', 'SUN', 'COAT', 'ROWS', 'DMAX', 'XSPAN',
  'CUR_DEPTH', 'CUR_TERR_PUSH', 'CUR_TERR_SX', 'CUR_TERR_PAD',
  'CUR_TERR_SIDE', 'CUR_SIDE_PEAK', 'WELL_DEPTH', 'EVENT_MS', 'EVENT_IN', 'EVENT_SPAN', 'EVENT_SEED',
  'ORBIT_T0', 'ORBIT_RATE', 'BODY_FLOOR', 'FIELD_W', 'CALM_FLOOR', 'CUR_GATE', 'CUR_DFAR', 'HOP_DIST',
  'fieldDepth', 'fieldSpeed', 'dentAt', 'ROLL_VMAX', 'ROLL_AMAX', 'PULL_VMAX', 'PULL_AMAX',
  'setSize', 'setCard', 'setCover', 'CARD', 'pointerAt', 'pointerGone', 'advance', 'hold', 'resetClock', 'recover',
  'sunAt', 'treeLevels', 'bodiesAt',
  /* W2b: the terrain's copy of the field and its pushes, which the WebGL
     renderer's shader evaluates and the tools hold it to */
  'TPUSH', 'TERR_JOLT', 'terrainPushDip', 'terrainPushSide', 'ridgeSummits', 'peakPlace',
  /* the bloom (scene.js THE BLOOM): its strength at a point, a stroke's curl */
  'bloomAt', 'CALM_RIPPLE'
].concat(LEGACY_NAMES);

/* The WebGL renderer's test surface: methods of the renderer object that
   only the tools call, in a browser (check-wave-parity.js and
   check-webgl-floor.js read the shader's wave and the floor's depth back
   through them; probeScenery and probeIds the scenery's placement and what
   every pixel shows: check-wave-parity.js, check-webgl-terrain.js), and the
   keys of what they and sceneryMesh return that only the tools read (v,
   probeIds' 1/d per pixel; crests and their x0, the massifs' outlines,
   for check-scenery-mesh.js). check-deadcode.js counts a key listed here as
   read, as it does PROBE_NAMES for Bg. */
const RENDERER_PROBES = ['probeWave', 'probeDepth', 'probeScenery', 'probeIds', 'v', 'crests', 'x0'];

function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

/* The inline canvas script of a pre-split index.html (the _baseline copy):
   from "const REDUCED = window.matchMedia(" to the IIFE's closing "})();". */
function inlineCanvas(html) {
  const m = /<script>\r?\n(const REDUCED = window\.matchMedia\([\s\S]*?\}\)\(\);\r?\n)<\/script>/.exec(html);
  return m ? m[1] : null;
}
/* The inline dice + tab scripts of a pre-split index.html, in page order. */
function inlineSite(html) {
  const out = [];
  const re = /<script>\r?\n([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const s = m[1];
    if (s.startsWith('const REDUCED')) continue;
    if (s.includes("getElementById('dice')") || s.includes('/* tabs:')) out.push(s);
  }
  return out.length ? out.join('\n') : null;
}
/* The background scripts a root's index.html loads, as page-relative paths
   in page order: the split layout's assets/js/bg/*.js, or the pre-split
   assets/js/background.js. Null when it loads neither (an inline script). */
function bgScripts(root) {
  const html = path.join(path.resolve(root || ROOT), 'index.html');
  if (!exists(html)) return null;
  const text = fs.readFileSync(html, 'utf8');
  const out = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text))) {
    const src = m[1].replace(/^\.\//, '').replace(/\?v=[0-9a-f]+$/, '');   /* less its stamp (stamp.js) */
    if (/^assets\/js\/(?:bg\/[\w.-]+\.js|background\.js)$/.test(src)) out.push(src);
  }
  return out.length ? out : null;
}
/* Source of 'background' or 'site' under a root (default SITE_ROOT), as
   { src, file, files }: files is every script to run, in page order, each
   { src, file }; src is their text joined by newlines (for hashing and for
   static checks); file names them all. */
function source(which, root) {
  root = path.resolve(root || ROOT);
  const one = (src, file) => ({ src, file, files: [{ src, file }] });
  const rel = which === 'background' ? bgScripts(root) : null;
  if (rel) {
    const files = rel.map(r => {
      const file = path.join(root, ...r.split('/'));
      if (!exists(file)) throw new Error('harness: ' + path.join(root, 'index.html') + ' loads ' + r + ', which does not exist');
      return { src: fs.readFileSync(file, 'utf8'), file };
    });
    if (files.length === 1) return one(files[0].src, files[0].file);
    return { src: files.map(f => f.src).join('\n'), files,
             file: path.join(root, 'assets', 'js') + path.sep + '{' + rel.map(r => r.slice('assets/js/'.length)).join(', ') + '}' };
  }
  const file = path.join(root, 'assets', 'js', which + '.js');
  if (exists(file)) return one(fs.readFileSync(file, 'utf8'), file);
  const html = path.join(root, 'index.html');
  if (exists(html)) {
    const text = fs.readFileSync(html, 'utf8');
    const src = which === 'background' ? inlineCanvas(text) : inlineSite(text);
    if (src) return one(src, html + ' (inline ' + which + ')');
  }
  throw new Error('harness: no ' + which + ' script under ' + root);
}

/* Numbers the WebGL renderer keeps to itself (render-webgl.js declares them
   and exports nothing but its factory): the sheet's lines (ROW_POW, COLS,
   COL_SPAN, ROW_A ...), the floor mesh's (MESH_NEAR ...). Read from its
   source under the root (default SITE_ROOT), each from its one declaration
   `NAME = <number>`, so a tool cannot drift from the renderer the way
   seattest.js's own copy of the rows did (34 rows where the page draws 20:
   audit F54). Throws, naming it, if a name is not declared exactly once. */
function rendererNumbers(names, root) {
  const files = source('background', root).files.filter(f => /render-webgl\.js$/.test(f.file));
  if (files.length !== 1) throw new Error('harness: no render-webgl.js among the background scripts under ' + path.resolve(root || ROOT));
  const code = files[0].src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const n of names) {
    const hits = code.match(new RegExp('\\b' + n + '\\s*=\\s*(-?[\\d.]+(?:e-?\\d+)?)\\b', 'g')) || [];
    if (hits.length !== 1) throw new Error('harness: render-webgl.js declares ' + n + ' = <number> ' + hits.length + 'x (need exactly 1)');
    out[n] = +/=\s*(\S+)$/.exec(hits[0])[1];
  }
  return out;
}
/* The card (.shell) as site.css lays it out at a window W px wide: at most
   --shell (860px) wide, centred, inside the body's side padding (24px; 10px
   at 640px and under). Its left and right edges in CSS px. A copy of
   site.css's numbers, like check-sun.js's own: for tools that only need to
   know which columns of the canvas the card leaves open (the gutters). */
function cssCard(W) {
  const pad = W <= 640 ? 10 : 24, w = Math.min(860, W - 2 * pad), left = (W - w) / 2;
  return { left, right: left + w };
}

/* Patches over several scripts: each anchor must be found in exactly one of
   them (a string anchor exactly once in all), and lands there. Returns
   copies; the caller's list is untouched. */
function applyPatchesToFiles(files, patches) {
  files = files.map(f => ({ src: f.src, file: f.file }));
  for (const p of patches || []) {
    const from = p[0];
    if (from instanceof RegExp) {
      const hits = files.filter(f => { from.lastIndex = 0; return from.test(f.src); });
      if (hits.length !== 1) {
        throw new Error('harness: patch anchor ' + (hits.length ? 'matches in ' + hits.length + ' files ('
                        + hits.map(f => path.basename(f.file)).join(', ') + '; need exactly 1)' : 'not found') + ': ' + from);
      }
      hits[0].src = applyPatches(hits[0].src, [p]);
    } else {
      const n = files.reduce((s, f) => s + f.src.split(from).length - 1, 0);
      if (n !== 1) {
        throw new Error('harness: patch anchor found ' + n + 'x (need exactly 1): ' + JSON.stringify(from.slice(0, 90)));
      }
      const hit = files.find(f => f.src.includes(from));
      hit.src = applyPatches(hit.src, [p]);
    }
  }
  return files;
}
function applyPatches(src, patches) {
  for (const [from, to] of patches || []) {
    if (from instanceof RegExp) {
      from.lastIndex = 0;
      if (!from.test(src)) throw new Error('harness: patch anchor not found: ' + from);
      from.lastIndex = 0;
      src = src.replace(from, to);
    } else {
      const n = src.split(from).length - 1;
      if (n !== 1) {
        throw new Error('harness: patch anchor found ' + n + 'x (need exactly 1): '
                        + JSON.stringify(from.slice(0, 90)));
      }
      src = src.replace(from, () => to);
    }
  }
  return src;
}

/* Each getter returns the name as the probe's own scope sees it (main.js's
   locals, or everything in a pre-split IIFE), else the scene's Bg.<name>,
   else undefined. */
function defaultProbe(extra) {
  const names = PROBE_NAMES.concat(extra || []);
  return '{ ' + names.map(n => 'get ' + n + '() { return typeof ' + n + " !== 'undefined' ? " + n
                         + " : typeof Bg !== 'undefined' && Bg ? Bg." + n + ' : undefined; }')
    .join(', ') + ' }';
}

/* ---- colour parsing: enough CSS Color 4 for what a canvas page emits ---- */
const NUM = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?%?';
const FUNC = new RegExp('^(rgba?|hsla?)\\(\\s*(' + NUM + ')(?:\\s*,\\s*|\\s+)(' + NUM + ')(?:\\s*,\\s*|\\s+)('
                        + NUM + ')(?:\\s*(?:,|\\/)\\s*(' + NUM + '))?\\s*\\)$', 'i');
function validColour(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^[a-z]+$/i.test(s)) return true;            /* named colours, transparent, currentcolor */
  return FUNC.test(s);
}

/* ---- the canvas 2D context ------------------------------------------------ */
const STATE_PROPS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
  globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
  direction: 'inherit', shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0,
  shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'low', filter: 'none'
};
/* how many leading arguments of each call are doubles (finite-checked) */
const NUMERIC = {
  moveTo: 2, lineTo: 2, arc: 5, arcTo: 5, ellipse: 7, rect: 4, roundRect: 4,
  quadraticCurveTo: 4, bezierCurveTo: 6, fillRect: 4, strokeRect: 4, clearRect: 4,
  translate: 2, scale: 2, rotate: 1, setTransform: 6, transform: 6,
  createLinearGradient: 4, createRadialGradient: 6, createConicGradient: 3
};
const CALLS = ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect',
  'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect',
  'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'save',
  'restore', 'reset', 'setTransform', 'resetTransform', 'transform', 'translate', 'scale',
  'rotate', 'setLineDash', 'drawFocusIfNeeded'];

function domError(name, msg) { const e = new Error(msg); e.name = name; return e; }

function makeContext(S) {
  let st = Object.assign({}, STATE_PROPS);
  const stack = [];
  let gradId = 0;
  function emit(op, args, set, target) {
    S.recordFn({ op, args, set, target, fill: st.fillStyle, stroke: st.strokeStyle, lw: st.lineWidth });
  }
  function problem(kind, op, args) {
    S.problems.push({ kind, op, args: args.map(a => String(a)), frame: S.frame });
  }
  const ctx = {};
  Object.defineProperty(ctx, 'canvas', { get: () => S.canvas, enumerable: true });
  for (const prop of Object.keys(STATE_PROPS)) {
    const isColour = prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'shadowColor';
    const isNumber = typeof STATE_PROPS[prop] === 'number';
    Object.defineProperty(ctx, prop, {
      enumerable: true,
      get: () => st[prop],
      set: v => {
        if (S.recordFn) emit(prop, [v], true);
        if (!S.strict) { st[prop] = v; return; }
        if (isColour) {
          if (v && typeof v === 'object' && v.__gradient) { if (prop !== 'shadowColor') st[prop] = v; return; }
          if (validColour(String(v))) st[prop] = String(v);
          else problem('bad-colour', prop, [v]);
        } else if (isNumber) {
          const n = +v;
          if (!Number.isFinite(n) || ((prop === 'lineWidth' || prop === 'miterLimit') && n <= 0)
              || (prop === 'globalAlpha' && (n < 0 || n > 1))) problem('ignored-number', prop, [v]);
          else st[prop] = n;
        } else st[prop] = v;
      }
    });
  }
  /* Rest parameters, not `arguments`: Array.from(arguments) on ~15,000 ops
     a frame cost 8.6ms/frame of recording on its own. */
  for (const name of CALLS) {
    const nnum = NUMERIC[name] || 0;
    ctx[name] = function (...a) {
      if (S.recordFn) emit(name, a, false);
      for (let i = 0; i < nnum && i < a.length; i++) {
        if (!Number.isFinite(+a[i])) { problem('non-finite', name, a); return; }
      }
      if (nnum === 0 && name !== 'save' && name !== 'restore' && name !== 'reset' && name !== 'resetTransform') return;
      if (S.strict && name === 'arc' && a[2] < 0) {
        problem('negative-radius', name, a);
        throw domError('IndexSizeError', "Failed to execute 'arc' on 'CanvasRenderingContext2D': The radius provided ("
                       + a[2] + ') is negative.');
      }
      if (name === 'save') stack.push({ st: Object.assign({}, st), m: S.m.slice() });
      else if (name === 'restore') { if (stack.length) { const s = stack.pop(); st = s.st; S.m = s.m; } }
      else if (name === 'reset') { st = Object.assign({}, STATE_PROPS); stack.length = 0; S.m = [1, 0, 0, 1, 0, 0]; }
      else if (name === 'setTransform') { if (a.length >= 6) S.m = a.slice(0, 6).map(Number); }
      else if (name === 'resetTransform') S.m = [1, 0, 0, 1, 0, 0];
      else if (name === 'translate') {
        const [m0, m1, m2, m3, m4, m5] = S.m, x = +a[0], y = +a[1];
        S.m = [m0, m1, m2, m3, m4 + m0 * x + m2 * y, m5 + m1 * x + m3 * y];
      } else if (name === 'scale') {
        const [m0, m1, m2, m3, m4, m5] = S.m, x = +a[0], y = +a[1];
        S.m = [m0 * x, m1 * x, m2 * y, m3 * y, m4, m5];
      }
    };
  }
  function gradient(kind, args) {
    const g = { __gradient: true, kind, id: ++gradId, args: args.slice(), stops: [] };
    g.addColorStop = function (off, col) {
      if (S.recordFn) emit('addColorStop', [off, col], false, '#g' + g.id);
      if (!Number.isFinite(+off)) {
        problem('non-finite', 'addColorStop', [off, col]);
        throw new TypeError("Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite.");
      }
      if (S.strict && (off < 0 || off > 1)) {
        problem('range', 'addColorStop', [off, col]);
        throw domError('IndexSizeError', "Failed to execute 'addColorStop' on 'CanvasGradient': The provided value ("
                       + off + ') is outside the range (0.0, 1.0).');
      }
      if (S.strict && !validColour(String(col))) {
        problem('bad-colour', 'addColorStop', [off, col]);
        throw domError('SyntaxError', "Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('"
                       + col + "') could not be parsed as a color.");
      }
      g.stops.push([+off, String(col)]);
    };
    return g;
  }
  for (const [name, kind] of [['createLinearGradient', 'linear'], ['createRadialGradient', 'radial'],
                              ['createConicGradient', 'conic']]) {
    const nnum = NUMERIC[name];
    ctx[name] = function (...a) {
      if (S.recordFn) emit(name, a, false);
      for (let i = 0; i < nnum; i++) {
        if (!Number.isFinite(+a[i])) {
          problem('non-finite', name, a);
          throw new TypeError("Failed to execute '" + name + "' on 'CanvasRenderingContext2D': The provided double value is non-finite.");
        }
      }
      if (S.strict && name === 'createRadialGradient' && (a[2] < 0 || a[5] < 0)) {
        problem('negative-radius', name, a);
        throw domError('IndexSizeError', "Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The "
                       + (a[2] < 0 ? 'r0' : 'r1') + ' provided is less than 0.');
      }
      return gradient(kind, a);
    };
  }
  ctx.createPattern = function (...a) {
    if (S.recordFn) emit('createPattern', a, false);
    return { __gradient: true, kind: 'pattern', id: ++gradId, setTransform() {} };
  };
  ctx.measureText = function (t) { return { width: String(t).length * 6 }; };
  ctx.getTransform = function () { const [a, b, c, d, e, f] = S.m; return { a, b, c, d, e, f }; };
  ctx.getLineDash = function () { return []; };
  ctx.isPointInPath = ctx.isPointInStroke = function () { return false; };
  ctx.isContextLost = function () { return false; };
  ctx.getContextAttributes = function () { return { alpha: true, desynchronized: false }; };
  ctx.createImageData = function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, (w * h * 4) | 0)) }; };
  ctx.getImageData = function (x, y, w, h) { return ctx.createImageData(w, h); };
  /* assigning canvas.width/height resets the context, as in a browser */
  S.resetContext = () => { st = Object.assign({}, STATE_PROPS); stack.length = 0; S.m = [1, 0, 0, 1, 0, 0]; };
  S.state = () => st;
  return ctx;
}

/* ---- the WebGL context ---------------------------------------------------
   Enough of WebGL 1 / 2 for the background's renderer (render-webgl.js) to
   run its real JS in node: programs compile and link (the GLSL itself is
   only kept, never run - the browser checks run it), buffers take their
   data, and every call is a no-op that the recorder sees. So the node checks
   measure what the renderer HANDS the GPU each frame - its draw calls, the
   uniform values (the swell's phase, the dents, the wells, the bodies, the
   view) and the buffers' contents - and its JS cost, bit for bit, without a
   GPU. What the GPU then makes of them is the browser checks' business
   (check-webgl-*.js, check-wave-parity.js).

   Recorded ops are { op, args, target: 'gl' }: a typed-array argument is
   copied as it stood at the call (the renderer reuses its scratch arrays),
   and summarised by length and SHA-1 when longer than 64 values (a buffer's
   data). GL objects are { __gl: kind, id } handles (fmtVal: '#program3').
   Strict mode logs a non-finite number in any argument as a problem: a NaN
   uniform puts the whole sheet off screen with no error anywhere.

   The context can be lost and restored (sim.loseContext / restoreContext,
   or the WEBGL_lose_context extension), with the events on the canvas: a
   restore needs the loss to have been preventDefault()ed, as in Chrome.

   It keeps the state a draw depends on - the capabilities enabled, the
   depth and colour masks, the depth and blend functions, the viewport, the
   framebuffer bound - and sim.setDraw's callback gets it with each draw,
   as one string (state), so a check can tell a frame drawn with its state
   half-set from a whole one. */
const GL_ENUMS = {
  POINTS: 0, LINES: 1, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6,
  DEPTH_BUFFER_BIT: 256, STENCIL_BUFFER_BIT: 1024, COLOR_BUFFER_BIT: 16384,
  NEVER: 512, LESS: 513, EQUAL: 514, LEQUAL: 515, GREATER: 516, NOTEQUAL: 517, GEQUAL: 518, ALWAYS: 519,
  ZERO: 0, ONE: 1, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771,
  CULL_FACE: 2884, DEPTH_TEST: 2929, STENCIL_TEST: 2960, BLEND: 3042, SCISSOR_TEST: 3089,
  NO_ERROR: 0, INVALID_ENUM: 1280, INVALID_VALUE: 1281, INVALID_OPERATION: 1282, OUT_OF_MEMORY: 1285,
  CONTEXT_LOST_WEBGL: 37442,
  BYTE: 5120, UNSIGNED_BYTE: 5121, SHORT: 5122, UNSIGNED_SHORT: 5123, INT: 5124, UNSIGNED_INT: 5125, FLOAT: 5126,
  RGBA: 6408, DEPTH_COMPONENT: 6402, DEPTH_STENCIL: 34041,
  ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048, STREAM_DRAW: 35040,
  FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
  TEXTURE_2D: 3553, TEXTURE_MAG_FILTER: 10240, TEXTURE_MIN_FILTER: 10241, NEAREST: 9728, LINEAR: 9729,
  FRAMEBUFFER: 36160, RENDERBUFFER: 36161, COLOR_ATTACHMENT0: 36064, DEPTH_ATTACHMENT: 36096,
  DEPTH_STENCIL_ATTACHMENT: 33306, FRAMEBUFFER_COMPLETE: 36053, DEPTH_COMPONENT16: 33189,
  MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, VIEWPORT: 2978
};
/* the GL calls that answer nothing; the create* calls answer a handle */
const GL_CALLS = ['activeTexture', 'attachShader', 'bindAttribLocation', 'bindBuffer', 'bindFramebuffer', 'bindRenderbuffer',
  'bindTexture', 'bindVertexArray', 'blendFunc', 'blendFuncSeparate', 'bufferData', 'bufferSubData', 'clear', 'clearColor',
  'clearDepth', 'clearStencil', 'colorMask', 'compileShader', 'cullFace', 'deleteBuffer', 'deleteFramebuffer',
  'deleteProgram', 'deleteRenderbuffer', 'deleteShader', 'deleteTexture', 'deleteVertexArray', 'depthFunc', 'depthMask',
  'depthRange', 'detachShader', 'disable', 'disableVertexAttribArray', 'drawArrays', 'drawElements', 'enable',
  'enableVertexAttribArray', 'finish', 'flush', 'framebufferRenderbuffer', 'framebufferTexture2D', 'frontFace', 'hint',
  'lineWidth', 'linkProgram', 'pixelStorei', 'polygonOffset', 'readPixels', 'renderbufferStorage', 'scissor',
  'shaderSource', 'stencilFunc', 'stencilMask', 'stencilOp', 'texImage2D', 'texParameteri', 'uniform1f', 'uniform1fv',
  'uniform1i', 'uniform2f', 'uniform2fv', 'uniform3f', 'uniform3fv', 'uniform4f', 'uniform4fv', 'uniformMatrix4fv',
  'useProgram', 'validateProgram', 'vertexAttribPointer', 'vertexAttrib1f', 'vertexAttrib4f', 'viewport'];
const GL_CREATE = { createBuffer: 'buffer', createFramebuffer: 'framebuffer', createProgram: 'program',
                    createRenderbuffer: 'renderbuffer', createShader: 'shader', createTexture: 'texture',
                    createVertexArray: 'vertexarray' };
function glArg(a) {
  if (!ArrayBuffer.isView(a)) return a;
  if (a.length <= 64) return Array.from(a);
  const bytes = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  return { __data: a.constructor.name, length: a.length, sha1: require('crypto').createHash('sha1').update(bytes).digest('hex') };
}
function glBad(a) {
  if (typeof a === 'number') return !Number.isFinite(a);
  if (ArrayBuffer.isView(a) && !(a instanceof Uint8Array)) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return true; }
  return false;
}
function makeGL(S, canvas, kind) {
  const gl = Object.assign({ canvas }, GL_ENUMS);
  const G = { kind, lost: false, ids: 0, programs: [], buffers: new Map(), bound: null, current: null, draws: 0, calls: 0,
              caps: new Set(), depthMask: true, colorMask: [true, true, true, true], depthFunc: GL_ENUMS.LESS,
              blend: [GL_ENUMS.ONE, GL_ENUMS.ZERO], viewport: [0, 0, 0, 0], framebuffer: null };
  const stateOf = () => 'caps ' + [...G.caps].sort((a, b) => a - b).join(',') + ' depthMask ' + G.depthMask + ' colorMask ' + G.colorMask.join(',')
                      + ' depthFunc ' + G.depthFunc + ' blend ' + G.blend.join(',') + ' viewport ' + G.viewport.join(',')
                      + ' framebuffer ' + (G.framebuffer ? G.framebuffer.id : 'none');
  const handle = (what, extra) => Object.assign({ __gl: what, id: ++G.ids }, extra);
  function call(op, args) {
    G.calls++;
    if (S.recordFn) S.recordFn({ op, args: args.map(glArg), target: 'gl' });
    if (S.strict) {
      for (const a of args) {
        if (glBad(a)) { S.problems.push({ kind: 'non-finite', op: 'gl.' + op, args: args.map(x => JSON.stringify(glArg(x))), frame: S.frame }); break; }
      }
    }
  }
  for (const name of GL_CALLS) {
    gl[name] = function (...a) {
      if (G.lost) return;
      call(name, a);
      if (name === 'shaderSource') a[0].src = String(a[1]);
      else if (name === 'attachShader') a[0].shaders.push(a[1]);
      else if (name === 'linkProgram') {
        const of = t => (a[0].shaders.find(s => s.type === t) || { src: '' }).src;
        a[0].vs = of(GL_ENUMS.VERTEX_SHADER); a[0].fs = of(GL_ENUMS.FRAGMENT_SHADER);
      } else if (name === 'useProgram') G.current = a[0] || null;
      else if (name === 'bindBuffer') G.bound = a[1] || null;
      else if (name === 'enable') G.caps.add(a[0]);
      else if (name === 'disable') G.caps.delete(a[0]);
      else if (name === 'depthMask') G.depthMask = !!a[0];
      else if (name === 'colorMask') G.colorMask = a.slice(0, 4).map(Boolean);
      else if (name === 'depthFunc') G.depthFunc = a[0];
      else if (name === 'blendFunc') G.blend = [a[0], a[1]];
      else if (name === 'viewport') G.viewport = a.slice(0, 4);
      else if (name === 'bindFramebuffer') G.framebuffer = a[1] || null;
      else if (name === 'bufferData' && G.bound) G.buffers.set(G.bound.id, ArrayBuffer.isView(a[1]) ? a[1].byteLength : 0);
      else if (name === 'deleteBuffer' && a[0]) G.buffers.delete(a[0].id);
      else if (name === 'drawArrays' || name === 'drawElements') {
        G.draws++;
        if (S.drawFn) S.drawFn({ program: G.current, mode: a[0], count: name === 'drawArrays' ? a[2] : a[1], state: stateOf() });
      } else if (name === 'readPixels' && a[6] && a[6].fill) a[6].fill(0);
    };
  }
  for (const [name, what] of Object.entries(GL_CREATE)) {
    gl[name] = function (...a) {
      if (G.lost) return null;
      call(name, a);
      const h = handle(what, what === 'shader' ? { type: a[0], src: '' } : what === 'program' ? { shaders: [], vs: '', fs: '' } : null);
      if (what === 'program') G.programs.push(h);
      return h;
    };
  }
  gl.getUniformLocation = (p, name) => {
    if (G.lost || !p) return null;
    call('getUniformLocation', [p, name]);
    return { __gl: 'uniform', id: p.id, name };
  };
  gl.getAttribLocation = () => (G.lost ? -1 : 0);
  gl.getShaderParameter = () => !G.lost;
  gl.getProgramParameter = () => !G.lost;
  gl.getShaderInfoLog = () => 'ok';
  gl.getProgramInfoLog = () => 'ok';
  gl.getError = () => (G.lost ? GL_ENUMS.CONTEXT_LOST_WEBGL : GL_ENUMS.NO_ERROR);
  gl.isContextLost = () => G.lost;
  gl.checkFramebufferStatus = () => (G.lost ? 0 : GL_ENUMS.FRAMEBUFFER_COMPLETE);
  gl.getParameter = p => (p === GL_ENUMS.MAX_TEXTURE_SIZE ? 16384 : p === GL_ENUMS.MAX_VIEWPORT_DIMS ? new Int32Array([16384, 16384]) : null);
  gl.getContextAttributes = () => (G.lost ? null : Object.assign({}, G.attrs));
  gl.getSupportedExtensions = () => (G.lost ? null : (kind === 'webgl' ? ['OES_standard_derivatives'] : []).concat(['WEBGL_lose_context']));
  const loseExt = { loseContext: () => S.loseContext(), restoreContext: () => S.restoreContext() };
  gl.getExtension = name => (G.lost ? null : name === 'WEBGL_lose_context' ? loseExt
                             : name === 'OES_standard_derivatives' && kind === 'webgl' ? {} : null);
  Object.defineProperty(gl, 'drawingBufferWidth', { get: () => canvas.width });
  Object.defineProperty(gl, 'drawingBufferHeight', { get: () => canvas.height });
  return { gl, G };
}

/* ---- DOM stubs -------------------------------------------------------- */
function listenerHost(obj) {
  const map = new Map();
  obj.dispatchEvent = function (ev) {
    if (!ev.target) ev.target = obj;
    invoke(obj, ev);
    return !ev.defaultPrevented;
  };
  obj.addEventListener = function (type, fn, opt) {
    if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
    const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
    const list = map.get(type) || [];
    if (list.some(l => l.fn === fn && l.capture === capture)) return;
    list.push({ fn, capture, once: !!(opt && typeof opt === 'object' && opt.once) });
    map.set(type, list);
  };
  obj.removeEventListener = function (type, fn, opt) {
    const capture = typeof opt === 'boolean' ? opt : !!(opt && opt.capture);
    const list = map.get(type);
    if (!list) return;
    const i = list.findIndex(l => l.fn === fn && l.capture === capture);
    if (i >= 0) list.splice(i, 1);
  };
  obj.__listeners = map;
  return obj;
}
function invoke(host, ev) {
  const list = host.__listeners && host.__listeners.get(ev.type);
  if (!list || !list.length) return;
  ev.currentTarget = host;
  for (const l of list.slice()) {
    if (ev.__stopImmediate) break;
    if (l.once) host.removeEventListener(ev.type, l.fn, l.capture);
    if (typeof l.fn === 'function') l.fn.call(host, ev); else l.fn.handleEvent(ev);
  }
}
function makeEvent(type, props, target) {
  return Object.assign({
    type, target, bubbles: true, cancelable: true, defaultPrevented: false, isTrusted: true,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.__stop = true; },
    stopImmediatePropagation() { this.__stop = true; this.__stopImmediate = true; }
  }, props || {});
}
function classList() {
  const set = new Set();
  return {
    add(...c) { c.forEach(x => set.add(x)); },
    remove(...c) { c.forEach(x => set.delete(x)); },
    contains(c) { return set.has(c); },
    toggle(c, force) { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
    get length() { return set.size; },
    item(i) { return [...set][i] || null; },
    toString() { return [...set].join(' '); },
    values() { return set.values(); },
    [Symbol.iterator]() { return set.values(); }
  };
}
function makeElement(tag, id) {
  const attrs = new Map();
  const el = listenerHost({
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), id: id || '',
    dataset: {}, style: {}, classList: classList(), hidden: false, textContent: '', innerHTML: '',
    children: [], childNodes: [], parentNode: null, tabIndex: -1,
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    removeAttribute(k) { attrs.delete(k); },
    hasAttribute(k) { return attrs.has(k); },
    toggleAttribute(k, force) { const on = force === undefined ? !attrs.has(k) : !!force; if (on) attrs.set(k, ''); else attrs.delete(k); return on; },
    appendChild(c) { this.children.push(c); this.childNodes.push(c); c.parentNode = this; return c; },
    append(...c) { c.forEach(x => this.appendChild(x)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains(o) { return o === this; },
    focus() { if (el.__doc) el.__doc.activeElement = this; },
    blur() {},
    click() { invoke(this, makeEvent('click', {}, this)); },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  });
  el.__attrs = attrs;
  return el;
}

/* ---- load the background scripts ------------------------------------ */
function load(opts) {
  opts = Object.assign({ W: 1440, H: 900, dpr: 1, reduced: false, record: false, strict: true,
                         starter: 'replace', start: null, now: 0, storage: 'ok', hidden: false }, opts || {});
  let files;
  if (opts.files) files = opts.files;
  else if (opts.src !== undefined) files = [{ src: opts.src, file: opts.file || 'background script (src)' }];
  else if (opts.file) files = [{ src: fs.readFileSync(opts.file, 'utf8'), file: opts.file }];
  else files = source('background').files;
  files = applyPatchesToFiles(files, opts.patches);
  const file = files.map(f => f.file).join(' + ');
  const probe = (opts.prelude ? opts.prelude + '\n' : '')
              + 'globalThis.__probe = ' + (opts.probe || defaultProbe(opts.expose)) + ';';
  const count = s => files.reduce((n, f) => n + f.src.split(s).length - 1, 0);
  const start = opts.start || (count(START) === 0 && count(LEGACY_START) === 1 ? LEGACY_START : START);
  if (count(start) !== 1) {
    throw new Error('harness: loop starter not found exactly once in ' + file
                    + ' - update START in _tools/harness.js (or pass opts.start)');
  }
  const host = files.find(f => f.src.includes(start));
  host.src = opts.starter === 'keep'
    ? host.src.replace(start, () => probe + '\n' + start)
    : host.src.replace(start, () => probe);

  const S = { NOW: opts.now, frame: 0, problems: [], recordFn: null, m: [1, 0, 0, 1, 0, 0],
              strict: opts.strict, W: opts.W, H: opts.H, dpr: opts.dpr, reduced: !!opts.reduced,
              box: opts.box ? opts.box.slice() : null };
  /* the canvas's own box: the viewport unless set apart (a scrollbar) */
  const boxW = () => (S.box ? S.box[0] : S.W), boxH = () => (S.box ? S.box[1] : S.H);
  const sim = { ops: null, problems: S.problems, uncaught: [], file, files: files.map(f => f.file) };
  if (opts.record === true) { sim.ops = []; S.recordFn = r => sim.ops.push(r); }
  else if (typeof opts.record === 'function') S.recordFn = opts.record;

  const ctx = makeContext(S);
  let cw = 300, chh = 150;
  const canvas = makeElement('canvas', 'cosmos');
  Object.defineProperty(canvas, 'width', { get: () => cw, set: v => {
    if (S.recordFn) S.recordFn({ op: 'width', args: [v], set: true, target: 'canvas' });
    cw = (Math.max(0, Math.floor(+v) || 0)) >>> 0; S.resetContext();
  } });
  Object.defineProperty(canvas, 'height', { get: () => chh, set: v => {
    if (S.recordFn) S.recordFn({ op: 'height', args: [v], set: true, target: 'canvas' });
    chh = (Math.max(0, Math.floor(+v) || 0)) >>> 0; S.resetContext();
  } });
  Object.defineProperty(canvas, 'clientWidth', { get: () => Math.round(boxW()) });
  Object.defineProperty(canvas, 'clientHeight', { get: () => Math.round(boxH()) });
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: boxW(), bottom: boxH(), width: boxW(), height: boxH() });
  /* An element keeps the first kind of context it hands out, as in a
     browser. opts.webgl says what WebGL there is: 'webgl2' (default: both),
     'webgl' (WebGL 1 only) or false (none). */
  let ctxKind = null, glPair = null;
  const webgl = opts.webgl === undefined ? 'webgl2' : opts.webgl;
  canvas.getContext = (type, attrs) => {
    const kind = type === 'experimental-webgl' ? 'webgl' : type;
    if (ctxKind) return kind === ctxKind ? (ctxKind === '2d' ? ctx : glPair.gl) : null;
    if (kind === '2d') { ctxKind = '2d'; return ctx; }
    if ((kind === 'webgl2' && webgl === 'webgl2') || (kind === 'webgl' && webgl)) {
      ctxKind = kind;
      glPair = makeGL(S, canvas, kind);
      glPair.G.attrs = Object.assign({}, attrs);
      return glPair.gl;
    }
    return null;
  };
  /* the GL context's loss and return, with its events on the canvas */
  S.loseContext = () => {
    if (!glPair || glPair.G.lost) return;
    glPair.G.lost = true;
    const ev = sim.fire('webglcontextlost', { statusMessage: '' }, canvas);
    glPair.G.restorable = ev.defaultPrevented;
  };
  S.restoreContext = () => {
    if (!glPair || !glPair.G.lost || !glPair.G.restorable) return false;
    glPair.G.lost = false;
    sim.fire('webglcontextrestored', {}, canvas);
    return true;
  };
  S.canvas = canvas;

  const html = makeElement('html');
  Object.defineProperty(html, 'clientWidth', { get: () => Math.round(boxW()) });
  Object.defineProperty(html, 'clientHeight', { get: () => Math.round(boxH()) });
  if (opts.motion !== undefined) html.dataset.motion = opts.motion;
  const body = makeElement('body');
  const elements = Object.assign({ cosmos: canvas }, opts.elements || {});
  const doc = listenerHost({
    documentElement: html, body, readyState: 'loading', activeElement: body,
    hidden: !!opts.hidden, visibilityState: opts.hidden ? 'hidden' : 'visible',
    getElementById: id => (Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null),
    querySelector: sel => (opts.querySelector ? opts.querySelector(sel) : null),
    querySelectorAll: sel => (opts.querySelectorAll ? opts.querySelectorAll(sel) : []),
    createElement: tag => makeElement(tag),
    hasFocus: () => true
  });
  for (const el of Object.values(elements)) el.__doc = doc;

  /* matchMedia: every list is kept so a change can be dispatched to it */
  const mqls = [];
  function evalMedia(q) {
    q = String(q).toLowerCase();
    if (q.includes('prefers-reduced-motion')) return q.includes('reduce') ? S.reduced : !S.reduced;
    let m = /(?:^|[^-])resolution:\s*([\d.]+)dppx/.exec(q);
    if (m) return Math.abs(+m[1] - S.dpr) < 1e-9;
    m = /min-resolution:\s*([\d.]+)dppx/.exec(q);
    if (m) return S.dpr >= +m[1];
    m = /max-resolution:\s*([\d.]+)dppx/.exec(q);
    if (m) return S.dpr <= +m[1];
    m = /max-width:\s*([\d.]+)px/.exec(q);
    if (m) return S.W <= +m[1];
    m = /min-width:\s*([\d.]+)px/.exec(q);
    if (m) return S.W >= +m[1];
    return false;
  }
  function matchMedia(q) {
    const mql = listenerHost({ media: String(q), onchange: null });
    mql.matches = evalMedia(q);
    mql.addListener = fn => mql.addEventListener('change', fn);
    mql.removeListener = fn => mql.removeEventListener('change', fn);
    mqls.push(mql);
    return mql;
  }
  function refreshMedia() {
    for (const mql of mqls) {
      const now = evalMedia(mql.media);
      if (now === mql.matches) continue;
      mql.matches = now;
      const ev = makeEvent('change', { matches: now, media: mql.media }, mql);
      invoke(mql, ev);
      if (typeof mql.onchange === 'function') mql.onchange(ev);
    }
  }

  /* rAF queue with ids and cancel; every request is counted */
  let rafId = 0;
  const raf = new Map();
  sim.rafRequests = 0;
  const timers = new Map();
  let timerId = 0;

  /* ResizeObserver: each observed element's last reported box; frame()
     reports the ones that changed, after its rAF callbacks */
  const observers = [];
  class ResizeObserver {
    constructor(cb) { this.cb = cb; this.last = new Map(); observers.push(this); }
    observe(el) { if (!this.last.has(el)) this.last.set(el, [0, 0]); }
    unobserve(el) { this.last.delete(el); }
    disconnect() { this.last.clear(); }
  }
  sim.resizeNotes = 0;
  function deliverResizes() {
    for (const ro of observers) {
      const entries = [];
      for (const [el, last] of ro.last) {
        const r = el.getBoundingClientRect();
        if (r.width === last[0] && r.height === last[1]) continue;
        ro.last.set(el, [r.width, r.height]);
        const size = [{ inlineSize: r.width, blockSize: r.height }];
        entries.push({ target: el, contentRect: { x: 0, y: 0, left: 0, top: 0, right: r.width, bottom: r.height, width: r.width, height: r.height },
                       contentBoxSize: size, borderBoxSize: size });
      }
      if (entries.length) { sim.resizeNotes++; ro.cb(entries, ro); }
    }
  }
  class Event {
    constructor(type, init) {
      Object.assign(this, makeEvent(type, { bubbles: !!(init && init.bubbles), cancelable: !!(init && init.cancelable), isTrusted: false }, null));
    }
  }
  class CustomEvent extends Event {
    constructor(type, init) { super(type, init); this.detail = init && init.detail !== undefined ? init.detail : null; }
  }

  const win = listenerHost({
    innerWidth: opts.W, innerHeight: opts.H, devicePixelRatio: opts.dpr,
    outerWidth: opts.W, outerHeight: opts.H, screen: { width: opts.W, height: opts.H },
    document: doc, console, matchMedia, ResizeObserver, Event, CustomEvent,
    performance: { now: () => S.NOW, timeOrigin: 0 },
    requestAnimationFrame: cb => { sim.rafRequests++; const id = ++rafId; raf.set(id, cb); return id; },
    cancelAnimationFrame: id => { raf.delete(id); },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: S.NOW + (+ms || 0) }); return id; },
    clearTimeout: id => { timers.delete(id); },
    setInterval: () => ++timerId,
    clearInterval: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { hash: '', href: 'http://127.0.0.1:8787/index.html' + (opts.search || ''), pathname: '/index.html', search: opts.search || '' },
    history: { replaceState() {}, pushState() {} },
    navigator: { userAgent: 'harness', maxTouchPoints: 0 }
  });
  if (opts.objectViewBox) win.CSS = { supports: (p, v) => /^object-view-box$/.test(String(p)) && v !== undefined };
  if (opts.storage === 'ok') {
    const m = new Map(Object.entries(opts.stored || {}));
    win.localStorage = win.sessionStorage = {
      getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); },
      removeItem: k => { m.delete(String(k)); },
      clear: () => m.clear(),
      key: i => [...m.keys()][i] || null,
      get length() { return m.size; },
      __map: m
    };
  } else if (opts.storage === 'throw') {
    for (const k of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(win, k, { get() { throw domError('SecurityError', 'The operation is insecure.'); } });
    }
  }
  win.window = win; win.self = win;
  const context = vm.createContext(win);

  /* Each script is compiled inside a function that takes Math and Number as
     parameters: the tools call the scene's functions tens of thousands of
     times a frame (and the Canvas renderer, gone since W3, did on the page),
     and every bare global lookup through a vm context's interceptor costs
     several local ones (Number alone made that renderer's lift smoothing
     2.6x slower here than it is in a browser, where both are plain
     builtins). Any other global the scene names in a hot path costs the
     same (scene.js keeps Infinity in a constant for that). Same realm, same builtins, same global
     object, the scripts one after another as the page runs them; each
     source is untouched and keeps its own file name and line numbers in
     stack traces. The one difference from a browser: a top-level
     declaration stays inside its own file's function here, where a browser
     would share it with every later script. The background scripts declare
     nothing at top level and share only window.Bg (check-bg-layout.js), so
     the two agree. */
  const ctxMath = vm.runInContext('Math', context), ctxNumber = vm.runInContext('Number', context);
  for (const f of files) {
    let fn;
    try { fn = vm.runInContext('(function (Math, Number) {' + f.src + '\n})', context, { filename: f.file }); }
    catch (e) { e.message = 'harness: ' + f.file + ' does not compile: ' + e.message; throw e; }
    fn.call(win, ctxMath, ctxNumber);
  }
  /* main.js returns before its loop starter when there is nothing to draw
     with (no WebGL: the still picture), so the probe never ran: give the
     tools one at the top level instead, which reads Bg (main.js's own
     names are then undefined), and say so in sim.early */
  let early = false;
  if (!win.__probe && opts.starter !== 'keep') {
    early = true;
    vm.runInContext(probe, context);
  }
  const P = win.__probe;
  if (!P) throw new Error('harness: probe was not installed (did the script return early?)');

  function hosts(target) {
    if (target === 'window' || target === win) return [win];
    if (target === 'document' || target === doc) return [doc, win];
    if (target === 'html' || target === html) return [html, doc, win];
    if (target && target.__listeners) return [target, html, doc, win];
    return [html, doc, win];
  }
  const WINDOW_ONLY = new Set(['resize', 'blur', 'focus', 'load', 'pageshow', 'pagehide', 'beforeunload',
                               'orientationchange', 'hashchange', 'popstate']);
  /* defineProperties, not Object.assign: assign would copy each getter's
     value once instead of the getter, freezing sim.now at its load value */
  Object.defineProperties(sim, {
    state: { get: () => S.state(), enumerable: true },
    now: { get: () => S.NOW, enumerable: true },
    frameIndex: { get: () => S.frame, enumerable: true },
    transform: { get: () => S.m.slice(), enumerable: true }
  });
  Object.assign(sim, {
    P, ctx, canvas, window: win, document: doc, html, body, context, mqls, early,
    setNow(v) { S.NOW = v; },
    /* dispatch along a bubbling path; the target defaults by event type */
    fire(type, props, target) {
      const p = target !== undefined ? hosts(target)
        : WINDOW_ONLY.has(type) ? [win] : type === 'visibilitychange' ? [doc, win] : [html, doc, win];
      const ev = makeEvent(type, Object.assign({ timeStamp: S.NOW }, props), p[0]);
      for (const host of p) { invoke(host, ev); if (ev.__stop) break; }
      return ev;
    },
    move(x, y, extra) {
      return sim.fire('pointermove', Object.assign({
        clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
        pointerType: 'mouse', pointerId: 1, isPrimary: true, buttons: 0, relatedTarget: null,
        getCoalescedEvents() { return [this]; }
      }, extra));
    },
    /* the pointer leaves the window: pointerout with no relatedTarget */
    leave(extra) {
      sim.fire('pointerout', Object.assign({ pointerType: 'mouse', pointerId: 1, isPrimary: true, relatedTarget: null }, extra));
      sim.fire('pointerleave', Object.assign({ pointerType: 'mouse', pointerId: 1, isPrimary: true, relatedTarget: null,
                                               bubbles: false }, extra), html);
    },
    blur() { sim.fire('blur'); },
    focus() { sim.fire('focus'); },
    setHidden(h) {
      doc.hidden = !!h; doc.visibilityState = h ? 'hidden' : 'visible';
      sim.fire('visibilitychange');
    },
    setReduced(v) { S.reduced = !!v; refreshMedia(); },
    /* viewport change: window size and/or devicePixelRatio, then 'resize'
       (the canvas box follows the viewport unless setBox set it apart) */
    resize(Wn, Hn, dprn) {
      if (Wn !== undefined) { if (S.box) S.box[0] += Wn - S.W; S.W = Wn; win.innerWidth = win.outerWidth = Wn; }
      if (Hn !== undefined) { if (S.box) S.box[1] += Hn - S.H; S.H = Hn; win.innerHeight = win.outerHeight = Hn; }
      if (dprn !== undefined) { S.dpr = dprn; win.devicePixelRatio = dprn; }
      refreshMedia();
      sim.fire('resize');
    },
    /* the canvas box alone changes, with no 'resize' (a scrollbar comes or
       goes); only a ResizeObserver sees it. setBox() puts it back on the
       viewport. */
    setBox(w, h) { S.box = w === undefined ? null : [w, h === undefined ? boxH() : h]; },
    /* devicePixelRatio alone changes, with no 'resize' (a monitor with
       another scale): only resolution media queries see it */
    setDpr(v) { S.dpr = v; win.devicePixelRatio = v; refreshMedia(); },
    /* the motion setting changes: a 'bgmotion' event on document,
       detail { paused } (plus anything in extra), not bubbling */
    motion(paused, extra) {
      const ev = makeEvent('bgmotion', { detail: Object.assign({ paused: !!paused }, extra), bubbles: false, timeStamp: S.NOW }, doc);
      invoke(doc, ev);
      return ev;
    },
    /* one frame: advance the clock by dt and tick (see the header) */
    frame(dt) {
      if (dt === undefined) dt = 16.7;
      S.NOW += dt;
      for (const [id, t] of [...timers]) if (t.at <= S.NOW) { timers.delete(id); t.fn(); }
      if (opts.starter === 'keep' || early) {
        /* as a browser does, a callback that throws is reported (here in
           sim.uncaught) and the others still run; nothing re-arms it (and
           a page that never started its loop has none) */
        const due = [...raf.values()];
        raf.clear();
        for (const cb of due) { try { cb(S.NOW); } catch (e) { sim.uncaught.push(e); } }
      } else {
        raf.clear();
        P.tick(S.NOW);
      }
      deliverResizes();
      S.frame++;
    },
    /* time passes with no frame at all, as in a hidden tab */
    idle(ms) {
      S.NOW += ms;
      for (const [id, t] of [...timers]) if (t.at <= S.NOW) { timers.delete(id); t.fn(); }
    },
    /* n frames; dt is a number or (i) => ms; each(i) runs before frame i */
    frames(n, dt, each) {
      for (let i = 0; i < n; i++) {
        if (each) each(i);
        sim.frame(typeof dt === 'function' ? dt(i) : dt);
      }
    },
    pendingRaf() { return raf.size; },
    clearOps() { if (sim.ops) sim.ops.length = 0; },
    /* swap the op recorder: a function, or null to stop recording */
    setRecord(f) { S.recordFn = f || null; },
    /* each GL draw call as { program, mode, count, state } (program: the
       handle in use, with its vs and fs sources; state: what it draws
       with, as a string): a function, or null to stop */
    setDraw(f) { S.drawFn = f || null; },
    /* the GL context taken away (webglcontextlost on the canvas) and given
       back (webglcontextrestored; only after a loss the page prevented) */
    loseContext() { S.loseContext(); },
    restoreContext() { return S.restoreContext(); }
  });
  /* the GL context's bookkeeping, once the page has one: kind, lost, the
     programs made (each with its shaders' sources), draws and calls so far,
     and each live buffer's size in bytes by id */
  Object.defineProperty(sim, 'gl', { get: () => (glPair ? glPair.G : null), enumerable: true });
  return sim;
}

/* ---- load site.js (dice + tabs) against a caller-built DOM ---------------
   dom: { document, window?, location?, history?, globals? } - plain objects;
   the tab check builds its own tab and panel stubs. */
function loadSite(dom, opts) {
  opts = opts || {};
  let src, file;
  if (opts.src !== undefined) { src = opts.src; file = 'site.js (src)'; }
  else ({ src, file } = source('site'));
  src = applyPatches(src, opts.patches);
  const g = Object.assign({ console }, dom.globals || {});
  g.document = dom.document;
  g.location = dom.location || { hash: '' };
  g.history = dom.history || { replaceState() {} };
  g.window = dom.window || listenerHost({});
  g.window.document = g.document;
  g.window.location = g.location;
  g.window.history = g.history;
  const context = vm.createContext(g);
  vm.runInContext(src, context, { filename: file });
  return { file, context, globals: g };
}

/* ---- serialisation for golden op streams ---------------------------------
   Numbers rounded to 1e-6; exact = true keeps every bit, which proves a
   refactor bit-identical rather than merely identical at 1e-6. */
function fmtNum(v, exact) {
  if (!Number.isFinite(v)) return String(v);
  if (exact) return Object.is(v, -0) ? '-0' : String(v);
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? '0' : String(r);
}
function fmtVal(v, exact) {
  if (typeof v === 'number') return fmtNum(v, exact);
  if (typeof v === 'string') return v;
  if (v && v.__gradient) return '#g' + v.id;
  if (v && v.__gl) return '#' + v.__gl + v.id + (v.name ? ':' + v.name : '');
  if (v && v.__data) return '<' + v.__data + ' ' + v.length + ' ' + v.sha1 + '>';
  if (Array.isArray(v)) return '[' + v.map(x => fmtVal(x, exact)).join(' ') + ']';
  return String(v);
}
/* paint ops also carry the state they paint with */
const PAINT = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clearRect', 'drawImage']);
function serializeOp(r, exact) {
  const who = r.target ? r.target + '.' : '';
  if (r.set) return who + r.op + '=' + fmtVal(r.args[0], exact);
  let s = who + r.op + '(' + r.args.map(a => (typeof a === 'string' ? JSON.stringify(a) : fmtVal(a, exact))).join(',') + ')';
  if (PAINT.has(r.op)) s += ' |f=' + fmtVal(r.fill, exact) + ' s=' + fmtVal(r.stroke, exact) + ' lw=' + fmtVal(r.lw, exact);
  return s;
}
/* does any numeric argument of this op fail to be finite? */
function nonFinite(r) {
  for (const a of r.args) {
    if (typeof a === 'number' && !Number.isFinite(a)) return true;
    if (Array.isArray(a) && a.some(x => typeof x === 'number' && !Number.isFinite(x))) return true;
  }
  return false;
}

/* ---- parallel jobs ---------------------------------------------------------
   Runs `node <script> --job <json>` once per job, at most `max` at a time
   (default: cores - 2, capped at 8, so a check never swamps the machine).
   The child answers with one stdout line "JOB-RESULT <json>" (jobResult);
   anything else, or a crash, becomes { error }. Results come back in job
   order. The environment, SITE_ROOT included, is inherited. */
function pool(script, jobs, max) {
  const { spawn } = require('child_process');
  const cores = require('os').cpus().length;
  max = Math.max(1, Math.min(max || Math.min(8, cores - 2), jobs.length));
  return new Promise(resolve => {
    const results = new Array(jobs.length);
    let next = 0, done = 0;
    if (!jobs.length) { resolve(results); return; }
    function launch() {
      if (next >= jobs.length) return;
      const idx = next++;
      const child = spawn(process.execPath, [script, '--job', JSON.stringify(jobs[idx])], { env: process.env });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('close', code => {
        const m = /^JOB-RESULT (.*)$/m.exec(out);
        results[idx] = m ? JSON.parse(m[1]) : { error: 'job exited ' + code + ': ' + (err || out).trim().slice(-1500) };
        if (++done === jobs.length) resolve(results); else launch();
      });
    }
    for (let i = 0; i < max; i++) launch();
  });
}
/* the job a child was started with, or null when run directly */
function jobArg() {
  const i = process.argv.indexOf('--job');
  return i >= 0 ? JSON.parse(process.argv[i + 1]) : null;
}
function jobResult(obj) { process.stdout.write('JOB-RESULT ' + JSON.stringify(obj) + '\n'); }

module.exports = {
  ROOT, START, LEGACY_START, PROBE_NAMES, RENDERER_PROBES, load, loadSite, source, bgScripts, inlineCanvas, inlineSite,
  rendererNumbers, cssCard, applyPatches, applyPatchesToFiles,
  makeElement, listenerHost, makeEvent, classList, validColour, fmtNum, fmtVal, serializeOp, nonFinite,
  pool, jobArg, jobResult
};
