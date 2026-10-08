/* The scene: everything about the background except how it is drawn.

   The ocean sheet and its projection, the swell and the swell events, the
   three orbiting bodies and their gravity wells, the pointer (the eased look,
   the cursor well and its pushes on the terrain, the ring marker), and the
   scenery's data tables and layout. The renderer (render-webgl.js) decides
   only how those things look. It evaluates the sheet and everything
   standing on it on the GPU from this file's own numbers (WAVE and the
   rest, above waveBase; the scenery's tables and layout, ridgeSummits and
   peakPlace; the cursor's pushes, from TPUSH), so they stay the one copy.

   It touches no DOM, no canvas and no clock of its own. main.js hands it the
   viewport (Bg.setSize), the pointer (Bg.pointerAt, Bg.pointerGone) and each
   frame's time (Bg.advance), and everything else follows deterministically
   from those. Its one global is the namespace it publishes, globalThis.Bg
   (window.Bg on the page). _tools/check-scene-headless.js runs this file
   alone in node, with no DOM or canvas at all, and checks that it reproduces
   the page's state bit for bit.

   Time is the scene's own (simNow, below advance): it starts at 0 and moves
   on by each frame's clamped dt, so a stall, a hidden tab or a pause can
   never land in one frame. A frame is either advance(now), one step, or
   hold(), the scene exactly as it stands for a still frame (the motion
   pause). Nothing the scene stores can become non-finite: bad input is
   refused and anything that goes wrong is reset to a sane value in the same
   frame (_tools/check-robustness.js).

   A frame of it allocates no records, closures or iterators and
   recomputes nothing that is constant (audit F16, F17, F19): every
   per-frame record is made once and refilled in place (the orbit,
   bodiesAt's, sunAt's), loops are indexed, the swell event's shape is
   derived once per event, and the push budget once per size. advance()
   allocated ~7 KB a frame before (sane()'s for-in over a dozen object
   shapes 2.4 KB, Math.hypot's argument array 1.9 KB, the rest the orbit's
   and the for-of loops' iterators); what is left, ~0.95 KB, is V8 boxing
   doubles across the few calls it does not inline, and
   _tools/check-scene-alloc.js holds it under 1,600 B.

   index.html loads it first of the assets/js/bg/ scripts. They share
   nothing but Bg: no file declares anything at its top level
   (_tools/check-bg-layout.js). */
