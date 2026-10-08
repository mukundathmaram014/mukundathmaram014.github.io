'use strict';
/* The adaptive quality governor (assets/js/bg/governor.js) keeps the
   background smooth on whatever draws it: it steps the quality down when
   frames keep missing their vsync - resolution first (min(dpr, 2) -> 1.5 ->
   1.25 -> 1 -> 0.75 px per CSS px), then a cadence (every k-th vsync,
   evenly paced) - and back up after sustained headroom, and as a last
   resort pauses the motion, when the page is to blame, and resumes it by
   itself when it can.

   A. The governor alone, in node, on synthetic machines: a display at a
      refresh rate (requestAnimationFrame on its vsync, optionally jittered,
      with late frames and their catch-ups) and a GPU whose cost per drawn
      frame grows with the pixels shaded (c0 + c1 * res^2 ms); a drawn frame
      holds the next animation frame back until the GPU is done with it
      (the stricter, serial pipeline), or (pipelined) lets that next one
      start on time and holds back the one after, as a browser does.
        fast       60-240 Hz: the vsync found within 1%, level 0 held, no
                   change, every frame drawn but the one probe's two
        2 vsyncs   a GPU that holds every frame to exactly 2 vsyncs of a
                   60 Hz display: read as 60 Hz, not as a 30 Hz display
                   keeping up, and stepped down until frames fit
        slow       165 Hz, level 0 too slow: straight down to the first
                   resolution that fits, held, no second change for the next
                   ~5 s and few failed attempts after (each wait 4x the last);
                   and 60, 120, 144 and 165 Hz with drawn frames over budget,
                   jittered, late frames and catch-ups among them: down
                   within 3 s; and the same pipelined, where a frame that
                   draws nothing right after a drawn one waits for that
                   one's GPU work: the vsync still read within 1% (the probe
                   drew nothing in one frame, and read 218 ms on SwiftShader),
                   down within 3 s, or 4 s at 140 ms a frame
        very slow  a cadence: 165 Hz at k = 3 (55 fps), 60 Hz at k = 2 (30
                   fps), drawn exactly every k vsyncs
        edge       a cost right at a level's limit, jittered: settles; the
                   waits between attempts to go back up grow; mostly at
                   the settled level
        noisy      fast frames with 4-5% spikes, jitter and hiccups: no
                   change at all (hysteresis)
        recovering slow for 20 s, then fast: back up one level at a time,
                   never down on the way, at level 0 within 40 s
        too slow   the lowest animated level over 80 ms a frame, the frames
                   that draw nothing still one vsync apart (the page's own
                   cost): the performance pause asked for once, after that
                   level was reached; played again by the visitor
                   (resumeAfterPause) it runs at the lowest animated level
                   and never asks again
        dpr 1      levels 1-3 are all 1x there: never stepped through
        held       ?bgq=n: the level held whatever the cost, and at a
                   cadence the frames exactly k vsyncs apart; ?bgq=pause
                   asks for the pause on the first frame
        the clamp  no cadence longer than the scene's 64 ms dt clamp
        cost       under 1 us an animation frame at 165 Hz, the vsync
                   confirmed, the best of many short runs (a run the
                   process spends waiting for the CPU times the machine,
                   not the governor), measured again a few times if even
                   the best is over and the machine looks busy; nothing
                   allocated, in
                   six states (fast at 165 and 60 Hz, settled at a
                   cadence, held at ?bgq=6, at the lowest level after the
                   pause, and a display that changes every 3 s, measured
                   again each time: 0.1 B, the new vsync boxed once a
                   change): the inspector's sampling heap profiler over
                   100,000 animation frames, everything allocated under
                   governor.js's functions, the best of WINDOWS windows
                   under ALLOC_MAX B a frame (before the fix, 16 to 129 B
                   in every window: the ratio boxed for main.js every
                   frame, typed-array views for the sorts, a closure for
                   PERIODS.some, the vsync reboxed). Best of, and warmed
                   up again after each collection, because the collection
                   that frees the last state's governor deoptimises code
                   that referred to it, and until V8 optimises again (a
                   few thousand frames) the interpreter boxes its doubles
                   (4-6 B a frame over a window): a page has one governor
   A2. Replays: frame timings alone, every frame on time whatever was drawn
      (a fast machine), as the final QA lens's govrepro.js fed them in.
      Each must hold level 0 from start to end, its vsync confirmed and
      never doubted (A4):
        the lens's  an exact 165 Hz trace, and 1, 2 and 3 pairs of a frame
                    late by half a vsync and its catch-up (9.1 then 3.03
                    ms) at frames 0, 40, 400 and 1200 (the governor as
                    shipped read a 3.03 ms vsync and was below full
                    resolution 17-53% of 30 s)
        displays    60, 120, 144 and 165 Hz for 60 s, three seeds each,
                    with realistic jitter: timestamps +-0.2 ms off the
                    grid, 0.2% of frames late by 0.25-0.55 of a vsync and
                    caught up, 0.3% a vsync late, a 60-120 ms stall now and
                    then; and 85 and 200 Hz, rates no common period fits
        whole ms    60, 120, 144, 165 and 240 Hz for 60 s, the timestamps
                    rounded to whole ms (a coarse clock): at 165 Hz one
                    interval in 17 is 7 ms, 0.94 ms off the vsync. 120 Hz
                    takes three probes to confirm, as it did before A4
        the owner's 40 s of the owner's Intel Arc at 165 Hz as the lens
                    recorded it (perf-log.txt; the trace itself was not
                    saved, so rebuilt from its figures): 6581 intervals,
                    12 over 1.5 vsyncs, the shortest 3.1, 3.6, 3.9 and 3.9
                    ms, each the catch-up of a late frame; from its start
                    and from frame 1000, as the lens replayed it (the
                    governor as shipped changed level 11 times in it)
   A3. The pause, with main.js around the governor as a machine sees it: a
      pause stops the frames until the governor's next try (retryIn ms on),
      whose frames go to pausedFrame - a TEST draws the still frame, at its
      cost - and RESUME plays again (resumeAfterPause(now, true)):
        page        drawn frames over 80 ms at the lowest level, the frames
                    that draw nothing one vsync apart: paused once; while
                    it stays slow it never resumes, and the wait between
                    tries doubles (15, 30, 60 s)
        stall       a fast page on a machine where every frame, drawn or
                    not, comes 130 ms late (other processes starving the
                    browser) for 40 s: down to the lowest level, but never
                    paused
        recovery    slow for 20 s, then fast: paused, then resumed by
                    itself at the first try after, at the lowest level,
                    and back at level 0 within 60 s
        busy        a try while the machine is busy (its frames that draw
                    nothing come late): no resume, and the wait not doubled
        its end     the stall ending anywhere from 20 to 60 s in, every 0.5
                    s: never paused. The pause's check judges each clean
                    sample with the drawn frame it follows; judged against
                    the cost that started it, a check that ran on past the
                    end of the stall paused at 29 of these 81 ends
   A4. THE VSYNC, AGAIN (governor.js): a display that changes under the
      running page, run() with m.period.
        changes     a fast page, serial and pipelined, jittered: 165 -> 60,
                    144 -> 60, 240 -> 144, 165 -> 144, 60 -> 165 and 120
                    -> 60 Hz (10 s in, and 5 s in), a 30 fps cap at 60 Hz,
                    a 30 fps cap at 165 Hz lifted 30 s later, and a cap on
                    a 165 Hz grid (every 6th vsync, 36.4 ms). After each,
                    the vsync back within 1% of the new period within 3 s;
                    level 0 from 10 s after it at the latest; no cadence
                    and no drawn interval past the 64 ms clamp once the
                    vsync is back, and before that at most the two probes'
                    (100 ms under a 30 fps cap); at most three probes'
                    frames undrawn. The governor before held the old vsync
                    for good: after 165 -> 60 Hz at 0.75 to the end, under
                    a 30 fps cap at k = 10, 404 frames 66.9 ms apart
        a cadence   a page at k = 3 at 165 Hz when the display goes to 60
                    Hz, or to a 30 fps cap: k of the new vsyncs within the
                    clamp (k = 1) as soon as the vsync is back
        loaded      165 Hz, every frame 145-170 ms for the first 3 s (a
                    page loading on SwiftShader), then 140 ms of GPU a
                    frame, pipelined, 40 seeds: no vsync over VSYNC_MAX
                    confirmed, down within 6 s and not back at level 0
                    (without the bound 35 of 40 confirmed 145-170 ms and
                    stayed at full resolution)
   B. Through the page (harness.js: main.js, the governor, the WebGL
      renderer on the recording stub) on a simulated slow GPU whose cost
      grows with the pixels drawn: the level's drawn size shrinks (its
      corner of the canvas, round(W * res) and LEVEL_MARGIN more: the
      frame's viewport) while the canvas keeps its size - assigned once at
      load and never again by a change of level, which scales it up by a
      CSS transform instead (render-webgl.js, THE LEVELS) - every frame
      that changes level draws (never a blank frame), a cadence leaves
      frames undrawn, and the scene clock keeps real time (motion speed
      unchanged). Through a test hook on the governor's res, a tour of the
      levels: each drawn in its corner under the transform that fills the
      box with it, and nothing allocated on the GPU at all (no buffer,
      texture, renderbuffer or framebuffer, no storage, no canvas size).
      Too slow, it pauses with detail {
      paused: true, reason: 'performance' }, dataset.motion 'paused' and
      nothing saved; played again it runs at the lowest level and does not
      pause again. The page gets fast again: it resumes by itself (detail {
      paused: false, reason: 'performance' }, dataset.motion 'running',
      nothing saved) and draws again. A machine-wide stall: never paused. A
      pause of the visitor's (bgmotion { paused: true }, from the button or
      reduced motion), even over a performance pause: never resumed by the
      governor. ?bgq=<n> draws in its level's corner and paces the frames by
      level, the canvas at level 0's size throughout. Another monitor: the
      window moved from a 165 Hz panel at dpr 1.5 to a 60 Hz monitor at dpr
      1 - the vsync measured again (16.67 ms within 1.5 s), level 0
      throughout, at most two probes' frames undrawn, the canvas 1440x900.
   C. In headless Chrome (SKIP without it): ?bgq=pause pauses at load with
      detail { paused: true, reason: 'performance' }, dataset.motion
      'paused', nothing saved, the motion button pressed and the background
      still; the button (play) sets it moving at the lowest level (res
      0.75, the canvas still at level 0's size) and it never pauses itself
      again. With governor.js's first wait cut to 1.5 s, its test always
      passing and its own pause out of reach (a patched copy, served in its
      place; SwiftShader here would pause it again 3.4-7.5 s after), the
      page at ?bgq=pause resumes by itself: the event, dataset.motion
      'running', the button not pressed, nothing saved, the background
      moving. The page as it ships, on SwiftShader (130-180 ms a frame at
      1440x900@1.5 at full resolution on a quiet machine, 0.3-1 s on a busy
      one; ~17 ms at 0.75): its vsync confirmed within 150 of the page's own
      frames and its resolution stepped down within 20 frames of that, the
      canvas keeping its size. And a change of level costs no frame: with the
      governor's res made to follow window.__res (a wrapper served after
      governor.js), a tour of the levels at 960x600@1.5 - SwiftShader as a
      weak GPU - where the frame that changes level must take at most HITCH
      x the slower of the two levels' median frames (each change measured
      again once if it fails, the machine being shared). Before THE LEVELS
      the canvas was resized and those frames took 1.3-2.2x here, and
      12-36 ms (2-6 vsyncs at 165 Hz) on the owner's Intel Arc.
   Exit 1 on any failure. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const inspector = require('inspector');
const H = require('./harness');

const fails = [], notes = [];
const fail = m => fails.push(m);
const file = path.join(H.ROOT, 'assets', 'js', 'bg', 'governor.js');
if (!fs.existsSync(file)) { console.log('check-governor: SKIP - no ' + file + ' (before W3)'); process.exit(0); }
const SRC = fs.readFileSync(file, 'utf8');

/* the governor alone, in this realm (as on the page: a vm context of its
   own would put every call through a realm boundary, 70x slower), under
   its own file name, for the heap profiler */
