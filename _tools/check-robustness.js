'use strict';
/* The background must keep going, whatever happens to one frame, and keep
   the motion contract (main.js, scene.js; audit G4.1, F42, F6, F3, F41,
   G5.1, F10). Everything runs the page's own requestAnimationFrame
   scheduling (harness starter 'keep'), at 1440x900 dpr 1.5, with the
   WebGL renderer on the harness's recording stub, every frame drawn
   (?bgq=0: the quality governor's top level held; check-governor.js
   covers it). A frame is judged by its draw calls - the program, the count
   and the GL state each draws with - and by where the scene puts what it
   draws (the sheet, the scenery through scenery-twin.js, the sun and the
   bodies), since the GPU does the rest.

   1. A frame that throws does not stop the loop. One throw at the start of
      the renderer's frame, one halfway through it with the GL state left
      half-set (colour mask and depth test off): the loop is still re-armed,
      the next 120 frames all run and draw the whole scene with the same
      draws, each in the same GL state, as an undisturbed frame, nothing
      non-finite reaches the GPU, and exactly one console.error is logged.
      A throw inside the scene's own step (Bg.advance, in its second
      substep, the follower already moved and the rest of the frame not):
      the frame after it starts from rest - the follower on the pointer
      and still, the ripple, every body's pull and roll at nothing, the
      swell event to be derived afresh, all finite (Bg.recover) - and the
      next 120 frames draw the whole scene.
      Without the recovery the half-stepped state simply carried on, and
      every frame still drew.
      A NaN put into any numeric field of any of the scene's state objects
      is gone by the end of the next frame, with no throw and nothing
      non-finite reaching the GPU - each field in turn, three times over:
      with no swell event running, with one running (its shape is kept
      from frame to frame for the whole event: scene.js prepEvent), and
      paused, where the next frame is a still one (hold), painted by a dpr
      change. Kept, a NaN in the event's shape lasted until the next event
      began (2,681 frames, 45s) with NaN in the shader's uEvt every frame,
      and while paused one in anything went to the GPU in every still
      frame (W3 review). prepEvent called on its own, as some tools call
      it, derives a kept shape that is not finite again too.
      A still frame that throws while paused (when no frame would follow
      it) is painted on the next frame instead, and then nothing.
   2. A zero-size frame does not poison anything: 0x0, 0 wide and 0 tall,
      for 10 frames each with the pointer moving on the sheet, and a page
      that starts at 0x0, then the real size again: every number in the
      scene stays finite, every frame afterwards draws the whole scene, and
      nothing non-finite reaches the GPU.
   3. A hidden tab coming back is one ordinary step: hidden for 5s and for
      600s (no frames run meanwhile, as in a browser), the first frame back
      moves the scene clock by one 16.7ms step, and no drawn point moves
      further than on the frames just before (2x plus 0.5px). A frame whose
      timestamp is older than the last one (a page restored from the
      back-forward cache can see one) still draws, but nothing in the scene
      moves for it - the clock steps by 0, every state bit for bit as it
      was - and the clock never runs back: the frames after it step by
      16.7ms again.
   4. The motion contract (dataset.motion at load, 'bgmotion' after):
      - loading paused ('paused', or no value and reduced motion) draws one
        still frame of scene time 0 - the orbit at phase 1.2 - then asks for
        no more; 'running' wins over reduced motion; an unset value without
        reduced motion runs;
      - a pause makes the next frame a still one, which is the last moving
        frame exactly, minus the ring, and then no frame is asked for, even
        with the pointer moving;
      - while paused, a dpr change with no resize and a context lost and
        restored each paint exactly one still frame, at the new size; a
        resize exactly one, at once, with the scenery built for its size,
        and nothing after it; and a drag one for each size - the first
        built for, those within REBUILD_MS of that build with the meshes
        fitted to theirs - and exactly one more once the wait is over,
        which builds the size it ended at (render-webgl.js scenery);
      - resuming after 5s paused moves the scene clock by exactly one step,
        and the first frame moves no drawn point further than an ordinary
        one;
      - eight toggles inside one frame leave one loop (one frame request a
        frame);
      - a pause with another reason (detail.reason, as the quality governor
        sends) pauses the same way.
   5. The bitmap follows the canvas's own box, not window.innerWidth: a
      1423px box in a 1440px window (a classic scrollbar) gets a bitmap of
      exactly 1423 x dpr, drawn to its full size, and the ring sits on the
      pointer; the box changing with no 'resize' event (only a
      ResizeObserver sees it) refits within two frames, in a frame that also
      draws; devicePixelRatio changing with no resize refits too.
   6. A lost context: drawing nothing while it is gone (no GL call reaches
      it, no error); not back within main.js's LOST_MS, the still picture
      (data-bg="static", no frames asked for), and back after all, the
      animation again (data-bg gone, whole frames); back but impossible to
      rebuild (no program links), the still picture at once.
   Exit 1 on any failure. */
const H = require('./harness');
const Twin = require('./scenery-twin');