(function () {
  /* The viewport in CSS px, from the canvas element's own box. main.js sets
     it on load and whenever the box changes, before it resizes the renderer.
     A new size also sets the scenery's scale, S (rescale, below the cursor's
     terrain constants). Nothing else is kept in screen pixels for a layout:
     the renderer places every base on the floor afresh each frame. */
  let W = 0, H = 0;
  function setSize(w, h) {
    if (!(Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0)) return;
    if (w === W && h === H) return;
    W = w; H = h;
    if (W > 0 && H > 0) {
      const s = Math.max(SCALE_MIN, Math.min(H / SCALE_H, W / SCALE_W));
      if (s !== S) rescale(s);
      forkLayouts();   /* the trees' joints at this scale, made now rather than in a frame (THE FORKS) */
    }
  }
  /* The card: the opaque box the page's text sits on (.shell), which hides
     the middle of the canvas. main.js measures it whenever the size changes
     and hands it over in the canvas's CSS px, as it stands with the page
     scrolled to the top: its left and right edges and its top. Called with
     nothing (or anything not finite), there is no card. Only the sun's
     place depends on it (sunAt). */
  const CARD = { on: false, left: 0, right: 0, top: 0 };
  /* Where the card covers the canvas this frame, in its CSS px - all four
     edges, as the page stands, scrolled or not (main.js hands it over each
     frame from what its occluder measured): nothing blooms under it. CARD
     above is not this: it is the card scrolled to the top and running to
     the canvas's foot, which the sun's place needs; for the bloom it kept
     the mountains a short card uncovers from blooming (the writing tab's
     card ends 500px above the foot at 1440x900). Called with nothing, no
     card covers anything. */
  const COVER = { on: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  function setCover(x0, y0, x1, y1) {
    COVER.on = Number.isFinite(x0 + y0 + x1 + y1) && x1 > x0 && y1 > y0;
    if (COVER.on) { COVER.x0 = x0; COVER.y0 = y0; COVER.x1 = x1; COVER.y1 = y1; }
  }
  function setCard(left, right, top) {
    CARD.on = Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(top) && right > left;
    if (!CARD.on) return;
    CARD.left = left; CARD.right = right; CARD.top = top;
  }

  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  /* The pointer, and the field it carries: a dent in the sheet (CUR, below),
     a push on the terrain (terrainDip, terrainShove, through the terrain's
     own copy of the field, TPUSH) and a pull on the bodies. WHERE the field
     is and HOW STRONG it is are separate.

     Where: ptr (x, y) is one short critically damped follower of the
     pointer (FIELD_W), so the field is under the pointer at every speed.
     It replaced a deliberately slow follower (~1.1s to settle, with a speed
     ceiling) that left the cursor with no field around it for seconds after
     any fast move - the owner's "the ripple takes too long to come".

     How strong: the field is two dents (CUR and RIP, below). The touch
     (CUR) is always on the follower and only CALM_FLOOR deep, so a fast
     move carries a shallow dent and never a deep one. The ripple (RIP) is
     the rest of the depth: it gathers on the follower, slowly, only while
     the follower moves slowly, and when the pointer moves fast it is left
     where it was and relaxes there instead of being dragged along. One
     dent cannot do both: making a single dent shallow fast enough on a
     flick moved the near floor up to 46px in a frame, half of it the deep
     dent being swept along. Both dents press the terrain too, each from
     where it is (TPUSH follows them). ptr.env fades the field in as the
     pointer arrives and out as it leaves.

     ptr.k is the ring marker's own fade (the ring is drawn at mk, below);
     tx/ty is the pointer itself; out says it has left the window (or the
     scene stopped seeing it); back says it has come back since, to be seated
     on the next frame (seat); hop runs from 1 to 0 while the field fades out
     to be put back under a pointer that came back somewhere else. */
  const ptr = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 0, want: 0, seen: false, out: false,
                back: false, env: 0, hop: 0, lsx: 0, lsy: 0, pvx: 0, pvy: 0 };
  /* The marker: where the ring is drawn - the pointer itself, copied in
     every frame (advance). It was a follower of its own (MW 34, a hair
     quicker than the field's), so it trailed a moving pointer by ~53ms: up
     to 223px behind the tip of a 6,000px/s flick at 165Hz (the final QA
     lens: 130-255px at 2,000-6,000px/s), and after a pause it swept, at
     full alpha, from wherever the pointer had first moved meanwhile to
     where it was (the regression lens: ~1150px). A marker has nothing to
     smooth: the pointer's own place is the right one, and from there the
     ring cannot streak in from anywhere (audit F4). */
  const mk = { x: 0, y: 0 };
  /* The pointer's path, as timestamped samples, read back each frame at a
     short fixed delay (smoothAt) for the ring and as the follower's target.

     Why not just the newest event: a mouse reports at its own rate, not the
     display's. A 125Hz mouse on a 165Hz display gives the page a new
     position on only three frames in four, and on the fourth none, so a
     ring drawn at the newest event froze on 202 of 800 frames of a steady
     circle and then jumped twice as far: its frame-to-frame step spread
     0.65 (coefficient of variation) against the path's own 0.27 - the
     owner's "it flicks around". The follower, chasing that stepping target,
     carried the same stutter into its speed, and so into the ripple's
     let-go test (CALM_DRAG).

     Reading the path at now - delay, between the two samples that bracket
     it, gives every frame the position the pointer really had then: even
     steps at any mouse and display rate. The delay is just long enough
     that a newer sample always exists - the newest sample's age as frames
     find it, held at its recent peak (up at once, down slowly) - so ~8ms
     at 125Hz, ~1ms with a 1000Hz mouse (main.js feeds the coalesced
     samples), never past SMOOTH_MAX. A pointer that stops is reached
     exactly, that delay later; nothing is extrapolated, so nothing
     overshoots. Untimed samples (a clock that disagrees with the frames')
     fall back to the newest position. */
  const SMOOTH_N = 16, SMOOTH_MAX = 24, SMOOTH_MIN = 0.5;
  const ps = { t: new Float64Array(SMOOTH_N), x: new Float64Array(SMOOTH_N), y: new Float64Array(SMOOTH_N),
               n: 0, head: -1, delay: 8, timed: true, sx: 0, sy: 0, iv: 8 };
  function sampleAt(x, y, t) {
    if (!(Number.isFinite(t) && (lastNow === 0 || Math.abs(t - lastNow) < 1000))) { ps.timed = false; ps.n = 0; return; }
    ps.timed = true;
    if (ps.n > 0 && !(t > ps.t[ps.head])) {            /* same instant, or out of order: the newer place wins */
      ps.x[ps.head] = x; ps.y[ps.head] = y; return;
    }
    /* the mouse's own sample interval, from moves (a gap of 50ms or more is a rest) */
    if (ps.n > 0) { const g = t - ps.t[ps.head]; if (g > 0 && g < 50) ps.iv += (g - ps.iv) * 0.25; }
    ps.head = (ps.head + 1) % SMOOTH_N;
    ps.t[ps.head] = t; ps.x[ps.head] = x; ps.y[ps.head] = y;
    if (ps.n < SMOOTH_N) ps.n++;
  }
  /* the pointer's place at time tq, from the samples (ps.sx, ps.sy) */
  function smoothAt(tq) {
    if (!ps.timed || ps.n === 0) { ps.sx = ptr.tx; ps.sy = ptr.ty; return; }
    let j = ps.head;
    if (tq >= ps.t[j]) { ps.sx = ps.x[j]; ps.sy = ps.y[j]; return; }
    for (let k = 1; k < ps.n; k++) {
      const i = (ps.head - k + SMOOTH_N) % SMOOTH_N;
      if (ps.t[i] <= tq) {
        const f = (tq - ps.t[i]) / (ps.t[j] - ps.t[i]);
        ps.sx = ps.x[i] + (ps.x[j] - ps.x[i]) * f;
        ps.sy = ps.y[i] + (ps.y[j] - ps.y[i]) * f;
        return;
      }
      j = i;
    }
    ps.sx = ps.x[j]; ps.sy = ps.y[j];                   /* older than every sample kept */
  }
  /* Once a frame: the delay that keeps a newer sample always in hand. It
     must cover the newest sample's age on EVERY frame while the pointer
     moves - on a frame that finds no new sample that age is largest, and a
     delay measured only on arrival frames let the ring hold still there
     (step spread 0.32 against the path's 0.27). Held at its recent peak (up
     at once, down 2% a frame). Ages past MOVE_IV sample intervals mean the
     pointer has stopped: those are not counted, or every stop pushed the
     delay to SMOOTH_MAX. */
  const MOVE_IV = 1.25;
  function smoothFrame(now) {
    if (ps.timed && ps.n > 0) {
      const age = now - ps.t[ps.head];
      if (age >= 0 && age < Math.max(4, MOVE_IV * ps.iv + 2)) {
        if (age + SMOOTH_MIN > ps.delay) ps.delay = age + SMOOTH_MIN;
        else ps.delay += (age + SMOOTH_MIN - ps.delay) * 0.02;
        if (ps.delay > SMOOTH_MAX) ps.delay = SMOOTH_MAX;
      }
    }
    smoothAt(now - ps.delay);
  }
  /* The pointer moved to (x, y), in CSS px (main.js's pointermove). Refused
     while there is no viewport or the numbers are not finite: one pointer
     event during a zero-width frame used to put Infinity into look for the
     rest of the visit (audit F42). */
  function pointerAt(x, y, t) {
    if (!(W > 0 && H > 0 && Number.isFinite(x) && Number.isFinite(y))) return;
    look.tx = (x / W - 0.5); look.ty = (y / H - 0.5);
    ptr.tx = x; ptr.ty = y; ptr.want = 1;
    /* back from outside: a fresh path, never one drawn across the jump */
    if (!ptr.seen || ptr.out) ps.n = 0;
    sampleAt(x, y, t);
    if (!ptr.seen || ptr.out) {
      /* A first touch, or back after leaving the window or a pause: the
         field is seated on the next frame, from wherever the pointer is by
         then (seat). A first touch too: made while the motion was paused
         (a page that loads paused under reduced motion, its visitor
         reaching for the play button), it used to leave the follower where
         the pointer first was, and on play the growing dent was dragged
         ~200px a frame across the near floor to the pointer (the
         regression lens). */
      if (!ptr.seen) { ptr.x = x; ptr.y = y; ptr.vx = ptr.vy = 0; ptr.env = 0; }
      ptr.back = true;
      ptr.seen = true;
      ptr.out = false;
    }
  }
  /* The pointer is back after the scene lost sight of it (the first frame
     after pointerAt said so). If nothing of the touch is left to see, it is
     simply put under the pointer, which cannot pop, and a ripple still
     showing stays where it is. If the touch still shows but the pointer is
     far from it, it is not swept across the sheet to the pointer (30-33px a
     frame): it fades out where it is over HOP_S and is then put under the
     pointer (hop, in fieldStep), and the ripple is left behind to relax,
     rejoining only once the hop is over (advance). Close by, the follower
     simply carries on. _tools/check-cursor-response.js holds the hop: after
     a re-entry neither dent shows anywhere but where the pointer left or
     where it came back, and neither jumps while it shows; and after a pause
     that the pointer moved through, none shows anywhere but near the
     pointer or where the field was paused, from the first frame back. */
  function seat() {
    ptr.back = false;
    if (!(CUR.on > 0)) {
      ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.vx = ptr.vy = 0;
      ptr.env = 0; ptr.hop = 0;
      if (RIP.b > RIP_GATE) leaveRipple();
      return;
    }
    const d0 = fieldDepth(ptr.y), d1 = fieldDepth(ptr.ty);
    const dx = worldX(ptr.tx, d1) - worldX(ptr.x, d0), dd = (d1 - d0) * DEPTH_W;
    if (dx * dx + dd * dd > HOP_DIST * HOP_DIST) {
      if (!ptr.hop) ptr.hop = 1;
      ptr.vx = ptr.vy = 0;
      leaveRipple();
    }
  }
  /* The pointer left the window, or the window lost focus (main.js's
     pointerout and blur): the field fades out where it is. */
  function pointerGone() { ptr.want = 0; ptr.out = true; }
  /* The scene is about to stop seeing the pointer for a while - the motion
     paused, the tab hidden - though it may still be over the page: its next
     move is treated as coming back (pointerAt), so a pointer that moved
     meanwhile gets the field put under it rather than swept across to it. */
  function pointerStale() { if (ptr.seen) ptr.out = true; }
  /* The two dents, recomputed every frame. on is a dent's depth as a share
     of CUR_DEPTH, xw and d its centre on the sheet, and sx, sy the screen
     point it presses the terrain from (they differ above the horizon, where
     the sheet ends but the mountains go on). The renderer evaluates both
     from these numbers: waveBase sums the dents (and so does its shader's
     wave), and the terrain's pushes come from TPUSH, which follows them.

       CUR   the touch: on the follower, env * CALM_FLOOR deep
       RIP   the ripple: up to 1 - CALM_FLOOR more. att is true while it
             rides on the follower; b and bv are its depth and the rate the
             depth is changing at (fieldStep), on is b less RIP_GATE; age is
             how long it has been left behind (s), counted up to LEFT_IN
             (leftRate). */
  const CUR = { on: 0, xw: 0, d: 3, sx: 0, sy: 0 };
  const RIP = { on: 0, xw: 0, d: 3, sx: 0, sy: 0, b: 0, bv: 0, att: true, age: 0 };
  const CUR_DEPTH = 3.2, CUR_SIGMA2 = 2 * 0.21 * 0.21;
  /* The dent is cut off where the Gaussian has died away (r2 = CUR_R2); the
     value there is subtracted so the cut lands on zero rather than on a
     0.09px step. */
  const CUR_R2 = 0.8, CUR_EDGE = Math.exp(-CUR_R2 / CUR_SIGMA2);
  /* Below this the field is off. The envelope is rescaled so the field
     reaches 0 exactly here, instead of dropping a 0.004-strength dent in one
     frame (audit F23: a 0.74-0.95px tick of the near floor 2.6s after the
     pointer left). RIP_GATE does the same for the ripple. */
  const CUR_GATE = 0.004, RIP_GATE = 0.02;
  /* The follower. Critically damped, so it never overshoots. w = 45, the
     spring twice as stiff as the 32 it was, trails a steady move by 32ms at
     60Hz and 38ms at 165Hz at every speed, and is within 2px of a pointer
     that stops dead in 0.13-0.17s (_tools/check-cursor-response.js); at 32 it
     trailed by 50 and 56ms, 113-339px behind a flick's tip at 2,000-
     6,000px/s at 165Hz (the final QA lens: "the dent and the ring visibly
     lag the cursor tip"). Stiffer still, the touch leaves a resting
     pointer faster, where the ripple it leaves behind is relaxing too, and
     the two rising together are the near floor's largest step. With that
     ripple relaxing at its full rate from the moment it was left (CALM_LEFT
     11, CALM_TAIL 40), 50 moved the floor 34.4px in a frame on
     check-cursor-response's paths (its limit 34) and 36.9px on its parked
     flicks; held while the touch leaves (leftRate), 50 moves it 33.5 and
     33.9px, too close to the limit to take. */
  const FIELD_W = 45;
  /* The field's strength (fieldStep). The follower's speed is measured in
     the well's WORLD metric (depth weighted by 0.55, like the Gaussian), so
     a move toward the horizon, where a few pixels cross a great depth,
     counts as fast; measured in pixels, the dent felt calm sideways and
     frantic into the distance (README "The cursor field").

       CALM_FLOOR   the touch's depth: what is left around the pointer
                    however fast it moves
       CALM_V0      world speed (units/s) at which the ripple's share is
                    half gone: 1 / (1 + (v / CALM_V0)^2)
       CALM_DRAG    the ripple lets go of the follower and stays where it is
                    once speed x depth (world units/s x share) passes this:
                    0.66 x 0.73, where the old speed-only rule let a deep,
                    gathered ripple go. Speed alone (CALM_VDET 0.66) let go
                    in ordinary slow movement: perspective makes a 150px/s
                    drift 0.73 units/s and a gentle 300px/s circle 0.8 near
                    the floor, 2.0 mid-sheet, so the ripple kept being
                    dropped 0.2-0.35 deep and regrown under the pointer - a
                    dent pulsing and jumping behind it (the owner: "it
                    flicks around"). A shallow ripple riding at moderate
                    speed is harmless - its target already shrinks with
                    speed - and a deep one still lets go as early as before
       CALM_IN      1/s, the ripple gathering: first order, so it starts to
                    sink the moment the pointer slows - 95% of the way in
                    0.67s, the slow, peaceful deepening. It was a critically
                    damped spring from rest (CALM_UP 7), which gathers from a
                    standstill: nothing for ~100ms after the pointer
                    stopped, then the sink (the owner: "there is a bit of a
                    pause then a sink, I don't want this pause")
       CALM_EASE    1/s, how fast the gathering's rate itself comes in: over
                    ~1/30 s, so the sink starts at once without a snap
       CALM_REL     1/s, the ripple relaxing while it rides on the follower
                    (the follower speeding up, the pointer gone): 95% in 0.4s
       CALM_LEFT    1/s, a ripple left behind relaxing while it is deep, and
       CALM_TAIL    as it runs out, below TAIL_B (leftRate)
       LEFT_IN      s, how long a ripple just left takes to come up to that
       LEFT_W0      rate, from LEFT_W0 of it: held while the touch leaves it
       ENV_IN       s, the field arriving with the pointer (via a smoothstep,
                    so it starts and ends gently)
       ENV_OUT      s, the field leaving with it
       HOP_DIST     world units (0.55 metric): a pointer that comes back
                    farther than this from the field makes it hop (seat)
       HOP_S        s, how long the hop's fade out takes */
  /* CALM_RIPPLE: the ripple's share of the rest of the depth - 0, off. The
     ripple deepened the dent once the pointer slowed, after it had
     arrived, and however soon it came that read as lag (the owner: "lets
     honestly remove the extra sinking after a pause, makes it look
     laggy"): the floor answers with the touch alone, CALM_FLOOR deep,
     moving or still. 1 brings the ripple back as it was tuned. */
  const CALM_RIPPLE = 0;
  const CALM_FLOOR = 0.25, CALM_V0 = 0.55, CALM_DRAG = 0.66 * 0.73, CALM_IN = 4.5, CALM_EASE = 30, CALM_REL = 12;
  const ENV_IN = 0.09, ENV_OUT = 0.25, HOP_DIST = 0.42, HOP_S = 0.15;
  const CALM_LEFT = 16, CALM_TAIL = 50, TAIL_B = 0.5, LEFT_IN = 0.12, LEFT_W0 = 0.2;
  /* The deepest the well can sit (just past the last drawn row), and the
     softness, in px, of the bend where the depth runs into it. A hard clamp
     there stopped the well dead (audit F21); this keeps its depth smooth in
     the pointer everywhere, above the horizon included. */
  const CUR_DFAR = 9.1, CUR_SOFT = 12;

  /* The three bodies' orbit at phase t: [{ xw, d }] for each. Given out (an
     array of such records), it refills them in place: advance does, every
     frame, so the orbit makes no garbage. */
  const PHASES = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  function orbitWorld(t, out) {
    const list = out || [];
    for (let i = 0; i < PHASES.length; i++) {
      const ph = PHASES[i], o = list[i] || (list[i] = { xw: 0, d: 0 });
      o.xw = Math.sin(t + ph) * 1.45; o.d = 2.65 + Math.sin(2 * (t + ph)) * 1.15;
    }
    return list;
  }
  /* Math.hypot(x, y), without its garbage: V8 copies every call's
     arguments into a fresh array (~1.9 KB a frame over the scene's ~30
     calls). This is V8's algorithm for two finite arguments, not a
     look-alike - each scaled by the larger, the squares summed (its Kahan
     compensation is exactly 0 after the first term, so it drops out), the
     root scaled back - so every value is bit for bit what Math.hypot gives
     (_tools/check-ops-golden.js); 0, NaN and Infinity, which a frame never
     sees once sane() has run, go to the builtin. Infinity is held in a
     constant: on a page that changes nothing, but in the tools' vm context
     (harness.js) a bare global is looked up through the context's
     interceptor every time - Math and Number are handed in, Infinity is
     not - and at ~39 calls a frame that made the harness's advance 8.96 us
     instead of 1.58 (69% of it here; 1.3 us in a plain realm either way). */
  const INF = Infinity;
  function hypot(x, y) {
    const a = Math.abs(x), b = Math.abs(y), m = a > b ? a : b;
    if (!(m > 0 && m < INF)) return Math.hypot(x, y);
    const p = a / m, q = b / m;
    return Math.sqrt(p * p + q * q) * m;
  }
  /* The orbit's phase is ORBIT_T0 + simNow * ORBIT_RATE. At scene time 0 it
     is the still composition the reduced-motion page has always shown, so a
     page that loads paused shows that, and one that starts moving starts
     from it. */
  const ORBIT_T0 = 1.2, ORBIT_RATE = 0.000055;
  /* The bodies' depth floor. The projection divides by d, so near d = 1 a
     small depth change is a huge sideways jump; the floor keeps them out of
     that. It is a SMOOTH max: the orbit itself reaches d = 1.5, so a hard
     floor bound several times a minute, and each contact was a corner in
     the motion - a one-frame velocity step of up to 46px/s (audit F22).
     1.8 + (z + sqrt(z^2 + w^2)) / 2 never goes below 1.8, never moves faster
     than d itself, and is within 0.01 of d by d = 2.15. */
  const BODY_FLOOR = 1.8, BODY_SOFT = 0.12;
  function softFloor(d) {
    const z = d - BODY_FLOOR;
    return BODY_FLOOR + (z + Math.sqrt(z * z + BODY_SOFT * BODY_SOFT)) / 2;
  }
  const bodiesW = orbitWorld(ORBIT_T0).map(b => ({ xw: b.xw, d: softFloor(b.d) }));
  /* Each body leans toward the field (bodyPull) and rolls down the slope of
     the landscape (bodyRoll), both as offsets from its orbit. Both are
     springs with a ceiling on speed and on acceleration, so a body drifts
     into a dent and back out of it and is never yanked: the field now moves
     at the pointer's speed, and an eased-target pull or a roll on the raw
     slope swung the bodies by up to 9.3px/frame (6.7px/frame^2) when it
     did.

     A body also sits ON the sheet, so a dent passing under it carried it
     down and up again with the surface: up to 38.6px in a frame once the
     dent could move at the pointer's speed (4.7px with the dent left out).
     So it sinks into the dents with some weight instead: sink is the dents'
     depth under it, eased over SINK_TAU (s), and bodiesAt draws it on that
     rather than on this frame's depth. A dent that settles under a body
     takes it all the way down; one that sweeps past only rocks it. */
  const bodyPull = [{ x: 0, d: 0, vx: 0, vd: 0, sink: 0 }, { x: 0, d: 0, vx: 0, vd: 0, sink: 0 },
                    { x: 0, d: 0, vx: 0, vd: 0, sink: 0 }];
  /* the pull's spring (1/s: ~2s to settle), and its ceilings in world
     units/s and /s^2, in the same 0.55 metric as everything else */
  const PULL_W = 2.4, PULL_VMAX = 0.25, PULL_AMAX = 0.8, SINK_TAU = 0.2;
  /* Gradient descent: the roll offset accelerates down the slope of the
     landscape, so a body runs faster where the sheet is steeper and coasts
     where it is flat. Spring-damped back toward the orbit so the offset stays
     bounded - G/K sets how far a given slope can carry it. C is above
     critical damping for K (3.63), so a body settles without swinging back.
     The slope it reads is low-passed over ROLL_TAU (s): the dent moving past
     changes it within a frame or two, and the raw step is what yanked. gx/gd
     hold the filtered slope. */
  const bodyRoll = [{ x: 0, d: 0, vx: 0, vd: 0, gx: 0, gd: 0 },
                    { x: 0, d: 0, vx: 0, vd: 0, gx: 0, gd: 0 },
                    { x: 0, d: 0, vx: 0, vd: 0, gx: 0, gd: 0 }];
  const ROLL_G = 0.35, ROLL_K = 3.3, ROLL_C = 4.4, ROLL_VMAX = 0.7, ROLL_AMAX = 1.4, ROLL_TAU = 0.15;

  const ROWS = 20, DMAX = 6.5, XSPAN = 1.08;
  /* The world metric the dents, the wells and the field all measure in: a
     step in depth counts DEPTH_W of the same step in xw, so their Gaussians
     are round in (xw, d * DEPTH_W), and a speed or a distance through depth
     is weighed the same way. */
  const DEPTH_W = 0.55;
  /* The bodies' wells: WELL_DEPTH deep at the centre, 2 sigma^2 =
     WELL_SIGMA2 wide, and cut off at r2 = WELL_R2. */
  const WELL_DEPTH = 1.7, WELL_SIGMA2 = 2 * 0.17 * 0.17, WELL_R2 = 0.5;

  /* Occasionally a single large swell rises on the sheet — a deep valley or a
     tall hill, depending on its sign — swells in place and subsides. Each
     event is placed in world x and in depth, so an event in the back lifts or
     drops the mountains and the far trees with it (they stand on the surface,
     so this is free), while one in front only heaves the near floor.

     Timed to the same slow pace as the rest: one event per EVENT_MS, and it
     only runs for part of that window so there are quiet gaps between them. */
  const EVENT_MS = 48000, EVENT_IN = 0.12, EVENT_SPAN = 0.50;
  /* Its shape: a Gaussian 2 sigma^2 = EVENT_SIGMA2 wide, its depth axis
     weighed by EVENT_DEPTH_W against xw, and EVENT_AMP0 + EVENT_AMP1 * u
     deep (u from 0 to 1, per event); the renderer reads the deepest an
     event can be (render-webgl.js gridAt). */
  const EVENT_DEPTH_W = 0.42, EVENT_SIGMA2 = 1.6, EVENT_AMP0 = 0.9, EVENT_AMP1 = 1.0;
  /* The event's sign, size, position and envelope depend only on the clock,
     but swellEvent is evaluated at every surface sample. That was ~2,800 a
     frame on the Canvas renderer (gone since W3), where deriving them per
     sample cost five trig calls each and more than doubled the frame's trig
     while an event was running, a stutter arriving exactly when the big
     motion does. On the page it is now 15 a frame, all for the bodies (the
     12 waveBase calls of their slopes and the 3 surfacePoint calls that
     place them; the shader gets the prepared event as a uniform), and far
     more in the tools, which sample the surface everywhere. The fields are
     prepared once per frame, and the shape (sign, size, position) once per
     event: n is the event it is for (audit F19: it was hashed again every
     frame, four hash1 calls).
     What is kept is checked like every other state (sane(), each frame),
     so a bad value in it is derived again at once instead of lasting to
     the next event. */
  const EVF = { t: -1, on: false, env: 0, sign: 1, amp: 0, cx: 0, cd: 0, n: -1 };
  /* Event n draws its shape from hash index n + EVENT_SEED, while its timing
     stays on n. Scene time starts at 0 on every visit, and hash1(0) is
     exactly 0, so with no offset the first event of every visit was pinned
     to the smallest amplitude at the far left edge and moved the visible
     sheet by 0.9px - the first swell anyone saw came 54s in (audit F7). Six
     makes the first event, from 5.8s, a 75px hill in the left gutter and the
     second another hill; then valleys (offsets 1 and 3 open on valleys of
     18 and 54px). A constant, not a per-load random seed: the scene stays
     deterministic, so the tools can reproduce it. */
  const EVENT_SEED = 6;
  function prepEvent(t) {
    if (EVF.t === t) return;
    EVF.t = t;
    const n = Math.floor(t / EVENT_MS), ph = t / EVENT_MS - n;
    const k = (ph - EVENT_IN) / EVENT_SPAN;
    EVF.on = k > 0 && k < 1;
    if (!EVF.on) return;
    EVF.env = Math.sin(Math.PI * k);
    /* kept for the event it was derived for, and only while it is finite
       (sane() checks it before every frame, but the tools call this on its
       own too): kept on n alone, a NaN put into it lasted until the next
       event began, 2,681 frames (45s at 60Hz), and went to the shader in
       every one of them (uEvt; W3 review) */
    if (EVF.n === n && Number.isFinite(EVF.sign + EVF.amp + EVF.cx + EVF.cd)) return;
    EVF.n = n;
    const m = n + EVENT_SEED;
    EVF.sign = hash1(m * 3.7) > 0.5 ? 1 : -1;
    EVF.amp = EVENT_AMP0 + EVENT_AMP1 * hash1(m * 5.3);
    /* cx must span the full world-x the scene uses: far things are pushed out
       in world x, so terrain sits around |xw| = 3.5..5.2 */
    EVF.cx = -5.6 + 11.2 * hash1(m * 2.1);
    EVF.cd = 1.5 + 5.1 * hash1(m * 7.9);
  }
  function swellEvent(xw, d) {
    if (!EVF.on) return 0;
    const dx = xw - EVF.cx, dd = (d - EVF.cd) * EVENT_DEPTH_W;
    return EVF.sign * EVF.amp * EVF.env * Math.exp(-(dx * dx + dd * dd) / EVENT_SIGMA2);
  }
  /* The ambient swell: three travelling sines, each

       sin(xw * kx + d * kd + t * kt) * amp        (t in ms)

     This table is the ONE copy of these numbers. waveBase sums it below, and
     the WebGL renderer writes its shader's wave from the same table
     (render-webgl.js), so the sheet the GPU draws and the sheet the CPU
     measures - the terrain stands on it, the bodies roll on it, the cursor's
     well is put on it - cannot drift apart. The rest of the wave's numbers
     are named the same way (CUR_*, WELL_*, EVENT_*, DEPTH_W) for the same
     reason. _tools/check-wave-parity.js holds the shader's wave to the
     scene's within 1e-3.

     The amplitudes were scaled 1.55x from where they sat when terrain was
     cheating its way to extra travel. Raising the SWELL moves the floor and
     everything standing on it together; raising the terrain gain instead
     just peels the terrain off the floor. Deliberately only the three
     ambient terms - the cursor well and the bodies' wells are left alone,
     so their depths in pixels do not change with this. */
  const WAVE = [
    { kx: 4.2, kd: 0.34, kt: 0.00035, amp: 0.96 },
    { kx: 2.1, kd: -0.55, kt: -0.00022, amp: 0.62 },
    { kx: 7.6, kd: 0.93, kt: 0.00052, amp: 0.26 }
  ];
  const [WAVE_1, WAVE_2, WAVE_3] = WAVE;
  /* The landscape WITHOUT the bodies' own gravity wells. The bodies read the
     slope of this to roll downhill; if they read the full wave they would see
     their own well. Each sits on top of a bump it raised itself (wave()'s
     `z -=`), so the full wave's slope points away from it on every side, and
     reading it would push every body off its own position and blow the whole
     system apart. Do not flip the wells' sign to make them dents instead: a
     body at the bottom of a real dent would be trapped there, not rolling. */
  function waveBase(xw, d, t) {
    /* The d coefficients (kd) are deliberately SMALL (they were 1.35 / 2.20 / 3.70).
       They set how fast the swell changes with depth along one world x, and
       when that outruns the perspective gradient a drawn column turns back on
       itself: screen y stops falling as depth grows. At a quarter of the old
       values every column falls the whole way (worst step -0.035px;
       _tools/foldscan.js: it turns back from about 1.2x these). It costs no
       motion: travel at a fixed spot comes from the t terms. And depth
       variety survives, because xw itself depends on d - one screen x maps to
       different xw at different depths, so the 4.2 * xw term still puts the
       bands out of phase.

       What it does not do is stop the sheet hiding parts of itself. A row
       crossing is a farther row drawn below a nearer one in one column of
       PIXELS, and there xw = sn * d moves with depth, so the xw terms change
       along it by kx * sn per unit of depth - 4.2 * sn against 0.34 - and
       drawn rows cross by up to 49px in the gutters (26px without the
       bodies' wells; _tools/seattest.js) at every kd, 0 included; only the
       amplitudes decide it (foldscan.js). The WebGL floor is opaque and
       depth-tested, so that is a crest hiding the trough behind it, drawn to
       the pixel (_tools/check-webgl-floor.js); on the Canvas wireframe it
       was braided rows (audit G1.1). The old values' "rows crossing by
       9.6px, terrain depths by 8.5px" and the "-0.03px, always descending"
       this comment used to quote were measured along one world x, the frame
       in which a column is drawn, not a row (audit G1.5).

       The second term's kd and kt are negative: xw * 2.1 + d * -0.55 is the
       same double as xw * 2.1 - d * 0.55, so the table changed no bit of
       the wave (check-ops-golden). */
    const z = Math.sin(xw * WAVE_1.kx + d * WAVE_1.kd + t * WAVE_1.kt) * WAVE_1.amp
          + Math.sin(xw * WAVE_2.kx + d * WAVE_2.kd + t * WAVE_2.kt) * WAVE_2.amp
          + Math.sin(xw * WAVE_3.kx + d * WAVE_3.kd + t * WAVE_3.kt) * WAVE_3.amp;
    return z * swellFar(d) + dentAt(xw, d) + swellEvent(xw, d);
  }
  /* The floor runs on to the horizon (render-webgl.js THE FAR FLOOR; the
     owner: "I don't like how it looks like the waves end, I want it to keep
     going into the screen, so it looks endless"), and out there the swell
     calms: its share falls from 1 at SWELL_D0 to 0 at SWELL_D1 (a
     smoothstep in d), past every base (6.49) and short of nothing the
     cursor does (its dents and the event are not the swell). Unfaded,
     xw = sn * d packs the swell into dozens of ripples across the screen
     near the horizon, shimmering, and it folds the sheet over itself from
     about d = 21 (K w_d d outgrowing H * PERSP_Y). Calm by 10, the mesh
     need reach no farther at its fine step (render-webgl.js THE FAR
     FLOOR): faded out to 20 instead, 40 strips even in 1/d could not
     follow it, and showed a farther part of it in 6-25 px a state
     (check-webgl-floor). The shader fades the same, its fold jet by the
     product rule. */
  const SWELL_D0 = 7, SWELL_D1 = 10;
  function swellFar(d) {
    if (d <= SWELL_D0) return 1;
    if (d >= SWELL_D1) return 0;
    const u = (d - SWELL_D0) / (SWELL_D1 - SWELL_D0);
    return 1 - u * u * (3 - 2 * u);
  }
  /* The cursor's two dents (CUR, RIP) at a point. PLUS, not minus. Canvas y
     grows downward and the projection adds the wave straight onto y, so
     `z -=` raises the sheet toward the viewer — which is what the three
     bodies do. The cursor presses the sheet DOWN, so its term is added. */
  function dentAt(xw, d) {
    return dentOf(CUR, xw, d) + dentOf(RIP, xw, d);
  }
  function dentOf(w, xw, d) {
    const on = sheetOn(w);
    if (!(on > 0)) return 0;
    const dx = xw - w.xw, dd = (d - w.d) * DEPTH_W;
    const r2 = dx * dx + dd * dd;
    return r2 < CUR_R2 ? CUR_DEPTH * on * (Math.exp(-r2 / CUR_SIGMA2) - CUR_EDGE) : 0;
  }
  /* A dent's strength ON THE FLOOR: its own, everywhere, the back of the
     floor among the mountains included.

     The terrain does not stand on the dents: every massif, tree and conifer
     stands on the floor WITHOUT the cursor's dents (the shader's refAt) -
     the swell, its event and the bodies' wells still carry it. A dent
     under a base carried it along at the pointer's speed (up to 1,135px/s
     along the mountains' feet, 11px/frame^2 at 165Hz: the owner's "the
     mountains still jitter when I move past them fast"), and the first
     fix, fading the dents out before the nearest terrain depth, left the
     whole back of the floor dead to the cursor (the owner: "the ground in
     the back doesn't move when I put my cursor there"). Where a dent sinks
     the floor under a base, the mountain's skirt and a trunk's root reach
     down to it (render-webgl.js SINK: the deepest a dent can be at the
     nearest terrain depth), so the ground sags around the scenery and
     nothing shows under it; the nearer floor hides the skirt everywhere
     else. (sheetOn is kept as the floor's one reading of a dent's
     strength; CUR.on + RIP.on never passes 1.) */
  function sheetOn(w) {
    return w.on > 0 ? w.on : 0;
  }
  /* An index, not for-of: the WebGL renderer calls this only for the three
     bodies (bodiesAt), too rarely for V8 to optimise it early, and an
     unoptimised for-of allocates an iterator and a result per step. */
  function wave(xw, d, t) {
    let z = waveBase(xw, d, t);
    for (let i = 0; i < bodiesW.length; i++) {
      const b = bodiesW[i];
      const dx = xw - b.xw, dd = (d - b.d) * DEPTH_W;
      const r2 = dx * dx + dd * dd;
      if (r2 < WELL_R2) z -= WELL_DEPTH * Math.exp(-r2 / WELL_SIGMA2);
    }
    return z;
  }
  /* The projection, in one place. A point on the sheet at world x `xw` and
     depth `d` lands on screen at

       x = centreX(d) + xw * W * PERSP_X / d
       y = horizonY() + H * PERSP_Y / d + wave(xw, d, t) * H * WAVE_Y / d

     Everything that must line up with the sheet goes through these names:
     surfacePoint, the terrain (restAt, the sheet at rest under a base, and
     standX, where each object stands; the renderer's shader has their GLSL
     twins, which _tools/check-wave-parity.js holds to these), the inverse
     that puts the cursor well on the sheet (worldX) and the well's speed
     (fieldSpeed), and the sky (skyX, tiltY). They used to be written out at
     each site - the horizon eight times, the rest plane seven - and terrain
     stays welded to the floor only while every copy agrees: retuning the
     horizon (0.42 -> 0.40) at the call sites but not under the terrain
     floated every base 18px above the floor at 900px tall; the other way
     round it sank 18px. Retune here and everything moves together.

     Parallax is ONE rule for the sheet and everything standing on it (audit
     G3.1). As the eased look.x moves, the sheet at depth d slides

       shiftX(d) = look.x * LOOK_X * max(0, (PAR_D0 - d) / (PAR_D0 - 1))

     LOOK_X px per unit at the near floor (d = 1), falling off linearly to
     nothing at PAR_D0, and a ridge, a peak, a conifer or a tree slides
     exactly as far as the sheet at its own depth (standX). It used to be
     two rules: the sheet slid a flat 30 * look.x at every depth while each
     object slid by its own hand-set `par`, so a sideways move of the
     pointer slid the floor 12-22px under the mountains, and since every
     base re-samples the swell where it stands, it raised, sank and tilted
     them by up to 13px: 20-27px/s of motion between a foot and the ground
     it stands on, where the idle scene has none. Linear rather than 1/d
     (what a camera really does) because the bands' old hand-set values lie
     on this line - 0.085 / 0.110 / 0.158 / 0.225 of LOOK_X against 0.07 /
     0.11 / 0.17 / 0.23 - so far ranges still barely move and near ones
     slide, where 1/d would flatten them all to 0.15-0.18. Do not give an
     object a parallax of its own again: for more or less motion, change
     LOOK_X (or PAR_D0) for the whole scene. _tools/check-parallax.js holds
     the floor's slide under every base, and the bob it caused, at 0.

     The sky is not on the sheet. The sun and the clouds slide sideways by
     their own small `par` (skyX), and up and down they move exactly with
     the horizon (tiltY): it and they are at infinity, and no move of the
     view can shift one against the other (audit G3.2: they stayed put
     while the horizon and every ridge moved 16 * look.y, so each vertical
     move of the pointer slid the ridges 8px over the sun).

     The helpers evaluate their terms in the same order as the inline copies
     they replaced, so with look at rest the frames are bit-identical to
     before (proved with _tools/check-ops-golden.js). That is also why
     surfacePoint keeps its own H * PERSP_Y * s product: restAt's
     H * PERSP_Y / d differs by ~1e-13px.

     Other 0.42s and 0.60s (here the swell event's depth weight and the hop
     distance; the sheet's line alphas in render-webgl.js) are unrelated
     numbers. Do not fold them into these. */
  const HORIZON = 0.42;    /* horizon height at rest, as a fraction of H */
  const LOOK_Y = 16;       /* px the horizon, and the sky with it, moves per unit of eased look.y */
  const LOOK_X = 30;       /* px the near floor (d = 1) slides per unit of eased look.x */
  const PAR_D0 = 7;        /* from this depth on nothing slides: past the last row (6.5) and every base */
  const PERSP_X = 0.62;    /* W * PERSP_X / d px span one world unit sideways at depth d */
  const PERSP_Y = 0.60;    /* the sheet at rest sits H * PERSP_Y / d below the horizon */
  const WAVE_Y = 0.085;    /* one unit of wave() is H * WAVE_Y / d px */
  /* Read the EASED look.y, never look.ty (README "Smoothness traps"). */
  function tiltY() { return look.y * LOOK_Y; }
  function horizonY() { return H * HORIZON + tiltY(); }
  /* how far the sheet at depth d slides with look.x, and its centre there */
  function shiftX(d) { return look.x * LOOK_X * Math.max(0, (PAR_D0 - d) / (PAR_D0 - 1)); }
  function centreX(d) { return W / 2 + shiftX(d); }
  /* the sheet at rest at depth d: where a base sits when the swell is flat */
  function restAt(d) { return horizonY() + (H * PERSP_Y) / d; }
  /* screen x back to world x at depth d - the inverse of surfacePoint's x */
  function worldX(sx, d) { return ((sx - centreX(d)) * d) / (W * PERSP_X); }
  /* screen x of something standing on the sheet at fraction f of the width
     and depth d: it slides with the sheet under it */
  function standX(f, d) { return f * W + shiftX(d); }
  /* screen x of something in the sky at fraction f of the width, with its
     own small parallax par */
  function skyX(f, par) { return f * W + look.x * LOOK_X * par; }
  /* The depth under screen y, for the well: restAt inverted,
     d = H*PERSP_Y / (y - horizon), with y - horizon passed through a smooth
     max so the depth bends into CUR_DFAR instead of running into a wall, and
     stays defined (at CUR_DFAR) at and above the horizon. Below the bend it
     is the plain inverse to within 0.9px of screen y. */
  function fieldDepth(y) {
    const K = H * PERSP_Y, u = y - horizonY() - K / CUR_DFAR;
    return Math.max(1, K / (K / CUR_DFAR + (u + Math.sqrt(u * u + CUR_SOFT * CUR_SOFT)) / 2));
  }
  /* The follower's speed in world units/s, in the well's metric (depth
     weighted by 0.55): its screen velocity through the derivative of
     (worldX, fieldDepth) at its position. Not a difference of positions, so
     the slow drift of the projection as look eases is not counted as the
     pointer moving. While look.x is off centre the sheet's centre moves
     with depth (shiftX), so a move through depth also carries the well
     sideways: slope is d(centreX)/dd there. */
  /* the follower's world speed - or, given (vx, vy) in px/s, that of a
     motion at the follower's place */
  function fieldSpeed(vx = ptr.vx, vy = ptr.vy) {
    const K = H * PERSP_Y, u = ptr.y - horizonY() - K / CUR_DFAR, root = Math.sqrt(u * u + CUR_SOFT * CUR_SOFT);
    const eff = K / CUR_DFAR + (u + root) / 2, d = K / eff, dd = Math.max(1, d);
    const vd = d < 1 ? 0 : -(d / eff) * ((1 + u / root) / 2) * vy;
    const slope = dd < PAR_D0 ? -look.x * LOOK_X / (PAR_D0 - 1) : 0;
    const vxw = (((vx - slope * vd) * dd) + (ptr.x - centreX(dd)) * vd) / (W * PERSP_X);
    return hypot(vxw, vd * DEPTH_W);
  }
  /* surfacePoint calls horizonY() and centreX(d) on every call rather than
     taking once-a-frame copies, so there is no cached horizon to go stale.
     It was free even when the Canvas renderer called it 2,764 times a
     frame: V8 inlines both into it (--trace-turbo-inlining), and the same
     file with the two written as inline locals was no faster (B/A 1.005 /
     1.003 / 1.000 per frame at 1440x900@1.5 / 390x844@3 / 2560x1440@1,
     interleaved, no-op canvas). The page calls it 3 times a frame now (the
     bodies; the WebGL renderer has its GLSL twin), the tools far more.
     Given out (a 2-array), it writes [x, y] there instead of allocating
     one: the WebGL renderer draws without making garbage (bodiesAt). */
  function surfacePoint(xw, d, t, out) {
    const s = 1 / d;
    const horizon = horizonY();
    const cx = centreX(d);
    const x = cx + xw * W * PERSP_X * s, y = horizon + H * PERSP_Y * s + wave(xw, d, t) * H * WAVE_Y * s;
    if (!out) return [x, y];
    out[0] = x; out[1] = y;
    return out;
  }
  /* The page grey. The canvas is cleared to it and the floor is filled with
     it, so it must match --coat in site.css exactly, or the background shows
     as a panel against the page. */
  const COAT = '#DCDCD8';
  /* A layered mountain range: where it stands and how tall, for the
     renderer to build its line-art massifs from (render-webgl.js,
     sceneryMesh, from ridgeSummits and peakPlace below).

     Two kinds of band, far to near:

       RIDGES  one continuous ridgeline spanning the whole width, with several
               summits over a raised `floor`. The floor is the point — a row
               of separate peaks leaves valleys that drop all the way to the
               ground, and those read as gaps in the skyline. A floor keeps
               the range a solid mass with peaks on top of it.
       BANDS   separate nearer peaks standing in front of that backdrop.

     Distant ranges are the TALL ones holding the skyline; nearer hills sit
     lower in front. That is the way layered landscape reads — put the big
     mountains in front and they simply hide everything behind them.

     Every base point stands on the live surface (the renderer places each
     on the floor where it is drawn, from the same wave), so the whole range
     rides the swells and the swell events. The bodies' wells never reach it
     on their own, though depth alone would not keep them off: the bodies
     orbit no deeper than d 3.85 and a well reaches 1.29 deeper
     (sqrt(WELL_R2) / DEPTH_W), to d 5.13, past the two nearest trees (4.92,
     4.95). The conifers (5.20 on) and the ridges and bands (5.65 on) are
     out of its reach by depth; the trees, sideways: the bodies stay within
     |xw| 2.13, and those two trees stand at |xw| 3.53 and beyond. The
     nearest a body comes to any root is r^2 2.18, against WELL_R2 0.5 (two
     orbits idle at 1440x900: 0px of a base moved). A pointer can pull a
     body deeper; a well that did reach a base would lift it, not sag it
     (wave(): `z -=`).
     Each one stands at standX, so it slides with the sheet at its own depth
     when the pointer moves (the projection, above): far bands barely move,
     near bands slide, which is what sells the depth. */
  /* `ph` is a phase offset on each band's peak spacing. Without it the bands
     all start at the same place and summits stack directly behind one another;
     these values were picked by searching for the best worst-case horizontal
     separation between any two summits in different bands (27px, up from 6). */
  const RIDGES = [
    { d: 6.49, nsum: 7, floor: 0.32, hmin: 0.34, hmax: 0.450, seed: 101, ph: 0.00 },
    { d: 6.34, nsum: 6, floor: 0.26, hmin: 0.26, hmax: 0.360, seed: 211, ph: 0.70 }
  ];
  /* wmin0 / wmax0: a peak's half-width range in px at S = 1; rescale keeps
     wmin / wmax at these times S */
  const BANDS = [
    { d: 6.05, n: 6, hmin: 0.230, hmax: 0.350, wmin0: 185, wmax0: 280, seed: 307, ph: 0.35 },
    { d: 5.65, n: 4, hmin: 0.190, hmax: 0.300, wmin0: 215, wmax0: 320, seed: 419, ph: 0.80 }
  ];
  /* Clouds, behind everything but the sun. Each is a union of lopsided,
     scattered ellipse lobes, which the renderer turns into a low-poly
     volume drawn in the mountains' line art. Keep the lobes small against
     the cloud and
     the clouds small and well apart: big overlapping lobes give a smooth
     lens, and wide clouds merge into one bank.

     fx, fy, half-width and height in px at S = 1 (w0, h0; rescale keeps w
     and h at these times S), lobes, the outline's alpha, parallax, seed */
  const CLOUDS = [
    { fx: 0.055, fy: 0.135, w0: 86,  h0: 56, n: 4, a: 0.30, par: 0.05, seed: 11 },
    { fx: 0.215, fy: 0.245, w0: 58,  h0: 38, n: 3, a: 0.24, par: 0.08, seed: 29 },
    { fx: 0.545, fy: 0.120, w0: 100, h0: 64, n: 4, a: 0.18, par: 0.04, seed: 47 },
    { fx: 0.800, fy: 0.235, w0: 64,  h0: 42, n: 3, a: 0.25, par: 0.08, seed: 63 },
    { fx: 0.955, fy: 0.140, w0: 92,  h0: 60, n: 4, a: 0.31, par: 0.05, seed: 83 }
  ];
  /* Heights (h0) and the conifers' half-widths (w0) are px at S = 1;
     rescale keeps h and w at these times S. */
  const TREES = [
    { fx: 0.058, h0: 238, a: 0.72, d: 4.95, seed: 7 },
    { fx: 0.192, h0: 162, a: 0.54, d: 5.55, seed: 23 },
    { fx: 0.815, h0: 170, a: 0.54, d: 5.52, seed: 37 },
    { fx: 0.948, h0: 248, a: 0.74, d: 4.92, seed: 53 }
  ];
  /* Every tree and conifer stands nearer than the near band (BANDS[1],
     d = 5.65). The Canvas renderer painted them all after the bands, so
     they stood in front of every peak; the WebGL renderer depth-tests them
     at their own d, and at 5.70 and 5.68 these two middle conifers stood
     behind the near band's peaks instead and were hidden by them (1,539
     and 0 px showing at 1440x900@1.5, against 3,884 and 4,265 for the
     outer two; W2b review). At 5.64 and 5.62 they keep the Canvas
     composition and their order among the trees, and their roots sit 1.0 px
     lower on the floor. _tools/check-scenery-mesh.js holds every tree and
     conifer nearer than every band; check-webgl-terrain.js finds all 8
     showing. */
  const CONIFERS = [
    { fx: 0.112, h0: 152, w0: 36, a: 0.66, d: 5.25 },
    { fx: 0.160, h0: 106, w0: 25, a: 0.50, d: 5.64 },
    { fx: 0.848, h0: 112, w0: 27, a: 0.50, d: 5.62 },
    { fx: 0.898, h0: 158, w0: 38, a: 0.68, d: 5.20 }
  ];
  /* The fractal trees' recursion depth, and their trunk's line width (px at
     S = 1; buildTree) */
  const TREE_DEPTH = 7, TRUNK_WIDTH = 3.4;

  function hash1(i) { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }
  /* The cursor's push on TERRAIN, measured on SCREEN.

     The sheet's well lives in world space, which only describes the ground.
     But a mountain is drawn standing up from its base - its face is hundreds
     of pixels ABOVE the ground line, and above the horizon entirely. Pointing
     at a peak therefore placed the well on open sheet far behind it, or off
     the sheet, and the peak never moved.

     So terrain gets its own test, in the space the shapes actually occupy:
     how near the pointer is in x, and whether it is inside this column's own
     vertical span. Point at a face and that face presses in. It presses from
     TPUSH, the terrain's own copy of the field (below), which follows the
     dents under a budget, so the terrain leans rather than jolts.

     These px figures are at S = 1 (1440x900, below): the push works through
     terrPush and the rest, which rescale keeps at these times S. */
  /* The physical push - the dip, the peaks' slide, the trees' bend - is OFF
     (0): the owner asked for the scenery to answer a resting pointer
     geometrically instead, "not necessarily physical" (THE BLOOM, below).
     The machinery stays - TPUSH is the bloom's source, and every tool that
     reads the push still sees what is drawn, which is now nothing - but its
     amplitudes are zero, here and in the shader, which is built from these. */
  const CUR_TERR_PUSH = 0;                  /* px of dip under the pointer (was 26) */
  const CUR_TERR_SX = 95;                   /* sideways reach */
  const CUR_TERR_PAD = 70;                  /* taper above/below the silhouette */
  /* Two amplitudes, because the two things are not alike. A tree is light and
     flexible, so it may visibly swing; a mountain is a rock, and anything
     more than a nudge reads as rubber. Peak shove is amplitude * 0.6065. */
  const CUR_TERR_SIDE = 0;                  /* trees' lean (was 34) */
  const CUR_SIDE_PEAK = 0;                  /* peaks' slide (was 22) */

  /* One scale, S, for everything in the scenery that is sized in px (audit
     G4.2): the trees and conifers (and their line widths), the clouds, the
     peaks' half-widths (BANDS), the bodies, and the cursor's push on the
     terrain. The mountains' heights and the sun are fractions of H, so they
     always grew and shrank with the window while these stayed put: on a
     short window the trees out-topped the skyline, ran off the top and
     through the clouds (tallest tree / tallest near peak 1.28 at 1366x657,
     1.87 at 1440x450 and 2.16 at 844x390, the last two cut by the top edge;
     1,199-5,965 cloud px under tree strokes) and the cursor pressed a
     mountain down by a fifth of its height; at 4K the trees were 0.39 of
     the peaks and the peaks turned to needles.

       S = max(SCALE_MIN, min(H / SCALE_H, W / SCALE_W))

     H / 900 keeps them in proportion to the mountains: wherever it binds,
     from 1440x450 to 3840x2160, tree / peak is 0.94, the near peaks are
     0.77-1.08 as tall as they are half-wide, and the cursor's dip is 10.1%
     of the near peak, all exactly as at 1440x900. W / 1100 stops a tall,
     narrow window (a phone, a portrait monitor) from making them wider than
     it can hold; where it binds they are smaller against the H-sized
     mountains instead: tree / peak 0.36 at 390x844 (it was 1.00) and 0.43
     at 1080x1920 (0.44), the near peaks 2.03-2.86 as tall as half-wide at
     390x844 (0.72-1.01), all of it under the card on a phone. S is 1 at
     1440x900, the size all of these were tuned at, so that size draws
     exactly as it did (bit for bit; _tools/check-scale.js). Line widths
     take SW = max(1, S): thinner than at S = 1, a line only goes grey.

     It is applied once per size, not per frame: setSize calls rescale when
     S changes, and rescale sets every scaled value from its value at S = 1
     (the *0 fields, the CUR_TERR_* constants), so nothing compounds over a
     run of resizes. The renderer builds its scenery's meshes again for a
     new W, H or S at once, and no more than once every REBUILD_MS while a
     window is dragged (render-webgl.js, scenery()).

     terrA, the largest of the pushes' amplitudes, is what terrainStep's
     budget is costed in; it changes only with S, so it is set here, not
     every frame (audit F19). */
  const SCALE_H = 900, SCALE_W = 1100, SCALE_MIN = 0.35;
  let S = 1, SW = 1;
  let terrPush, terrSX, terrSX2, terrPad, terrSide, terrSidePeak, terrA;
  function rescale(s) {
    S = s; SW = Math.max(1, s);
    for (const c of TREES) c.h = c.h0 * s;
    for (const c of CONIFERS) { c.h = c.h0 * s; c.w = c.w0 * s; }
    for (const c of CLOUDS) { c.w = c.w0 * s; c.h = c.h0 * s; }
    for (const b of BANDS) { b.wmin = b.wmin0 * s; b.wmax = b.wmax0 * s; }
    terrPush = CUR_TERR_PUSH * s; terrSX = CUR_TERR_SX * s; terrSX2 = 2 * terrSX * terrSX;
    terrPad = CUR_TERR_PAD * s; terrSide = CUR_TERR_SIDE * s; terrSidePeak = CUR_SIDE_PEAK * s;
    terrA = Math.max(terrSide, terrSidePeak, terrPush);
  }
  rescale(1);
  /* Both pushes come from a pair of dents (TPUSH, below: the terrain's copy
     of CUR and RIP), each from its own screen point (sx, sy) at its own
     strength (on, which is 0 when it is off), and both reach exactly zero at
     the edge of their reach: a cut-off there dropped up to 0.5px (dip) and
     0.65px (shove) in one frame as the pointer moved. Together the two are
     never stronger than one dent at full strength (their on sum to at most
     1), so the bound below still holds. render-webgl.js's shader is these
     same functions (PUSH_GLSL: dipAt, shoveAt). */
  const CUR_TERR_MIN = 0.02;                /* the dip's Gaussian, where it ends */
  function terrainDip(w, sx, topY, botY) {
    if (!(w.on > 0)) return 0;
    const dx = w.sx - sx;
    const g = Math.exp(-(dx * dx) / terrSX2);
    if (g <= CUR_TERR_MIN) return 0;
    const vy = spanGate(w.sy, topY, botY);
    if (vy <= 0) return 0;
    return terrPush * w.on * ((g - CUR_TERR_MIN) / (1 - CUR_TERR_MIN)) * vy;
  }
  /* 1 inside a column's own vertical span, tapering over CUR_TERR_PAD
     (terrPad at this size) outside it */
  function spanGate(y, topY, botY) {
    if (y < topY) return Math.max(0, 1 - (topY - y) / terrPad);
    if (y > botY) return Math.max(0, 1 - (y - botY) / terrPad);
    return 1;
  }
  /* The same field, sideways: things near the pointer are shoved AWAY from
     it, so terrain parts around the cursor instead of only dipping under it.

     u * exp(-u^2/2), the derivative of the Gaussian above — odd, so the sign
     carries "away from the pointer" for free, zero exactly under it, peaking
     at one reach either side and dying off after. Amplitude peaks at
     u = 1, where u*exp(-0.5) = 0.6065, so the real maximum shove is
     CUR_TERR_SIDE * 0.6065 px.

     Nothing is shoved per vertex today - a peak slides as one, by the
     shove at its centre, and a tree bends by the shove at its root - but if
     anything ever is, this cannot fold a silhouette back on itself: d/dx of
     the offset bottoms out at -0.446 * SIDE / SX, so x stays increasing as
     long as SIDE < 2.24 * SX: CUR_TERR_SIDE 34 and CUR_SIDE_PEAK 22 against
     about 213 (95 / 0.446) at S = 1, and SIDE and SX scale together
     (_tools/check-monotonic.js). Worth preserving if you retune it: a
     silhouette shoved per vertex past it would fold back on itself.

     The tail beyond |u| = 2.4 (where u * exp(-u^2/2) is down to 0.135) is
     faded to zero at 3.2 by a smoothstep, so the shove has no step at the
     edge of its reach. The fade only steepens the tail, which falls far
     slower than the -0.446 slope at u = sqrt(3) that sets the bound. */
  const CUR_SIDE_FADE = 2.4, CUR_SIDE_END = 3.2;
  function terrainShove(w, sx, topY, botY, amp) {
    if (!(w.on > 0)) return 0;
    const u = (sx - w.sx) / terrSX;
    const au = Math.abs(u);
    if (au >= CUR_SIDE_END) return 0;
    const vy = spanGate(w.sy, topY, botY);
    if (vy <= 0) return 0;
    let fade = 1;
    if (au > CUR_SIDE_FADE) {
      const q = (CUR_SIDE_END - au) / (CUR_SIDE_END - CUR_SIDE_FADE);
      fade = q * q * (3 - 2 * q);
    }
    return amp * w.on * vy * u * Math.exp(-(u * u) / 2) * fade;
  }
  /* The field as the TERRAIN feels it: the renderer evaluates the pushes
     itself, per vertex, in its vertex shader, with no per-vertex state
     (render-webgl.js).

     The two dents move at the pointer's speed, which is right for the
     sheet - it should ripple at full speed, that is the effect - but not
     for a mountain. Evaluated directly, their pushes moved terrain by up
     to 11.9 px in one frame (a pointer scribbling up and down a face at
     900 px/s: the dip's vertical span gate is only terrPad tall) and 7.9 px
     sideways (flicks between the gutters). The Canvas renderer, gone since
     W3, hid that behind a smoothing filter per vertex (LIFTS), which still
     let 3.1 px through on the same paths (audit F11).

     So the terrain is pushed from its own copy of each dent, TPUSH[i] (on,
     sx, sy, like CUR and RIP, and through the same terrainDip /
     terrainShove), that follows its dent under a budget: in one frame no
     point of the terrain may move more than TERR_JOLT px (times S, and in
     proportion to the frame's dt) because of that copy. Each frame the
     copy heads straight for its dent - strength and position together -
     and goes as far as the budget allows. The cost of a step is a bound on
     how far it moves any point, from the pushes' steepest slopes: A px per
     unit of strength (A the largest amplitude, the trees' shove), and,
     times the strength, A / terrSX per px of sideways move (the shove's
     slope; the dip's is 0.62x that) and A / terrPad per px of vertical
     move (the span gate's taper). A pointer that moves slowly is followed
     exactly (at full strength up to 84 px/s sideways, at the touch's
     strength alone up to 335 px/s); a fast one is trailed. A copy whose
     dent is further away than it costs to fade out and back in
     (|dx| / terrSX + |dy| / terrPad > 2) fades out where it is instead of
     sliding across the terrain, and once it has no strength left
     (TERR_SNAP) it is simply put on its dent, where it cannot be seen.
     Both copies together therefore move the terrain by at most
     2 * TERR_JOLT * S px a frame (_tools/check-terrain-jolt.js). A still
     frame (hold) moves nothing.

     The budget is on every motion the push makes - the dip, the peaks'
     rigid sideways slide (README "The scenery") and the trees' bend - so
     retuning TERR_JOLT changes how fast the slide follows the pointer as
     well as the dip. It took that job over from the Canvas renderer's
     LIFT_EASE (gone in W3), which eased the peaks' slide (its 'px' lifts)
     along with every vertical lift, so retuning that changed the slide's
     response too (audit F11). */
  /* How the copy moves: a critically damped spring toward its dent (TERR_W),
     with the speed of the motion it causes capped at the budget (TERR_JOLT
     px per 16.7ms) and the CHANGE of that speed capped too (TERR_ACC). The
     cost of a velocity is the bound above, applied to rates. It was a plain
     rate limit, which kept every step under the budget but started, stopped
     and reversed within one frame: from rest to full speed in a frame and
     straight back, a speed change of 0.24px/frame^2 at 165Hz on the peaks
     and 0.26 on the trees - small steps snapping on and off, which reads as
     jitter. Now the terrain eases into its lean and out of it: full speed
     takes TERR_JOLT * 60 / TERR_ACC = 0.25s to reach, and arrival slows
     down by the spring. (check-terrain-calm measures both, over the floor
     too; check-terrain-jolt still holds the per-frame bound.)
     A copy that fades out to start again elsewhere fades on a quicker spring
     (TERR_W_FADE), still under both caps, and counts as gone once its push
     moves nothing by TERR_SNAP_PX (0.02px: at 0.1 the snap onto its new dent was itself a 0.085px/frame^2 step, check-terrain-calm): a spring only nears zero, and waiting for
     a strength of 1e-4, as the rate limit could, kept a pointer that jumped
     from one face to another from moving the new one for 2.3s. */
  const TPUSH = [{ on: 0, sx: 0, sy: 0, von: 0, vsx: 0, vsy: 0 }, { on: 0, sx: 0, sy: 0, von: 0, vsx: 0, vsy: 0 }];
  const TERR_JOLT = 0.5, TERR_SNAP_PX = 0.02, TERR_W = 5, TERR_W_FADE = 10, TERR_ACC = 120;
  function terrainStep(dt) {
    const A = terrA;
    const VMAX = (TERR_JOLT * S * 1000) / 16.7, AMAX = TERR_ACC * S;     /* px/s and px/s^2 of terrain motion */
    for (let i = 0; i < FIELD.length; i++) {
      const w = FIELD[i], p = TPUSH[i];
      /* pushing nothing visible: simply on its dent */
      if (!(p.on * A > TERR_SNAP_PX * S)) { p.sx = w.sx; p.sy = w.sy; p.vsx = p.vsy = 0; if (!(p.von > 0)) p.von = 0; }
      /* Only the RIPPLE moves the terrain, never the touch. The touch is on
         whenever the pointer moves, so a pass over the mountains pushed
         them every time: watched on the owner's display, the big peak swung
         +-1.5px sideways and sank up to 26px as the cursor swept past, its
         crest reversing direction 214 times in 6s against 3 at rest - the
         push points away from the pointer, so it flips sides as the pointer
         crosses. The ripple gathers only while the pointer is slow or still
         (CALM_IN), so a sweep leaves the terrain alone and a pointer resting
         on a face presses it in slowly. Scaled so a fully gathered ripple
         pushes as hard as the whole field did. */
      const share = i === 0 ? 0 : (w.on > 0 ? w.on : 0) / (1 - CALM_FLOOR);
      let tx = w.sx, ty = w.sy, ton = share > 1 ? 1 : share, k = TERR_W;
      /* further than it costs to fade out and back in: fade where it is */
      if (p.on > 0 && Math.abs(tx - p.sx) / terrSX + Math.abs(ty - p.sy) / terrPad > 2) { tx = p.sx; ty = p.sy; ton = 0; k = TERR_W_FADE; }
      let rem = dt / 1000;
      while (rem > 0) {
        const h = Math.min(rem, 1 / 120);
        const on = Math.max(p.on, ton);
        let aon = k * k * (ton - p.on) - 2 * k * p.von;
        let ax = k * k * (tx - p.sx) - 2 * k * p.vsx;
        let ay = k * k * (ty - p.sy) - 2 * k * p.vsy;
        const ac = A * Math.abs(aon) + on * A * (Math.abs(ax) / terrSX + Math.abs(ay) / terrPad);
        if (ac > AMAX) { const f = AMAX / ac; aon *= f; ax *= f; ay *= f; }
        p.von += aon * h; p.vsx += ax * h; p.vsy += ay * h;
        const vc = A * Math.abs(p.von) + on * A * (Math.abs(p.vsx) / terrSX + Math.abs(p.vsy) / terrPad);
        if (vc > VMAX) { const f = VMAX / vc; p.von *= f; p.vsx *= f; p.vsy *= f; }
        p.on += p.von * h; p.sx += p.vsx * h; p.sy += p.vsy * h;
        if (p.on < 0) { p.on = 0; if (p.von < 0) p.von = 0; }
        rem -= h;
      }
    }
  }
  /* THE BLOOM. The pointer on the scenery reshapes it geometrically - the
     owner: "slowly and smoothly move in a geometric manner, something
     abstract and beautiful and mathematical, not necessarily physical,
     maybe fractalize away, rotate"; then "I want the actual geometric
     structure of the mountains to change, same with the trees, and I
     don't want to have to hold it there for that long"; then, of the
     shards: "I love the mountains fragmenting like that ... remove all the
     tiny lines in the mountains, just the large pieces fragmenting", the
     clouds to fragment the same way in the mountains' style, and the trees
     "rotate and fractalize" rather than stretch. From one strength, BLOOM
     (two of them, below), a Gaussian of BLOOM_R * S about its centre
     (bloomAt), the renderer breaks the scenery into rigid pieces:

       a mountain's facets turn about their own centroids by up to
       SHARD_TURN rad (all one way, each by its own share, 0.8-1: the
       mountain turns as one mosaic; alternate ways read as shattered
       glass), shrink toward them by up to SHARD_SHRINK and drift out from
       the mountain's foot by up to SHARD_DRIFT of their distance - each as
       one, read at the bloom over its centroid; the gaps open onto
       whatever is behind. A facet's share falls to nothing as its lowest
       corner nears the ground (smoothstep over SHARD_PIN * S px), so a
       facet on the ground stays put, the feet stay on the floor, and
       nothing turns over;
       a cloud's facets do the same about their centroids (no ground to
       keep), drifting out from its centre by up to CLOUD_DRIFT;
       a tree's or conifer's branches keep out of the cursor's disc,
       turning at their joints and never coming apart: every branch turns
       about the point it grows from (a tree's fork, a conifer chevron's
       apex on its trunk), and every trunk hinges at its root, just far
       enough that it clears a disc of KEEP_R * S px (plus KEEP_MARGIN of
       that) about each bloom's centre, the nearer way round - a soft sign
       over KEEP_SOFT of the half-width it is in, so a centre crossing a
       branch swings it across rather than flipping it - times that
       bloom's strength, and no further than its joint allows: FORK_MAX
       rad at a tree's first fork and FORK_GROW more for each fork further
       out (the twigs turn the most, to FORK_LIMIT), a conifer's arms
       ARM_MAX, a trunk TRUNK_MAX. A branch carries its children, and
       each solves its own clearance after its parent has turned, so the
       tree finds a shape out of the disc from the trunk out (the owner: "I
       basically want it so that the trees don't touch the cursor's radius
       ... more aggressive rotation on those tiny branches, to basically
       find the configuration where it's out of the radius of the cursor.
       Same with the other type of tree ... the base hinging and the
       leaves"). Every branch keeps its length and its joint; the trunks'
       feet stay planted. Each turn eases toward its clearing turn rather
       than jumping to it (THE FORKS, below); the renderer poses the
       strokes from the turns on the CPU (render-webgl.js poseStrokes: the
       turns compound through the tree, which a vertex shader, seeing one
       segment, cannot follow).

     When. The pointer itself, not the ripple (which takes a second or more
     to gather): BLOOM.still comes in at STILL_IN per second while the
     pointer is on the scenery - in the window, off the card (COVER), no lower than
     BLOOM_PAD * S under the nearest scenery's ground line (the sky and its
     clouds included) - and moving under BLOOM_VREST * S px/s (a hand's slow
     glide; a sweep is several times that), and goes at STILL_OUT. A
     bloom's strength follows still on a critically damped spring (BLOOM_W)
     with its rate (BLOOM_RATE /s) and acceleration (BLOOM_ACC /s^2)
     capped, so it starts and stops without a jerk: about 0.35s to 90%
     (the owner: "less time between cursor on mountains and the
     fractalizing"; it took 0.9s). Its
     centre follows the pointer on a spring of its own (BLOOM_W again), no
     faster than BLOOM_MOVE * S px/s nor accelerating more than
     BLOOM_MACC * S px/s^2, so a slow glide carries the bloom along with
     the pointer; a jump further than BLOOM_R * S * 0.75 does not drag it
     across: the bloom fades where it is while the other one (there are
     two, BLOOM.s) comes in at the new place. bloomAt sums them, at most 1;
     BLOOM.on is the larger. */
  const BLOOM_R = 140, BLOOM_W = 11, BLOOM_RATE = 5, BLOOM_ACC = 45, BLOOM_MOVE = 260, BLOOM_MACC = 900;
  const BLOOM_VREST = 350, STILL_IN = 25, STILL_OUT = 4, BLOOM_PAD = 20;
  const SHARD_TURN = 0.28, SHARD_SHRINK = 0.2, SHARD_DRIFT = 0.05, SHARD_PIN = 40, CLOUD_DRIFT = 0.1;
  const KEEP_R = 46, KEEP_MARGIN = 0.15, KEEP_SOFT = 0.3, FORK_MAX = 0.6, FORK_GROW = 0.5, FORK_LIMIT = 2.5, TRUNK_MAX = 0.6, ARM_MAX = 1.5;
  const bloomSlot = () => ({ on: 0, v: 0, x: 0, y: 0, vx: 0, vy: 0 });
  const BLOOM = { on: 0, still: 0, cur: 0, s: [bloomSlot(), bloomSlot()] };
  let NEAR_D = 0;   /* the nearest scenery's depth, found once */
  /* a length, for the bloom's own comparisons: hypot falls back to
     Math.hypot (and its garbage) at 0, where the bloom mostly sits */
  function dist(x, y) { return Math.sqrt(x * x + y * y); }
  /* one slot over dt (s): its strength toward target, its centre toward
     (tx, ty) when follow, else coming to rest where it is */
  function slotStep(b, target, follow, tx, ty, h) {
    const vm = BLOOM_MOVE * S, am = BLOOM_MACC * S;
    let rem = h;
    while (rem > 0) {
      const k = Math.min(rem, 1 / 120);
      if (follow) {
        let ax = BLOOM_W * BLOOM_W * (tx - b.x) - 2 * BLOOM_W * b.vx, ay = BLOOM_W * BLOOM_W * (ty - b.y) - 2 * BLOOM_W * b.vy;
        const a = dist(ax, ay);
        if (a > am) { ax *= am / a; ay *= am / a; }
        b.vx += ax * k; b.vy += ay * k;
      } else {
        const sp = dist(b.vx, b.vy), dv = am * k;
        if (sp <= dv) b.vx = b.vy = 0; else { b.vx -= b.vx / sp * dv; b.vy -= b.vy / sp * dv; }
      }
      const sp = dist(b.vx, b.vy);
      if (sp > vm) { b.vx *= vm / sp; b.vy *= vm / sp; }
      b.x += b.vx * k; b.y += b.vy * k;
      let acc = BLOOM_W * BLOOM_W * (target - b.on) - 2 * BLOOM_W * b.v;
      if (acc > BLOOM_ACC) acc = BLOOM_ACC; else if (acc < -BLOOM_ACC) acc = -BLOOM_ACC;
      b.v += acc * k;
      if (b.v > BLOOM_RATE) b.v = BLOOM_RATE; else if (b.v < -BLOOM_RATE) b.v = -BLOOM_RATE;
      b.on += b.v * k;
      if (b.on < 0) { b.on = 0; if (b.v < 0) b.v = 0; }
      else if (b.on > 1) { b.on = 1; if (b.v > 0) b.v = 0; }
      rem -= k;
    }
  }
  function bloomStep(dt) {
    const h = dt / 1000, R = BLOOM_R * S, px = ptr.x, py = ptr.y;
    if (!NEAR_D) { let m = Infinity; for (const L of [RIDGES, BANDS, TREES, CONIFERS]) for (const o of L) if (o.d < m) m = o.d; NEAR_D = m; }
    const onCard = COVER.on && px > COVER.x0 && px < COVER.x1 && py > COVER.y0 && py < COVER.y1;
    /* slow by both the follower and the pointer's own path: the follower slows for a moment at a sweep's turn while the path does not */
    const on = ptr.seen && !ptr.out && !onCard && py < restAt(NEAR_D) + BLOOM_PAD * S && Math.max(dist(ptr.vx, ptr.vy), dist(ptr.pvx, ptr.pvy)) < BLOOM_VREST * S;
    BLOOM.still = on ? Math.min(1, BLOOM.still + STILL_IN * h) : Math.max(0, BLOOM.still - STILL_OUT * h);
    let c = BLOOM.s[BLOOM.cur];
    if (c.on < 1e-3) { c.x = px; c.y = py; c.vx = c.vy = 0; }
    if (dist(px - c.x, py - c.y) > R * 0.75 && BLOOM.still > 0) {
      const o = BLOOM.s[1 - BLOOM.cur];
      if (o.on < 1e-3 || dist(px - o.x, py - o.y) <= R * 0.75) {
        BLOOM.cur = 1 - BLOOM.cur; c = o;
        if (c.on < 1e-3) { c.x = px; c.y = py; c.vx = c.vy = 0; }
      }
    }
    const live = dist(px - c.x, py - c.y) <= R * 0.75;
    for (let i = 0; i < 2; i++) { const b = BLOOM.s[i]; slotStep(b, b === c && live ? BLOOM.still : 0, b === c && live, px, py, h); }
    BLOOM.on = Math.max(BLOOM.s[0].on, BLOOM.s[1].on);
  }
  function bloomAt(x, y) {
    if (!(BLOOM.on > 0)) return 0;
    const r = BLOOM_R * S;
    let v = 0;
    for (let i = 0; i < 2; i++) {
      const b = BLOOM.s[i];
      if (!(b.on > 0)) continue;
      const dx = x - b.x, dy = y - b.y;
      v += b.on * Math.exp(-(dx * dx + dy * dy) / (2 * r * r));
    }
    return v < 1 ? v : 1;
  }
  /* A conifer's line work, relative to its root: [x1, y1, x2, y2, kind,
     parent, tier, variant] per segment - its trunk (kind 4, hinged at the
     root), then each tier's two chevrons (variant 0 the strong one, 1 its
     faint echo) as two arms meeting at the apex on the trunk (kind 2: the
     second end is the apex, 3: the first), their parent the trunk (0).
     The renderer draws it (sceneryMesh: the widths by variant) and THE
     FORKS turn it; one layout for both. */
  function coniferLayout(c) {
    const h = c.h, out = [[0, 0, 0, -0.97 * h, 4, -1, -1, 0]];
    for (let k = 0; k < 5; k++) {
      const f = 0.14 + 0.19 * k, tw = c.w * (1 - 0.155 * k), ty = -h * f;
      for (let v = 0; v < 2; v++) {
        const ay = -h * (f + (v ? 0.025 : 0.135));
        out.push([-tw, ty, 0, ay, 2, 0, k, v], [0, ay, tw, ty, 3, 0, k, v]);
      }
    }
    return out;
  }
  /* THE FORKS: the trees' and conifers' turns at their joints, kept out of
     the cursor's disc (THE BLOOM). Per tree and conifer (FORK.obj, TREES
     then CONIFERS, the renderer's ID_STROKE order), its segments as the
     renderer's mesh has them ([x1, y1, x2, y2, kind, parent] from the
     root; kind 1 a tree branch on its parent's end, 2 / 3 a chevron arm on
     its apex, 4 a trunk hinged at its root) and each one's turn (off),
     made again when the scale changes. Each frame every joint's target is
     the turn that clears the disc (keepOut, the nearer way round, times
     each bloom's strength, within its joint's limit), worked out from the
     trunk out on the branches as they stand; each turn then eases toward
     its target on a critically damped spring (FORK_W) whose rate keeps the
     farthest tip it carries (its reach: the longest path out from its
     joint, its own length and its children's) under FORK_TIPV * S px/s
     shared among the joints a tip can ride on (chain: 8 in a tree, 2 in a
     conifer), so all of them together move it no faster (capped by its own length alone, the
     twigs riding on every fork below them moved at up to 1,637px/s), and
     whose acceleration is held to FORK_ACC times that rate a second, so a
     turn reaching its cap does not stop accelerating at once. A target alone, from the branches'
     targets, swung a twig 166px in a frame: each joint's choice of side
     turns on its parent's angle, so a small turn near the trunk flipped
     the forks above it one after another. The turns are the scene's, so
     everything that draws or measures a tree poses it the same way
     (render-webgl.js poseStrokes). */
  const FORK_W = 16, FORK_TIPV = 480, FORK_ACC = 14;
  const FORK = { S: 0, idle: true, obj: [] }, FORK_PT = [0, 0];
  function forkLayouts() {
    if (FORK.S === S && FORK.obj.length) return;
    FORK.S = S; FORK.obj = []; FORK.idle = true;
    const add = (c, segs) => {
      const m = segs.length, seg = new Float64Array(6 * m);
      segs.forEach((g, i) => { for (let j = 0; j < 6; j++) seg[6 * i + j] = g[j]; });
      FORK.obj.push({ c, m, seg, off: new Float64Array(m), vel: new Float64Array(m), tgt: new Float64Array(m),
                      ang: new Float64Array(m), ex: new Float64Array(m), ey: new Float64Array(m), rest: new Float64Array(m), depth: new Float64Array(m),
                      reach: new Float64Array(m), chain: 1 });
      /* each joint's reach, from the twigs in: its length and its longest child's */
      const o = FORK.obj[FORK.obj.length - 1], dep = new Float64Array(m);
      /* the most joints a tip rides on, its own included */
      for (let i = 0; i < m; i++) { const p = seg[6 * i + 5]; dep[i] = p >= 0 ? dep[p] + 1 : 1; if (dep[i] > o.chain) o.chain = dep[i]; }
      for (let i = m - 1; i >= 0; i--) {
        const q = 6 * i, len = Math.sqrt((seg[q + 2] - seg[q]) * (seg[q + 2] - seg[q]) + (seg[q + 3] - seg[q + 1]) * (seg[q + 3] - seg[q + 1]));
        o.reach[i] = Math.max(o.reach[i], 0) + len;
        const p = seg[q + 5];
        if (p >= 0 && seg[q + 4] === 1) o.reach[p] = Math.max(o.reach[p], o.reach[i]);
        if (p >= 0 && seg[q + 4] !== 1) o.reach[p] = Math.max(o.reach[p], o.reach[i] + Math.abs(seg[q + 1]));
      }
    };
    for (const c of TREES) {
      const segs = [], levels = treeLevels(c);
      let first = 0;
      levels.forEach((lv, li) => {
        lv.segs.forEach((g, j) => segs.push([g[0], g[1], g[2], g[3], li ? 1 : 4, li ? first - levels[li - 1].segs.length + (j >> 1) : -1]));
        first += lv.segs.length;
      });
      add(c, segs);
    }
    for (const c of CONIFERS) add(c, coniferLayout(c));
  }
  /* the turn that takes a branch from joint (jx, jy) at angle a (x = sin a,
     y = -cos a), len long, out of the disc of radius k about (cx, cy): 0
     when it misses; else to the disc's edge on the side it is turned to -
     its angle less its own turn now (off) is a, so where it stands now is
     a + off, and it keeps to that side (a soft sign over KEEP_SOFT of the
     half-width it is in, nudged by its own lean, lean: +-1), so a branch
     the cursor sits square on leans its own way at once, and one already
     turned is not thrown back across by the turns below it. With the side
     from a alone, a cursor square on a trunk left it standing (its sign
     0) and the arms on it could not get out. */
  function keepOut(jx, jy, a, len, cx, cy, k, off, lean) {
    const dx = cx - jx, dy = cy - jy, D = Math.sqrt(dx * dx + dy * dy);
    if (D - k >= len) return 0;
    let psi;
    if (D <= k) psi = 0.5 * Math.PI * (2 - D / k);   /* the joint itself inside: wider toward the centre (pi/2 at the edge, as asin gives) */
    else {
      const T = Math.sqrt(D * D - k * k);
      psi = len >= T ? Math.asin(k / D) : Math.acos(Math.max(-1, Math.min(1, (D * D + len * len - k * k) / (2 * D * len))));
    }
    let del = a - Math.atan2(dx, -dy);
    del -= 2 * Math.PI * Math.round(del / (2 * Math.PI));
    if (Math.abs(del) >= psi) return 0;
    let s = (del + off + lean * 0.15 * KEEP_SOFT * psi) / (KEEP_SOFT * psi);
    s = s > 1 ? 1 : s < -1 ? -1 : s;
    return s * (1.5 - 0.5 * s * s) * psi - del;
  }
  /* one object's branches as they stand (their turns, off), from the trunk
     out: each one's angle and end (ang, ex, ey); with targets, each
     joint's clearing turn into tgt */
  function forkPose(o, targets, n) {
    const k = KEEP_R * (1 + KEEP_MARGIN) * S, s0 = BLOOM.s[0], s1 = BLOOM.s[1];
    /* the root where it is drawn: on the floor there without the cursor's
       dents (the shader's refAt) - on the rest line alone the disc it
       cleared sat 10-20px off the one the cursor makes, with the swell */
    const d = o.c.d, rx = o.c.fx * W + shiftX(d), xw = worldX(rx, d);
    const ry = surfacePoint(xw, d, simNow, FORK_PT)[1] - (dentAt(xw, d) * H * WAVE_Y) / d, g = o.seg;
    for (let i = 0; i < o.m; i++) {
      const q = 6 * i, kind = g[q + 4], par = g[q + 5];
      const x1 = g[q], y1 = g[q + 1], x2 = g[q + 2], y2 = g[q + 3];
      const len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
      const ra = kind === 2 ? Math.atan2(x1 - x2, y2 - y1) : Math.atan2(x2 - x1, y1 - y2);
      o.rest[i] = ra;
      let jx = kind === 2 ? x2 : x1, jy = kind === 2 ? y2 : y1, ang = ra, lim = TRUNK_MAX, depth = 0;
      if (kind === 1) {
        jx = o.ex[par]; jy = o.ey[par]; ang = o.ang[par] + ra - o.rest[par]; depth = o.depth[par] + 1;
        lim = Math.min(FORK_LIMIT, FORK_MAX * (1 + FORK_GROW * (depth - 1)));
      } else if (kind !== 4) {
        /* an arm: its apex goes round the root with the trunk */
        const t = o.off[par], c = Math.cos(t), sn = Math.sin(t), ax = jx;
        jx = c * ax - sn * jy; jy = sn * ax + c * jy; ang = ra + t; depth = 2;
        lim = ARM_MAX;
      }
      if (targets) {
        let turn = 0;
        const lean = (i + n) % 2 ? 1 : -1;
        if (s0.on > 0) turn += s0.on * keepOut(rx + jx, ry + jy, ang, len, s0.x, s0.y, k, o.off[i], lean);
        if (s1.on > 0) turn += s1.on * keepOut(rx + jx, ry + jy, ang, len, s1.x, s1.y, k, o.off[i], lean);
        o.tgt[i] = turn > lim ? lim : turn < -lim ? -lim : turn;
      }
      ang += o.off[i];
      o.ang[i] = ang; o.ex[i] = jx + Math.sin(ang) * len; o.ey[i] = jy - Math.cos(ang) * len; o.depth[i] = depth;
    }
  }
  function forkStep(dt) {
    forkLayouts();
    if (!(BLOOM.on > 0) && FORK.idle) return;
    const h = dt / 1000;
    let moving = BLOOM.on > 0;
    for (let n = 0; n < FORK.obj.length; n++) {
      const o = FORK.obj[n];
      forkPose(o, true, n);
      for (let i = 0; i < o.m; i++) {
        const vmax = FORK_TIPV * S / (Math.max(o.reach[i], 4) * o.chain), amax = FORK_ACC * vmax;
        let rem = h, off = o.off[i], v = o.vel[i];
        const tg = o.tgt[i];
        while (rem > 0) {
          const st = Math.min(rem, 1 / 120);
          let acc = FORK_W * FORK_W * (tg - off) - 2 * FORK_W * v;
          acc = acc > amax ? amax : acc < -amax ? -amax : acc;
          v += acc * st;
          if (v > vmax) v = vmax; else if (v < -vmax) v = -vmax;
          off += v * st;
          rem -= st;
        }
        o.off[i] = off; o.vel[i] = v;
        if (Math.abs(off) > 1e-5 || Math.abs(v) > 1e-5) moving = true;
      }
    }
    if (!moving) {
      for (let n = 0; n < FORK.obj.length; n++) { FORK.obj[n].off.fill(0); FORK.obj[n].vel.fill(0); }
      FORK.idle = true;
    } else FORK.idle = false;
  }
  /* the pushes of TPUSH: what render-webgl.js's shader evaluates per vertex
     (the CPU copy the tools hold it to) */
  function terrainPushDip(sx, topY, botY) {
    return terrainDip(TPUSH[0], sx, topY, botY) + terrainDip(TPUSH[1], sx, topY, botY);
  }
  function terrainPushSide(sx, topY, botY, amp) {
    return terrainShove(TPUSH[0], sx, topY, botY, amp) + terrainShove(TPUSH[1], sx, topY, botY, amp);
  }
  /* A fractal tree's shape never changes — only where its root sits. The
     layout is built once relative to the root: one entry per depth level,
     holding its segments, alpha and line width. At TREE_DEPTH 7 a tree is
     255 segments and 381 hash1 calls (each a Math.sin), ~1,500 for the four,
     so it is built once per size, never per frame: the renderer's
     sceneryMesh calls treeLevels. The line widths are TRUNK_WIDTH and the 1.5
     floor times SW. */
  function buildTree(len, depth, alpha, seed) {
    const levels = [];
    let level = [[0, 0, len, 0, seed]], a = alpha, lw = TRUNK_WIDTH * SW;
    for (let dpt = depth; dpt >= 0 && level.length; dpt--) {
      const segs = [], next = [];
      for (const [bx, by, bl, ang, sd] of level) {
        const x2 = bx + Math.sin(ang) * bl, y2 = by - Math.cos(ang) * bl;
        segs.push([bx, by, x2, y2]);
        if (dpt > 0) {
          const spread = 0.34 + 0.26 * hash1(sd + dpt * 5.1);
          const lean = (hash1(sd + dpt * 2.7) - 0.5) * 0.20;
          const nl = bl * (0.70 + 0.08 * hash1(sd + dpt * 1.3));
          next.push([x2, y2, nl, ang - spread + lean, sd + 1.7]);
          next.push([x2, y2, nl, ang + spread + lean, sd + 3.1]);
        }
      }
      levels.push({ segs: segs, a: a, lw: lw });
      a *= 0.9;
      lw = Math.max(1.5 * SW, lw * 0.80);
      level = next;
    }
    return levels;
  }
  /* the layout of one TREES entry: its trunk is 0.30 of its height */
  function treeLevels(c) { return buildTree(c.h * 0.30, TREE_DEPTH, c.a, c.seed); }
  const SUN = { fx: 0.12, fy: 0.30, r: 0.105, par: 0.03, fill: 'rgb(150,186,178)' };

  /* Where the scenery stands. The renderer builds its meshes once per size
     from the layout (the tables, ridgeSummits, peakPlace, treeLevels) and
     places every corner in its vertex shader each frame, on the floor where
     it is drawn (_tools/check-wave-parity.js holds it to the floor; the
     Canvas renderer's per-frame shape functions and their LIFTS went with
     it in W3). What it asks the scene for each frame is the sun (sunAt) and
     the bodies (bodiesAt). */
  /* The sun: [x, y, r]. It lives in a margin the card leaves open, never in
     the middle the card hides (audit G4.4). Placed at fx * W, its centre
     went under the card on any window narrower than about 1130px: 16% of
     the disc showing at 1024x768, 6% at 390x844, none at 844x390 or
     960x600. Now its centre never sits under the card. It goes into
     whichever margin is the wider, the gutter beside the card or the strip
     above it:

       gutter   at fx * W while the whole disc fits there; else out toward
                the screen edge until it just clears the card; and once the
                gutter is narrower than the disc, centred in it, which shows
                the most of it a strip that wide can (95% at 1180x820, 57%
                at 1024x768, 42% at 960x600, 32% at 1080x1920)
       above    a phone or a narrow window, where the gutter is the body's
                padding: the centre goes LOOK_Y above the card's top edge,
                so the vertical parallax (tiltY, up to LOOK_Y / 2) cannot
                carry it under the card, and the sun shows as a band over
                the card's top (41% at 844x390, 28% at 900x600, 9% at
                390x844)

     Measured in headless Chrome with a 15px scrollbar, the worst over
     look.y; _tools/check-sun.js. The radius stays a fraction of H. With no
     card it is at (fx * W, fy * H), as it always was, and on the page it is
     still there wherever the whole disc fits in the gutter (1366x768,
     1440x900 and up). An fx past 0.5 puts it in the right-hand gutter by
     the same rule. Given out (a 3-array), it fills that rather than a new
     one. */
  function sunAt(out) {
    const r = SUN.r * H, right = SUN.fx > 0.5;
    let e = (right ? 1 - SUN.fx : SUN.fx) * W, y = SUN.fy * H;
    if (CARD.on) {
      const gutter = Math.max(0, right ? W - CARD.right : CARD.left);
      if (gutter >= CARD.top) e = Math.min(e, Math.max(gutter - r, gutter / 2));
      else y = CARD.top - LOOK_Y;
    }
    const p = out || [0, 0, 0];
    p[0] = (right ? W - e : e) + look.x * LOOK_X * SUN.par; p[1] = y + tiltY(); p[2] = r;
    return p;
  }
  /* Where the scenery is laid out: a backdrop ridge's summits, [position,
     height, half-width] as fractions of the width, the height and the width
     (position from -0.08 to 1.08, the span the ridge covers), and a band's
     peak k: its seed sd, centre fx (a fraction of the width), height mh (px)
     and half-width mw (px). render-webgl.js builds its crests from these,
     once per size. */
  function ridgeSummits(r) {
    const summits = [];
    for (let j = 0; j < r.nsum; j++) {
      const sj = r.seed + j * 11.7;
      summits.push([((j + 0.5 + r.ph) % r.nsum) / r.nsum + (0.7 * (hash1(sj) - 0.5)) / r.nsum,
                    r.hmin + (r.hmax - r.hmin) * hash1(sj + 1.3),
                    0.07 + 0.09 * hash1(sj + 2.6)]);
    }
    return summits;
  }
  function peakPlace(b, k) {
    const sd = b.seed + k * 7.3;
    const fx = -0.08 + 1.16 * (((k + 0.5 + b.ph) % b.n) / b.n + (0.55 * (hash1(sd) - 0.5)) / b.n);
    const mh = (b.hmin + (b.hmax - b.hmin) * hash1(sd + 1.1)) * H;
    const mw = b.wmin + (b.wmax - b.wmin) * hash1(sd + 2.2);
    return { sd, fx, mh, mw };
  }
  /* The three bodies on screen, sorted far to near (paint order): x, y; s,
     the perspective scale 2.1 / d (how bright the renderer makes it); and
     size, s * S, what it sizes the body by (render-webgl.js: a 3.8 * size
     core in a 17 * size halo). Each floats 7 * size px above the sheet,
     with the cursor's dents under it taken at their eased depth (sink, in
     bodyPull) rather than this frame's.

     Given out, an array the caller keeps, it refills that and its records
     in place instead of allocating new ones, so a renderer can draw a frame
     without making garbage (render-webgl.js); without it every call returns
     fresh ones. The order is the same either way: by s, ties kept in body
     order, as the Array.prototype.sort this replaced (which also allocates)
     gave them. */
  const BODY_AT = [0, 0];
  function bodiesAt(t, out) {
    const list = out || [];
    for (let i = 0; i < bodiesW.length; i++) {
      const b = bodiesW[i];
      const p = surfacePoint(b.xw, b.d, t, BODY_AT);
      const s = 2.1 / b.d, size = s * S;
      const y = p[1] + ((bodyPull[i].sink - dentAt(b.xw, b.d)) * H * WAVE_Y) / b.d;
      const o = list[i] || (list[i] = { x: 0, y: 0, s: 0, size: 0 });
      o.x = p[0]; o.y = y - 7 * size; o.s = s; o.size = size;
    }
    for (let i = 1; i < list.length; i++) {
      const o = list[i];
      let j = i - 1;
      for (; j >= 0 && list[j].s > o.s; j--) list[j + 1] = list[j];
      list[j + 1] = o;
    }
    return list;
  }

  /* The scene clock. simNow (ms) starts at 0 and only ever moves on by a
     frame's clamped dt, and everything that changes with time reads it: the
     wave, the swell events, the orbit and the terrain, and the springs
     through dt. It used to be the raw rAF time while the springs took the
     clamped step, so after a hidden tab the whole gap landed on the sheet
     and the orbit in one frame - the near floor leapt 53px, the bodies up to
     525px (audit F6).

     lastNow is the rAF time of the last frame, or 0 when the next frame
     must count as one ordinary step whatever the gap (resetClock: main.js
     calls it when the tab comes back and when the motion resumes). */
  let lastNow = 0, simNow = 0;
  function resetClock() { lastNow = 0; }
  /* the orbit this frame, refilled in place (orbitWorld) */
  const ORBIT = orbitWorld(ORBIT_T0);

  /* One frame of the scene at rAF time `now` (ms): the eased look, the field
     and the marker, the orbit, the bodies' pull and roll, and the swell
     event. Returns the scene time to draw the sheet and the terrain at. */
  function advance(now) {
    /* Frame-rate independent easing: a flat per-frame factor converges 2.4x
       faster on a 144Hz screen than on 60Hz.
       dt is clamped to 64ms HERE, once, and every integrator below relies on
       it (README "The scene clock"): a long frame or a tab return must not reach
       a spring as one giant step. Keep this clamp. It is floored at 0 too: a
       timestamp older than the last one (seen after a bfcache restore) must
       not run the clock backwards. */
    let dt = lastNow ? now - lastNow : 16.7;
    if (!(dt > 0)) dt = 0;
    else if (dt > 64) dt = 64;
    if (Number.isFinite(now)) lastNow = now;
    if (!(W > 0 && H > 0)) return simNow;   /* nowhere to put anything */
    if (ptr.back) seat();
    /* the pointer's place this frame, evenly paced (smoothFrame) */
    if (Number.isFinite(now)) smoothFrame(now); else { ps.sx = ptr.tx; ps.sy = ptr.ty; }
    /* the pointer's own path's velocity this frame (the ripple's target,
       fieldStep): it stops when the pointer does, where the follower takes
       50-80ms to */
    if (!Number.isFinite(ptr.lsx + ptr.lsy)) { ptr.lsx = ps.sx; ptr.lsy = ps.sy; }
    if (dt > 0 && ptr.seen) { ptr.pvx = (ps.sx - ptr.lsx) * 1000 / dt; ptr.pvy = (ps.sy - ptr.lsy) * 1000 / dt; }
    else ptr.pvx = ptr.pvy = 0;
    ptr.lsx = ps.sx; ptr.lsy = ps.sy;
    simNow += dt;
    const e = 1 - Math.pow(1 - 0.04, dt / 16.7);
    look.x += (look.tx - look.x) * e;
    look.y += (look.ty - look.y) * e;

    /* The field follower, in fixed substeps: one big step at a low frame
       rate, or after a stall, makes a spring overshoot or blow up. The
       field's strength is stepped with it, so its time constants do not
       depend on the frame rate either. */
    let rem = dt / 1000;
    while (rem > 0) {
      const h = Math.min(rem, 1 / 120);
      if (ptr.seen) {
        if (!(ptr.hop > 0)) {
          ptr.vx += (FIELD_W * FIELD_W * (ps.sx - ptr.x) - 2 * FIELD_W * ptr.vx) * h;
          ptr.vy += (FIELD_W * FIELD_W * (ps.sy - ptr.y) - 2 * FIELD_W * ptr.vy) * h;
          ptr.x += ptr.vx * h;
          ptr.y += ptr.vy * h;
        }
        fieldStep(h);
      }
      rem -= h;
    }
    /* the ring, on the pointer's evenly paced path */
    mk.x = ps.sx; mk.y = ps.sy;
    ptr.k += (ptr.want - ptr.k) * (1 - Math.pow(1 - 0.035, dt / 16.7));

    /* Where the dents sit. The touch is on the follower: its depth from
       screen y through fieldDepth, and its world x at that depth. No rate
       limit and no second spring - the follower is already smooth, and a
       limit on top is what let the dent fall behind and then stop dead
       (audit F21). No horizon taper either: above the horizon the depth
       bends into CUR_DFAR, past the last row and every terrain base, so the
       dent leaves the sheet by itself, continuously. The old taper started
       at 1.167x full strength, so crossing that line popped the dent 16%
       deeper in one frame (audit F5). The ripple rides on the touch until a
       fast move leaves it behind (fieldStep), and rejoins it once it has
       relaxed away. */
    if (ptr.seen) {
      const d = fieldDepth(ptr.y);
      CUR.d = d;
      CUR.xw = worldX(ptr.x, d);
      CUR.sx = ptr.x; CUR.sy = ptr.y;
      /* The ripple rejoins the follower once it has relaxed away (b at
         RIP_GATE, so it rejoins unseen), but never while the field hops:
         the follower then waits where the pointer left, so the ripple
         gathered there and rode the hop's snap across the sheet - 1150px
         in one frame at 0.065 strength, a 15px step of the sheet at both
         ends, after the pointer was away 1s. */
      if (!RIP.att && RIP.b <= RIP_GATE && !(ptr.hop > 0)) RIP.att = true;
      if (RIP.att) { RIP.xw = CUR.xw; RIP.d = CUR.d; RIP.sx = ptr.x; RIP.sy = ptr.y; }
    }
    let hopShare = 1;
    if (ptr.hop > 0) hopShare = ptr.hop * ptr.hop * (3 - 2 * ptr.hop);
    CUR.on = envShare() * CALM_FLOOR * hopShare;
    RIP.on = RIP.b > RIP_GATE ? RIP.b - RIP_GATE : 0;
    /* the terrain's copy of the field follows it, under its budget */
    terrainStep(dt);
    bloomStep(dt);
    forkStep(dt);

    const orbit = orbitWorld(ORBIT_T0 + simNow * ORBIT_RATE, ORBIT);
    const gk = 1 - Math.exp(-dt / 1000 / ROLL_TAU), sk = 1 - Math.exp(-dt / 1000 / SINK_TAU);
    for (let i = 0; i < orbit.length; i++) {
      const o = orbit[i], p = bodyPull[i], r = bodyRoll[i];
      /* Each body leans toward the field where a dent is near it. */
      let tx = 0, td = 0;
      for (let j = 0; j < FIELD.length; j++) {
        const w = FIELD[j];
        if (!(w.on > 0)) continue;
        const dx = w.xw - o.xw, dd = w.d - o.d;
        const r2 = dx * dx + dd * DEPTH_W * (dd * DEPTH_W);
        const pull = w.on * 0.55 * Math.exp(-r2 / 1.4);
        tx += dx * pull; td += dd * pull;
      }
      /* Roll downhill. z grows downward on screen, so the downhill direction
         is +grad, and the push is the slope itself - steeper means faster,
         which is the whole point. The slope is read where the body is drawn
         (orbit + pull + roll, clamped as below); it was read at the orbit
         and pull point alone, a median 0.27 world units away - most of a
         quarter wave - so bodies rolled uphill 41% of the time (audit F8).
         Still waveBase, never wave: a body must not feel its own well. */
      const x0 = o.xw + p.x, d0 = o.d + p.d, hh = 0.05;
      const qx = Math.max(-3.2, Math.min(3.2, x0 + r.x)), qd = softFloor(d0 + r.d);
      const gx = (waveBase(qx + hh, qd, simNow) - waveBase(qx - hh, qd, simNow)) / (2 * hh);
      const gd = (waveBase(qx, qd + hh, simNow) - waveBase(qx, qd - hh, simNow)) / (2 * hh);
      r.gx += (gx - r.gx) * gk;
      r.gd += (gd - r.gd) * gk;
      let rem2 = dt / 1000;
      while (rem2 > 0) {
        const hs = Math.min(rem2, 1 / 120);
        let ax = PULL_W * PULL_W * (tx - p.x) - 2 * PULL_W * p.vx;
        let ad = PULL_W * PULL_W * (td - p.d) - 2 * PULL_W * p.vd;
        const am = hypot(ax, ad * DEPTH_W);
        if (am > PULL_AMAX) { ax *= PULL_AMAX / am; ad *= PULL_AMAX / am; }
        p.vx += ax * hs; p.vd += ad * hs;
        const pv = hypot(p.vx, p.vd * DEPTH_W);
        if (pv > PULL_VMAX) { p.vx *= PULL_VMAX / pv; p.vd *= PULL_VMAX / pv; }
        p.x += p.vx * hs; p.d += p.vd * hs;

        let bx = ROLL_G * r.gx - ROLL_K * r.x - ROLL_C * r.vx;
        let bd = ROLL_G * r.gd - ROLL_K * r.d - ROLL_C * r.vd;
        const bm = hypot(bx, bd * DEPTH_W);
        if (bm > ROLL_AMAX) { bx *= ROLL_AMAX / bm; bd *= ROLL_AMAX / bm; }
        r.vx += bx * hs; r.vd += bd * hs;
        const rv = hypot(r.vx, r.vd * DEPTH_W);
        if (rv > ROLL_VMAX) { r.vx *= ROLL_VMAX / rv; r.vd *= ROLL_VMAX / rv; }
        r.x += r.vx * hs; r.d += r.vd * hs;
        rem2 -= hs;
      }
      /* Screen x is xw*W*PERSP_X/d, so at small d a tiny depth change becomes an
         enormous horizontal jump (~1240px per unit d at d=1.2). Keep the
         bodies out of that regime (the soft floor) and bound how far the
         offsets can carry them, or a cursor dragged low on the sheet flings
         one across the screen. */
      const b = bodiesW[i];
      b.xw = Math.max(-3.2, Math.min(3.2, o.xw + p.x + r.x));
      b.d = softFloor(o.d + p.d + r.d);
      /* how far the body has sunk into the dents under it (bodiesAt) */
      p.sink += (dentAt(b.xw, b.d) - p.sink) * sk;
    }
    sane();
    prepEvent(simNow);
    return simNow;
  }
  /* the dents, for what reads both */
  const FIELD = [CUR, RIP];
  /* the envelope as a share of the field, 0 below CUR_GATE, through a
     smoothstep so the field arrives and leaves without a sudden start */
  function envShare() {
    const e = Math.min(1, Math.max(0, (ptr.env - CUR_GATE) / (1 - CUR_GATE)));
    return e * e * (3 - 2 * e);
  }
  /* The ripple stops riding on the follower: it stays where it is, with any
     rise it had in hand dropped, and relaxes there, its age counted from
     now (leftRate). One already left (seat leaves it again when the
     pointer comes back) keeps its age, so it relaxes on its own clock:
     counted again from 0, the hold cut the spring's damping mid-way and
     the ripple coasted out at the rate it had instead of easing out (up
     to 0.004 off, gone 17ms sooner: check-cursor-response's ghost). */
  function leaveRipple() {
    if (RIP.att) RIP.age = 0;
    RIP.att = false;
    RIP.bv = Math.min(0, RIP.bv);
  }
  /* The field's strength over one substep h (s): the envelope, the hop,
     and the ripple's depth. */
  function fieldStep(h) {
    const v = fieldSpeed();
    /* While the field hops the envelope waits, so the touch only fades, by
       hopShare (advance), from what it was when the pointer came back.
       Rising toward the pointer that was back (want 1), it deepened the
       touch where the pointer no longer was before the fade won: from
       0.00015 to 0.079 (0.03px to a 13.6px dent) after 1s away. */
    if (!(ptr.hop > 0)) ptr.env += (ptr.want - ptr.env) * (1 - Math.exp(-h / (ptr.want > ptr.env ? ENV_IN : ENV_OUT)));
    if (ptr.hop > 0) {
      ptr.hop -= h / HOP_S;
      if (ptr.hop <= 0) {
        /* faded out: the field starts again under the pointer */
        ptr.hop = 0;
        ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.vx = ptr.vy = 0;
        ptr.env = 0;
      }
    }
    /* a fast move leaves the ripple behind, where the follower is now */
    if (RIP.att && v * RIP.b > CALM_DRAG) {
      const d = fieldDepth(ptr.y);
      RIP.d = d;
      RIP.xw = worldX(ptr.x, d);
      RIP.sx = ptr.x; RIP.sy = ptr.y;
      leaveRipple();
    }
    /* Riding, the ripple heads for its share of the depth, which the
       follower's speed takes away as 1 / (1 + (v / CALM_V0)^2); left
       behind, for none. Deepening, it heads there at once, first order
       (CALM_IN), its rate eased in over 1/CALM_EASE s; otherwise one
       critically damped spring, from whatever rate it has: CALM_REL while
       relaxing on the follower, leftRate once left behind.
       With the pointer gone (want 0) it only fades where it is: never
       deeper, so no rise in hand and no target above its depth; it still
       follows the fading envelope down. A fast exit leaves it shallow, and
       it used to gather where the pointer had left the window: from 0 to
       0.204 (a 35px dent) 0.3s after a 600px/s exit, +19px after one at
       3,000px/s. */
    /* the speed that takes the share away: the follower's, or the pointer's
       own path's if that is slower - so the ripple starts to gather the
       moment the pointer stops, not once the follower has (50-80ms later:
       the owner's "a bit of a pause then a sink") */
    const u = Math.min(v, fieldSpeed(ptr.pvx, ptr.pvy)) / CALM_V0;
    let target = RIP.att ? CALM_RIPPLE * envShare() * (1 - CALM_FLOOR) / (1 + u * u) : 0;
    if (!(ptr.want > 0)) {
      if (target > RIP.b) target = RIP.b;
      if (RIP.bv > 0) RIP.bv = 0;
    }
    if (!RIP.att && RIP.age < LEFT_IN) RIP.age += h;
    if (target > RIP.b) RIP.bv += (CALM_IN * (target - RIP.b) - RIP.bv) * Math.min(1, CALM_EASE * h);
    else {
      const w = RIP.att ? CALM_REL : leftRate();
      RIP.bv += (w * w * (target - RIP.b) - 2 * w * RIP.bv) * h;
    }
    RIP.b += RIP.bv * h;
    if (RIP.b < 0) { RIP.b = 0; RIP.bv = 0; }
    else if (RIP.b > 1 - CALM_FLOOR) { RIP.b = 1 - CALM_FLOOR; RIP.bv = 0; }
  }
  /* How fast a ripple left behind relaxes (its spring's w, 1/s): CALM_LEFT
     while it is deep, rising smoothly to CALM_TAIL as it runs out below
     TAIL_B - and for the first LEFT_IN after it was left only a share of
     that, rising from LEFT_W0 to all of it (a smoothstep).
     The start is held because the touch is leaving the same place: a flick
     carries it off the ripple's sheet points in 0.1-0.2s, and the touch
     leaving and the ripple relaxing raise those points together, the near
     floor's largest step in a frame. Relaxing at its full rate from the
     start (CALM_LEFT 11, CALM_TAIL 40, as the stiffer follower first
     shipped), three of check-cursor-response's five parked flicks (2.5s at
     rest, then one flick) moved the near floor 34.1, 35.2 and 36.4px in a
     frame, one of them a 2,250px/s flick straight up toward the horizon
     (the final review; 33.9px at most with the follower at 32; limit 34).
     Held as here, at most 32.4px. Held only 0.05s it was 34.7px at 11 and
     40 (40.3 at 16 and 50); and the rate lowered instead (CALM_LEFT 9, no
     hold) gave 34.1px, with the ghost 1.6 times as visible (7.8 px s).
     After that the ripple is a ghost on its own, a dent behind the
     pointer, and goes quicker than it did (16 and 50, from 11 and 40): a
     3,000px/s flick's is gone 0.30s after the flick starts (0.48s at
     CALM_REL, the final QA lens's ghost; 0.32s unheld), and shows clear of
     the touch for 133ms (233, 150), 5.1 px s (5.4, 5.0); at 6,000px/s low
     on the sheet, 10.4 px s (9.6, 9.6). Measured after 2.5s at rest, then
     a 600px flick, at 60Hz. Its strength steps at most 0.069 a frame
     (check-cursor-response's limit 0.08); the tail begun deeper (TAIL_B
     0.6) steps it 0.082-0.084. */
  function leftRate() {
    const s = RIP.b < TAIL_B ? RIP.b / TAIL_B : 1;
    const a = RIP.age < LEFT_IN ? RIP.age / LEFT_IN : 1;
    return (CALM_TAIL + (CALM_LEFT - CALM_TAIL) * s * s * (3 - 2 * s)) * (LEFT_W0 + (1 - LEFT_W0) * a * a * (3 - 2 * a));
  }
  /* A still frame, for the motion pause: the scene exactly as it stands,
     with no time passing (the swell event prepared for it). Checked first,
     as a moving frame is (sane): a paused page draws nothing but still
     frames, so a bad value it held went to the GPU in every one of them
     until the motion resumed (a NaN in the swell event: 4 non-finite
     uniforms a still frame). */
  function hold() {
    sane();
    prepEvent(simNow);
    return simNow;
  }

  /* Nothing non-finite is ever kept. Each state object is checked once a
     frame, moving (advance) or still (hold): a few dozen tests. One that
     has gone bad is put back to a sane value on its own, and everything
     else carries on.

     Each test is the sum of the object's numeric fields, read by name: a
     sum is finite exactly when every term is (these are pixels, world units
     and rates, nowhere near overflow). It used to be a for-in over every
     field of a dozen object shapes, which built a key list and boxed every
     number it read, every call: 2.4 KB of garbage a frame. Read by name the
     reads stay unboxed. The fields are listed here, so a numeric field
     added to one of these objects must be added to its sum:
     _tools/check-robustness.js puts a NaN into every numeric field of every
     one of them, one at a time, and fails if one survives a frame. */
  function sane() {
    if (!Number.isFinite(look.x + look.y + look.tx + look.ty)) { look.x = look.y = look.tx = look.ty = 0; }
    if (!Number.isFinite(ptr.x + ptr.y + ptr.vx + ptr.vy + ptr.tx + ptr.ty + ptr.k + ptr.want + ptr.env + ptr.hop)) {
      if (!(Number.isFinite(ptr.tx) && Number.isFinite(ptr.ty))) { ptr.tx = ptr.ty = 0; ptr.want = 0; }
      ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.vx = ptr.vy = 0;
      ptr.k = ptr.env = ptr.hop = 0; ptr.back = false;
      if (!Number.isFinite(ptr.want)) ptr.want = 0;
    }
    if (!Number.isFinite(mk.x + mk.y)) { mk.x = ptr.tx; mk.y = ptr.ty; }
    if (!Number.isFinite(CUR.on + CUR.xw + CUR.d + CUR.sx + CUR.sy)) { CUR.on = 0; CUR.xw = 0; CUR.d = 3; CUR.sx = ptr.x; CUR.sy = ptr.y; }
    if (!Number.isFinite(RIP.on + RIP.xw + RIP.d + RIP.sx + RIP.sy + RIP.b + RIP.bv + RIP.age)) {
      RIP.on = RIP.b = RIP.bv = RIP.age = 0; RIP.att = true; RIP.xw = CUR.xw; RIP.d = CUR.d; RIP.sx = CUR.sx; RIP.sy = CUR.sy;
    }
    for (let i = 0; i < bodyPull.length; i++) {
      const p = bodyPull[i];
      if (!Number.isFinite(p.x + p.d + p.vx + p.vd + p.sink)) p.x = p.d = p.vx = p.vd = p.sink = 0;
    }
    for (let i = 0; i < bodyRoll.length; i++) {
      const r = bodyRoll[i];
      if (!Number.isFinite(r.x + r.d + r.vx + r.vd + r.gx + r.gd)) r.x = r.d = r.vx = r.vd = r.gx = r.gd = 0;
    }
    for (let i = 0; i < TPUSH.length; i++) {
      const p = TPUSH[i];
      if (!Number.isFinite(p.on + p.sx + p.sy + p.von + p.vsx + p.vsy)) { p.on = 0; p.sx = ptr.x; p.sy = ptr.y; p.von = p.vsx = p.vsy = 0; }
    }
    for (let i = 0; i < 2; i++) { const b = BLOOM.s[i]; if (!Number.isFinite(b.on + b.v + b.x + b.y + b.vx + b.vy)) { b.on = b.v = b.vx = b.vy = 0; b.x = ptr.x; b.y = ptr.y; } }
    if (!Number.isFinite(BLOOM.on + BLOOM.still)) BLOOM.on = BLOOM.still = 0;
    for (let n = 0; n < FORK.obj.length; n++) {
      const o = FORK.obj[n];
      for (let i = 0; i < o.m; i++) if (!Number.isFinite(o.off[i] + o.vel[i])) { o.off[i] = o.vel[i] = 0; }
    }
    if (!Number.isFinite(ptr.lsx + ptr.lsy + ptr.pvx + ptr.pvy)) { ptr.lsx = Number.isFinite(ps.sx) ? ps.sx : ptr.x; ptr.lsy = Number.isFinite(ps.sy) ? ps.sy : ptr.y; ptr.pvx = ptr.pvy = 0; }
    if (BLOOM.cur !== 0 && BLOOM.cur !== 1) BLOOM.cur = 0;
    {
    }
    if (!Number.isFinite(simNow)) simNow = 0;
    /* The swell event, as it loaded: prepEvent, which runs next, derives it
       from the clock again in this same frame. Not only while one runs -
       the renderer hands cx and cd to the shader between events too (uEvt,
       with no height), and a NaN there lasted to the next event: up to
       48s (put in 1s into a visit, 285 frames and 852 non-finite
       uniforms). */
    if (!Number.isFinite(EVF.t + EVF.env + EVF.sign + EVF.amp + EVF.cx + EVF.cd + EVF.n)) {
      EVF.t = EVF.n = -1; EVF.on = false; EVF.env = EVF.amp = EVF.cx = EVF.cd = 0; EVF.sign = 1;
    }
    for (let i = 0; i < bodiesW.length; i++) {
      const b = bodiesW[i];
      if (!Number.isFinite(b.xw + b.d)) { b.xw = 0; b.d = 3; }
    }
  }
  /* After a frame threw (main.js): every motion state back to rest, keeping
     only the pointer, the eased look and the scene time. The field fades
     back in under the pointer, the bodies return to their orbit, and the
     next frame is one ordinary step. */
  function recover() {
    ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.vx = ptr.vy = 0;
    ptr.env = ptr.hop = 0; ptr.back = false;
    mk.x = ptr.tx; mk.y = ptr.ty;
    CUR.on = RIP.on = RIP.b = RIP.bv = 0;
    RIP.att = true;
    for (const p of bodyPull) p.x = p.d = p.vx = p.vd = p.sink = 0;
    for (const r of bodyRoll) r.x = r.d = r.vx = r.vd = r.gx = r.gd = 0;
    for (const p of TPUSH) { p.on = 0; p.von = p.vsx = p.vsy = 0; }
    EVF.t = EVF.n = -1;              /* the swell event derived afresh, its shape too */
    lastNow = 0;
    sane();
  }

  /* The namespace. The state objects are live and mutated in place every
     frame: read them, never replace them. W, H, S, SW, lastNow and simNow
     are reassigned, so they are getters.

     For the renderer, the field is CUR and RIP: on, xw, d for the dents
     (already in waveBase, so in surfacePoint), TPUSH's on, sx, sy for the
     terrain's pushes, and mk and ptr.k for the ring. */
  globalThis.Bg = {
    /* for main.js: the viewport, the card, the pointer and the clock */
    setSize, setCard, setCover, pointerAt, pointerGone, pointerStale, advance, hold, resetClock, recover,
    get W() { return W; },
    get H() { return H; },
    /* the scenery's scale, and the line widths' (rescale) */
    get S() { return S; },
    get SW() { return SW; },
    /* the state */
    look, ptr, mk, CUR, RIP, EVF, bodyPull, bodyRoll, bodiesW, CARD,
    get lastNow() { return lastNow; },
    get simNow() { return simNow; },
    /* the projection and the surface; the wave's numbers (WAVE, DEPTH_W,
       the wells', the dents' and the swell event's), which the WebGL
       renderer writes its shader's wave from */
    HORIZON, LOOK_X, LOOK_Y, PERSP_X, PERSP_Y, WAVE_Y,
    PAR_D0, tiltY, horizonY, shiftX, centreX, restAt, worldX, standX, skyX, surfacePoint,
    ROWS, DMAX, XSPAN, SWELL_D0, SWELL_D1, WELL_DEPTH, EVENT_MS, EVENT_IN, EVENT_SPAN, EVENT_SEED,
    WAVE, DEPTH_W, WELL_SIGMA2, WELL_R2, CUR_SIGMA2, CUR_R2, CUR_EDGE, EVENT_DEPTH_W, EVENT_SIGMA2, EVENT_AMP0, EVENT_AMP1,
    wave, waveBase, swellEvent, prepEvent, orbitWorld, ORBIT_T0, ORBIT_RATE, BODY_FLOOR,
    /* the cursor field */
    FIELD_W, CALM_FLOOR, CUR_GATE, CUR_DFAR, HOP_DIST, fieldDepth, fieldSpeed, dentAt, sheetOn,
    CUR_DEPTH, CUR_TERR_PUSH, CUR_TERR_SX, CUR_TERR_PAD, CUR_TERR_SIDE, CUR_SIDE_PEAK,
    CUR_TERR_MIN, CUR_SIDE_FADE, CUR_SIDE_END,
    /* the terrain's copy of the field (TPUSH, terrainStep), and its pushes */
    TPUSH, TERR_JOLT, terrainPushDip, terrainPushSide,
    BLOOM, BLOOM_R, SHARD_TURN, SHARD_SHRINK, SHARD_DRIFT, SHARD_PIN, CLOUD_DRIFT, FORK, coniferLayout, bloomAt, CALM_RIPPLE,
    ROLL_VMAX, ROLL_AMAX, PULL_VMAX, PULL_AMAX,
    /* the scenery: its tables and layout, and the sun and the bodies this
       frame */
    COAT, SUN, CLOUDS, RIDGES, BANDS, TREES, CONIFERS,
    hash1, sunAt, ridgeSummits, peakPlace, treeLevels, bodiesAt,
    /* the renderer's factory, by name (render-webgl.js adds webgl) */
    renderers: {}
  };
})();