const load = vm.runInThisContext('(function (globalThis) {' + SRC + '\n})', { filename: file });
function governor(opts) {
  const g = { Bg: {} };
  load(g);
  return g.Bg.governor(opts);
}
/* a machine (the header): returns the draws { t, level, res, k, vsync,
   sure }, the times of the frames not drawn, the level changes [s, from,
   to], the pause requests, the governor. m.period(s), if given, is the
   display's vsync s seconds in (A4: a display that changes); m.loaded, the
   seconds at the start in which every frame, drawn or not, comes 145-170
   ms after the last, on the vsync grid (A4: a page still loading on a weak
   GPU - SwiftShader as shipped, 151-164 ms a frame then) */
function run(m) {
  const g = governor({ maxRes: m.dpr || 1.5, level: m.level, pause: m.pause });
  const V = 1000 / m.hz;
  let T = 1000, gpuFree = 0, rnd = m.seed || 7;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const draws = [], skips = [], changes = [], pauses = [];
  let last = g.level, frames = 0, ahead = false;
  while (T < 1000 + m.seconds * 1000) {
    const s = (T - 1000) / 1000, P = m.period ? m.period(s) : V;
    let now = T + (m.jitter || 0) * (rand() - 0.5);
    /* a frame late by a quarter to half a vsync; the next is back on the
       grid, its catch-up */
    if (m.late && rand() < m.late) now += P * (0.25 + 0.3 * rand());
    frames++;
    if (g.frame(now)) {
      let c = m.cost(g.res, T - 1000);
      if (m.spikes && rand() < m.spikes) c *= 3;
      gpuFree = Math.max(T, gpuFree) + c;
      draws.push({ t: now, level: g.level, res: g.res, k: g.k, vsync: g.vsync, sure: g.sure });
      if (g.takePause()) { pauses.push({ t: (T - 1000) / 1000, level: g.level }); if (m.onPause) m.onPause(g, now); }
    } else skips.push(now);
    if (g.level !== last) { changes.push([+((T - 1000) / 1000).toFixed(2), last, g.level]); last = g.level; }
    let next = T + P;
    /* pipelined: one frame may start while the GPU is still busy with the
       last drawn one; the frame after it waits */
    if (gpuFree > next) {
      if (m.pipelined && !ahead) ahead = true;
      else next = T + Math.ceil((gpuFree - T) / P - 1e-9) * P;
    } else ahead = false;
    if (m.hiccup && rand() < m.hiccup) next += P * Math.floor(1 + rand() * 3);
    if (m.loaded && s < m.loaded) next = T + Math.ceil((145 + 25 * rand()) / P) * P;
    T = next;
  }
  return { g, draws, skips, changes, pauses, V, frames };
}
const pix = (c0, c1) => res => c0 + c1 * res * res;
/* the share of [from, to) s spent at a level */
function timeAt(r, level, from, to) {
  const ds = r.draws.filter(d => d.t >= 1000 + from * 1000 && d.t < 1000 + to * 1000);
  let at = 0;
  for (let i = 1; i < ds.length; i++) if (ds[i - 1].level === level) at += ds[i].t - ds[i - 1].t;
  return ds.length > 1 ? at / (ds[ds.length - 1].t - ds[0].t) : 0;
}
/* the intervals between drawn frames in [from, to) s */
function intervals(r, from, to) {
  const ds = r.draws.filter(d => d.t >= 1000 + from * 1000 && d.t < 1000 + to * 1000), out = [];
  for (let i = 1; i < ds.length; i++) out.push(ds[i].t - ds[i - 1].t);
  return out;
}
const lv = r => r.changes.map(c => c[1] + '>' + c[2] + '@' + c[0] + 's').join(' ');

