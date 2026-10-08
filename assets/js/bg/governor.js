/* The adaptive quality governor: it keeps the background smooth on
   whatever draws it, instead of hoping the hardware is fast enough.

   It watches the real frame timing - the requestAnimationFrame timestamps,
   which in a browser fall on the display's vsync - and when frames keep
   missing their vsync it steps the quality down, cheapest visual loss
   first; when they have run with room to spare for a while it steps back
   up. main.js asks it, every animation frame, whether to draw this one
   (frame) and at what resolution (res). The scene's clock runs on dt, so
   whatever it decides, nothing moves faster or slower.

   THE LEVELS (?bgq=<n> on the page's URL holds one, for QA; nothing is
   ever logged; main.js puts the governor on Bg.gov, so QA can read its
   level, res, k, vsync and sure - false too while the vsync is measured
   again)

     0     the scene at the display's own density, min(dpr, 2)
     1-4   1.5, 1.25, 1 and 0.75 px per CSS px (never above level 0's):
           the GPU shades fewer pixels and they are scaled up to the
           canvas, which stays at level 0's size (render-webgl.js, THE
           LEVELS: a change of level allocates nothing, so it costs no
           frame): a softer image, nothing else
     5+    0.75, drawing every k-th vsync, k = level - 3, evenly paced (a
           frame every k vsyncs exactly, never 2 then 3): 165 Hz at k = 3
           is 55 fps, 60 Hz at k = 2 is 30 fps. k comes from what a frame
           costs, so one fits with room; a cadence is offered only while k
           vsyncs are at most DT_MAX, the scene's dt clamp, since a longer
           step would slow the motion down
     pause the last resort, only if even the lowest animated level takes
           over PAUSE_MS a frame and the page is to blame (THE PAUSE): it
           asks main.js to pause the motion (takePause; detail { paused:
           true, reason: 'performance' }, nothing saved), and then tries
           now and then to come back by itself (AFTER A PAUSE). Played
           again by the visitor, it runs at the lowest animated level and
           never pauses itself again that visit (resumeAfterPause).
           ?bgq=pause asks for it at once.

   WHEN. A drawn frame misses when it comes more than half a vsync after
   its slot, k vsyncs after the last one - and only once the vsync is
   confirmed (THE VSYNC): until then no frame is judged at all. Down:
   MISS_DOWN or more of the frames of the last WINDOW ms (at least MIN_N of
   them) missed, at a level held DWELL_DOWN ms. A step down from a
   resolution goes straight to the first one the measured cost predicts
   will fit (the cost taken to go with the pixels shaded), but not past
   0.75 at every vsync: a cadence is only ever chosen from a cost measured
   at 0.75.

   Up: at most MISS_UP missed for UP_DWELL ms (and DWELL_MIN since the last
   change). From a cadence, only as far as the frames show room for: the
   next animation frame after a drawn one comes when the GPU is done with
   it, so that interval is the frame's cost to the vsync, and k comes down
   to what it says will fit - never to a cadence it has just shown it
   cannot keep. A resolution's cost cannot be seen from below (a frame
   that fits takes one vsync, whatever it costs), so that step is tried:
   if it fails - back down within FAIL_MS - it goes back to the level it
   came from, and the wait before that level is tried again grows 4x (5 s,
   20 s, 80 s, then every 320 s), so it settles instead of oscillating and
   still finds its way back up if the machine gets faster. A new window
   size (resized) forgets the failures: every level costs something else
   now. Nothing is decided in the first START_GRACE ms, while the page is
   still loading.
   _tools/check-governor.js drives it through synthetic machines - fast,
   slow, very slow, recovering, noisy, jittered, at 60 to 240 Hz, and
   displays that change under it - through replays of frame timings like
   the owner's (165 Hz with late frames and their catch-ups), and through
   the page in node and in Chrome.

   THE VSYNC is measured, not assumed, and nothing is judged against it
   until it is confirmed. A wrong one is worse than none: the shortest
   interval used to stand in for it when nothing better fitted, and one
   frame late by half a vsync followed by its catch-up (9.1 then 3.03 ms
   at 165 Hz; the QA lens saw four in 40 s on the owner's Intel Arc) read
   as a 3.03 ms vsync, so every 6.06 ms frame was a miss and a machine
   holding 165 fps went down to 0.75 within seconds, over and over.
   Two sources:
     - the intervals between animation frames (the ring), while it is not
       confirmed: every 16 frames (provisional), the longest common
       refresh period that explains FIT_SHARE of them as a whole number of
       periods and is no longer than a low quantile (LOW_Q) of them, so a
       frame the GPU holds to 4, 5, 6 or 7 vsyncs reads as a 165 Hz
       display, not a 41 Hz one. Catch-ups are left out first - an
       interval under CATCH_UP of the median, and the late one before it.
       That is only an estimate to pace by. It is confirmed when there are
       24 intervals, FIT_SHARE of them fit, SINGLE_SHARE of them are one
       period (else the GPU may be holding every frame to two: an 85 Hz
       display fits as 165 Hz held to 2 vsyncs), and the period is
       unambiguous - no common period a whole number of times shorter
       explains the same intervals (60 Hz could be 120 or 240 Hz held to 2
       or 4 vsyncs). 144, 165 and 240 Hz are confirmed so, with no probe;
     - pure samples: the interval after two animation frames that drew
       nothing, when no GPU work of the page's was in flight to hold the
       next one back. After one, there can be: a browser lets the next
       frame start before the GPU is done with the last, and on a slow GPU
       that frame's own successor waits for it (SwiftShader, as shipped:
       "pure" samples of 218 ms, confirmed as the vsync, and a page at 140
       ms a frame never stepped down). A cadence of k = 3 or more makes
       them all the time; otherwise, while the vsync is not confirmed, the
       governor draws nothing in two frames now and then (a probe,
       PROBE_GAP apart; never on ?bgq=0..4, where nothing depends on the
       vsync). The vsync is their median at the nearest common period
       within SNAP, confirmed once two of them agree, or one agrees with
       the period that fitted the ring (a catch-up is shorter than that, a
       stall longer), or PURE are in: one alone can be a catch-up too. So a
       60 or 120 Hz display takes one probe (the old one drew nothing in
       one frame; this one in two, a 50 ms hold once at 60 Hz), and a GPU
       holding every frame to 2 vsyncs two. Neither source gives a vsync
       longer than VSYNC_MAX: no display or frame cap is slower (a 30 fps
       cap is 33.3 ms, up to 41.7 on some displays' grids), and a sample
       that long is the GPU or the machine holding the frame, so it is not
       kept and the ring's estimate paces until one that can be the vsync
       comes. SwiftShader as shipped, still loading, gave two that agreed,
       and 151 and 236 ms were confirmed in 2 of 6 loads, their page at
       140 ms a frame left at full resolution (check-governor's loaded
       start: 35 of 40; now none of 40, nor of 6 loads). A browser whose
       every frame comes 50 ms or more apart, drawn or not, never gives one,
       and then nothing is judged at all (this governor alone, every frame
       50-300 ms apart: never confirmed in 120 s); SwiftShader on a busy
       machine gives one late (the page as shipped confirmed it 4.5-17 s
       in, where quiet it takes a few seconds). Once confirmed,
       it is measured again when the frames stop fitting it (THE VSYNC,
       AGAIN); the pause's check keeps none of its samples. Replayed into
       the governor as it was, the owner's 40 s (rebuilt from the lens's
       figures) left it below full resolution 85% of the time, and
       jittered 165 Hz traces 56-89%; now none of them, nor 60, 120 or 144
       Hz, leaves level 0 (check-governor).
   Without the probe a GPU that holds every frame to exactly 2 vsyncs of a
   60 Hz display would pass for a 30 Hz display that is keeping up, and
   nothing would ever step down.

   THE VSYNC, AGAIN. The display can change under a page that is running:
   the window goes to another monitor (a 165 Hz laptop panel to a 60 Hz
   one), or the browser caps the frame rate (energy saver on battery: 30
   fps). A confirmed vsync used to stay for the rest of the visit, and the
   frames were judged against the old display's: a fast page went to 0.75
   for good (165 -> 60 Hz: level 6, k = 3, 2.6 s after the change) or,
   under a 30 fps cap at 165 Hz, to k = 10 - a frame every 66.7 ms, past
   DT_MAX, so 15 fps and the motion 4% slow. Now it is doubted and measured
   again, nothing judged meanwhile and the frames paced by the one it had
   (HAD), when
     - ODD_N of the last ODD intervals between animation frames are no
       whole number of it, within max(0.5 ms, SNAP of one): a late frame
       and its catch-up make two, a frame the GPU holds is a whole number,
       and after 165 -> 60 Hz every one is off (doubted 0.27 s after);
     - a step down is due, and it was confirmed RECHECK ago or more, or
       before a resize (resized), or before misses that ended a calm of
       CALM_LONG: a display a whole number of times slower (120 -> 60 Hz,
       a 30 fps cap at 60 Hz) still fits the frames, and only makes them
       miss. The probe tells the display from a page that got slower;
     - the display's density changes (setMaxRes: another monitor, likely);
     - at a cadence, all PURE of its pure samples agree on another common
       period.
   Measured again, it is the one it had as soon as a pure sample agrees
   with it (a page that got slower pays one probe, and the step down that
   was due goes ahead); else another on the first rule, within VSYNC_MAX,
   so that a machine-wide stall cannot drag it to where its own frames
   look a vsync apart (THE PAUSE); after AGAIN_N that agree on nothing, the
   one it had. Another vsync clears the window and forgets the failed
   attempts, since every level costs something else in vsyncs, and a
   cadence keeps its pace: k of the new vsyncs no longer than k of the
   old, within the clamp (k = 3 at 165 Hz is k = 1 at 60). A false alarm of
   the misfit test - the vsync right after all - rests that test RECHECK.
   check-governor: 165 and 144 -> 60, 240 and 165 -> 144, 60 -> 165 and
   120 -> 60 Hz, a 30 fps cap at 60 and at 165 Hz and lifted, and a cap on
   a 165 Hz grid, on a fast page, serial and pipelined: the vsync back
   within 1% in 1.2 s at most, level 0 throughout; the only frames past
   DT_MAX are a 30 fps cap's two probes, 100 ms each, once; and no replay,
   nor 60-240 Hz timestamps rounded to whole ms, doubts a vsync at all.
   Still stuck: a display a whole number of times slower within CALM_LONG
   of the page's start (no calm to end), or under a cadence that already
   draws its every frame; and one a whole number of times faster under a
   page whose frames take exactly that many of its vsyncs (60 -> 120 Hz at
   12 ms a frame), which nothing in the timing tells apart.

   THE PAUSE. A frame slow because of the page and one slow because the
   whole machine is (other processes starving the browser) look the same
   from their own timing, and the QA lens saw the old pause - the median
   drawn frame alone - stop the background on the owner's fast machine
   under other processes' load, for the rest of the visit. A frame that
   draws nothing tells them apart: it costs the page nothing, so it comes
   one vsync after the last unless the machine itself is behind. So before
   it pauses, the two frames after each drawn one draw nothing (the first
   lets the GPU finish the drawn frame's work, which may still be in
   flight; the interval after the second is clean), and of CHECK_N clean
   samples FAST_N or more must be within FAST_K confirmed vsyncs while the
   drawn frame each follows still took over PAUSE_MS: the cost is the
   page's own. Judged against the cost that started the check, as it was,
   a check that ran on past the end of a stall found its last samples fast
   and paused a page that was fast again (57 of 161 stalls ending 0.25 s
   apart, 20-60 s in). Otherwise the machine is to blame, which no pause
   would help, and it looks again PAUSE_DWELL later. check-governor: a
   page at 130 ms and more a frame at the lowest level pauses (8.4 s in);
   a fast page on a machine where every frame comes 130 ms late, drawn or
   not, never does, whenever the stall ends.

   AFTER A PAUSE main.js asks for a short burst of frames RETRY_MS later
   (pausedFrame): BURST_N that draw nothing, to see that the machine keeps
   up (all but one within FAST_K vsyncs), then BURST_TESTS still frames -
   the scene as it stands, so the picture does not change - each timed
   over the next two frames. If they take at most DT_MAX at the lowest
   level's resolution it resumes there itself (detail { paused: false,
   reason: 'performance' }, nothing saved: site.js shows it on the
   button); if they take more, the wait doubles, up to RETRY_MAX; a
   machine still busy is tried again after the same wait; and a pause
   asked again after resuming itself doubles it too. A visitor's own pause
   is never undone: only main.js's own performance pause is retried.
   check-governor: a page slow for 20 s, paused at 8.4 s, resumed at the
   first try after the load went, 23.7 s in, and was back at level 0 by
   120 s; one still slow tries 15, 30 and 60 s apart and never resumes.

   COST. Per animation frame, a few comparisons and ring-buffer writes, and
   the misfit test's division and rounding (THE VSYNC, AGAIN); the
   provisional estimate every 16 frames while the vsync is not confirmed
   (a sort of 128 intervals and a few thousand flops); a sort of at most a
   window of intervals when stepping down. Nothing is allocated per frame,
   in any state (check-governor.js profiles it): the sorts are in place,
   in one buffer, since a typed array's own sort needs a view of it
   (subarray: 64-96 B a frame at a cadence); the vsync and the bitmap
   ratio are stored only when they change, since V8 boxes every double
   stored in a closure's variable or returned from a call it does not
   inline (16 B each: the ratio main.js reads every frame was 16 B a
   frame); and no callback closures (the estimate's PERIODS.some, ~9 B a
   frame at 165 Hz). 47.5-47.9 ns an animation frame at 165 Hz, 42.0-43.4
   without the misfit test (medians of 7 runs each, alternating, twice);
   measured another time 54-64 ns, against 85-94 when it ran the ring's
   estimate every 16 frames for as long as no frame had drawn nothing,
   which at 165 Hz was forever; check-governor.js, the best of 25 runs of
   40,000 frames (a run the process waits for the CPU times the machine),
   57-87 ns in six runs. A display that changes every 3 s: 0.1 B a frame,
   the new vsync boxed once a change.

   It touches no DOM and keeps no clock of its own (main.js hands it each
   frame's timestamp), so check-governor.js runs it in node alone.
   index.html loads it after scene.js, whose Bg it joins. */
