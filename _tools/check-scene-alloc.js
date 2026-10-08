'use strict';
/* A frame of the scene makes no garbage and recomputes nothing constant
   (audit F16, F17, F19; scene.js's header).

   The scene runs every frame on the main thread, so whatever it allocates
   is collected there: before W3 a frame of it allocated ~6.8 KB (sane()'s
   for-in over a dozen object shapes 2.4 KB, Math.hypot's argument array
   1.9 KB, the orbit's records and the for-of loops' iterators the rest),
   and the Canvas renderer's shape functions ~1.45 MB on top (string keys
   for LIFTS, destructured tuples, hashes of constants). Now every record a
   frame needs is made once and refilled in place, the loops are indexed,
   and a frame's constants are derived when they change: the swell event's
   shape once per event, the push budget once per size.

   Measured in node: scene.js alone in a bare vm context, as
   check-scene-headless.js runs it, through a scripted session (the pointer
   on the sheet, flicks, leaving and coming back, swell events), each frame
   Bg.advance plus what the renderer asks for every frame (sunAt, bodiesAt,
   into arrays it keeps). After a long warm-up (V8 optimises functions that
   run once a frame late), the inspector's sampling heap profiler over
   WINDOWS windows of FRAMES frames: everything allocated under scene.js's
   functions, the builtins they call included. The best window must be
   under LIMIT bytes a frame: what is left is V8 boxing doubles across the
   few calls it does not inline (~0.95 KB measured), where any per-frame
   record, closure, iterator or argument array put back would add its own.
   And, the source patched to count them, hash1 runs only when a new swell
   event starts (four calls), never once a frame. Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const inspector = require('inspector');
const H = require('./harness');

const LIMIT = 1600, WARM = 30000, FRAMES = 3000, WINDOWS = 3;
const file = path.join(H.ROOT, 'assets', 'js', 'bg', 'scene.js');
if (!fs.existsSync(file)) { console.log('check-scene-alloc: SKIP - no ' + file + ' (a pre-split layout)'); process.exit(0); }
const src = fs.readFileSync(file, 'utf8');

/* the scene alone, with a hash1 call counter */
function scene(withCount) {
  const ctx = vm.createContext({ __hashes: 0 });
  let s = src;
  if (withCount) {
    const anchor = 'function hash1(i) {';
    if (s.split(anchor).length !== 2) { console.log('check-scene-alloc: FAIL - scene.js has no single "' + anchor + '"'); process.exit(1); }
    s = s.replace(anchor, anchor + ' globalThis.__hashes++;');
  }
  vm.runInContext(s, ctx, { filename: file });
  ctx.Bg.setSize(1440, 900);
  ctx.__hashes = 0;   /* what a size is built with (the trees' layouts for THE FORKS) is setup, not a frame */
  return ctx;
}
/* one session: the frames, as calls on the scene */
function driver(ctx) {
  const Bg = ctx.Bg, SUN = [0, 0, 0], BODIES = [];
  let i = 0, now = 0;
  return () => {
    i++;
    const k = i % 3000;
    if (k < 1500) Bg.pointerAt(300 + 250 * Math.sin(i * 0.013), 700 + 120 * Math.cos(i * 0.021));
    else if (k < 1600) Bg.pointerAt((i % 7) * 200, 400 + (i % 5) * 100);
    else if (k === 1600) Bg.pointerGone();
    else if (k > 1700 && k < 2900) Bg.pointerAt(1300 - (k - 1700) * 0.5, 600);
    now += 16.7;
    const t = Bg.advance(now);
    Bg.sunAt(SUN);
    Bg.bodiesAt(t, BODIES);
  };
}

const fails = [];
/* hash1: only when an event starts */
{
  const ctx = scene(true), step = driver(ctx), Bg = ctx.Bg;
  let events = 0, lastN = -1;
  for (let f = 0; f < 20000; f++) {
    step();
    if (Bg.EVF.on && Bg.EVF.n !== lastN) { events++; lastN = Bg.EVF.n; }
  }
  if (!(events >= 5)) fails.push('the session saw only ' + events + ' swell events: it tests nothing');
  if (ctx.__hashes > 4 * events) fails.push('hash1 ran ' + ctx.__hashes + ' times in 20,000 frames with ' + events + ' swell events (at most 4 an event): the scene recomputes constants every frame');
  var hashNote = 'hash1 ' + ctx.__hashes + ' calls in 20,000 frames (' + events + ' swell events, 4 each)';
}

async function main() {
  const ctx = scene(false), step = driver(ctx);
  for (let f = 0; f < WARM; f++) step();
  const s = new inspector.Session();
  s.connect();
  const post = (m, p) => new Promise((res, rej) => s.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
  await post('HeapProfiler.enable');
  const windows = [];
  for (let w = 0; w < WINDOWS; w++) {
    await post('HeapProfiler.collectGarbage');
    await post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    for (let f = 0; f < FRAMES; f++) step();
    const { profile } = await post('HeapProfiler.stopSampling');
    const by = new Map();
    let total = 0;
    (function walk(n, under) {
      const f = n.callFrame, mine = /scene\.js$/.test(f.url || ''), into = under || mine;
      if (into && n.selfSize) {
        total += n.selfSize;
        const k = (f.functionName || '(anon)') + (mine ? '' : ' (builtin)');
        by.set(k, (by.get(k) || 0) + n.selfSize);
      }
      for (const c of n.children) walk(c, into);
    })(profile.head, false);
    windows.push({ perFrame: total / FRAMES, top: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + (v / FRAMES).toFixed(0)) });
  }
  s.disconnect();
  const best = windows.reduce((a, b) => (b.perFrame < a.perFrame ? b : a));
  if (!(best.perFrame < LIMIT)) fails.push('a frame of the scene allocates ' + best.perFrame.toFixed(0) + ' B (limit ' + LIMIT + '): ' + best.top.join(', '));
  if (fails.length) {
    console.log('check-scene-alloc: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-scene-alloc: OK - a frame of the scene (advance, sunAt, bodiesAt) allocates ' + best.perFrame.toFixed(0) + ' B after '
              + WARM.toLocaleString('en-US') + ' frames of warm-up (best of ' + WINDOWS + ' windows of ' + FRAMES.toLocaleString('en-US') + '; '
              + windows.map(w => w.perFrame.toFixed(0)).join(' / ') + ' B; limit ' + LIMIT + '; top: ' + best.top.join(', ')
              + '); ' + hashNote);
}
main().catch(e => { console.log('check-scene-alloc: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