/* ---- A. the governor alone ------------------------------------------------ */
for (const hz of [60, 75, 90, 120, 144, 165, 240]) {
  const r = run({ hz, seconds: 20, cost: pix(0.3, 0.6) });
  if (Math.abs(r.g.vsync - 1000 / hz) > 0.01 * (1000 / hz)) fail('fast ' + hz + ' Hz: the vsync is read as ' + r.g.vsync.toFixed(2) + ' ms');
  if (!r.g.sure) fail('fast ' + hz + ' Hz: the vsync is never confirmed');
  if (r.changes.length || r.g.level !== 0) fail('fast ' + hz + ' Hz: the level changed (' + lv(r) + ')');
  if (r.frames - r.draws.length > 2) fail('fast ' + hz + ' Hz: ' + (r.frames - r.draws.length) + ' frames not drawn (one probe, two frames, allowed)');
  const p = run({ hz, seconds: 20, cost: pix(0.3, 0.6), pipelined: true });
  if (p.changes.length || Math.abs(p.g.vsync - 1000 / hz) > 0.01 * (1000 / hz)) fail('fast ' + hz + ' Hz pipelined: vsync ' + p.g.vsync.toFixed(2) + ' ms (' + lv(p) + ')');
}
notes.push('fast 60-240 Hz, serial and pipelined: vsync within 1%, level 0, no change, one probe (two frames) at most');
{
  /* every frame exactly 2 vsyncs at 60 Hz, at every resolution down to 1x */
  const r = run({ hz: 60, seconds: 30, cost: res => (res > 1.01 ? 20 : 9) });
  if (Math.abs(r.g.vsync - 1000 / 60) > 0.2) fail('2 vsyncs at 60 Hz: the vsync is read as ' + r.g.vsync.toFixed(2) + ' ms (a 30 Hz display keeping up?)');
  if (!(r.g.level >= 3 && r.g.k === 1)) fail('2 vsyncs at 60 Hz: still at level ' + r.g.level + ' (' + lv(r) + ')');
  notes.push('a GPU holding every frame to 2 vsyncs of 60 Hz: read as ' + (1000 / r.g.vsync).toFixed(0) + ' Hz, stepped to level ' + r.g.level);
}
{
  const r = run({ hz: 165, seconds: 40, cost: pix(1, 4.5) });
  const first = r.changes[0];
  if (!first || first[2] !== 3 || first[0] > 3) fail('slow 165 Hz: did not go straight to 1x (level 3) within 3 s (' + lv(r) + ')');
  const fails2 = r.changes.filter((c, i) => i > 0 && c[2] > c[1]).length;
  if (fails2 > 2) fail('slow 165 Hz: ' + fails2 + ' failed attempts to go back up in 40 s (' + lv(r) + ')');
  if (r.changes[1] && r.changes[1][0] - first[0] < 4.5) fail('slow 165 Hz: changed again ' + (r.changes[1][0] - first[0]).toFixed(1) + ' s after settling');
  const share = timeAt(r, 3, 3, 40);
  if (!(share >= 0.85)) fail('slow 165 Hz: only ' + (100 * share).toFixed(0) + '% of the time at the level that fits');
  notes.push('slow 165 Hz: 0 > 3 at ' + first[0] + ' s, ' + (100 * share).toFixed(0) + '% there, ' + fails2 + ' failed attempts in 40 s');
}
{
  /* drawn frames over budget at level 0 (1.6 vsyncs of work, 2 vsyncs a
     frame), 1x fits (0.8 vsyncs): jittered, with late frames and catch-ups */
  const got = [];
  for (const hz of [60, 120, 144, 165]) {
    const V = 1000 / hz;
    const r = run({ hz, seconds: 15, cost: pix(0.2 * V, 1.4 * V / 2.25), jitter: 0.4, late: 0.003, seed: hz });
    const first = r.changes[0];
    if (!first || first[0] > 3 || first[2] < 2) fail('slow ' + hz + ' Hz, jittered: not down to a level that fits within 3 s (' + lv(r) + ')');
    else got.push(hz + ' Hz ' + first[0] + ' s');
  }
  notes.push('slow, jittered, with catch-ups: down within ' + got.join(', '));
  /* pipelined, 140 ms of GPU a frame at level 0 (SwiftShader as shipped) and 3 vsyncs of it */
  const pip = [];
  for (const [hz, c] of [[165, 140], [60, 140], [165, 3 * 1000 / 165], [60, 3 * 1000 / 60]]) {
    const r = run({ hz, seconds: 15, cost: res => c * (res / 1.5) * (res / 1.5), pipelined: true, jitter: 0.2 });
    const first = r.changes[0];
    if (Math.abs(r.g.vsync - 1000 / hz) > 0.01 * (1000 / hz)) fail('slow ' + hz + ' Hz pipelined (' + c.toFixed(0) + ' ms a frame): the vsync read as ' + r.g.vsync.toFixed(2) + ' ms');
    /* six drawn frames make a window: 0.84 s of them at 140 ms, after the estimate at 2 s */
    const by = c > 50 ? 4 : 3;
    if (!first || first[0] > by) fail('slow ' + hz + ' Hz pipelined (' + c.toFixed(0) + ' ms a frame): not down within ' + by + ' s (' + lv(r) + ')');
    else pip.push(hz + ' Hz ' + c.toFixed(0) + ' ms ' + first[0] + ' s');
  }
  notes.push('slow and pipelined: the vsync within 1%, down within ' + pip.join(', '));
}
for (const [hz, c1, k] of [[165, 20, 3], [60, 40, 2]]) {
  const r = run({ hz, seconds: 30, cost: pix(hz === 165 ? 1.5 : 2, c1) });
  const iv = intervals(r, 20, 30), want = k * 1000 / hz;
  const off = iv.filter(v => Math.abs(v - want) > 0.5);
  if (r.g.k !== k || r.g.level !== 3 + k) fail('very slow ' + hz + ' Hz: ended at level ' + r.g.level + ' (k ' + r.g.k + '), not k = ' + k + ' (' + lv(r) + ')');
  if (off.length) fail('very slow ' + hz + ' Hz: ' + off.length + ' of ' + iv.length + ' drawn frames not ' + want.toFixed(2) + ' ms apart (' + off.slice(0, 3).map(v => v.toFixed(2)).join(', ') + ')');
  if (r.changes.length > 3) fail('very slow ' + hz + ' Hz: ' + r.changes.length + ' changes (' + lv(r) + ')');
  notes.push(hz + ' Hz very slow: k = ' + r.g.k + ', ' + (1000 / want).toFixed(0) + ' fps, every frame ' + want.toFixed(2) + ' ms apart');
}
{
  const r = run({ hz: 165, seconds: 120, cost: pix(0.6, 2.62), jitter: 0.4 });
  const ups = r.changes.filter(c => c[2] < c[1]).map(c => c[0]);
  const waits = ups.slice(2).map((t, i) => t - ups[i + 1]);
  const settled = r.changes.length ? r.changes[r.changes.length - 1][2] : 0;
  const share = timeAt(r, settled, 5, 120);
  if (ups.length > 6) fail('edge: ' + ups.length + ' attempts to go up in 120 s (' + lv(r) + ')');
  for (let i = 1; i < waits.length; i++) if (waits[i] < 1.9 * waits[i - 1]) fail('edge: the wait before trying again did not grow (' + waits.map(w => w.toFixed(1)).join(', ') + ' s)');
  if (!(share >= 0.8)) fail('edge: only ' + (100 * share).toFixed(0) + '% of the time at the settled level ' + settled + ' (' + lv(r) + ')');
  notes.push('edge: settled at level ' + settled + ' ' + (100 * share).toFixed(0) + '% of the time, ' + r.changes.length + ' changes in 120 s');
}
for (const [hz, c1, spikes, jitter, hiccup] of [[165, 1.5, 0.04, 0.6, 0.01], [60, 4, 0.05, 1.0, 0.01]]) {
  const r = run({ hz, seconds: 60, cost: pix(0.5, c1), spikes, jitter, hiccup });
  if (r.changes.length) fail('noisy ' + hz + ' Hz: the level changed (' + lv(r) + ')');
}
notes.push('noisy 165 and 60 Hz: no change');
{
  const r = run({ hz: 165, seconds: 80, cost: (res, t) => (t < 20000 ? pix(1, 12)(res) : pix(0.5, 1)(res)) });
  const after = r.changes.filter(c => c[0] >= 20);
  if (after.some(c => c[2] > c[1])) fail('recovering: stepped down after the load dropped (' + lv(r) + ')');
  for (let i = 1; i < after.length; i++) if (after[i][0] - after[i - 1][0] < 4.9) fail('recovering: two steps up ' + (after[i][0] - after[i - 1][0]).toFixed(1) + ' s apart');
  const back = after.find(c => c[2] === 0);
  if (!back || back[0] > 60) fail('recovering: not back at level 0 within 40 s of the load dropping (' + lv(r) + ')');
  notes.push('recovering: back to level 0 ' + (back ? (back[0] - 20).toFixed(0) : '?') + ' s after the load dropped, one level at a time');
}
{
  let resumedAt = null;
  const r = run({ hz: 60, seconds: 40, cost: pix(20, 200),
                  onPause: (g, now) => { if (resumedAt === null) { resumedAt = now; g.resumeAfterPause(now); } } });
  if (r.pauses.length !== 1) fail('too slow: ' + r.pauses.length + ' pause requests (need exactly 1)');
  else {
    const p = r.pauses[0], lowest = 3 + Math.floor(64 / (1000 / 60));
    if (p.level !== lowest) fail('too slow: the pause was asked for at level ' + p.level + ', not the lowest animated one (' + lowest + ')');
    const afterLevels = new Set(r.draws.filter(d => d.t > resumedAt).map(d => d.level));
    if (afterLevels.size !== 1 || !afterLevels.has(lowest)) fail('too slow: after playing again the levels were ' + [...afterLevels].join(', '));
    notes.push('too slow: paused once at ' + p.t.toFixed(1) + ' s at the lowest level (' + lowest + '), played again it stays there, no second pause');
  }
}
{
  const r = run({ hz: 60, seconds: 10, dpr: 1, cost: pix(4, 30) });
  if (r.changes.some(c => c[2] >= 1 && c[2] <= 3 && c[1] !== c[2])) fail('dpr 1: stepped through levels 1-3, which are all 1x there (' + lv(r) + ')');
}
for (const level of [0, 2, 4, 5, 6, 7]) {
  for (const hz of [60, 165]) {
    const r = run({ hz, seconds: 6, level, cost: pix(30, 60) });
    /* held as asked, but never past the dt clamp (level 7 at 60 Hz is
       4 x 16.7 ms: held at k = 3 once the vsync is known) */
    const k = Math.min(level <= 4 ? 1 : level - 3, Math.floor(64 / (1000 / hz))), want = level <= 4 ? level : 3 + k;
    if (r.g.level !== want || r.changes.some(c => c[0] > 2)) fail('held level ' + level + ' at ' + hz + ' Hz: at level ' + r.g.level + ', not ' + want + ' (' + lv(r) + ')');
    if (level >= 5) {
      const fast = run({ hz, seconds: 6, level, cost: pix(0.2, 0.2) });
      const iv = intervals(fast, 1, 6), want = k * 1000 / hz;
      if (iv.some(v => Math.abs(v - want) > 1e-6)) fail('held level ' + level + ' at ' + hz + ' Hz: frames not exactly ' + want.toFixed(2) + ' ms apart');
    }
  }
}
{
  const g = governor({ maxRes: 1.5, pause: true });
  let asked = -1;
  for (let i = 0; i < 10 && asked < 0; i++) if (g.frame(1000 + i * 16.67) && g.takePause()) asked = i;
  if (asked !== 0) fail('?bgq=pause: the pause was asked for on frame ' + asked + ', not the first');
}
{
  for (const [hz, kMax] of [[60, 3], [30, 1], [144, 9], [165, 10]]) {
    const r = run({ hz, seconds: 20, cost: pix(30, 400) });
    const most = Math.max(...r.draws.map(d => d.k));
    if (most > kMax) fail('the clamp: a cadence of ' + most + ' at ' + hz + ' Hz, ' + (most * 1000 / hz).toFixed(0) + ' ms a step, past the scene\'s 64 ms dt clamp');
  }
}
{
  /* Its own cost: animation frames at 165 Hz, the vsync confirmed, after
     200,000 to warm up; COST_MAX ns at most. Timed as COST_REPS runs of
     COST_N frames each (a million, as before), the best run the figure: a
     run the process spends waiting for the CPU times the machine, not the
     governor. A single run of the million took 1309 ns a frame in a
     run-all beside other agents' checks, where the governor alone took
     112-136 (the final regression review). A run here is a few ms, a
     scheduler's slice 15 ms or more, so even on a busy machine some run
     goes unpreempted. If even the best is over the limit while the machine
     looks busy - the runs' median over COST_SPREAD x the best, or the
     process given under COST_CPU of a CPU over the round - it is measured
     again, a second apart, up to COST_ROUNDS rounds; on a quiet machine
     an over-limit best fails at once. */
  const COST_N = 40000, COST_REPS = 25, COST_ROUNDS = 6, COST_SPREAD = 1.5, COST_CPU = 0.5, COST_MAX = 1000;
  const g = governor({ maxRes: 1.5 });
  let t = 0;
  for (let i = 0; i < 200000; i++) { t += 6.06; g.frame(t); }
  const round = () => {
    const per = [];
    const c0 = process.cpuUsage(), w0 = process.hrtime.bigint();
    for (let r = 0; r < COST_REPS; r++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < COST_N; i++) { t += 6.06; g.frame(t); g.res; }
      per.push(Number(process.hrtime.bigint() - t0) / COST_N);
    }
    const wall = Number(process.hrtime.bigint() - w0) / 1e3, used = process.cpuUsage(c0);
    per.sort((a, b) => a - b);
    return { best: per[0], median: per[per.length >> 1], cpu: (used.user + used.system) / wall };
  };
  const busy = m => m.median > COST_SPREAD * m.best || m.cpu < COST_CPU;
  let m = round(), rounds = 1, best = m.best;
  while (!(best < COST_MAX) && busy(m) && rounds < COST_ROUNDS) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    m = round(); rounds++;
    best = Math.min(best, m.best);
  }
  const how = 'the best of ' + rounds * COST_REPS + ' runs of ' + COST_N + ', their median ' + m.median.toFixed(0)
              + (rounds > 1 ? ', ' + rounds + ' rounds on a busy machine' : '');
  if (!(best < COST_MAX)) {
    fail('cost: ' + best.toFixed(0) + ' ns an animation frame (limit ' + COST_MAX + '; ' + how + ', '
         + (busy(m) ? 'busy throughout: ' + (100 * m.cpu).toFixed(0) + '% of a CPU in the last round' : 'on a quiet machine') + ')');
  }
  notes.push('cost ' + best.toFixed(0) + ' ns an animation frame (' + how + ')');
}

/* ---- A2. replays -------------------------------------------------------------
   Frame timings alone: every frame comes when the trace says, whatever the
   governor drew (a fast machine), as govrepro.js fed them in. */