const W = 1440, HH = 900, DPR = 1.5, DT = 16.7;
const fails = [], notes = [];
const fail = m => fails.push(m);

/* a throw at the start of the renderer's frame ('start'), or halfway, with
   the GL state half-set ('mid'); the anchors are render-webgl.js's own
   lines, and the harness throws if one moves. And one inside the scene's
   step: __step = n throws in the nth call of fieldStep from then on, which
   advance makes once a substep, after it has moved the follower (scene.js's
   own line). */
const PATCHES = [
  [/function paint\(([^)]*)\) \{/, "function paint($1) { if (globalThis.__boom === 'start') { globalThis.__boom = null; throw new Error('test: a frame that throws'); }"],
  ['      gl.useProgram(sheet.p);', "      if (globalThis.__boom === 'mid') { globalThis.__boom = null; gl.colorMask(false, true, false, true); gl.disable(gl.DEPTH_TEST); throw new Error('test: a throw halfway through a frame'); }\n      gl.useProgram(sheet.p);"],
  ['  function fieldStep(h) {', "  function fieldStep(h) { if (globalThis.__step > 0 && --globalThis.__step === 0) throw new Error('test: a throw inside the scene step');"]
];
function page(opts) {
  const sim = H.load(Object.assign({ W, H: HH, dpr: DPR, now: 1000, starter: 'keep', patches: PATCHES, search: '?bgq=0' }, opts));
  sim.errors = [];
  sim.window.console = { error: (...a) => sim.errors.push(a.map(String).join(' ')), warn() {}, log() {}, info() {} };
  return sim;
}
/* what a program draws, from its fragment shader */
function kindOf(p) {
  const fs = (p && p.fs) || '';
  if (fs.includes('float ringAt(')) return 'ring';
  if (fs.includes('float rowDepth(')) return 'floor';
  if (fs.includes('float coverOf(')) return 'strokes';
  if (fs.includes('vFill')) return 'massifs';
  if (fs.includes('vTone')) return 'clouds';
  if (fs.includes('uDisc.z - length(vOff)')) return 'sun';
  if (fs.includes('BODY') || fs.includes('vLook;\nuniform float uPx;\nvoid main() {\n  float r = length(vOff), core')) return 'bodies';
  if (fs.includes('fragOut = vec4(0.0)')) return 'card';
  return 'other';
}
/* one frame: its GL calls, its draws ({ kind, count, state }) and whether
   it drew the ring */
function frameOf(sim, dt) {
  const ops = [], draws = [];
  sim.setRecord(r => ops.push(r));
  sim.setDraw(d => draws.push({ kind: kindOf(d.program), count: d.count, state: d.state }));
  try { sim.frame(dt === undefined ? DT : dt); }
  finally { sim.setRecord(null); sim.setDraw(null); }
  return { ops, draws, ring: draws.some(d => d.kind === 'ring') };
}
const drawn = f => f.draws.length > 0;
/* the draws as one string, without the ring's */
const shape = f => f.draws.filter(d => d.kind !== 'ring').map(d => d.kind + ' ' + d.count + ' ' + d.state).join('\n');
/* the exact calls of a frame, without the ring's (from its program to its draw) */
function serial(f) {
  const out = [];
  let inRing = false;
  for (const r of f.ops) {
    if (r.op === 'useProgram') inRing = r.args[0] && kindOf(r.args[0]) === 'ring';
    if (!inRing) out.push(H.serializeOp(r, true));
  }
  return out.join('\n');
}
const nonFinite = f => f.ops.filter(r => H.nonFinite(r)).length;
/* where the scene puts what is drawn, in CSS px: a grid of the sheet, every
   scenery corner and stroke end (the shaders' math: scenery-twin.js), the
   sun and the bodies */
function points(sim) {
  const P = sim.P, Bg = sim.window.Bg, t = P.simNow, out = [];
  for (let r = 0; r <= 12; r++) for (let c = -10; c <= 10; c++) { const d = 1 + r * 0.45; out.push(...P.surfacePoint(c * 0.1 * d, d, t)); }
  if (!sim.__tw || sim.__twS !== Bg.S || sim.__twW !== Bg.W) { sim.__tw = Twin.make(Bg); sim.__twS = Bg.S; sim.__twW = Bg.W; }
  const tw = sim.__tw, o2 = [0, 0], o4 = [0, 0, 0, 0];
  for (let i = 0; i < tw.massifs; i += 7) out.push(...tw.massifAt(i, t, o2));
  for (let i = 0; i < tw.strokes; i += 5) out.push(...tw.strokeAt(i, t, o4));
  out.push(...P.sunAt());
  for (const b of P.bodiesAt(t)) out.push(b.x, b.y);
  return out;
}
function maxMove(p, q) {
  if (p.length !== q.length) return Infinity;
  let m = 0;
  for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
  return m;
}
const STATE = ['look', 'ptr', 'mk', 'CUR', 'RIP', 'EVF'], LISTS = ['bodiesW', 'bodyPull', 'bodyRoll', 'TPUSH'];
function badState(P) {
  const bad = [];
  const look = (label, o) => { for (const k of Object.keys(o || {})) if (typeof o[k] === 'number' && !Number.isFinite(o[k])) bad.push(label + '.' + k); };
  for (const n of STATE) look(n, P[n]);
  for (const n of LISTS) (P[n] || []).forEach((o, i) => look(n + '[' + i + ']', o));
  for (const k of ['simNow', 'lastNow']) if (!Number.isFinite(P[k])) bad.push(k);
  return bad;
}
/* the largest move of the frames just before, for comparison */
function ordinary(sim, n, each) {
  let worst = 0, prev = points(sim), last = null;
  for (let i = 0; i < n; i++) { if (each) each(i); last = frameOf(sim); const p = points(sim); worst = Math.max(worst, maxMove(prev, p)); prev = p; }
  return { worst, last, pts: prev };
}
/* a section that throws (an older page has no such API) fails, the rest still run */
function section(n, fn) {
  try { fn(); } catch (e) { fail('section ' + n + ' threw: ' + ((e && e.stack) || e)); }
}

