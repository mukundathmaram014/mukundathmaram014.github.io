/* The background's bootstrap and frame loop, and the only background script
   that touches the page. It starts the WebGL renderer on #cosmos, keeps it
   and the scene sized to the canvas's own box, forwards the pointer to the
   scene, follows the motion setting, tells the renderer where the opaque
   card is, and runs the requestAnimationFrame loop: each frame the quality
   governor (governor.js) says whether to draw it and at what resolution,
   the scene moves on (scene.js, Bg.advance) - or holds where it stands
   while the motion is paused (Bg.hold) - and the renderer draws it.

   Where there is no WebGL (or the renderer cannot start, or a lost context
   never comes back) it shows a still picture of the scene instead:
   document.documentElement.dataset.bg = 'static', which index.html's
   stylesheet turns into assets/img/bg-still.webp behind the card, and
   site.css into no motion toggle, since nothing moves.

   index.html loads it last of the assets/js/bg/ scripts, all plain
   synchronous <script src> tags at the end of <body>. It looks #cosmos up
   the moment it runs, so the canvas element must already exist: keep the
   tags after the canvas, not async in <head>. _tools/harness.js runs them
   all in node for every check, swapping only this file's last statement
   (the loop starter) for a probe. */
(function () {
  const Bg = window.Bg;
  const canvas = document.getElementById('cosmos');
  if (!canvas) return;
  const root = document.documentElement;
  /* The still picture in place of the animation: nothing is drawn, no
     frame is asked for, and the motion toggle goes (site.css). */
  let showingStill = false;
  function goStatic() {
    showingStill = true;
    if (root.dataset) root.dataset.bg = 'static';
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    stopRetry();
  }
  /* The renderer. 'webgl2' first, then 'webgl'; if neither, or a shader
     that will not compile, it says why in one console warning and is null.
     It builds its scenery for a new size at once, but no more than once
     every REBUILD_MS while a window is dragged, fitting the meshes it has
     to the sizes in between, and asks for the frame that builds the last
     one through onSettle: a paused page has none coming. */
  const renderer = Bg.renderers.webgl ? Bg.renderers.webgl(canvas, { onSettle: wake }) : null;
  /* the frame asked for; a still frame due (wake); the performance pause's
     next try and whether one is running (retryLater) */
  let rafId = 0, stillDue = true, retryTimer = 0, retrying = false;
  if (!renderer) { goStatic(); return; }

  /* The quality governor (governor.js), and its override for QA: ?bgq=<n>
     holds level n, ?bgq=pause asks for the performance pause at once. */
  const q = /[?&]bgq=([^&#]*)/.exec(window.location.search || '');
  const held = q && /^\d+$/.test(q[1]) ? +q[1] : undefined;
  const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);
  const gov = Bg.governor({ maxRes: dprNow(), level: held, pause: !!q && q[1] === 'pause' });
  /* For QA and the tools, read only: the level, its res and cadence k, the
     vsync and whether it is confirmed (sure), as they stand. The canvas no
     longer shows the level - it stays at level 0's size (render-webgl.js,
     THE LEVELS). */
  Bg.gov = gov;

  /* The motion setting (WCAG 2.2.2 Pause, Stop, Hide; audit G5.1, F10, F3).
     The page loads with document.documentElement.dataset.motion set to
     'paused' or 'running' by the inline script in <head> (the visitor's
     saved choice, else the reduced-motion setting); without it the
     reduced-motion setting decides here. From then on a 'bgmotion' event on
     document, detail { paused }, changes it - the motion button, the OS
     setting changing (site.js), the governor below, or anything else that
     has to stop the motion.

     Paused, the next frame is a still one - the scene exactly as it stands,
     without the ring, which would sit frozen away from the moving pointer -
     and no further frame is asked for. A size, dpr or context change paints
     the still frame again. Resuming resets the clock, so the scene carries
     on from where it stopped as if no time had passed. A page that loads
     paused shows scene time 0: the composition the reduced-motion page
     always showed (orbit phase 1.2, the swell and terrain at time 0).

     The governor's last resort is the same pause, with reason
     'performance': it sets dataset.motion itself and saves nothing, so the
     visitor's own choice is never overwritten. It used to last the rest of
     the visit unless the visitor pressed play, even when what had slowed
     the page down was gone. Now, while the pause is still the governor's
     own, it asks for a short burst of frames now and then (retryLater,
     governor.js AFTER A PAUSE), which draw nothing but its tests - still
     frames of the scene as it stands, the same picture - and when they
     show the machine can animate again it resumes by itself: detail
     { paused: false, reason: 'performance' }, dataset.motion 'running',
     nothing saved, the button following as it follows every bgmotion
     (site.js). A pause anyone else asks for - the button, the OS's reduced
     motion - is theirs and is never undone, even over one of the
     governor's own. Played again by the visitor, it runs at its lowest
     animated level and does not pause itself again this visit. */
  const motion = root.dataset ? root.dataset.motion : undefined;
  let paused = motion === 'paused' ? true : motion === 'running' ? false
             : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let forPerformance = false;
  /* own: the bgmotion said reason 'performance' (the governor's resume) */
  function setPaused(p, own) {
    if (p === paused) return;
    paused = p;
    if (paused) Bg.pointerStale();
    else {
      Bg.resetClock();
      if (forPerformance) gov.resumeAfterPause(window.performance.now(), own);
      else gov.reset();
      forPerformance = false;
      stopRetry();
    }
    wake();
  }
  document.addEventListener('bgmotion', e => {
    if (!(e && e.detail && typeof e.detail.paused === 'boolean')) return;
    const own = e.detail.reason === 'performance';
    if (e.detail.paused && !own) { forPerformance = false; stopRetry(); }
    setPaused(e.detail.paused, own);
  });
  function pauseForPerformance() {
    forPerformance = true;
    root.dataset.motion = 'paused';
    document.dispatchEvent(new window.CustomEvent('bgmotion', { detail: { paused: true, reason: 'performance' } }));
    retryLater();
  }
  function resumeForPerformance() {
    root.dataset.motion = 'running';
    document.dispatchEvent(new window.CustomEvent('bgmotion', { detail: { paused: false, reason: 'performance' } }));
  }
  /* the performance pause's next try at resuming, gov.retryIn ms on, while
     the pause is still its own: a burst of frames, which tick hands to
     gov.pausedFrame */
  function retryLater() {
    stopRetry();
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      if (paused && forPerformance) { retrying = true; arm(); }
    }, gov.retryIn);
  }
  function stopRetry() {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = 0;
    retrying = false;
  }

  /* The size comes from the canvas's own box, not from window.innerWidth:
     innerWidth includes a classic scrollbar the fixed canvas does not cover,
     so the bitmap was squeezed into a box 17px narrower, every line went
     soft, and the ring sat up to 16.5px left of the pointer (audit F2). The
     box, the dpr and the pointer offset are read here (fit) at the top of a
     frame, just before it draws, and only when something says they may have
     changed: a 'resize', the ResizeObserver (a scrollbar appearing does not
     fire 'resize'), or devicePixelRatio moving without one (a monitor with a
     different scale; checked every frame, and by a resolution query while
     paused). A new size clears the bitmap, so doing it anywhere but right
     before a draw could show a blank frame.

     The bitmap is dpr px per CSS px, min(dpr, 2), the governor's top level;
     the scene is drawn at res, the governor's resolution, which is less
     below that level: in the canvas's top-left corner, that corner shown
     over the whole box, so a change of level resizes no canvas and costs
     no frame (render-webgl.js, THE LEVELS). It is applied in the frame
     that draws at it (applyRes), so a change of level never shows a blank
     frame. */
  let W = 0, H = 0, dpr = 0, res = 0, left = 0, top = 0, sizeDirty = true;
  function fit() {
    sizeDirty = false;
    /* the box as laid out: below level 0, in a browser without
       object-view-box, the renderer scales the canvas up by a CSS
       transform, which getBoundingClientRect would count */
    const scaled = canvas.style.transform;
    if (scaled) canvas.style.transform = 'none';
    const box = canvas.getBoundingClientRect();
    if (scaled) canvas.style.transform = scaled;
    const r = dprNow();
    left = box.left; top = box.top;
    if (box.width === W && box.height === H && r === dpr) return;
    W = box.width; H = box.height; dpr = r;
    Bg.setSize(W, H);
    measureCard(box);
    gov.setMaxRes(dpr);
    gov.resized();
    cardDirty = true;
    if (W > 0 && H > 0) applyRes(true);
  }
  function applyRes(always) {
    const r = gov.res;
    if (!always && r === res) return;
    res = r;
    renderer.resize(W, H, res, dpr);
  }
  /* The card the page's text sits on (.shell), for the scene to keep the
     sun out from under it (Bg.setCard; audit G4.4): its edges in the
     canvas's own CSS px, and its top as it stands with the page scrolled
     to the top, since the card scrolls and the canvas does not. Measured
     with the size, because only a change of size moves it: it is centred,
     its top is the body's padding, and the scrollbar's gutter is reserved
     on every tab (site.css), so a tab switch cannot shift it. Read from the
     layout rather than copied from site.css, so the two cannot drift. A
     page without one gets the sun where the scene puts it with no card. */
  const card = document.querySelector('.shell');
  function measureCard(box) {
    if (!card) { Bg.setCard(); return; }
    const c = card.getBoundingClientRect();
    Bg.setCard(c.left - box.left, c.right - box.left, c.top + (window.scrollY || 0) - box.top);
  }
  /* The card is also opaque, and covers the middle of the canvas: about
     half of what a frame draws at 1440x900 and nearly all of it on a phone
     (audit F14). The renderer is told where (renderer.occlude) and writes
     depth there first, so the GPU rejects every fragment the card hides
     before shading it. Inset by the card's corner radius, so the hole never
     shows at a corner, and by SLACK above and below: the compositor scrolls
     the card on its own thread and can be a frame or two ahead of the
     canvas. While the page scrolls (and SCROLL_QUIET ms after) there is no
     hole at all, so a fast fling cannot outrun it, and a still frame has
     none either: it is not redrawn as the card moves.

     The card is measured when something can have changed it, and only
     then, never every frame: a resize; a change in it - its own attributes
     (shown, hidden, restyled) or anything inside it (a tab switch is a
     class on a panel; content or text changing) - which its
     MutationObserver reports before the next frame; and whatever else
     changes its size (a font or an image arriving), which only its
     ResizeObserver sees, after the frame that first shows it, so up to
     SLACK px late. A tab switch used to wait for that: the first frame
     kept the old hole under a card that had got shorter, 501px of page
     grey from about to writing at 1440x900 (headless Chrome, found for
     the W3 review; _tools/check-occluder-gate.js). A scroll only moves
     the hole, by scrollY. A card that is not fully opaque (hidden, faded,
     a translucent background) gets no hole. Measured: the same pixels to
     the bit everywhere the card does not cover; the GPU's time per frame in
     _tools/check-occluder.js. A frame's part is allocation-free: the quiet
     time is judged on the frame's own timestamp (performance.now() would
     box a fresh double every frame) and the hole is rounded inward to
     whole px (four fractional px handed to the renderer would be boxed
     whenever V8 does not inline the call). */
  const SLACK = 160, SCROLL_QUIET = 200;
  let cardDirty = true, cardOn = false, cardL = 0, cardR = 0, cardT = 0, cardB = 0, cardInset = 0, scrollY = 0, scrolledAt = -1e9;
  function measureOccluder() {
    cardDirty = false;
    cardOn = false;
    if (!card || !window.getComputedStyle) return;
    const cs = window.getComputedStyle(card);
    const prop = n => String(cs.getPropertyValue(n) || '').trim();
    if (prop('visibility') !== 'visible' || prop('opacity') !== '1' || prop('display') === 'none'
        || !/^rgb\(/.test(prop('background-color'))) return;
    const c = card.getBoundingClientRect();
    scrollY = window.scrollY || 0;
    cardL = c.left - left; cardR = c.right - left; cardT = c.top + scrollY - top; cardB = c.bottom + scrollY - top;
    cardInset = parseFloat(prop('border-top-left-radius')) || 0;
    cardOn = c.width > 0 && c.height > 0;
  }
  function occlusion(now) {
    if (cardDirty) measureOccluder();
    /* the scene's cover, as the card stands now (scene.js COVER) */
    if (cardOn) Bg.setCover(cardL, cardT - scrollY, cardR, cardB - scrollY); else Bg.setCover();
    if (!cardOn || now - scrolledAt < SCROLL_QUIET) { renderer.occlude(); return; }
    const x0 = Math.ceil(Math.max(0, cardL + cardInset)), x1 = Math.floor(Math.min(W, cardR - cardInset));
    const y0 = Math.ceil(Math.max(0, cardT - scrollY + cardInset + SLACK)), y1 = Math.floor(Math.min(H, cardB - scrollY - cardInset - SLACK));
    if (x1 > x0 && y1 > y0) renderer.occlude(x0, y0, x1, y1);
    else renderer.occlude();
  }
  window.addEventListener('scroll', () => { scrollY = window.scrollY || 0; scrolledAt = window.performance.now(); }, { passive: true });
  if (card) {
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { cardDirty = true; }).observe(card);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => { cardDirty = true; }).observe(card, {
        attributes: true, attributeFilter: ['style', 'class', 'hidden'], childList: true, characterData: true, subtree: true
      });
    }
  }

  function resized() { sizeDirty = true; wake(); }
  fit();
  window.addEventListener('resize', resized);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      if (box.width !== W || box.height !== H) resized();
    }).observe(canvas);
  }
  (function watchDpr() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    if (mq.addEventListener) mq.addEventListener('change', () => { resized(); watchDpr(); }, { once: true });
  })();

  /* A lost context (a GPU reset, a driver update, a switch between GPUs)
     shows nothing while it is gone - the canvas is transparent - and the
     renderer rebuilds itself when it comes back, in its own listener,
     which runs before these: then refit and paint (a paused page has no
     frame coming that would). One that is not back within LOST_MS, or that
     comes back broken, gets the still picture in its place; one that comes
     back later after all takes over again. */
  const LOST_MS = 3000;
  let lostTimer = 0;
  canvas.addEventListener('webglcontextlost', () => {
    window.clearTimeout(lostTimer);
    lostTimer = window.setTimeout(() => { if (!renderer.alive()) goStatic(); }, LOST_MS);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    window.clearTimeout(lostTimer);
    if (!renderer.alive()) { goStatic(); return; }
    if (showingStill) { showingStill = false; delete root.dataset.bg; }
    dpr = 0;
    gov.reset();
    resized();
  });

  /* Every sample, with its time: Chrome hands the page one pointermove per
     frame and folds the rest into getCoalescedEvents(), and the scene reads
     the path back at a fixed short delay (scene.js smoothAt), so it needs
     them all to pace the ring and the field evenly. A finger is not a
     cursor: the scene animates on a touch screen but does not answer it (the
     owner: interactivity "wont be easy to do on a phone"), so a drag that
     scrolls the page does not dent the floor or bloom the mountains. A
     mouse or a pen still does, on any device. */
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length) for (const c of list) Bg.pointerAt(c.clientX - left, c.clientY - top, c.timeStamp);
    else Bg.pointerAt(e.clientX - left, e.clientY - top, e.timeStamp);
  }, { passive: true });
  window.addEventListener('pointerout', e => { if (!e.relatedTarget) Bg.pointerGone(); }, { passive: true });
  window.addEventListener('blur', () => { Bg.pointerGone(); });
  /* No frames run while the tab is hidden; the first one back must be one
     ordinary step, not the whole time away (audit F6), and a pointer that
     moved meanwhile must not drag the field across the sheet. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Bg.pointerStale();
    Bg.resetClock();
    gov.reset();
  });

  /* The loop. A frame is re-armed BEFORE it does any work, so one that
     throws cannot stop the animation: it used to be re-armed on its last
     line, so a single exception left the background blank for the rest of
     the visit (audit G4.1). The scene is then reset (Bg.recover) and the
     renderer resized, which clears whatever state the throw left half-set.
     The first failure is logged, and a run of 60, so a fault that repeats is
     not hidden. A still frame that fails is tried again twice. A frame with
     no box to draw in is skipped. An animation frame the governor passes
     over (its cadence) does nothing at all: the scene's clock moves on by
     dt, so the next one drawn is where it should be. */
  let failures = 0, reported = false;
  /* wake: a frame, which paints the still frame if the motion is paused;
     arm: a frame, nothing more (the performance pause's tries) */
  function wake() { stillDue = true; arm(); }
  function arm() { if (!rafId && !showingStill) rafId = window.requestAnimationFrame(tick); }
  function tick(now) {
    rafId = 0;
    if (showingStill) return;
    if (!paused || retrying) rafId = window.requestAnimationFrame(tick);
    try {
      if (sizeDirty || dprNow() !== dpr) fit();
      if (!(W > 0 && H > 0)) { Bg.resetClock(); gov.reset(); return; }
      if (paused) {
        /* while the performance pause tries to end itself, each frame is
           the governor's: nothing, a test (the still frame again), resume,
           or wait for the next try. A frame woken to repaint in the middle
           of a try spoils its timing, so the try starts again. */
        const a = retrying ? gov.pausedFrame(now) : 0;
        if (stillDue || a === gov.TEST) {
          if (retrying && a !== gov.TEST) gov.reset();
          stillDue = false;
          applyRes(false);
          renderer.occlude();
          renderer.draw(Bg.hold(), true);
        }
        if (a === gov.RESUME) resumeForPerformance();
        else if (a === gov.DONE) {
          if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
          retryLater();
        }
      } else {
        stillDue = false;
        if (!gov.frame(now)) return;
        applyRes(false);
        occlusion(now);
        renderer.draw(Bg.advance(now), false);
        if (gov.takePause()) pauseForPerformance();
      }
      failures = 0;
    } catch (err) {
      failures++;
      if (!reported || failures === 60) {
        reported = true;
        console.error(failures === 60 ? 'background: 60 frames in a row have failed' : 'background: a frame failed and the scene was reset', err);
      }
      try {
        Bg.recover();
        if (W > 0 && H > 0) renderer.resize(W, H, res, dpr);
      } catch { /* the next frame tries again */ }
      /* a still frame is not followed by another: give it two more tries */
      if (paused && failures < 3) wake();
    }
  }
  /* The loop starter: the first frame, still or moving as the page loads.
     _tools/harness.js finds this exact line (its START) and puts its probe
     here; if you change the line, change START too. */
  rafId = requestAnimationFrame(tick);
})();