function replay(ivs) {
  const g = governor({ maxRes: 1.5 });
  let t = 1000, below = 0, last = g.level, skipped = 0, was = false, doubts = 0;
  const changes = [];
  for (let i = 0; i < ivs.length; i++) {
    if (!g.frame(t)) skipped++;
    /* confirmed, then not: doubted, and measured again (THE VSYNC, AGAIN) */
    if (was && !g.sure) doubts++;
    was = g.sure;
    if (g.res < 1.5) below++;
    if (g.level !== last) { changes.push(((t - 1000) / 1000).toFixed(2) + ' s ' + last + '>' + g.level + ' (vsync ' + g.vsync.toFixed(2) + ')'); last = g.level; }
    t += ivs[i];
  }
  return { g, below: below / ivs.length, changes, skipped, doubts };
}
const P165 = 1000 / 165;
/* a display at hz for s seconds (A2's header): frames on its vsync grid */
function display(hz, s, o) {
  const P = 1000 / hz;
  let rnd = o.seed || 11, k = 0;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const times = [];
  while (k * P < s * 1000) {
    let t = k * P + (rand() - 0.5) * 2 * o.jitter;
    if (rand() < o.late) t += P * (0.25 + 0.3 * rand());
    times.push(t);
    k += rand() < o.drop ? 2 : 1;
    if (o.stallEvery && rand() < P / (o.stallEvery * 1000)) k += Math.round((60 + 60 * rand()) / P);
  }
  return times.slice(1).map((t, i) => t - times[i]);
}
/* the owner's 40 s (A2's header), rebuilt from the lens's figures */
function owners() {
  let rnd = 5;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const a = [];
  for (let i = 0; i < 6581; i++) a.push(P165 + (rand() - 0.5) * 0.1);
  for (let j = 0; j < 12; j++) a[300 + j * 520] = 2 * P165;
  for (const [i, c] of [[900, 3.1], [2300, 3.6], [3700, 3.9], [5100, 3.9]]) { a[i] = 2 * P165 - c; a[i + 1] = c; }
  return a;
}
/* skip: the frames a probe may leave undrawn (two probes of two frames) */
function holds(label, ivs, want, skip) {
  const r = replay(ivs), most = skip || 4;
  if (r.changes.length || r.below > 0) fail(label + ': below full resolution ' + (100 * r.below).toFixed(1) + '% of the time (' + r.changes.join(', ') + ')');
  if (!r.g.sure) fail(label + ': the vsync never confirmed');
  else if (want && Math.abs(r.g.vsync - want) > 0.01 * want) fail(label + ': the vsync read as ' + r.g.vsync.toFixed(3) + ' ms, not ' + want.toFixed(3));
  if (r.skipped > most) fail(label + ': ' + r.skipped + ' frames not drawn at level 0 (at most ' + most / 2 + ' probes of two frames)');
  if (r.doubts) fail(label + ': the vsync doubted ' + r.doubts + ' times on a display that never changed (THE VSYNC, AGAIN)');
  return r;
}
{
  holds('replay, exact 165 Hz', new Array(165 * 30).fill(P165), P165);
  let n = 0;
  for (const pairs of [1, 2, 3]) {
    for (const at of [0, 40, 400, 1200]) {
      const a = new Array(165 * 30).fill(P165);
      for (let p = 0; p < pairs; p++) { a[at + 37 * p] = 9.1; a[at + 37 * p + 1] = 3.03; }
      holds('replay, ' + pairs + ' pair(s) of 9.1/3.03 ms from frame ' + at, a, P165);
      n++;
    }
  }
  notes.push('replays: exact 165 Hz and ' + n + ' traces with 1-3 late frames and their 3.03 ms catch-ups held level 0 throughout, the vsync never doubted');
}
{
  let n = 0;
  for (const hz of [60, 120, 144, 165]) {
    for (const seed of [11, 23, 37]) {
      holds('replay, ' + hz + ' Hz jittered (seed ' + seed + ')', display(hz, 60, { jitter: 0.2, late: 0.002, drop: 0.003, stallEvery: 15, seed }), 1000 / hz);
      n++;
    }
  }
  for (const hz of [85, 200]) holds('replay, ' + hz + ' Hz jittered', display(hz, 30, { jitter: 0.2, late: 0.002, drop: 0.003, seed: hz }));
  /* timestamps rounded to whole ms, as a browser with a coarse clock gives
     them: at 165 Hz one interval in 17 is 7 ms, 0.94 ms off the vsync. Not
     doubted once confirmed; confirming takes 120 Hz three probes here (8,
     8, 9 ms: two that agree), as it did before THE VSYNC, AGAIN */
  for (const hz of [60, 120, 144, 165, 240]) {
    const ts = [];
    for (let k = 0; k <= hz * 60; k++) ts.push(Math.round(k * 1000 / hz));
    holds('replay, ' + hz + ' Hz in whole ms', ts.slice(1).map((t, i) => t - ts[i]), 1000 / hz, 6);
  }
  notes.push(n + ' jittered 60-165 Hz traces of 60 s, 85 and 200 Hz, and 60-240 Hz in whole ms: level 0 throughout, never doubted');
}
{
  const a = owners();
  const iv = a.filter(v => v > 1.5 * P165).length, short = a.slice().sort((x, y) => x - y).slice(0, 4).map(v => v.toFixed(1));
  if (iv !== 12 || short.join() !== '3.1,3.6,3.9,3.9') fail('the owner\'s trace is not as the lens recorded it (' + iv + ' over 1.5 vsyncs, the shortest ' + short.join(', ') + ')');
  holds('replay, the owner\'s 40 s', a, P165);
  holds('replay, the owner\'s 40 s from frame 1000', a.slice(1000), P165);
  notes.push('the owner\'s 40 s at 165 Hz (rebuilt: 6581 intervals, ' + iv + ' over 1.5 vsyncs, shortest ' + short.join('/') + ' ms): level 0 throughout, from its start and from frame 1000');
}

/* ---- A3. the pause, with main.js around the governor ------------------------
   m: hz, seconds, cost(res, s) per drawn frame; stall(s), ms every frame
   comes late, drawn or not (the machine's own); onResume(g, s) */
function paused(m) {
  const g = governor({ maxRes: 1.5 });
  const V = 1000 / m.hz;
  let T = 1000, gpuFree = 0, off = false, wakeAt = 0;
  const events = [];
  while (T < 1000 + m.seconds * 1000) {
    const s = (T - 1000) / 1000;
    if (!off) {
      if (g.frame(T)) {
        gpuFree = Math.max(T, gpuFree) + m.cost(g.res, s);
        if (g.takePause()) { off = true; wakeAt = T + g.retryIn; events.push({ s, what: 'pause', level: g.level, wait: g.retryIn }); }
      }
    } else if (T >= wakeAt) {
      const a = g.pausedFrame(T);
      if (a === g.TEST) gpuFree = Math.max(T, gpuFree) + m.cost(g.res, s);
      else if (a === g.RESUME) { off = false; g.resumeAfterPause(T, true); events.push({ s, what: 'resume', level: g.level }); }
      else if (a === g.DONE) { wakeAt = T + g.retryIn; events.push({ s, what: 'wait', wait: g.retryIn }); }
    } else {
      /* paused between tries: no frames at all */
      T = wakeAt;
      continue;
    }
    let next = T + V + (m.stall ? m.stall(s) : 0);
    if (gpuFree > next) next = T + Math.ceil((gpuFree - T) / V - 1e-9) * V;
    T = next;
  }
  return { g, events };
}
const ev = r => r.events.map(e => e.what + '@' + e.s.toFixed(1) + (e.wait ? '(' + (e.wait / 1000) + 's)' : '')).join(' ');
{
  const r = paused({ hz: 60, seconds: 130, cost: pix(20, 200) });
  const pauses = r.events.filter(e => e.what === 'pause'), resumes = r.events.filter(e => e.what === 'resume');
  const waits = r.events.filter(e => e.what === 'wait').map(e => e.wait / 1000);
  if (pauses.length !== 1) fail('pause, a slow page: ' + pauses.length + ' pauses (need 1: ' + ev(r) + ')');
  if (resumes.length) fail('pause, a slow page: resumed while still too slow (' + ev(r) + ')');
  if (waits.length < 2 || waits.some((w, i) => w !== 15 * Math.pow(2, i + 1))) fail('pause, a slow page: the waits between tries were ' + waits.join(', ') + ' s (need 30, 60, ...)');
  notes.push('a slow page: paused at ' + (pauses[0] ? pauses[0].s.toFixed(1) : '?') + ' s, never resumed while slow, tries ' + [15].concat(waits.slice(0, -1)).join(', ') + ' s apart');
}
{
  const r = paused({ hz: 60, seconds: 60, cost: pix(0.3, 0.6), stall: s => (s >= 5 && s < 45 ? 130 : 0) });
  const pauses = r.events.filter(e => e.what === 'pause');
  if (pauses.length) fail('pause, a machine-wide stall: paused (' + ev(r) + ')');
  notes.push('a machine-wide stall (every frame 130 ms late for 40 s): no pause, back at level ' + r.g.level + ' 15 s after');
}
{
  /* the same stall ending anywhere from 20 to 60 s in: a pause's check that
     runs on past its end judges each clean sample with the drawn frame it
     follows (THE PAUSE), and those are fast again */
  const hit = [];
  for (let end = 20; end <= 60; end += 0.5) {
    const r = paused({ hz: 60, seconds: end + 15, cost: pix(0.3, 0.6), stall: s => (s >= 5 && s < end ? 130 : 0) });
    if (r.events.some(e => e.what === 'pause')) hit.push(end);
  }
  if (hit.length) fail('pause, the end of a machine-wide stall: paused when it ended at ' + hit.join(', ') + ' s (' + hit.length + ' of 81, 20-60 s in)');
  notes.push('the same stall ending at 20-60 s in, every 0.5 s: no pause in 81');
}

/* ---- A4. THE VSYNC, AGAIN: a display that changes under the page -----------
   run()'s machines with m.period: the vsync changes at the given seconds,
   as when the window moves to another monitor, or the browser caps the
   frame rate (energy saver: 30 fps) and lifts the cap again. */
const VSYNC_MAX = +((/\bVSYNC_MAX = (\d+(?:\.\d+)?)/.exec(SRC) || [])[1]);
if (!(VSYNC_MAX > 0)) fail('governor.js has no VSYNC_MAX');
/* a run's span from a change at s = from to the next (s = to): when the
   vsync was back for good - confirmed within 1% of want, and within 1% from
   then on (measured again later, it paces by the one it had meanwhile) -
   in s after the change; the share of the span below level 0, and the
   frames below it from 10 s after the change; the drawn intervals over the
   64 ms clamp in it, and those after the vsync was back; the frames drawn
   at a cadence past the clamp (k x want) after it was back; the frames
   not drawn */