/* ---- 1. frames that throw, and NaN in the state --------------------------- */
section(1, () => {
for (const where of ['start', 'mid']) {
  const sim = page();
  sim.move(300, 700);
  sim.frames(60, DT);
  const normal = shape(frameOf(sim));
  sim.window.__boom = where;
  sim.frame(DT);
  if (sim.pendingRaf() !== 1) fail('throw at ' + where + ': ' + sim.pendingRaf() + ' frames queued after it (need 1: the loop must re-arm first)');
  let ran = 0, whole = 0, badOps = 0;
  for (let i = 0; i < 120; i++) {
    sim.move(300 + 3 * i, 700);
    const f = frameOf(sim);
    if (drawn(f)) ran++;
    if (shape(f) === normal) whole++;
    badOps += nonFinite(f);
  }
  if (ran !== 120) fail('throw at ' + where + ': only ' + ran + ' of the next 120 frames ran');
  if (whole !== 120) fail('throw at ' + where + ': ' + (120 - whole) + ' of the next 120 frames did not draw the whole scene in the same GL state as before it');
  if (badOps) fail('throw at ' + where + ': ' + badOps + ' non-finite GL calls after it');
  if (sim.errors.length !== 1) fail('throw at ' + where + ': ' + sim.errors.length + ' console errors (need exactly 1)');
  if (sim.uncaught.length) fail('throw at ' + where + ': it escaped the frame (' + sim.uncaught[0].message + '), so nothing re-armed the loop');
  const bad = badState(sim.P);
  if (bad.length) fail('throw at ' + where + ': non-finite state ' + bad.slice(0, 4).join(', '));
}
});
/* a throw inside the scene's own step, part-way through it */
section('step-throw', () => {
  const sim = page();
  const P = sim.P;
  /* into the first swell event (5.8s in), so its shape is being kept;
     then a slow drift low on the sheet, past a body, so every motion
     state is busy: the follower moving, the dent under it (the touch; the
     ripple too, where it is on: scene.js CALM_RIPPLE), the bodies pulled
     toward it and rolling */
  sim.frames(360, DT);
  let x = 300;
  for (let i = 0; i < 150; i++) { sim.move(x += 1, 700); sim.frame(DT); }
  sim.move(x += 1, 700);
  const normal = shape(frameOf(sim));
  const zero = o => Object.keys(o).every(k => typeof o[k] !== 'number' || o[k] === 0);
  const busy = P.ptr.vx !== 0 && (P.RIP.b > 0.1 || P.CUR.on > 0.2) && !P.bodyPull.every(zero) && !P.bodyRoll.every(zero);
  if (!busy) fail('a throw in the scene step: precondition: the motion state is not busy (follower ' + P.ptr.vx + 'px/s, ripple ' + P.RIP.b + ', touch ' + P.CUR.on + ')');
  if (!(P.EVF.on && P.EVF.n >= 0)) fail('a throw in the scene step: precondition: no swell event is running (EVF.on ' + P.EVF.on + ', n ' + P.EVF.n + ')');
  sim.window.__step = 2;
  sim.move(x += 1, 700);
  const f = frameOf(sim);
  if (sim.window.__step !== 0) fail('a throw in the scene step: it never threw (the fieldStep patch did not run)');
  if (drawn(f)) fail('a throw in the scene step: the frame that threw still drew');
  if (sim.pendingRaf() !== 1) fail('a throw in the scene step: ' + sim.pendingRaf() + ' frames queued after it (need 1)');
  if (sim.uncaught.length) fail('a throw in the scene step: it escaped the frame (' + sim.uncaught[0].message + ')');
  if (sim.errors.length !== 1) fail('a throw in the scene step: ' + sim.errors.length + ' console errors (need exactly 1)');
  /* the frame after it starts from rest (Bg.recover) */
  const p = P.ptr, r = P.RIP, notRest = [];
  if (!(p.x === p.tx && p.y === p.ty && p.vx === 0 && p.vy === 0 && p.env === 0 && p.hop === 0)) notRest.push('the follower');
  if (!(r.b === 0 && r.bv === 0 && r.on === 0 && r.att === true)) notRest.push('the ripple');
  if (!P.bodyPull.every(zero)) notRest.push('the bodies\' pull');
  if (!P.bodyRoll.every(zero)) notRest.push('the bodies\' roll');
  /* and the swell event is derived afresh, its kept shape too (n), so a
     throw that left it half-written cannot keep it for the rest of the
     event */
  if (!(P.EVF.t === -1 && P.EVF.n === -1)) notRest.push('the swell event (EVF.t ' + P.EVF.t + ', n ' + P.EVF.n + ': not derived afresh)');
  if (notRest.length) fail('a throw in the scene step: ' + notRest.join(', ') + ' not back at rest after it (Bg.recover)');
  const bad = badState(P);
  if (bad.length) fail('a throw in the scene step: non-finite state after it: ' + bad.slice(0, 4).join(', '));
  let whole = 0, badOps = 0;
  for (let i = 0; i < 120; i++) {
    sim.move(x += 1, 700);
    const g = frameOf(sim);
    if (shape(g) === normal) whole++;
    badOps += nonFinite(g);
  }
  if (whole !== 120) fail('a throw in the scene step: ' + (120 - whole) + ' of the next 120 frames did not draw the whole scene');
  if (badOps || sim.problems.length) fail('a throw in the scene step: ' + badOps + ' non-finite GL calls, ' + sim.problems.length + ' rejected after it');
  if (badState(P).length) fail('a throw in the scene step: non-finite state 120 frames on');
  notes.push('a throw inside the scene step: every motion state at rest the frame after, whole frames on');
});
section(2, () => {
  /* every numeric field of every state object, one at a time, at three
     moments (the header): EVF's included, so the swell event's kept shape
     is tested while it is being kept */
  let n = 0;
  for (const when of ['no swell event', 'a swell event running', 'paused in a swell event']) {
    const sim = page();
    const P = sim.P;
    sim.move(300, 700);
    sim.frames(60, DT);
    const inEvent = when !== 'no swell event', still = when.startsWith('paused');
    /* the first event of a visit starts 5.8s in; well into it */
    for (let i = 0; inEvent && !(P.EVF.on && P.EVF.env > 0.5) && i < 2000; i++) sim.frame(DT);
    if (still) { sim.motion(true); frameOf(sim); }
    const where = [];
    for (const s of STATE) for (const k of Object.keys(P[s])) if (typeof P[s][k] === 'number') where.push([P[s], k, s + '.' + k]);
    for (const s of LISTS) P[s].forEach((o, i) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') where.push([o, k, s + '[' + i + '].' + k]); });
    let mine = 0, evf = 0, dpr = DPR;
    for (const [o, k, label] of where) {
      /* each injection at the moment it is for: else it tests nothing */
      if (P.EVF.on !== inEvent) { fail(when + ': precondition: at NaN in ' + label + ' the swell event is ' + (P.EVF.on ? 'running' : 'not running')); break; }
      const was = o[k];
      o[k] = NaN;
      if (o === P.EVF) evf++;
      /* paused, nothing paints unless asked: a dpr change paints one still frame */
      if (still) sim.setDpr(dpr = dpr === DPR ? 2 : DPR);
      const f = frameOf(sim);
      mine++;
      const bad = badState(P);
      if (still && !drawn(f)) fail(when + ': NaN in ' + label + ': no still frame was painted (it tests nothing)');
      if (bad.length || nonFinite(f) || sim.errors.length || sim.problems.length) {
        fail('NaN in ' + label + ', ' + when + ': ' + (bad.length ? 'still non-finite after a frame: ' + bad.slice(0, 3).join(', ')
                                                                  : nonFinite(f) + ' non-finite GL calls, ' + sim.errors.length + ' errors, ' + sim.problems.length + ' rejected'));
        o[k] = was;
        sim.problems.length = 0;
      }
    }
    if (evf < 7) fail(when + ': only ' + evf + ' of the swell event\'s numeric fields were tested (need t, env, sign, amp, cx, cd, n)');
    n += mine;
    /* prepEvent on its own, with no sane() before it (check-first-swell.js
       and check-sheet-mesh.js call it directly): a kept shape that is not
       finite is derived again, not kept for the rest of the event */
    if (inEvent && !still) {
      for (const k of ['sign', 'amp', 'cx', 'cd']) {
        P.EVF[k] = NaN;
        P.prepEvent(P.EVF.t + 1);
        if (!P.EVF.on) fail('prepEvent on its own: precondition: the swell event is not running');
        else if (!Number.isFinite(P.EVF[k])) fail('prepEvent on its own kept a NaN in EVF.' + k + ' for the event (a kept shape must be checked)');
      }
    }
  }
  notes.push(n + ' NaN injections (every numeric field of the scene\'s state, with no swell event, in one and paused in one)');
});

/* a still frame that throws (paused, so nothing else follows it) is tried again */
section('still-throw', () => {
  const sim = page({ motion: 'paused' });
  sim.window.__boom = 'start';
  const counts = [];
  for (let i = 0; i < 6; i++) counts.push(frameOf(sim).draws.length);
  if (!(counts[0] === 0 && counts[1] >= 6 && counts.slice(2).every(n => n === 0))) {
    fail('a still frame that threw: frames drew ' + counts.join(', ') + ' times (need nothing, then the still frame once, then nothing)');
  }
  if (sim.pendingRaf()) fail('a still frame that threw: a frame is still queued afterwards');
});

/* ---- 2. zero-size frames -------------------------------------------------- */
section(3, () => {
for (const [label, w, h] of [['0x0', 0, 0], ['0 wide', 0, HH], ['0 tall', W, 0]]) {
  const sim = page();
  sim.move(300, 700);
  sim.frames(60, DT);
  const normal = shape(frameOf(sim));
  sim.resize(w, h);
  for (let i = 0; i < 10; i++) { sim.move(200 + 20 * i, 650); sim.frame(DT); }
  sim.resize(W, HH);
  let short = 0, badOps = 0;
  sim.frame(DT);
  for (let i = 0; i < 60; i++) {
    sim.move(400 + i, 700);
    const f = frameOf(sim);
    if (shape(f) !== normal) short++;
    badOps += nonFinite(f);
  }
  const bad = badState(sim.P);
  if (bad.length) fail(label + ': non-finite state after it: ' + bad.slice(0, 4).join(', '));
  if (short) fail(label + ': ' + short + ' of 60 frames after it did not draw the whole scene');
  if (badOps || sim.problems.length) fail(label + ': ' + badOps + ' non-finite GL calls, ' + sim.problems.length + ' rejected');
  if (sim.pendingRaf() !== 1) fail(label + ': the loop is not running after it');
}
});
section(4, () => {
  const sim = page({ W: 0, H: 0 });
  sim.frames(5, DT);
  sim.resize(390, 844);
  let full = 0;
  for (let i = 0; i < 60; i++) if (frameOf(sim).draws.length >= 6) full++;
  const bad = badState(sim.P);
  if (full !== 60 || bad.length || sim.problems.length) fail('starting at 0x0: ' + full + '/60 full frames once the real size came, '
                                                            + bad.length + ' non-finite values, ' + sim.problems.length + ' rejected');
});

/* ---- 3. a hidden tab ------------------------------------------------------ */
section(5, () => {
for (const away of [5000, 600000]) {
  const sim = page();
  sim.frames(120, DT);
  const o = ordinary(sim, 10);
  const t0 = sim.P.simNow;
  sim.setHidden(true);
  sim.idle(away);
  sim.setHidden(false);
  frameOf(sim);
  const jump = maxMove(o.pts, points(sim)), step = sim.P.simNow - t0;
  if (!(Math.abs(step - DT) < 1e-6)) fail('hidden ' + away / 1000 + 's: the first frame back moved the scene clock ' + step.toFixed(1) + 'ms (need one 16.7ms step)');
  if (!(jump <= o.worst * 2 + 0.5)) fail('hidden ' + away / 1000 + 's: a drawn point moved ' + jump.toFixed(1) + 'px on the first frame back (ordinary frames: '
                                         + o.worst.toFixed(1) + 'px)');
  notes.push('back after ' + away / 1000 + 's hidden: ' + jump.toFixed(2) + 'px (ordinary ' + o.worst.toFixed(2) + 'px)');
}
});

/* a frame whose timestamp is older than the last one: the clock stands
   still for it and never runs back (scene.js advance: dt floored at 0) */
section('old-timestamp', () => {
  const sim = page();
  const P = sim.P;
  sim.move(300, 700);
  sim.frames(60, DT);
  const motion = () => JSON.stringify([P.look, P.ptr, P.mk, P.CUR, P.RIP, P.bodiesW, P.bodyPull, P.bodyRoll, P.TPUSH]);
  const t0 = P.simNow, held = motion();
  sim.setNow(sim.now - 500);
  const f = frameOf(sim);
  const late = sim.now;
  if (P.lastNow !== late) fail('an older timestamp: the scene did not step at it (lastNow ' + P.lastNow + ', the frame ' + late + ')');
  if (P.simNow !== t0) fail('an older timestamp (' + (500 - DT).toFixed(1) + 'ms before the last frame): the scene clock moved ' + (P.simNow - t0).toFixed(1) + 'ms (need 0)');
  else if (motion() !== held) fail('an older timestamp: the clock stood still but the scene moved (it must be a still frame of the scene)');
  if (!drawn(f)) fail('an older timestamp: the frame drew nothing');
  let back = 0, odd = 0, prevT = P.simNow;
  for (let i = 0; i < 30; i++) {
    sim.frame(DT);
    const step = P.simNow - prevT;
    if (step < 0) back++;
    else if (Math.abs(step - DT) > 1e-6) odd++;
    prevT = P.simNow;
  }
  if (back || odd) fail('after an older timestamp: the scene clock ran back on ' + back + ' and stepped by other than 16.7ms on ' + odd + ' of the next 30 frames');
  notes.push('a frame stamped ' + (500 - DT).toFixed(1) + 'ms before the last: the clock steps by 0 and nothing moves, then 16.7ms a frame again');
});

/* ---- 4. the motion contract ---------------------------------------------- */
section(6, () => {
  let stillRef = null;
for (const [label, opts, paused] of [['dataset paused', { motion: 'paused' }, true], ['unset + reduced motion', { reduced: true }, true],
                                     ['dataset running + reduced motion', { motion: 'running', reduced: true }, false], ['unset', {}, false]]) {
  const sim = page(opts);
  const P = sim.P;
  const first = frameOf(sim);
  let more = 0;
  for (let i = 0; i < 30; i++) if (drawn(frameOf(sim))) more++;
  if (!paused) { if (more !== 30) fail(label + ': did not keep running (' + more + '/30 frames drew)'); continue; }
  if (!drawn(first)) fail(label + ': nothing drawn at load');
  if (more || sim.pendingRaf()) fail(label + ': ' + more + ' more frames drawn, ' + sim.pendingRaf() + ' queued after the still frame');
  if (P.simNow !== 0) fail(label + ': the still frame is at scene time ' + P.simNow + ', not 0');
  const orbit = P.orbitWorld(1.2);
  if (P.ORBIT_T0 !== 1.2 || P.bodiesW.some((b, i) => Math.abs(b.xw - orbit[i].xw) > 1e-12)) fail(label + ': the bodies are not at orbit phase 1.2');
  if (first.ring) fail(label + ': the still frame draws the ring');
  if (stillRef === null) stillRef = serial(first);
  else if (serial(first) !== stillRef) fail(label + ': its still frame differs from the dataset-paused one');
}
});
section(7, () => {
  const sim = page();
  const P = sim.P;
  sim.move(300, 700);
  sim.frames(90, DT);
  const o = ordinary(sim, 10, i => sim.move(300 + i, 700));
  if (!o.last.ring) fail('precondition: the ring is not drawn while the pointer is on the page');
  /* pause */
  sim.motion(true);
  const still = frameOf(sim);
  if (still.ring) fail('the still frame draws the ring');
  if (serial(still) !== serial(o.last)) fail('the still frame is not the last moving frame minus the ring');
  let n = 0;
  for (let i = 0; i < 60; i++) { sim.move(500 + 5 * i, 600); if (drawn(frameOf(sim))) n++; }
  if (n || sim.pendingRaf()) fail('paused: ' + n + ' frames drawn, ' + sim.pendingRaf() + ' queued, with the pointer moving');
  /* a resize while paused: one still frame at once, at the new size and
     with the scenery built for it (one resize, one adjustment), and nothing
     after it. A drag while paused: a still frame for each size, the first
     built for and the ones within REBUILD_MS of it drawn with the meshes
     fitted to their size (uFit), and exactly one more once the wait is
     over, which builds the size it ended at. A build is the frame's
     bufferData calls (the scenery's three buffers). */
  const builds = f => f.ops.filter(r => r.op === 'bufferData').length;
  const fitOf = f => { const r = f.ops.find(o => o.op === 'uniform4fv' && o.args[0] && o.args[0].name === 'uFit'); return r ? r.args[1] : null; };
  sim.resize(1100, 820);
  let painted = 0, rebuilt = 0;
  for (let i = 0; i < 5; i++) { const f = frameOf(sim); if (drawn(f)) { painted++; if (builds(f) > 0) rebuilt++; } }
  if (painted !== 1) fail('paused resize: ' + painted + ' frames painted at once (need exactly 1)');
  else if (!rebuilt) fail('paused resize: the frame at once draws the scenery built for the size before it (one resize must be one adjustment)');
  if (sim.canvas.width !== Math.round(1100 * DPR)) fail('paused resize: the bitmap is ' + sim.canvas.width + ' wide, not ' + Math.round(1100 * DPR));
  painted = 0;
  for (let i = 0; i < 20; i++) if (drawn(frameOf(sim))) painted++;
  if (painted) fail('paused resize: ' + painted + ' frames painted after it (need none: its scenery was built at once)');
  if (sim.pendingRaf()) fail('paused resize: ' + sim.pendingRaf() + ' frames still queued after it');
  const drag = [];
  for (let i = 1; i <= 4; i++) { sim.resize(1100 + 10 * i, 820); drag.push(frameOf(sim)); }
  const dragBuilt = drag.filter(f => builds(f) > 0).length;
  if (drag.filter(drawn).length !== 4) fail('paused drag: ' + drag.filter(drawn).length + ' of its 4 sizes painted (need each)');
  if (dragBuilt !== 1 || !(builds(drag[0]) > 0)) fail('paused drag: the scenery was built in ' + dragBuilt + ' of its 4 frames (need the first alone, then none within REBUILD_MS)');
  if (!drag.slice(1).every(f => (fitOf(f) || []).some(v => v !== 0))) fail('paused drag: a frame within REBUILD_MS of the build drew the meshes unfitted to its size');
  painted = 0;
  let last = null;
  for (let i = 0; i < 20; i++) { const f = frameOf(sim); if (drawn(f)) { painted++; last = f; } }
  if (painted !== 1) fail('paused drag: ' + painted + ' frames painted once the wait was over (need exactly 1: the scenery built for the size it ended at)');
  else if (!(builds(last) > 0) || (fitOf(last) || [1]).some(v => v !== 0)) fail('paused drag: the frame once the wait was over did not build the size it ended at');
  if (sim.pendingRaf()) fail('paused drag: ' + sim.pendingRaf() + ' frames still queued after it');
  sim.resize(1100, 820);
  for (let i = 0; i < 20; i++) frameOf(sim);
  /* a dpr change with no resize, and a context lost and restored */
  sim.setDpr(2);
  painted = 0;
  for (let i = 0; i < 5; i++) if (drawn(frameOf(sim))) painted++;
  if (painted !== 1 || sim.canvas.width !== 2200) fail('paused dpr change with no resize: ' + painted + ' frames painted, the bitmap ' + sim.canvas.width + ' wide (need 1, 2200)');
  sim.loseContext();
  sim.restoreContext();
  painted = 0;
  for (let i = 0; i < 5; i++) if (drawn(frameOf(sim))) painted++;
  if (painted !== 1) fail('paused context loss and restore: ' + painted + ' frames painted (need exactly 1)');
  /* resume after 5s paused, the pointer back where it was paused */
  sim.setDpr(DPR);
  sim.resize(W, HH);
  sim.move(310, 700);
  frameOf(sim);
  const held = points(sim);
  sim.idle(5000);
  const t0 = P.simNow;
  sim.motion(false);
  frameOf(sim);
  const step = P.simNow - t0, jump = maxMove(held, points(sim));
  if (!(Math.abs(step - DT) < 1e-6)) fail('resume after 5s paused: the scene clock moved ' + step.toFixed(1) + 'ms on the first frame (need 16.7)');
  if (!(jump <= o.worst * 2 + 0.5)) fail('resume after 5s paused: a drawn point moved ' + jump.toFixed(1) + 'px (ordinary frames: ' + o.worst.toFixed(1) + 'px)');
  notes.push('resume after 5s paused: ' + jump.toFixed(2) + 'px (ordinary ' + o.worst.toFixed(2) + 'px)');
  n = 0;
  for (let i = 0; i < 30; i++) if (drawn(frameOf(sim))) n++;
  if (n !== 30) fail('after resuming only ' + n + '/30 frames drew');
});
section(8, () => {
  /* resume after the pointer moved far while paused: the field must not be
     swept across the sheet to it. The touch stays where it was until it has
     faded out, then starts again under the pointer; nothing in between. */
  const sim = page();
  const P = sim.P;
  sim.move(250, 760);
  sim.frames(120, DT);
  sim.motion(true);
  sim.frame(DT);
  for (let i = 0; i < 30; i++) { sim.move(250 + 35 * i, 760 - 4 * i); sim.frame(DT); }
  sim.motion(false);
  const from = P.CUR.sx, to = P.ptr.tx;
  let between = 0, worst = 0, prev = P.CUR.on;
  for (let i = 0; i < 40; i++) {
    sim.frame(DT);
    worst = Math.max(worst, Math.abs(P.CUR.on - prev));
    prev = P.CUR.on;
    if (P.CUR.on > 0 && Math.abs(P.CUR.sx - from) > 1 && Math.abs(P.CUR.sx - to) > 1) between++;
  }
  if (between) fail('resume after the pointer moved while paused: the touch was drawn between the old place and the pointer on ' + between + ' frames');
  if (!(worst <= 0.06)) fail('resume after the pointer moved while paused: the touch changed by ' + worst.toFixed(3) + ' in a frame');
  if (!(Math.abs(P.CUR.sx - to) < 1 && P.CUR.on > 0.2)) fail('resume after the pointer moved while paused: the touch is not back under the pointer 40 frames on');
});
section(9, () => {
  const sim = page();
  sim.frames(10, DT);
  for (let i = 0; i < 8; i++) sim.motion(i % 2 === 0);
  const r0 = sim.rafRequests;
  let most = 0;
  for (let i = 0; i < 60; i++) { sim.frame(DT); most = Math.max(most, sim.pendingRaf()); }
  const per = (sim.rafRequests - r0) / 60;
  if (most !== 1 || per !== 1) fail('eight toggles in one frame: up to ' + most + ' frames queued, ' + per.toFixed(2) + ' requests a frame (need one loop)');
});
section(10, () => {
  const sim = page();
  sim.frames(10, DT);
  sim.motion(true, { reason: 'performance' });
  sim.frame(DT);
  let n = 0;
  for (let i = 0; i < 20; i++) if (drawn(frameOf(sim))) n++;
  if (n || sim.pendingRaf()) fail('a pause with reason "performance" did not stop the motion');
});

/* ---- 5. the bitmap follows the canvas's own box (audit F2) ---------------- */
section('box', () => {
  /* a 17px classic scrollbar: the window is 1440 wide, the fixed canvas 1423 */
  const sim = page({ box: [1423, 900] });
  const f0 = frameOf(sim);
  const vp = (f0.draws[0] && f0.draws[0].state.match(/viewport ([\d,]+)/)) || [];
  if (sim.canvas.width !== Math.round(1423 * DPR) || vp[1] !== '0,0,' + Math.round(1423 * DPR) + ',' + Math.round(900 * DPR)) {
    fail('box 1423 in a 1440 window: the bitmap is ' + sim.canvas.width + ' wide, drawn with viewport ' + vp[1] + ' (need ' + Math.round(1423 * DPR) + ', all of it)');
  }
  sim.move(1400, 700);
  sim.frames(40, DT);
  if (Math.abs(sim.P.mk.x - 1400) > 0.5) fail('box 1423: the ring is drawn at ' + sim.P.mk.x.toFixed(1) + ' for a pointer at 1400');
  /* the box alone changes (no 'resize'): refitted within two frames, and the frame that refits draws */
  sim.setBox(1440, 900);
  const a = frameOf(sim), b = frameOf(sim);
  const refit = [a, b].findIndex(f => f.ops.some(r => r.op === 'width'));
  if (sim.canvas.width !== Math.round(1440 * DPR)) fail('the box grew with no resize event: the bitmap is still ' + sim.canvas.width + ' wide');
  else if (refit < 0 || !drawn([a, b][refit])) fail('the frame that refitted the bitmap did not draw (a blank frame)');
  /* devicePixelRatio alone changes (no 'resize') */
  sim.setDpr(2);
  sim.frame(DT);
  if (sim.canvas.width !== 2880) fail('dpr 1.5 -> 2 with no resize event: the bitmap is ' + sim.canvas.width + ' wide (need 2880)');
});

/* ---- 6. a lost context ----------------------------------------------------- */
section('lost', () => {
  const sim = page();
  sim.move(300, 700);
  sim.frames(30, DT);
  const normal = shape(frameOf(sim));
  sim.loseContext();
  let calls = 0;
  for (let i = 0; i < 20; i++) calls += frameOf(sim).ops.length;
  if (calls) fail('lost: ' + calls + ' GL calls while the context was gone');
  if (sim.html.dataset.bg) fail('lost: the still picture already, ' + 20 * DT + 'ms in');
  /* not back within LOST_MS: the still picture */
  for (let i = 0; i < 200 && !sim.html.dataset.bg; i++) sim.frame(DT);
  if (sim.html.dataset.bg !== 'static') fail('lost for good: no still picture (data-bg ' + sim.html.dataset.bg + ')');
  const requests = sim.rafRequests;
  sim.frames(10, DT);
  if (sim.rafRequests !== requests || sim.pendingRaf()) fail('the still picture: the page still asks for frames');
  /* back after all: animating again */
  sim.restoreContext();
  let whole = 0;
  for (let i = 0; i < 30; i++) { sim.move(300 + i, 700); if (shape(frameOf(sim)) === normal) whole++; }
  if (sim.html.dataset.bg) fail('restored after all: still the still picture');
  if (whole < 28) fail('restored after all: only ' + whole + '/30 whole frames');
  if (sim.errors.length) fail('lost and restored: console errors: ' + sim.errors[0]);
  /* back, but nothing will build: the still picture at once */
  const sim2 = page();
  sim2.frames(10, DT);
  const gl = sim2.canvas.getContext('webgl2');
  sim2.loseContext();
  gl.createProgram = () => null;
  sim2.restoreContext();
  if (sim2.html.dataset.bg !== 'static') fail('restored but impossible to rebuild: no still picture (data-bg ' + sim2.html.dataset.bg + ')');
  sim2.frames(5, DT);
  if (sim2.pendingRaf()) fail('restored but impossible to rebuild: the page still asks for frames');
  notes.push('a lost context: nothing drawn while gone, the still picture after main.js\'s grace, the animation again when back, the still picture at once when it cannot be rebuilt');
});

if (fails.length) {
  console.log('check-robustness: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-robustness: OK - a throw at the start of a frame and halfway through it (GL state half-set): the loop runs on, '
            + 'whole frames in the same GL state, 1 error logged; ' + notes[0] + '; ' + notes[1] + ' fixed in a frame; 0x0 / 0-wide / 0-tall frames and a 0x0 '
            + 'start poison nothing; ' + notes.slice(2).join('; ') + '; a paused load draws scene time 0 once; a pause is the last frame minus '
            + 'the ring, then nothing; a paused resize (built for at once), dpr change and context restore paint once each, a paused drag once a size and once more as its wait ends; toggles keep one loop; '
            + 'the bitmap is the canvas box x dpr, refitted on a box or dpr change with no resize event');