(function () {
  const Bg = globalThis.Bg;
  /* bitmap px per CSS px at levels 0-4 (0: the display's own, capped) */
  const RES = [Infinity, 1.5, 1.25, 1, 0.75];
  const LAST_RES = RES.length - 1;
  /* ms: the scene's dt clamp (scene.js advance), the longest cadence step */
  const DT_MAX = 64;
  /* the rules (the header) */
  const WINDOW = 1000, MIN_N = 6, DWELL_DOWN = 1000, DWELL_MIN = 1000, UP_DWELL = 5000, FAIL_MS = 3000,
        MISS_DOWN = 0.3, MISS_UP = 0.1, PAUSE_MS = 80, PAUSE_DWELL = 2000, START_GRACE = 1500, MARGIN = 0.25;
  /* the vsync (the header): its estimate from the ring and its probes; and
     measuring it again (THE VSYNC, AGAIN) */
  const FIT_SHARE = 0.85, SINGLE_SHARE = 0.5, CATCH_UP = 0.75, LOW_Q = 0.1, SNAP = 0.08, PROBE_GAP = 250,
        ODD = 32, ODD_N = 16, RECHECK = 10000, CALM_LONG = 3000, AGAIN_N = 4, VSYNC_MAX = 45;
  /* the pause's check, and the tries at resuming after one */
  const CHECK_N = 3, FAST_N = 2, FAST_K = 1.5, RETRY_MS = 15000, RETRY_MAX = 240000, BURST_N = 6, BURST_TESTS = 3;
  /* what pausedFrame answers: draw nothing; draw the still frame (a
     test); resume now; the burst is over (main.js asks for the next one
     retryIn ms later) */
  const SAMPLE = 0, TEST = 1, RESUME = 2, DONE = 3;
  /* common refresh periods, longest first (ms) */
  const PERIODS = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360].map(hz => 1000 / hz);
  /* how close an interval must be to a whole number of periods (ms, or that
     share of the period, whichever is larger) */
  const fits = (g, p) => { const r = Math.round(g / p); return r >= 1 && Math.abs(g - r * p) <= Math.max(0.5, 0.05 * p); };
  /* a period is ambiguous when a common period a whole number of times
     shorter would explain the same intervals (60 Hz: 120 or 240 Hz held to
     2 or 4 vsyncs) */
  const ambiguous = p => {
    for (let c = 0; c < PERIODS.length; c++) if (PERIODS[c] < p / 1.5 && fits(p, PERIODS[c])) return true;
    return false;
  };
  /* g at the nearest common period within SNAP of it, else g itself (as
     fromPure, which inlines it) */
  const snap = g => {
    let best = g, err = 1;
    for (let c = 0; c < PERIODS.length; c++) {
      const e = Math.abs(g - PERIODS[c]) / PERIODS[c];
      if (e < err) { err = e; best = PERIODS[c]; }
    }
    return Math.max(2.5, err < SNAP ? best : g);
  };
  /* the intervals kept for the provisional estimate; pure samples kept;
     intervals after a drawn frame kept; the frames a window can hold */
  const RING = 128, PURE = 8, POST = 32, WIN = 512;

  /* opts: maxRes, the display's density (min(dpr, 2)); level, a level to
     hold (?bgq=<n>), else it adapts; pause, ask for the performance pause
     at once (?bgq=pause) */
  Bg.governor = function (opts) {
    let maxRes = Math.min(Math.max(opts.maxRes || 1, 0.5), 2);
    const held = Number.isInteger(opts.level) && opts.level >= 0 ? opts.level : -1;
    /* the vsync matters (pacing, decisions) unless a level at every vsync is held */
    const needVsync = held < 0 || held > LAST_RES;
    let level = held >= 0 ? held : 0, autoPause = held < 0, pauseAsked = opts.pause === true;
    /* the vsync: intervals since the last animation frame, pure samples (the
       interval after a frame that drew nothing) and the estimate; known: an
       estimate to pace by, sure: confirmed (THE VSYNC); the next probe's
       earliest time; whether the last frame drew, and how many before this
       one in a row did not. FITTED[0] is the period that fitted the ring
       (0: none), in a typed array: as a closure variable it was a small
       integer in one governor and a double in the next (the tools make
       several), and the comparison with it boxed, 11 B a frame at ?bgq=6 */
    const gaps = new Float64Array(RING), pure = new Float64Array(PURE), post = new Float64Array(POST), SORTED = new Float64Array(WIN),
          FITTED = new Float64Array(1);
    let nGaps = 0, gapAt = 0, nPure = 0, pureAt = 0, nPost = 0, postAt = 0, sinceEstimate = 0, vsync = 1000 / 60,
        vsyncKnown = false, sure = false, probeAt = 0, lastDrew = true, undrawn = 0;
    /* measuring it again (THE VSYNC, AGAIN): ever, confirmed once; recheck,
       to be measured again before the next step down (a resize, or a calm
       ended); HAD[0], the vsync it had, while it is measured again;
       SURE_AT[0], when it was last confirmed; ODDS, which of the last ODD
       intervals were no whole number of it, nOdd of them; byOdd, the misfit
       test doubted it, and ODD_FROM[0], when that test may again (typed
       arrays, as FITTED: a double stored in a closure's variable is boxed) */
    const HAD = new Float64Array(1), SURE_AT = new Float64Array(1), ODD_FROM = new Float64Array(1), ODDS = new Uint8Array(ODD);
    let ever = false, recheck = false, nOdd = 0, oddAt = 0, byOdd = false;
    /* the window's drawn frames: when, how long after the one before, missed */
    const wT = new Float64Array(WIN), wGap = new Float64Array(WIN), wMiss = new Uint8Array(WIN);
    let head = 0, n = 0, misses = 0;
    /* the last animation frame and the last drawn one; the first; the last
       change of level and the start of the current calm; drawn frames still
       to leave out after a change (the first pays for the change) */
    let lastRaf = 0, lastDraw = 0, startAt = 0, levelSince = 0, calmSince = 0, warm = 2;
    /* failed attempts to go up to each level, and the last attempt: where
       to, when, and from where */
    const fails = new Uint8Array(64);
    let upTo = -1, upAt = 0, upFrom = 0;
    /* the pause's check (THE PAUSE): running, its clean samples and how many
       were fast, and when it may run again */
    let checking = false, checkN = 0, checkFast = 0, checkFrom = 0;
    /* after a pause (AFTER A PAUSE): the wait before the next try, the
       burst's step and fast samples, the test frame's time and the tests'
       costs, and whether the last resume was its own */
    let retryWait = RETRY_MS, bStep = 0, bFast = 0, bT = 0, autoResumed = false;
    const bCost = new Float64Array(BURST_TESTS);

    const kOf = l => (l <= LAST_RES ? 1 : l - LAST_RES + 1);
    const resOf = l => Math.min(RES[Math.min(l, LAST_RES)], maxRes);
    /* the current level's ratio, kept (the header: COST); keepRes after
       every change of level or of maxRes */
    let res = resOf(level);
    const keepRes = () => { const r = resOf(level); if (r !== res) res = r; };
    const kMax = () => Math.max(1, Math.floor(DT_MAX / vsync + 1e-9));
    /* the lowest animated level: 0.75 at the longest cadence the clamp allows */
    const lowest = () => LAST_RES + kMax() - 1;

    /* SORTED[0..m), ascending, in place: an insertion sort (m is at most a
       window of frames, and nearly in order already) */
    function sortTo(m) {
      for (let i = 1; i < m; i++) {
        const v = SORTED[i];
        let j = i - 1;
        while (j >= 0 && SORTED[j] > v) { SORTED[j + 1] = SORTED[j]; j--; }
        SORTED[j + 1] = v;
      }
    }
    function clearWindow() { head = 0; n = 0; misses = 0; }
    /* a new estimate: the window's misses were judged against another one */
    function setVsync(v) { if (v !== vsync) { vsync = v; clearWindow(); } }
    /* the first confirmation; nothing was judged before it, so the calm
       starts with it (THE VSYNC, AGAIN: the calm a step down ends) */
    function confirm() { if (!sure) { sure = ever = true; recheck = false; SURE_AT[0] = lastRaf; calmSince = lastRaf; clearWindow(); } }
    /* THE VSYNC, AGAIN: the confirmed vsync may be another display's now.
       It is measured again; nothing is judged meanwhile (a pause's check
       running ends: it judges against the vsync), and the frames are paced
       by the one it had */
    function doubt() {
      if (!sure) return;
      HAD[0] = vsync;
      sure = checking = false;
      nGaps = gapAt = sinceEstimate = nPure = pureAt = 0;
      FITTED[0] = 0;
    }
    /* measured again: vsync, as it now stands. The one it had: the window,
       judged against the right vsync after all, stands (a step down that
       was due goes ahead at once), and if the misfit test doubted it, the
       frames it went by were this machine's timing, so it rests RECHECK
       (SwiftShader's: 1-2% of its intervals off its 165 Hz grid). Another,
       another display: the window is cleared, every level costs something
       else in vsyncs, so the failed attempts and the frames' costs to the
       vsync are forgotten too, and a cadence keeps its pace - k of the new
       vsyncs no longer than k of the old, within the clamp (k = 10 of 6.06
       ms under a 30 fps cap would be 333 ms) */
    function settle() {
      const had = HAD[0];
      if (vsync === had) { if (byOdd) ODD_FROM[0] = lastRaf + RECHECK; }
      else {
        clearWindow();
        fails.fill(0); upTo = -1; nPost = 0;
        if (held < 0 && level > LAST_RES) {
          level = (LAST_RES - 1 + Math.max(1, Math.min(kMax(), Math.floor(kOf(level) * had / vsync + 1e-6)))) | 0;
          keepRes();
          levelSince = calmSince = lastRaf;
          warm = 2;
        }
      }
      ODDS.fill(0); nOdd = 0;
      sure = true; recheck = byOdd = false; SURE_AT[0] = lastRaf;
    }
    /* the vsync from the pure samples: the median of the last few at the
       nearest common period within SNAP (a late one, after main-thread
       work, does not move it), confirmed once two agree, or one agrees
       with the period that fitted the ring (a catch-up is shorter than it,
       a stall longer), or PURE are in. A cadence calls this every few
       frames, so it allocates nothing: snap's loop inlined (a double
       returned from a call is boxed), and its best error seeded with a
       small integer, not SNAP - a let that starts as a constant read from
       the closure and then takes doubles is a boxed value in optimised
       code once V8 cannot fold the constant (the tools build a governor
       many times), 11 B a frame at ?bgq=6 */
    function fromPure() {
      for (let i = 0; i < nPure; i++) SORTED[i] = pure[i];
      sortTo(nPure);
      const g = SORTED[nPure >> 1];
      let best = g, err = 1;
      for (let c = 0; c < PERIODS.length; c++) {
        const e = Math.abs(g - PERIODS[c]) / PERIODS[c];
        if (e < err) { err = e; best = PERIODS[c]; }
      }
      const v = err < SNAP ? Math.max(2.5, best) : Math.max(2.5, g);
      vsyncKnown = true;
      if (sure) {
        if (v !== vsync && unanimous(err < SNAP)) { HAD[0] = vsync; vsync = v; settle(); }
      } else if (ever) {
        /* measured again (THE VSYNC, AGAIN): the one it had, once the
           samples agree with it; another on the first rule but no longer
           than VSYNC_MAX, so a machine-wide stall's long samples cannot make
           its own frames look a vsync apart (THE PAUSE); after AGAIN_N that
           agree on nothing, the one it had */
        const had = HAD[0];
        if (Math.abs(g - had) <= SNAP * had) settle();
        else if (v <= VSYNC_MAX && (agreeing() >= 2 || v === FITTED[0])) { vsync = v; settle(); }
        else if (nPure >= AGAIN_N) settle();
      } else {
        if (v !== vsync) { vsync = v; clearWindow(); }
        unconfirmed();
      }
    }
    /* Once the vsync is confirmed, the pure samples (a cadence of k = 3 or
       more makes them all the time) move it when all PURE of them agree on
       another common period: another display (THE VSYNC, AGAIN), even one
       a whole number of times slower, whose frames still fit the old. A
       machine-wide stall makes them long and ragged, and a vsync that
       followed them would make the stall's own frames look like one vsync
       apart, which is the pause's test for a page to blame (THE PAUSE). */
    function unanimous(common) {
      if (!common || nPure < PURE) return false;
      const g = SORTED[nPure >> 1], tol = Math.max(0.5, SNAP * g);
      for (let i = 0; i < nPure; i++) if (Math.abs(SORTED[i] - g) > tol) return false;
      return true;
    }
    /* the pure samples in SORTED, their median at SORTED[nPure >> 1] and
       the vsync from it: confirmed? */
    function unconfirmed() {
      if (agreeing() >= 2 || nPure >= PURE || vsync === FITTED[0]) confirm();
    }
    /* how many of the pure samples in SORTED agree with their median */
    function agreeing() {
      const g = SORTED[nPure >> 1], tol = Math.max(0.5, SNAP * g);
      let agree = 0;
      for (let i = 0; i < nPure; i++) if (Math.abs(SORTED[i] - g) <= tol) agree++;
      return agree;
    }
    /* provisional, from the ring (THE VSYNC): the longest common period no
       longer than the ring's low quantile that explains nearly every
       interval as whole periods, catch-ups left out */
    function provisional() {
      for (let i = 0; i < nGaps; i++) SORTED[i] = gaps[i];
      sortTo(nGaps);
      const cut = CATCH_UP * SORTED[nGaps >> 1];
      let lo = 0;
      while (lo < nGaps - 1 && SORTED[lo] < cut) lo++;
      const b = SORTED[lo + Math.floor(LOW_Q * (nGaps - lo))], first = gapAt - nGaps + RING;
      /* a near neighbour of the first period that fits (within 1.25x) may
         fit better: 75 Hz intervals fit 72 Hz too, within its 5% */
      let found = 0, foundErr = 0, singles = 0;
      for (let c = 0; c < PERIODS.length; c++) {
        const p = PERIODS[c];
        if (p > b + Math.max(0.5, 0.05 * p)) continue;
        if (found && p < found / 1.25) break;
        let fit = 0, one = 0, counted = 0, err = 0;
        for (let i = 0; i < nGaps; i++) {
          const g = gaps[(first + i) % RING];
          /* a catch-up, or the late frame just before one */
          if (g < cut || (i + 1 < nGaps && gaps[(first + i + 1) % RING] < cut)) continue;
          counted++;
          if (fits(g, p)) { fit++; err += Math.abs(g - Math.round(g / p) * p); if (g < 1.5 * p) one++; }
        }
        if (counted >= 3 && fit >= FIT_SHARE * counted && (!found || err / fit < foundErr)) {
          found = p; foundErr = err / fit; singles = one / counted;
        }
      }
      vsyncKnown = true;
      FITTED[0] = found;
      const alone = found > 0 && nGaps >= 24 && singles >= SINGLE_SHARE && !ambiguous(found);
      /* measured again (THE VSYNC, AGAIN): the ring confirms another as it
         did the first, but paces nothing, the one it had doing that */
      if (ever) {
        if (alone) { if (found !== vsync) vsync = found; settle(); }
        return;
      }
      /* an estimate to pace by until the probes have spoken, once they have
         only a confirmation; never past VSYNC_MAX (THE VSYNC) */
      if (!nPure) setVsync(found || Math.min(VSYNC_MAX, snap(SORTED[nGaps >> 1])));
      if (alone) { setVsync(found); confirm(); }
    }
    function setLevel(l, now) {
      l = Math.max(0, Math.min(l, lowest()));
      if (l === level) return;
      /* back down from a level it went up to only just now: that attempt
         failed, so back to where it came from, and wait longer next time */
      if (l > level && level === upTo && now - upAt < FAIL_MS) {
        if (fails[level] < 255) fails[level]++;
        l = upFrom;
        upTo = -1;
      }
      if (l < level) { upTo = l; upAt = now; upFrom = level; }
      level = l;
      keepRes();
      levelSince = calmSince = now;
      warm = 2;
      checking = false;
      clearWindow();
    }
    /* the window's intervals between drawn frames, or the intervals after
       them (the frames' own cost, to the vsync), sorted into SORTED; of m,
       the q-quantile is SORTED[pick(q, m)], read in place (a double
       returned from a call V8 does not inline is boxed: 16 B a frame at a
       cadence) */
    function sortWindow() {
      for (let i = 0; i < n; i++) SORTED[i] = wGap[(head - n + i + WIN) % WIN];
      sortTo(n);
    }
    function sortPost() {
      for (let i = 0; i < nPost; i++) SORTED[i] = post[i];
      sortTo(nPost);
    }
    const pick = (q, m) => Math.min(m - 1, Math.floor(q * m));
    function stepDown(now) {
      /* to be acted on, a vsync confirmed RECHECK ago or more, or before a
         resize or the misses that ended a calm (recheck), is measured again
         first (THE VSYNC, AGAIN): a display a whole number of times slower
         (120 -> 60 Hz, or a 30 fps cap at 60 Hz) still fits the frames, and
         only makes them miss */
      if (!checking && (recheck || now - SURE_AT[0] >= RECHECK)) { doubt(); return; }
      sortWindow();
      const cost = SORTED[pick(0.5, n)];
      if (level < LAST_RES) {
        /* the first resolution the measured cost predicts will fit, skipping
           levels that change nothing (at dpr 1, levels 1-3 are all 1). A
           frame that took m vsyncs cost between m - 1 and m of them: take
           m - 1/2. */
        const r0 = resOf(level), c = Math.max(cost - vsync / 2, vsync / 2);
        let to = level + 1;
        while (to < LAST_RES && (resOf(to) >= r0 || c * (resOf(to) / r0) * (resOf(to) / r0) > vsync)) to++;
        setLevel(to, now);
        return;
      }
      /* a cadence: from the measured cost, enough vsyncs for a frame to fit with room */
      const k = kOf(level);
      if (k < kMax()) {
        setLevel(LAST_RES - 1 + Math.min(kMax(), Math.max(k + 1, Math.ceil(SORTED[pick(0.9, n)] / vsync - MARGIN))), now);
        return;
      }
      /* the lowest animated level: too slow to animate at all? If so, is it
         the page (THE PAUSE)? */
      if (autoPause && !checking && cost > PAUSE_MS && now - levelSince >= PAUSE_DWELL && now >= checkFrom) {
        checking = true; checkN = checkFast = 0;
      }
    }
    function stepUp(now) {
      /* the shortest wait first, so a calm frame sorts nothing */
      if (now - calmSince < UP_DWELL) return;
      let to = level - 1;
      if (level <= LAST_RES) {
        /* the next resolution up, at the first level that has it */
        while (to >= 0 && resOf(to) === resOf(level)) to--;
        if (to < 0) return;
        while (to > 0 && resOf(to - 1) === resOf(to)) to--;
      } else {
        /* a shorter cadence, as far as the frames' own cost allows */
        if (nPost < MIN_N) return;
        sortPost();
        const k = Math.max(1, Math.ceil(SORTED[pick(0.9, nPost)] / vsync - MARGIN));
        if (k >= kOf(level)) return;
        to = LAST_RES + k - 1;
      }
      if (now - calmSince < UP_DWELL * Math.pow(4, Math.min(fails[to], 3))) return;
      setLevel(to, now);
    }
    /* a clean sample in the pause's check, judged with the drawn frame it
       follows: the page is to blame when that frame still took over
       PAUSE_MS (to the second frame after it, less a vsync, as the tries
       after a pause time their tests) while the interval after that second
       frame, the machine's own pace, stayed within FAST_K vsyncs. The cost
       that started the check is the window's, and it was judged alone: a
       check that ran on past the end of a machine-wide stall found its
       last samples fast and paused a page that was fast again (the
       governor before THE VSYNC, AGAIN did so in 57 of 161 stalls ending
       0.25 s apart from 20 to 60 s in; check-governor) */
    function judge(gap, now) {
      checkN++;
      if (gap <= FAST_K * vsync && now - gap - lastDraw - vsync > PAUSE_MS) checkFast++;
      if (checkN < CHECK_N) return;
      checking = false;
      if (checkFast >= FAST_N) pauseAsked = true;
      else checkFrom = now + PAUSE_DWELL;
    }

    /* One animation frame at time now (ms): true to draw it. */
    function frame(now) {
      const gap = lastRaf ? now - lastRaf : 0, after = lastDrew, quiet = undrawn;
      lastRaf = now;
      if (!startAt) startAt = now;
      if (gap > 0 && gap < 1000) {
        /* THE VSYNC, AGAIN: is this interval a whole number of the
           confirmed vsync, within max(0.5 ms, SNAP of one)? If ODD_N of the
           last ODD are not, it is doubted. Not in the pause's check, which
           judges against the vsync it had */
        if (sure && needVsync && !checking) {
          const r = Math.round(gap / vsync), odd = r < 1 || Math.abs(gap - r * vsync) > Math.max(0.5, SNAP * vsync) ? 1 : 0;
          nOdd += odd - ODDS[oddAt];
          ODDS[oddAt] = odd;
          oddAt = (oddAt + 1) % ODD;
          if (nOdd >= ODD_N && now >= ODD_FROM[0]) { byOdd = true; doubt(); }
        }
        /* a pure sample is clean only when two frames before this one drew
           nothing: with one, the drawn frame's GPU work can still be in
           flight - a browser lets the next frame start before it is done -
           and hold this one back (SwiftShader: "pure" samples of 218 ms,
           read as the vsync, and a slow page never stepped down). The
           pause's check judges its own and keeps none: it runs when the
           machine may be stalled. */
        if (!after && quiet >= 2) {
          if (checking) judge(gap, now);
          /* before the first confirmation, one longer than VSYNC_MAX is the
             GPU or the machine holding the frame, not the display: not kept
             (THE VSYNC), so the ring's estimate paces until a sample that
             can be the vsync comes */
          else if (ever || gap <= VSYNC_MAX) {
            pure[pureAt] = gap; pureAt = (pureAt + 1) % PURE;
            if (nPure < PURE) nPure++;
            fromPure();
            if (!sure) probeAt = now + PROBE_GAP;
          } else probeAt = now + PROBE_GAP;
        } else if (after) {
          post[postAt] = gap; postAt = (postAt + 1) % POST;
          if (nPost < POST) nPost++;
          if (!sure) {
            gaps[gapAt] = gap; gapAt = (gapAt + 1) % RING;
            if (nGaps < RING) nGaps++;
            /* every 16 intervals once there are 24; sooner when frames are
               slow, so a slow machine is not left undecided */
            if ((++sinceEstimate >= 16 && nGaps >= 24) || (!vsyncKnown && nGaps >= 4 && now - startAt >= 2000)) {
              sinceEstimate = 0;
              provisional();
            }
          }
        }
      }
      /* a held level, kept to the dt clamp once the vsync has been known for
         sure (and while it is measured again, by the one it had) */
      if (held >= 0) {
        const l = ever ? Math.min(held, lowest()) : held;
        if (l !== level) { level = l; keepRes(); }
      }
      const k = kOf(level);
      /* evenly paced: at a cadence, draw once k vsyncs have passed since
         the last draw (at every vsync, every frame the browser gives is
         drawn); while the vsync is not confirmed, nothing at all in two
         frames now and then, for a pure sample of it (a probe; a held
         cadence, k = 2, makes none of its own); and in the pause's check,
         nothing in the two frames after a drawn one */
      lastDrew = false;
      undrawn = quiet + 1;
      if (k > 1 && lastDraw && now - lastDraw < (k - 0.5) * vsync) return false;
      if (needVsync && !sure && (vsyncKnown || held > LAST_RES) && now >= probeAt && quiet < 2) return false;
      if (checking && quiet < 2) return false;
      lastDrew = true;
      undrawn = 0;
      const since = lastDraw ? now - lastDraw : 0;
      lastDraw = now;
      if (held >= 0 || !since) return true;
      if (warm > 0) { warm--; return true; }
      /* nothing is judged against a vsync that is not confirmed */
      if (!sure) return true;
      /* the window: this frame in; frames older than WINDOW out, keeping MIN_N */
      const miss = since > (k + 0.5) * vsync ? 1 : 0;
      if (n === WIN) { misses -= wMiss[(head - n + WIN) % WIN]; n--; }
      wT[head] = now; wGap[head] = since; wMiss[head] = miss; misses += miss;
      head = (head + 1) % WIN; n++;
      while (n > MIN_N && wT[(head - n + WIN) % WIN] < now - WINDOW) { misses -= wMiss[(head - n + WIN) % WIN]; n--; }
      if (now - startAt < START_GRACE) return true;
      const rate = misses / n;
      /* misses that end a calm of CALM_LONG or more: something changed - the
         load, or the display - so the vsync is measured again before the
         step down they may bring (THE VSYNC, AGAIN) */
      if (rate > MISS_UP) { if (now - calmSince >= CALM_LONG) recheck = true; calmSince = now; }
      if (rate >= MISS_DOWN && n >= MIN_N && now - levelSince >= DWELL_DOWN) stepDown(now);
      else if (rate <= MISS_UP && now - levelSince >= DWELL_MIN) stepUp(now);
      return true;
    }
    /* Timing to forget: after a pause, a hidden tab or a context restore the
       next interval is not a frame's cost. resized: the window changed size,
       so every level costs something else now - failures forgotten too -
       and the vsync is measured again before the next step down, since a
       window moved to another monitor can come with a resize. Not at once:
       main.js says resized at every size a dragged window passes through,
       and a probe at each would leave frames undrawn all through the drag
       (THE VSYNC, AGAIN). */
    function reset() { lastRaf = lastDraw = 0; lastDrew = true; undrawn = 0; warm = 2; nPost = 0; bStep = 0; checking = false; clearWindow(); }
    function resized() { reset(); fails.fill(0); upTo = -1; recheck = true; }
    /* the display's density changed (another monitor): level 0's ratio, and
       the vsync measured again at once, since the refresh rate may well have
       changed with it (THE VSYNC, AGAIN) */
    function setMaxRes(r) {
      const m = Math.min(Math.max(r || 1, 0.5), 2);
      if (m === maxRes) return;
      maxRes = m;
      keepRes();
      if (needVsync) doubt();
    }
    /* the motion was played again after a performance pause, at time now:
       by the visitor (it never pauses itself again this visit), or by
       itself (auto: pausedFrame said so) */
    function resumeAfterPause(now, auto) {
      if (!auto) autoPause = false;
      autoResumed = !!auto;
      pauseAsked = false;
      reset();
      if (held < 0) { level = lowest(); keepRes(); levelSince = calmSince = now; }
    }
    /* true when the motion should pause for performance; it waits for its
       tries at resuming (pausedFrame) at the lowest animated level, whose
       resolution they measure */
    function takePause() {
      const ask = pauseAsked && autoPause;
      pauseAsked = false;
      if (ask) {
        if (autoResumed) retryWait = Math.min(2 * retryWait, RETRY_MAX);
        autoResumed = false;
        checking = false;
        bStep = 0;
        if (held < 0) { level = lowest(); keepRes(); }
      }
      return ask;
    }
    /* One animation frame of a try at resuming after a performance pause
       (AFTER A PAUSE), at time now: SAMPLE, TEST, RESUME or DONE. */
    function pausedFrame(now) {
      const gap = bStep && lastRaf ? now - lastRaf : 0, step = bStep++;
      lastRaf = now;
      if (step === 0) { bFast = 0; return SAMPLE; }
      if (step <= BURST_N) {
        if (gap > 0 && gap <= FAST_K * vsync) bFast++;
        if (step < BURST_N || bFast >= BURST_N - 1) return SAMPLE;
        bStep = 0;
        return DONE;
      }
      /* the tests: a still frame, then two that draw nothing; its cost is
         the time to the second, less a vsync (a GPU that lets the next
         frame start before it is done holds the one after) */
      const j = step - BURST_N - 1, i = (j / 3) | 0, ph = j - 3 * i;
      if (ph === 0) { bT = now; return TEST; }
      if (ph === 1) return SAMPLE;
      bCost[i] = now - bT - vsync;
      if (i + 1 < BURST_TESTS) return SAMPLE;
      bStep = 0;
      for (let t = 0; t < BURST_TESTS; t++) SORTED[t] = bCost[t];
      sortTo(BURST_TESTS);
      if (SORTED[BURST_TESTS >> 1] <= DT_MAX) return RESUME;
      retryWait = Math.min(2 * retryWait, RETRY_MAX);
      return DONE;
    }
    return {
      frame, reset, resized, setMaxRes, resumeAfterPause, takePause, pausedFrame, TEST, RESUME, DONE,
      /* this frame's bitmap px per CSS px, and (for the tools and QA) the
         level, the cadence and the vsync it is working from, and whether
         that vsync is confirmed */
      get res() { return res; },
      get level() { return level; },
      get k() { return kOf(level); },
      get vsync() { return vsync; },
      get sure() { return sure; },
      /* ms from a performance pause, or a burst that did not resume, to
         the next try (main.js) */
      get retryIn() { return retryWait; }
    };
  };
})();