function span(r, from, to, want) {
  const lo = 1000 + from * 1000, hi = 1000 + to * 1000, CLAMP = 64 + 1e-6;
  const ds = r.draws.filter(d => d.t >= lo && d.t < hi);
  let back = null;
  for (const d of ds) {
    if (Math.abs(d.vsync - want) > 0.01 * want) back = null;
    else if (back === null && d.sure) back = d.t;
  }
  const prior = r.draws.filter(d => d.t < lo).pop();
  let prev = prior ? prior.t : null, below = 0, over = 0, overAfter = 0, longest = 0, pastClamp = 0;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    if (prev !== null) {
      const iv = d.t - prev;
      longest = Math.max(longest, iv);
      if (iv > CLAMP) { over++; if (back !== null && prev >= back) overAfter++; }
    }
    if (i + 1 < ds.length && d.level !== 0) below += ds[i + 1].t - d.t;
    if (back !== null && d.t >= back && d.k * want > CLAMP) pastClamp++;
    prev = d.t;
  }
  return {
    back: back === null ? null : (back - lo) / 1000, below: ds.length > 1 ? below / (ds[ds.length - 1].t - ds[0].t) : 0,
    late: ds.filter(d => d.t >= lo + 10000 && d.level !== 0).length, over, overAfter, longest, pastClamp,
    skipped: r.skips.filter(t => t >= lo && t < hi).length
  };
}
{
  /* a fast page (level 0 fits every display here), serial and pipelined,
     jittered: after each change the vsync back within 1% of the new
     period within 3 s, level 0 from 10 s after it at the latest, and no
     cadence or drawn interval past the clamp once the vsync is back -
     before that at most the probes' two (two frames that draw nothing
     under a 30 fps cap: 100 ms) */
  const most = { back: 0, below: 0, over: 0, skipped: 0 };
  let n = 0;
  for (const [label, hz, steps] of [
    ['165 -> 60 Hz', 165, [[10, 60]]],
    ['144 -> 60 Hz', 144, [[10, 60]]],
    ['240 -> 144 Hz', 240, [[10, 144]]],
    ['165 Hz -> a 30 fps cap -> 165 Hz', 165, [[10, 30], [40, 165]]],
    ['165 -> 144 Hz', 165, [[10, 144]]],
    ['60 -> 165 Hz', 60, [[10, 165]]],
    ['120 -> 60 Hz', 120, [[10, 60]]],
    ['120 -> 60 Hz, 5 s in', 120, [[5, 60]]],
    ['60 Hz -> a 30 fps cap', 60, [[10, 30]]],
    ['165 Hz -> a 30 fps cap on its grid (every 6th vsync, 36.4 ms)', 165, [[10, 165 / 6]]]
  ]) {
    const period = s => { let p = 1000 / hz; for (const [at, to] of steps) if (s >= at) p = 1000 / to; return p; };
    const end = steps[steps.length - 1][0] + 25;
    for (const pipelined of [false, true]) {
      const r = run({ hz, period, seconds: end, cost: pix(0.3, 0.6), pipelined, jitter: 0.2 });
      for (let i = 0; i < steps.length; i++) {
        const [at, to] = steps[i], want = 1000 / to, q = span(r, at, i + 1 < steps.length ? steps[i + 1][0] : end, want);
        const tag = 'a display that changes, ' + label + (pipelined ? ', pipelined' : '') + (steps.length > 1 ? ' (at ' + at + ' s)' : '');
        if (q.back === null || q.back > 3) fail(tag + ': the vsync not back within 1% of ' + want.toFixed(2) + ' ms within 3 s (' + (q.back === null ? 'not at all' : q.back.toFixed(2) + ' s') + '; ' + r.g.vsync.toFixed(2) + ' ms at the end, ' + lv(r) + ')');
        if (q.late) fail(tag + ': below level 0 in ' + q.late + ' frames from 10 s after the change (' + lv(r) + ')');
        if (q.overAfter || q.pastClamp) fail(tag + ': ' + q.overAfter + ' drawn intervals and ' + q.pastClamp + ' frames at a cadence past the 64 ms clamp once the vsync was back');
        if (q.over > 2) fail(tag + ': ' + q.over + ' drawn intervals past the 64 ms clamp, the longest ' + q.longest.toFixed(1) + ' ms (the two probes make two)');
        if (q.skipped > 6) fail(tag + ': ' + q.skipped + ' frames not drawn after the change (three probes of two frames at most)');
        most.back = Math.max(most.back, q.back || 0); most.below = Math.max(most.below, q.below);
        most.over = Math.max(most.over, q.over); most.skipped = Math.max(most.skipped, q.skipped);
        n++;
      }
    }
  }
  notes.push('a display that changes (165 and 144 -> 60, 240 and 165 -> 144, 60 -> 165, 120 -> 60 Hz, a 30 fps cap at 60 and at 165 Hz and lifted, a cap on a 165 Hz grid; serial and pipelined; '
             + n + ' changes): the vsync back within 1% in ' + most.back.toFixed(2) + ' s at most, below level 0 ' + (100 * most.below).toFixed(1) + '% of the time after a change at most, '
             + most.skipped + ' frames not drawn, ' + most.over + ' drawn intervals over 64 ms (the probes under a 30 fps cap) and none once the vsync was back');
}
{
  /* a page at a cadence when the display changes: k = 3 at 165 Hz (very
     slow), then 60 Hz or a 30 fps cap - k of the new vsyncs within the
     clamp as soon as the vsync is back. (Its frames can still take longer:
     under the cap it goes back up to level 0 in time, where a frame takes
     46.5 ms, two of the cap's, and steps down again: the page's own cost.) */
  const got = [];
  for (const [label, to] of [['165 -> 60 Hz', 60], ['165 Hz -> a 30 fps cap', 30]]) {
    const r = run({ hz: 165, period: s => (s < 20 ? P165 : 1000 / to), seconds: 45, cost: pix(1.5, 20) });
    const at = r.draws.filter(d => d.t < 21000).pop(), want = 1000 / to, q = span(r, 20, 45, want), tag = 'a cadence when the display changes, ' + label;
    if (!at || at.k !== 3) fail(tag + ': at k = ' + (at ? at.k : '?') + ' before the change, not 3 (' + lv(r) + ')');
    if (q.back === null || q.back > 3) fail(tag + ': the vsync not back within 1% of ' + want.toFixed(2) + ' ms within 3 s (' + r.g.vsync.toFixed(2) + ' ms at the end)');
    if (q.pastClamp) fail(tag + ': ' + q.pastClamp + ' frames at a cadence past the 64 ms clamp once the vsync was back');
    const after = r.draws.find(d => d.t >= 1000 + (20 + q.back) * 1000);
    got.push(label + ' k = 3 -> ' + (after ? after.k : '?') + ' at once (' + (q.back || 0).toFixed(2) + ' s)');
  }
  notes.push('a cadence when the display changes: ' + got.join(', ') + ', no cadence past the clamp');
}
{
  /* a loaded start (m.loaded): for 3 s every frame, drawn or not, comes
     145-170 ms after the last, then 140 ms of GPU a frame, pipelined
     (SwiftShader as shipped) - the probes' samples are held too, two of
     them agree, and they may not become the vsync (VSYNC_MAX). Without the
     bound, 35 of these 40 starts confirmed 145-170 ms, and their page, at
     140 ms a frame, stayed at full resolution (headless Chrome: 2 of 6
     loads, 151-236 ms, "res still 1.5 after 12 s" in part C) */
  let long = 0, worst = 0;
  const slow = [];
  for (let seed = 1; seed <= 40; seed++) {
    const r = run({ hz: 165, seconds: 12, seed, loaded: 3, pipelined: true, cost: res => 140 * (res / 1.5) * (res / 1.5) });
    if (r.draws.some(d => d.sure && d.vsync > VSYNC_MAX)) long++;
    const first = r.changes[0];
    if (!first || first[0] > 6 || !r.g.level) slow.push(seed + ' (' + lv(r) + ')');
    else worst = Math.max(worst, first[0]);
    if (!r.g.sure || Math.abs(r.g.vsync - P165) > 0.01 * P165) fail('a loaded start (seed ' + seed + '): the vsync ' + r.g.vsync.toFixed(2) + ' ms at the end' + (r.g.sure ? '' : ', unconfirmed'));
  }
  if (long) fail('a loaded start: a vsync over ' + VSYNC_MAX + ' ms confirmed in ' + long + ' of 40 starts');
  if (slow.length) fail('a loaded start: not down within 6 s, or back at level 0, in ' + slow.length + ' of 40 (seed ' + slow.slice(0, 3).join(', ') + ')');
  notes.push('a loaded start at 165 Hz (frames 145-170 ms for 3 s, then 140 ms a frame), 40 of them: no vsync over ' + VSYNC_MAX + ' ms confirmed, all down within ' + worst.toFixed(2) + ' s');
}
{
  let at = null;
  const r = paused({ hz: 60, seconds: 120, cost: (res, s) => (s < 20 ? pix(20, 200)(res) : pix(0.3, 0.6)(res)) });
  const p = r.events.find(e => e.what === 'pause'), q = r.events.find(e => e.what === 'resume');
  const lowest = 3 + Math.floor(64 / (1000 / 60));
  if (!p || !q) fail('pause, recovery: ' + (p ? 'never resumed' : 'never paused') + ' (' + ev(r) + ')');
  else {
    at = q.s;
    if (q.s > Math.max(p.s + 15, 20) + 15 + 2) fail('pause, recovery: resumed only at ' + q.s.toFixed(1) + ' s, not at the first try after the load dropped (' + ev(r) + ')');
    if (q.level !== lowest) fail('pause, recovery: resumed at level ' + q.level + ', not the lowest (' + lowest + ')');
    if (r.g.level !== 0) fail('pause, recovery: at level ' + r.g.level + ' 120 s in, not back at 0');
  }
  notes.push('recovery: paused at ' + (p ? p.s.toFixed(1) : '?') + ' s, the load gone at 20 s, resumed by itself at ' + (at ? at.toFixed(1) : '?') + ' s at the lowest level, at level ' + r.g.level + ' by 120 s');
}
{
  /* busy during its first try: the frames that draw nothing 40 ms late */
  const r = paused({ hz: 60, seconds: 50, cost: (res, s) => (s < 20 ? pix(20, 200)(res) : pix(0.3, 0.6)(res)),
                     stall: s => (s >= 20 && s < 26 ? 40 : 0) });
  const p = r.events.find(e => e.what === 'pause'), w = r.events.find(e => e.what === 'wait'), q = r.events.find(e => e.what === 'resume');
  if (!p || !w || w.wait !== 15000 || !q) fail('pause, busy at a try: ' + ev(r) + ' (need a pause, a try that waits 15 s more, then a resume)');
  else notes.push('a try while the machine is busy: no resume, the same 15 s wait, resumed at the next');
}

/* what it allocates, by state (the header: cost): a machine as run() has
   it, stepped one animation frame at a time, reading what main.js reads */
const ALLOC_MAX = 1;
function stepper(m) {
  const g = governor({ maxRes: m.dpr || 1.5, level: m.level });
  const V = 1000 / m.hz;
  let T = 1000, gpuFree = 0, pauses = 0;
  const step = () => {
    if (g.frame(T)) {
      gpuFree = Math.max(T, gpuFree) + m.cost(g.res);
      if (g.takePause()) { pauses++; g.resumeAfterPause(T); }
    }
    const P = m.period ? m.period((T - 1000) / 1000) : V;
    let next = T + P;
    if (gpuFree > next) next = T + Math.ceil((gpuFree - T) / P - 1e-9) * P;
    T = next;
  };
  return { g, step, pauses: () => pauses };
}
async function allocation() {
  const states = [
    ['fast at 165 Hz', { hz: 165, cost: pix(0.3, 0.6) }, g => g.level === 0],
    ['fast at 60 Hz', { hz: 60, cost: pix(0.3, 0.6) }, g => g.level === 0],
    ['at a cadence', { hz: 165, cost: pix(1.5, 18) }, g => g.k > 1],
    ['held at ?bgq=6', { hz: 165, level: 6, cost: pix(0.3, 0.6) }, g => g.k === 3],
    ['the lowest level, after the pause', { hz: 60, cost: pix(30, 400) }, (g, M) => M.pauses() === 1 && g.k === 3],
    /* measured again every 3 s (THE VSYNC, AGAIN) */
    ['a display that keeps changing', { hz: 165, period: s => (Math.floor(s / 3) % 2 ? 1000 / 60 : 1000 / 165), cost: pix(0.3, 0.6) }, g => g.level === 0]
  ];
  const s = new inspector.Session();
  s.connect();
  const post = (m, p) => new Promise((res, rej) => s.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
  const FRAMES = 100000, WINDOWS = 3, got = [];
  try {
    await post('HeapProfiler.enable');
    for (const [name, m, where] of states) {
      const M = stepper(m);
      for (let i = 0; i < 300000; i++) M.step();
      if (!where(M.g, M)) { fail('allocation, ' + name + ': the machine is not in that state (level ' + M.g.level + ', k ' + M.g.k + ')'); continue; }
      let best = null;
      for (let w = 0; w < WINDOWS; w++) {
        await post('HeapProfiler.collectGarbage');
        for (let i = 0; i < 50000; i++) M.step();
        await post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        for (let i = 0; i < FRAMES; i++) M.step();
        const { profile } = await post('HeapProfiler.stopSampling');
        const by = new Map();
        let total = 0;
        (function walk(n, under) {
          const f = n.callFrame, mine = /(^|[\\/])governor\.js$/.test(f.url || ''), into = under || mine;
          if (into && n.selfSize) {
            total += n.selfSize;
            const k = (f.functionName || '(anon)') + (mine ? '' : ' (builtin)');
            by.set(k, (by.get(k) || 0) + n.selfSize);
          }
          for (const c of n.children) walk(c, into);
        })(profile.head, false);
        if (!best || total < best.total) best = { total, by };
      }
      const per = best.total / FRAMES;
      got.push(name + ' ' + per.toFixed(1));
      if (!(per < ALLOC_MAX)) fail('allocation, ' + name + ': ' + per.toFixed(1) + ' B an animation frame (limit ' + ALLOC_MAX + ', the best of ' + WINDOWS + ' windows): '
                                   + [...best.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + (v / FRAMES).toFixed(1)).join(', '));
    }
  } finally { s.disconnect(); }
  notes.push('allocated per animation frame (B): ' + got.join(', '));
}

/* ---- B. through the page ---------------------------------------------------- */
/* the size a frame draws its scene at (the first viewport of its GL calls:
   the level's offscreen target, or the canvas), and every assignment to
   the canvas's size, through the harness's recorder */
function watch(sim) {
  const w = { vp: null, sizes: 0 };
  sim.setRecord(r => {
    if (r.target === 'canvas' && r.set) w.sizes++;
    else if (r.op === 'viewport' && !w.vp) w.vp = r.args.join(',');
  });
  return w;
}
/* a level's viewport and transform on the 1440x900@1.5 page (THE LEVELS):
   its corner, round(W * res) and the margin, at the top of the canvas */
const { LEVEL_MARGIN } = H.rendererNumbers(['LEVEL_MARGIN']);
function corner(res) {
  const bw = 2160, bh = 1350, rw = Math.round(1440 * res), rh = Math.round(900 * res);
  if (rw >= bw) return { vp: '0,0,' + bw + ',' + bh, t: '', v: '' };
  const lw = Math.min(bw, rw + LEVEL_MARGIN), lh = Math.min(bh, rh + LEVEL_MARGIN);
  return { vp: '0,' + (bh - lh) + ',' + lw + ',' + lh, t: 'scale(' + bw / rw + ', ' + bh / rh + ')',
           v: 'inset(0px ' + (bw - rw) + 'px ' + (bh - rh) + 'px 0px)' };
}
/* a slow GPU: cost(px, s) ms per drawn frame for px pixels drawn (the
   level's, not the canvas's: THE LEVELS); frames on a 60 Hz vsync, held
   back while the GPU is busy, and stall(s) ms later still, drawn or not */
function drive(sim, seconds, cost, each, stall) {
  const V = 1000 / 60, t0 = sim.now;
  let gpuFree = 0, T = sim.now, drawsBefore = sim.gl.draws;
  const end = T + seconds * 1000, w = sim.__watch;
  while (T < end) {
    if (w) w.vp = null;
    sim.frame(0);
    const drew = sim.gl.draws > drawsBefore;
    drawsBefore = sim.gl.draws;
    const r = sim.P.gov.res;
    if (each) each({ drew, vp: w ? w.vp : null, res: r });
    if (drew) gpuFree = Math.max(T, gpuFree) + cost(Math.round(1440 * r) * Math.round(900 * r), (T - t0) / 1000);
    let next = T + V + (stall ? stall((T - t0) / 1000) : 0);
    if (gpuFree > next) next = T + Math.ceil((gpuFree - T) / V - 1e-9) * V;
    sim.idle(next - T);
    T = next;
  }
}
function pageOf(opts) {
  const sim = H.load(Object.assign({ W: 1440, H: 900, dpr: 1.5, now: 1000, starter: 'keep' }, opts));
  sim.__watch = watch(sim);
  return sim;
}
const FULL = '2160x1350';
{
  const sim = pageOf();
  sim.move(300, 700);
  sim.frames(2, 16.7);
  sim.__watch.sizes = 0;
  let blank = 0, undrawn = 0, frames = 0, last = sim.P.gov.res, changes = 0;
  const sizes = new Set();
  const t0 = sim.P.simNow, clock0 = sim.now;
  drive(sim, 25, px => 2 + px / 1e5, f => {
    frames++;
    if (!f.drew) undrawn++;
    if (f.res !== last) { changes++; if (!f.drew) blank++; last = f.res; }
    if (f.vp) sizes.add(f.vp);
  });
  const res = sim.P.gov.res, want = corner(res);
  const sceneMs = sim.P.simNow - t0, wallMs = sim.now - clock0;
  if (!(res < 1.5) || !sizes.has(want.vp) || sim.canvas.style.transform !== want.t) {
    fail('page: the drawn size never shrank (res ' + res + ', viewports ' + [...sizes].join(' ') + ', transform ' + sim.canvas.style.transform + ')');
  }
  if (sim.canvas.width + 'x' + sim.canvas.height !== FULL || sim.__watch.sizes) fail('page: the canvas is ' + sim.canvas.width + 'x' + sim.canvas.height + ', its size set ' + sim.__watch.sizes + ' times by ' + changes + ' changes of level (need ' + FULL + ', never)');
  if (blank) fail('page: ' + blank + ' frames changed level without drawing (a blank frame)');
  if (!(Math.abs(sceneMs - wallMs) < 70)) fail('page: the scene clock moved ' + sceneMs.toFixed(0) + ' ms in ' + wallMs.toFixed(0) + ' ms (the motion\'s speed changed)');
  notes.push('page: res ' + res + ' (viewports ' + [...sizes].join(' then ') + ', ' + sim.canvas.style.transform + '), the canvas ' + FULL + ' throughout, set 0 times by '
             + changes + ' changes of level, ' + undrawn + ' of ' + frames + ' frames not drawn, the scene clock ' + sceneMs.toFixed(0) + ' ms in ' + wallMs.toFixed(0) + ' ms, no blank frame');
}
{
  /* a tour of the levels through a test hook on the governor's res: each
     in its corner, shown by object-view-box where the browser has it and
     by a transform where not, and nothing allocated */
  const got = [];
  for (const ovb of [false, true]) {
    const sim = pageOf({ search: '?bgq=0', objectViewBox: ovb, patches: [['get res() { return res; }', 'get res() { return window.__res || res; }']] });
    const ALLOC = /^(?:create\w+|bufferData|bufferSubData|texImage2D|texStorage2D|renderbufferStorage\w*)$/;
    let sizes = 0, vp = null;
    const made = [], wrong = [];
    sim.setRecord(r => {
      if (r.target === 'canvas' && r.set) sizes++;
      else if (ALLOC.test(r.op)) made.push(r.op);
      else if (r.op === 'viewport' && !vp) vp = r.args.join(',');
    });
    sim.frames(3, 16.7);
    /* the first frame built the scenery: from here on, nothing */
    sizes = 0; made.length = 0;
    const tour = [0.75, 1.5, 1, 0.75, 1.25, 1, 1.5, 0.75, 1.25], how = ovb ? 'object-view-box' : 'a transform';
    for (const r of tour) {
      sim.window.__res = r;
      const d = sim.gl.draws;
      vp = null;
      sim.frame(16.7);
      const want = corner(r), shows = (ovb ? sim.canvas.style.objectViewBox : sim.canvas.style.transform) || '', other = (ovb ? sim.canvas.style.transform : sim.canvas.style.objectViewBox) || '';
      if (sim.gl.draws === d) wrong.push(r + ' (' + how + '): drew nothing');
      else if (vp !== want.vp || shows !== (ovb ? want.v : want.t) || other) wrong.push(r + ' (' + how + '): viewport ' + vp + ', shown by "' + shows + '" and "' + other + '" (need ' + want.vp + ', "' + (ovb ? want.v : want.t) + '")');
      sim.frames(3, 16.7);
    }
    if (sizes) fail('a tour of the levels (' + how + '): the canvas\'s size was set ' + sizes + ' times');
    if (made.length) fail('a tour of the levels (' + how + '): ' + made.length + ' GPU allocations (' + [...new Set(made)].join(', ') + ')');
    for (const w of wrong) fail('a tour of the levels, res ' + w);
    got.push(how + ' (0.75: ' + (ovb ? corner(0.75).v : corner(0.75).t) + ')');
  }
  notes.push('a tour of 9 changes of level: each in its corner, shown by ' + got.join(' or ') + ', the canvas never resized, nothing allocated on the GPU');
}
{
  const sim = pageOf();
  const events = [];
  sim.document.addEventListener('bgmotion', e => events.push(e.detail));
  sim.move(300, 700);
  drive(sim, 30, px => 40 + px / 2e4);
  const perf = events.filter(d => d.paused && d.reason === 'performance');
  if (perf.length !== 1) fail('page, too slow: ' + perf.length + ' performance pauses (need 1)');
  if (sim.html.dataset.motion !== 'paused') fail('page, too slow: dataset.motion is ' + sim.html.dataset.motion);
  if (sim.window.localStorage.getItem('bg-motion') !== null) fail('page, too slow: the pause was saved (' + sim.window.localStorage.getItem('bg-motion') + ')');
  sim.frames(3, 16.7);
  const drewWhilePaused = sim.gl.draws;
  sim.frames(5, 16.7);
  if (sim.gl.draws !== drewWhilePaused) fail('page, too slow: still drawing after the pause');
  /* played again (the motion button: bgmotion { paused: false }) */
  sim.motion(false);
  let vp = null;
  drive(sim, 20, px => 40 + px / 2e4, f => { if (f.vp) vp = f.vp; });
  const again = events.filter(d => d.paused && d.reason === 'performance').length;
  if (again !== 1) fail('page, played again: paused itself again (' + again + ' performance pauses)');
  if (sim.P.gov.res !== 0.75 || vp !== corner(0.75).vp || sim.canvas.width + 'x' + sim.canvas.height !== FULL) {
    fail('page, played again: res ' + sim.P.gov.res + ', viewport ' + vp + ', the canvas ' + sim.canvas.width + 'x' + sim.canvas.height + ' (need the lowest level: 0.75, ' + corner(0.75).vp + ' on ' + FULL + ')');
  }
  notes.push('page, too slow: paused once (reason performance, dataset.motion paused, nothing saved); played again, the lowest level (viewport ' + vp + ') and no second pause');
}
{
  /* slow, then fast: it resumes by itself */
  const sim = pageOf();
  const events = [];
  sim.document.addEventListener('bgmotion', e => events.push(Object.assign({ at: sim.now }, e.detail)));
  sim.move(300, 700);
  let gone = 0;
  drive(sim, 60, (px, s) => (events.length ? 0.5 + px / 1e6 : 40 + px / 2e4), f => { if (!gone && events.length) gone = sim.now; });
  const pause = events.find(d => d.paused), resume = events.find(d => !d.paused);
  if (!pause || pause.reason !== 'performance') fail('page, recovery: no performance pause (' + JSON.stringify(events) + ')');
  else if (!resume || resume.reason !== 'performance') fail('page, recovery: never resumed by itself in 60 s (' + JSON.stringify(events) + ')');
  else {
    const after = (resume.at - pause.at) / 1000;
    if (after > 18) fail('page, recovery: resumed ' + after.toFixed(1) + ' s after the pause (the first try is 15 s on)');
    if (sim.html.dataset.motion !== 'running') fail('page, recovery: dataset.motion is ' + sim.html.dataset.motion);
    if (sim.window.localStorage.getItem('bg-motion') !== null) fail('page, recovery: the resume was saved');
    const d = sim.gl.draws;
    sim.frames(10, 16.7);
    if (sim.gl.draws === d) fail('page, recovery: not drawing after the resume');
    notes.push('page, recovery: paused, then resumed by itself ' + after.toFixed(1) + ' s later (reason performance, dataset.motion running, nothing saved), at level ' + sim.P.gov.level + ' by the end');
  }
}
{
  /* everything slow, the page's frames and the ones that draw nothing alike */
  const sim = pageOf();
  const events = [];
  sim.document.addEventListener('bgmotion', e => events.push(e.detail));
  sim.move(300, 700);
  drive(sim, 40, px => 1 + px / 1e6, null, s => (s >= 3 ? 130 : 0));
  if (events.length || sim.html.dataset.motion === 'paused') fail('page, a machine-wide stall: ' + JSON.stringify(events) + ', dataset.motion ' + sim.html.dataset.motion);
  notes.push('page, a machine-wide stall (every frame 130 ms late for 37 s): no pause, at level ' + sim.P.gov.level);
}
{
  /* the visitor's own pause, over the governor's: never undone */
  const sim = pageOf();
  const events = [];
  sim.document.addEventListener('bgmotion', e => events.push(e.detail));
  sim.move(300, 700);
  let fast = false;
  drive(sim, 12, (px) => (fast ? 0.5 : 40 + px / 2e4));
  const perf = events.filter(d => d.paused && d.reason === 'performance').length;
  sim.motion(true);
  fast = true;
  drive(sim, 60, () => 0.5);
  const resumed = events.filter(d => !d.paused).length;
  if (perf !== 1 || resumed || sim.html.dataset.motion !== 'paused') fail('page, the visitor\'s pause over a performance pause: ' + JSON.stringify(events) + ', dataset.motion ' + sim.html.dataset.motion + ' (need it never resumed)');
  /* and a visitor's pause on its own */
  const s2 = pageOf();
  const e2 = [];
  s2.document.addEventListener('bgmotion', e => e2.push(e.detail));
  drive(s2, 3, () => 0.5);
  s2.motion(true);
  drive(s2, 60, () => 0.5);
  /* the one event is the visitor's own */
  if (e2.length !== 1 || s2.pendingRaf()) fail('page, the visitor\'s pause: ' + JSON.stringify(e2) + ', ' + s2.pendingRaf() + ' frames asked for');
  notes.push('page: a visitor\'s pause, alone or over a performance pause, never resumed (60 s)');
}
for (const [q, res, k] of [['?bgq=0', 1.5, 1], ['?bgq=2', 1.25, 1], ['?bgq=4', 0.75, 1], ['?bgq=5', 0.75, 2], ['?bgq=6', 0.75, 3]]) {
  const sim = pageOf({ search: q });
  sim.frames(30, 1000 / 60);
  const d0 = sim.gl.draws;
  let drawn = 0, vp = null;
  for (let i = 0; i < 60; i++) {
    const d = sim.gl.draws;
    sim.__watch.vp = null;
    sim.frame(1000 / 60);
    if (sim.gl.draws > d) { drawn++; vp = sim.__watch.vp; }
  }
  const want = corner(res);
  if (vp !== want.vp || (sim.canvas.style.transform || '') !== want.t) fail(q + ': viewport ' + vp + ', transform "' + sim.canvas.style.transform + '", not ' + want.vp + ', "' + want.t + '"');
  if (sim.canvas.width + 'x' + sim.canvas.height !== FULL) fail(q + ': the canvas is ' + sim.canvas.width + 'x' + sim.canvas.height + ', not level 0\'s ' + FULL);
  if (drawn !== 60 / k) fail(q + ': ' + drawn + ' of 60 frames drawn, not ' + 60 / k);
  if (sim.gl.draws === d0) fail(q + ': nothing drawn');
}
notes.push('?bgq=0/2/4/5/6: drawn in the level\'s corner on a ' + FULL + ' canvas, paced by level');
{
  /* another monitor (THE VSYNC, AGAIN): the window moves from a 165 Hz
     panel at dpr 1.5 to a 60 Hz monitor at dpr 1 - main.js tells the
     governor (setMaxRes, then resized), which measures the vsync again */
  const sim = pageOf();
  sim.move(300, 700);
  sim.frames(165 * 4, 1000 / 165);
  const g = sim.P.gov, was = { vsync: +g.vsync.toFixed(3), sure: g.sure, level: g.level };
  sim.setDpr(1);
  let undrawn = 0, doubted = false, back = null, left = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const d = sim.gl.draws;
    sim.frame(1000 / 60);
    if (sim.gl.draws === d) undrawn++;
    if (g.level !== 0) left++;
    if (!g.sure) doubted = true;
    else if (doubted && back === null && Math.abs(g.vsync - 1000 / 60) <= 0.01 * 1000 / 60) back = (i + 1) / 60;
  }
  if (!was.sure || Math.abs(was.vsync - P165) > 0.01 * P165 || was.level) fail('page, another monitor: before the move ' + JSON.stringify(was) + ' (need 6.06 ms, confirmed, level 0)');
  if (back === null || back > 1.5) fail('page, another monitor: the vsync not measured again as 16.67 ms within 1.5 s (' + g.vsync.toFixed(2) + ' ms, ' + (g.sure ? 'confirmed' : 'unconfirmed') + ', ' + (doubted ? 'doubted' : 'never doubted') + ')');
  if (left) fail('page, another monitor: below level 0 in ' + left + ' frames');
  if (undrawn > 4) fail('page, another monitor: ' + undrawn + ' frames not drawn (two probes of two frames at most)');
  if (sim.canvas.width + 'x' + sim.canvas.height !== '1440x900') fail('page, another monitor: the canvas is ' + sim.canvas.width + 'x' + sim.canvas.height + ' at dpr 1, not 1440x900');
  notes.push('page, another monitor (165 Hz at dpr 1.5 -> 60 Hz at dpr 1): the vsync measured again, 16.67 ms ' + (back === null ? '?' : back.toFixed(2)) + ' s after the move, level 0 throughout, '
             + undrawn + ' frames not drawn, the canvas 1440x900');
}

/* ---- C. in a browser ---------------------------------------------------------- */
/* the governor's res follows window.__res (for the change of level's cost) */
const FOLLOW = `
;(function () {
  const real = Bg.governor;
  Bg.governor = function (o) {
    const g = real(o);
    return {
      frame: n => g.frame(n), reset: () => g.reset(), resized: () => g.resized(), setMaxRes: r => g.setMaxRes(r),
      resumeAfterPause: (n, a) => g.resumeAfterPause(n, a), takePause: () => g.takePause(),
      pausedFrame: n => (g.pausedFrame ? g.pausedFrame(n) : 3), TEST: g.TEST, RESUME: g.RESUME, DONE: g.DONE,
      get res() { return window.__res > 0 ? window.__res : g.res; }, get level() { return g.level; },
      get k() { return g.k; }, get vsync() { return g.vsync; }, get retryIn() { return g.retryIn; }
    };
  };
})();`;
/* a change of level against the frames around it (the header), as many
   times as the tour has changes; a change that fails is measured again */
const HITCH = 2;
async function hitch(b, site) {
  const routes = { [new URL('assets/js/bg/governor.js', site.url).pathname]: { body: SRC + FOLLOW, contentType: 'text/javascript' } };
  const s = await b.open(site.url + 'index.html?bgq=0', { width: 960, height: 600, dpr: 1.5, routes });
  try {
    await s.frames(10);
    const tour = async (seq, per) => s.evaluate(async (seq, per) => {
      const T = [], R = [], at = [], W = [];
      const raf = window.requestAnimationFrame.bind(window), c = document.getElementById('cosmos');
      let i = 0, step = 0;
      window.__res = seq[0];
      await new Promise(r => raf(() => raf(r)));
      await new Promise(done => {
        const f = t => {
          T.push(t); R.push(window.__res); W.push(c.width);
          if (++i % per === 0) {
            if (++step >= seq.length) { done(); return; }
            window.__res = seq[step]; at.push(T.length);
          }
          raf(f);
        };
        raf(f);
      });
      return { T, R, at, W };
    }, seq, per);
    const med = a => { const x = [...a].sort((p, q) => p - q); return x[x.length >> 1]; };
    /* the page's frame at T[c] applies the new res (it runs before ours);
       its cost is the interval after it */
    const measure = o => {
      const iv = o.T.slice(1).map((t, j) => t - o.T[j]), rows = [];
      for (const c of o.at) {
        const before = med(iv.slice(c - 9, c - 1)), after = med(iv.slice(c + 2, c + 10)), at = iv[c];
        rows.push({ from: o.R[c - 1], to: o.R[c], ratio: at / Math.max(before, after), at, before, after });
      }
      return { rows, widths: [...new Set(o.W)] };
    };
    const SEQ = [1.5, 0.75, 1.5, 1, 1.5, 1.25, 0.75, 1.25, 1, 1.5], PER = 12;
    const first = measure(await tour(SEQ, PER));
    const ratios = [];
    for (const row of first.rows) {
      let r = row;
      if (r.ratio > HITCH) {
        const again = measure(await tour([row.from, row.to], PER)).rows[0];
        if (again && again.ratio < r.ratio) r = again;
      }
      ratios.push(r.ratio.toFixed(2));
      if (r.ratio > HITCH) fail('browser, a change of level ' + row.from + ' -> ' + row.to + ': its frame took ' + r.at.toFixed(1) + ' ms, ' + r.ratio.toFixed(2) + 'x the frames around it (' + r.before.toFixed(1) + ' / ' + r.after.toFixed(1) + ' ms; limit ' + HITCH + 'x)');
    }
    if (first.widths.length !== 1) fail('browser, a change of level: the canvas was resized (' + first.widths.join(', ') + ' wide)');
    for (const e of s.errors) fail('browser, a change of level: ' + e.type + ': ' + e.text);
    notes.push('browser, ' + first.rows.length + ' changes of level at 960x600@1.5 (SwiftShader): each frame ' + ratios.join('/') + 'x the frames around it (limit ' + HITCH + 'x), the canvas '
               + first.widths.join() + ' wide throughout');
  } finally { await s.close(); }
}
async function browser() {
  const B = require('./browser');
  const why = B.unavailable();
  if (why) { notes.push('browser: SKIP - ' + why); return; }
  const site = await B.serve();
  const b = await B.launch();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const st = s => s.evaluate(() => {
    /* the box as laid out, without the transform a level below 0 scales the canvas by */
    const box = el => { const t = el.style.transform; el.style.transform = 'none'; const w = el.getBoundingClientRect().width; el.style.transform = t; return w; };
    const m = document.getElementById('motion'), c = document.getElementById('cosmos');
    let saved; try { saved = localStorage.getItem('bg-motion'); } catch (e) { saved = 'throws'; }
    return { ev: window.__ev.map(d => JSON.stringify(d)), motion: document.documentElement.dataset.motion, saved,
             pressed: m && m.getAttribute('aria-pressed'), w: c.width, bw: box(c),
             res: window.Bg.gov ? window.Bg.gov.res : null, dpr: devicePixelRatio };
  });
  const EV = "window.__ev = []; document.addEventListener('bgmotion', e => window.__ev.push(e.detail));";
  const moving = async s => {
    await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
    await sleep(300);
    const a = B.decodePNG(await s.screenshot());
    await sleep(1500);
    const z = B.decodePNG(await s.screenshot());
    await s.evaluate(() => { document.querySelector('.shell').style.visibility = ''; });
    return B.changed(a, z, 12);
  };
  try {
    const s = await b.open(site.url + 'index.html?bgq=pause', { width: 1440, height: 900, dpr: 1.5, init: EV });
    try {
      await sleep(800);
      const a = await st(s);
      const perf = a.ev.filter(e => /"reason":"performance"/.test(e));
      if (perf.length !== 1 || !/"paused":true/.test(perf[0] || '')) fail('browser, ?bgq=pause: the performance pause events were ' + JSON.stringify(a.ev));
      if (a.motion !== 'paused' || a.saved !== null || a.pressed !== 'true') fail('browser, ?bgq=pause: ' + JSON.stringify({ motion: a.motion, saved: a.saved, pressed: a.pressed }));
      await s.evaluate(() => { document.querySelector('.shell').style.visibility = 'hidden'; });
      await sleep(300);
      const p0 = B.decodePNG(await s.screenshot());
      await sleep(800);
      const still = B.changed(p0, B.decodePNG(await s.screenshot()), 12);
      if (still > 0.001) fail('browser, ?bgq=pause: ' + (100 * still).toFixed(2) + '% of the pixels changed while paused');
      /* play */
      await s.evaluate(() => { document.querySelector('.shell').style.visibility = ''; document.getElementById('motion').click(); });
      await sleep(1500);
      const mv = await moving(s);
      await sleep(4000);
      const z = await st(s);
      if (!(mv > 0.01)) fail('browser, played again: only ' + (100 * mv).toFixed(2) + '% of the pixels changed in 1.5s');
      if (z.ev.filter(e => /"reason":"performance"/.test(e)).length !== 1) fail('browser, played again: it paused itself again (' + JSON.stringify(z.ev) + ')');
      if (z.res !== 0.75 || z.w !== Math.round(z.bw * Math.min(z.dpr, 2))) fail('browser, played again: res ' + z.res + ' on a ' + z.w + ' px canvas for a ' + z.bw + ' px box (need the lowest level, 0.75, on level 0\'s canvas)');
      if (z.motion !== 'running' || z.pressed !== 'false') fail('browser, played again: ' + JSON.stringify({ motion: z.motion, pressed: z.pressed }));
      for (const m of s.messages) fail('browser, ?bgq=pause: console ' + m.type + ': ' + m.text);
      for (const e of s.errors) fail('browser, ?bgq=pause: ' + e.type + ': ' + e.text);
      notes.push('browser: ?bgq=pause pauses at load (reason performance, nothing saved, the button pressed, the background still); played, '
                 + (100 * mv).toFixed(1) + '% moving in 1.5s at res ' + z.res + ' on a ' + z.w + ' px canvas, no second pause');
    } finally { await s.close(); }
    /* it resumes by itself: the first wait cut to 1.5 s, the test passing,
       and its own pause out of reach. SwiftShader at 960x600 is too slow to
       animate, so the page, resumed, paused itself again - as it may - 3.4
       to 7.5 s later in all of 12 loads (6 with the governor before THE
       VSYNC, AGAIN, 6 after), and once in run-all before the look below,
       about 3 s after the resume: a race this test is not about */
    const cut = [['RETRY_MS = 15000', 'RETRY_MS = 1500'], ['if (SORTED[BURST_TESTS >> 1] <= DT_MAX) return RESUME;', 'if (SORTED[BURST_TESTS >> 1] < 1e9) return RESUME;'],
                 ['PAUSE_MS = 80', 'PAUSE_MS = 1e9']];
    let quick = SRC;
    for (const [from, to] of cut) {
      if (quick.split(from).length !== 2) fail('browser, resumes by itself: governor.js has no single "' + from + '" to patch');
      quick = quick.replace(from, to);
    }
    const routes = { [new URL('assets/js/bg/governor.js', site.url).pathname]: { body: quick, contentType: 'text/javascript' } };
    /* the same profile as the page before, whose play was saved: forget it */
    const r = await b.open(site.url + 'index.html?bgq=pause', { width: 960, height: 600, dpr: 1, routes,
      init: "try { localStorage.removeItem('bg-motion'); } catch (e) {}\n" + EV });
    try {
      let z = await st(r);
      for (let i = 0; i < 30 && z.motion !== 'running'; i++) { await sleep(250); z = await st(r); }
      const mv = await moving(r);
      z = await st(r);
      const want = ['{"paused":true,"reason":"performance"}', '{"paused":false,"reason":"performance"}'];
      if (z.ev.join() !== want.join()) fail('browser, resumes by itself: the events were ' + JSON.stringify(z.ev) + ' (need ' + want.join(', ') + ')');
      if (z.motion !== 'running' || z.pressed !== 'false' || z.saved !== null) fail('browser, resumes by itself: ' + JSON.stringify({ motion: z.motion, pressed: z.pressed, saved: z.saved }));
      if (!(mv > 0.01)) fail('browser, resumes by itself: only ' + (100 * mv).toFixed(2) + '% of the pixels changed in 1.5 s');
      for (const e of r.errors) fail('browser, resumes by itself: ' + e.type + ': ' + e.text);
      notes.push('browser, its first wait cut to 1.5 s: ?bgq=pause resumed by itself (reason performance, dataset.motion running, the button not pressed, nothing saved), ' + (100 * mv).toFixed(1) + '% moving in 1.5 s');
    } finally { await r.close(); }
    /* The page as it ships: on SwiftShader, a slow GPU, its resolution must
       step down. Counted in the page's own animation frames, which the
       governor decides on, not in seconds: its vsync confirmed within
       SHIP_SURE of them, and the step down within SHIP_AFTER of them after
       that (at most SHIP_MAX s a load). How soon SwiftShader gives the
       governor its samples of the vsync - frames that draw nothing, within
       VSYNC_MAX of the last (governor.js THE VSYNC) - is the machine's:
       11-72 frames, 3.1-12.2 s, into 12 loads alone, the step down 4-6
       frames after it every time; on a busy machine later still, where a
       fixed 12 s from the load failed this test in two run-alls (the vsync
       not yet confirmed, and confirmed 60 frames in, the step down due a
       few frames on). And now and then not at all: one load alone, at
       SwiftShader's usual 7 frames a second, confirmed none in 151 frames.
       So a load whose vsync is not confirmed in time is measured again in a
       fresh page, up to SHIP_LOADS; one that confirmed it and then did not
       step down fails at once, since that is the governor's own decision. */
    const SHIP_SURE = 150, SHIP_AFTER = 20, SHIP_MAX = 180, SHIP_LOADS = 3;
    const COUNT = '(() => { window.__frames = 0; const raf = window.requestAnimationFrame.bind(window); '
                + 'window.requestAnimationFrame = cb => raf(now => { window.__frames++; cb(now); }); })();';
    const tries = [];
    for (let load = 1; load <= SHIP_LOADS; load++) {
      const t = await b.open(site.url + 'index.html', { width: 1440, height: 900, dpr: 1.5, init: COUNT });
      let r;
      try {
        const look = () => t.evaluate(() => ({ res: window.Bg.gov.res, w: document.getElementById('cosmos').width, level: window.Bg.gov.level, vsync: +window.Bg.gov.vsync.toFixed(2), sure: window.Bg.gov.sure, retry: window.Bg.gov.retryIn, motion: document.documentElement.dataset.motion, frames: window.__frames }));
        const g0 = await look(), t0 = Date.now();
        let g = g0, sure = g0.sure ? g0 : null;
        const open = () => g.res >= g0.res && Date.now() - t0 < SHIP_MAX * 1000
          && (sure ? g.frames - sure.frames < SHIP_AFTER : g.frames - g0.frames < SHIP_SURE);
        while (open()) {
          await sleep(250);
          g = await look();
          if (g.sure && !sure) sure = g;
        }
        r = { g0, g, sure, secs: ((Date.now() - t0) / 1000).toFixed(1) + 's', errors: t.errors.slice(),
              at: sure ? 'the vsync confirmed ' + (sure.frames - g0.frames) + ' frames in' : 'the vsync not confirmed in ' + (g.frames - g0.frames) + ' frames' };
      } finally { await t.close(); }
      tries.push(r);
      if (r.g.res < r.g0.res || r.sure) break;
    }
    const last = tries[tries.length - 1], { g0, g, sure } = last;
    const again = tries.length > 1 ? ' (load ' + tries.length + ': ' + tries.slice(0, -1).map(x => x.at).join(', ') + ' before)' : '';
    if (!(g.res < g0.res)) {
      fail('browser, as shipped on SwiftShader: res still ' + g.res + ' after ' + last.secs + ', ' + last.at
           + (sure ? ' and ' + (g.frames - sure.frames) + ' after it' : ' in each of ' + tries.length + ' loads') + again + ' (' + JSON.stringify(g) + ')');
    }
    if (g.w !== g0.w) fail('browser, as shipped on SwiftShader: the canvas went from ' + g0.w + ' to ' + g.w + ' wide (a level is drawn offscreen, not by resizing it)');
    for (const x of tries) for (const e of x.errors) fail('browser, as shipped: ' + e.type + ': ' + e.text);
    notes.push('browser, as shipped on SwiftShader: res ' + g0.res + ' -> ' + g.res + ' in ' + last.secs + ', ' + last.at + ', the step down '
               + (sure ? g.frames - sure.frames : '?') + ' frames after' + again + ', the canvas ' + g.w + ' wide throughout');
    await hitch(b, site);
  } finally {
    await b.close();
    await site.close();
  }
}

allocation().catch(e => fail('allocation: ' + ((e && e.stack) || e))).then(browser).catch(e => fail('browser: ' + ((e && e.stack) || e))).then(() => {
  if (fails.length) {
    console.log('check-governor: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1, 30)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-governor: OK - ' + notes.join('; '));
});
