'use strict';
/* The cursor field (scene.js: the follower, the touch CUR, the ripple RIP,
   and the bodies' response) must be under the pointer at every speed, never
   vanish while the pointer is on the sheet, and stay calm: nothing it moves
   may jump from one frame to the next.

   Scripted pointer paths at 1440x900, 60Hz, from the page's own pointer
   events: a slow drift; min-jerk flicks between far points (peak speeds
   4,000-9,000px/s); short fast flicks; a 2,500px/s sweep and a dead stop;
   vertical scribbles through depth; crossings of the horizon, slow and
   fast; leaving the window for 0.3s, 1s and 4s and coming back on the
   other side, and a flick out of the window and back in on the other side
   0.2s later; and five single flicks, each from a pointer parked 2.5s, so
   the ripple under it has gathered (~0.73 deep): the parked flicks. Plus
   steady sweeps at 250-6,000px/s for the time lag.

   Checked, frame by frame:
     - where: the touch's centre (CUR, projected at rest) is within
       LAG_MS of the pointer's own path on every steady sweep (the
       follower trails a steady move by about 2/FIELD_W = 44ms, 32ms
       measured; at FIELD_W 32 it was 50ms, which on the owner's display
       lagged a flick's tip by 130-255px), and within 2px of a pointer
       SETTLE_MS after it stops dead (the lag at 6,000px/s is 193px); the
       largest distance in px on any path is reported;
     - the ring: on the pointer itself in every frame of every path and
       sweep, within RING_PX (it was a follower of its own and trailed
       the field's);
     - always there: once the pointer has been on the sheet for ENTRY_MS
       (its fade-in, and a hop's fade-out first), the touch is at least
       90% of CALM_FLOOR deep;
     - calm: from one frame to the next, each dent's strength changes by at
       most ON_STEP; neither dent's centre, while it shows on both frames
       (on > SHOW), moves further than the pointer itself moved in a frame
       of the last 40 (no teleport while it shows). The jump of a pointer
       coming back after it left is not such a move: far away the field
       must hop there, not follow (seat), so it is left out. No sheet
       point moves more than SHEET_SLOW px in the drift or SHEET_FAST px
       anywhere because of the dents - the parked flicks included, where it
       is hardest: the touch leaving a resting pointer and the deep ripple
       it leaves behind raise the same sheet points in the same frames.
       With the ripple relaxing at its full rate from the moment it was
       left, three of the five moved the near floor 34.1, 35.2 and 36.4px
       in a frame, one of them a 2,250px/s flick straight up toward the
       horizon (the final review; 33.9px at most with the follower at
       FIELD_W 32), while the other paths, which never rest that long
       first, stayed at 33.5px or less; the terrain's pushes (terrainPushDip
       dip, terrainPushSide shove, on mountain- and tree-sized columns
       across the width: what the renderer's vertex shader evaluates, from
       the terrain's copy of the field, TPUSH) change by at most PUSH_STEP
       px; a body on screen moves at most BODY_STEP px and changes speed by
       at most BODY_ACC px a frame;
     - capped: every body's roll and pull speed (world units/s, depth
       weighted 0.55) stays under ROLL_VMAX and PULL_VMAX;
     - seated: from the frame the pointer comes back (the re-entry path:
       away 0.3s, 1s and 4s, then back 1150px from where it left; flicked
       out, back 1285px away 0.2s later; all far past the hop distance) and
       while it stays there, each dent that shows is centred within SEAT_PX
       of where the pointer left or of where it came back: it fades out at
       one and starts again at the other, and is never drawn on the way
       between them (audit F4: it crawled the 1150px to the pointer over
       2.56s; with seat() bypassed the touch is drawn 519px from both
       ends). One still where the pointer left only fades there, never
       deeper than it was the frame before the pointer came back;
     - gone: from the frame the pointer leaves until it comes back, neither
       dent's strength ever rises: the field only fades where it is, also
       when the pointer left at speed and the ripple had not gathered (left
       shallow by a 3,000px/s flick out, it used to gather a 19px dent
       there in the 0.4s after the pointer had gone);
     - fades out: parked low on the sheet for 4s and then gone, the field
       fades to nothing with no frame changing the sheet (the dents' effect,
       in px) SPIKE_PX more than both frames around it: a gate that drops
       the field in one frame shows as such a frame (audit F23);
     - after a pause: the pointer moves while the motion is paused - seen
       before the pause, and first seen while paused (a page that loads
       paused under reduced motion, its visitor reaching for the play
       button) - and the motion resumes. From the first frame back the ring
       is on the pointer, and each dent that shows is within HOP_DIST of it
       or still where the field was paused (fading there, or hopping),
       never on the way between, and never deepening there (the regression
       lens: the ring swept ~1150px at full alpha, and a growing dent was
       dragged ~200px a frame across the near floor);
     - the ghost: at rest 2.5s, then a 600px flick at 3,000px/s; the ripple
       left behind never deepens, and is gone within GHOST_MS of the
       flick's start (it lingered 483ms: the final QA lens's ghost dent).
       It relaxes on its own clock: run again with the pointer leaving the
       window as the flick ends and coming back far away 2 frames later
       (seat leaves the ripple again), its strength is the same in every
       frame. The hold at the start of its relaxing (leftRate) counted
       again from there cut the spring's damping mid-way, and it coasted
       out instead of easing out (up to 0.004 off, gone 17ms sooner).
   Exit 1 on any failure. */
const H = require('./harness');

const W = 1440, HH = 900, DT = 16.7;
const LAG_MS = 45, SETTLE_MS = 200, ENTRY_MS = 450, ON_STEP = 0.08, SHEET_SLOW = 8, SHEET_FAST = 34,
      PUSH_STEP = 8, BODY_STEP = 6.5, BODY_ACC = 3, SEAT_PX = 60, SPIKE_PX = 0.1, RING_PX = 0.5, GHOST_MS = 380;
/* The ring is drawn on the pointer's own path read back RING_LAG_MS at most
   behind it (scene.js smoothAt): on that path within RING_PX, at a point no
   older than that. Pinning it to the newest event instead - what this check
   used to demand - is what made it stutter on a real display: a 125Hz mouse
   on 165Hz frames gives no new position on one frame in four (JUDDER). */
const RING_LAG_MS = 20;
/* where the pointer was at time tq, on its moves so far (hist: [t, x, y]) */
function pathAt(hist, tq) {
  if (!hist.length) return null;
  if (tq <= hist[0][0]) return [hist[0][1], hist[0][2]];
  for (let k = hist.length - 1; k > 0; k--) {
    const a = hist[k - 1], b = hist[k];
    if (tq >= a[0]) {
      if (tq >= b[0]) return [b[1], b[2]];
      const f = (tq - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return [hist[0][1], hist[0][2]];
}
/* the ring's distance from the pointer's path within the last RING_LAG_MS:
   point to segment, on the path clipped to that window (sampling the path
   by time instead left 4px between test points on a 17,000px/s flick) */
function ringOff(hist, now, rx, ry) {
  const t0 = now - RING_LAG_MS;
  const pts = [pathAt(hist, t0)];
  for (const h of hist) if (h[0] > t0 && h[0] < now) pts.push([h[1], h[2]]);
  pts.push(pathAt(hist, now));
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    const f = L > 0 ? Math.max(0, Math.min(1, ((rx - ax) * vx + (ry - ay) * vy) / L)) : 0;
    best = Math.min(best, Math.hypot(rx - ax - vx * f, ry - ay - vy * f));
  }
  return best;
}
/* A dent shows above this strength. Below it, it is under 1.3px deep even
   on the nearest row (CUR_DEPTH * SHOW * H * WAVE_Y at d = 1: 1.22px), so
   where it sits cannot be seen. */
const SHOW = 0.005;
const fails = [];
const fail = m => fails.push(m);
const minjerk = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
/* The parked flicks, [x0, y0, x1, y1, ms]: at rest at (x0, y0) for PARK_N frames (2.5s: the
   ripple gathered), then one min-jerk flick to (x1, y1) in ms - up and across from the bottom
   of the window, across low on the sheet, a short fast one, straight up through depth toward
   the horizon (360px in 160ms), across at the bottom. The final review's five (the G2 fix's
   m-parkflick.js), each from a fresh load. */
const PARK_N = 150;
const PARKED = [[120, 880, 1200, 700, 220], [200, 760, 1250, 820, 220], [700, 860, 150, 700, 120], [150, 880, 150, 520, 160], [1300, 840, 300, 840, 180]];
const isParked = name => name.startsWith('parked ');
const parkedLabel = name => { const p = PARKED[+name.slice(7) - 1]; return name + ' (' + p[0] + ',' + p[1] + ' to ' + p[2] + ',' + p[3] + ' in ' + p[4] + 'ms, after ' + (PARK_N * DT / 1000).toFixed(1) + 's at rest)'; };

/* a path: per frame null (no event), { x, y } (a pointermove) or 'leave' */
function path(name) {
  const a = [];
  const hold = n => { for (let i = 0; i < n; i++) a.push(null); };
  const at = (x, y, n) => { for (let i = 0; i < n; i++) a.push({ x, y }); };
  const flick = (x0, y0, x1, y1, ms) => { const n = Math.max(1, Math.round(ms / DT)); for (let i = 1; i <= n; i++) { const f = minjerk(i / n); a.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f }); } };
  const line = (x0, y0, x1, y1, pxs) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / pxs * 1000 / DT)); for (let i = 1; i <= n; i++) { const f = i / n; a.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f }); } };
  if (name === 'drift') {
    at(150, 700, 60);
    for (let i = 0; i < 600; i++) { const t = i * DT / 1000 * 2 * Math.PI * 0.2; a.push({ x: 150 + 90 * Math.sin(t), y: 700 + 54 * (1 - Math.cos(t)) }); }
    hold(60);
  } else if (name === 'flicks') {
    at(200, 760, 90);
    let p = [200, 760];
    for (const q of [[1250, 820], [180, 640], [1300, 560], [120, 880], [1200, 700], [240, 520], [1340, 860]]) { flick(p[0], p[1], q[0], q[1], 220); at(q[0], q[1], 45); p = q; }
    hold(60);
  } else if (name === 'short flicks') {
    at(200, 760, 90);
    let p = [200, 760];
    for (const q of [[700, 800], [150, 700], [600, 860], [200, 620], [1300, 780], [900, 840]]) { flick(p[0], p[1], q[0], q[1], 120); at(q[0], q[1], 12); p = q; }
    hold(90);
  } else if (name === 'sweep and stop') {
    at(80, 800, 90); line(80, 800, 1360, 800, 2500); at(1360, 800, 90); line(1360, 800, 80, 620, 1800); at(80, 620, 90);
  } else if (name === 'through depth') {
    at(150, 520, 60);
    for (let k = 0; k < 4; k++) { line(150, 520, 150, 880, 300); line(150, 880, 150, 520, 300); }
    for (let k = 0; k < 4; k++) { flick(150, 520, 150, 880, 160); at(150, 880, 20); flick(150, 880, 150, 520, 160); at(150, 520, 20); }
    hold(60);
  } else if (name === 'horizon') {
    at(200, 700, 60); line(200, 700, 200, 250, 180); at(200, 250, 30); line(200, 250, 200, 700, 180); at(200, 700, 30);
    flick(200, 700, 200, 250, 200); at(200, 250, 30); flick(200, 250, 200, 760, 200); at(200, 760, 60);
  } else if (name === 're-entry') {
    at(150, 760, 180);
    for (const away of [18, 60, 240]) { a.push('leave'); hold(away); at(1300, 760, 150); a.push('leave'); hold(away); at(150, 760, 150); }
    /* out at the edge mid-flick, back on the far side 0.2s later: the ripple let go on the
       flick and has relaxed, while the envelope is still high - had it rejoined the follower
       during the hop it would gather where the pointer left and ride the snap across (1283px
       at 0.042 strength) */
    line(150, 760, 1435, 760, 3000); a.push('leave'); hold(12); at(150, 760, 150);
  } else if (isParked(name)) {
    const [x0, y0, x1, y1, ms] = PARKED[+name.slice(7) - 1];
    at(x0, y0, PARK_N); flick(x0, y0, x1, y1, ms); hold(40);
  }
  return a;
}
const PATHS = ['drift', 'flicks', 'short flicks', 'sweep and stop', 'through depth', 'horizon', 're-entry'].concat(PARKED.map((p, k) => 'parked ' + (k + 1)));

/* every frame drawn (?bgq=0: the quality governor's top level held), at
   the scene time simNow */
/* whether the ripple is on (scene.js CALM_RIPPLE: 0 today, the floor answers
   with the touch alone); its own tests - the parked flicks' deep start, the
   ghost - run only where it is. A root from before CALM_RIPPLE has it on. */
let RIPPLE = null;
function rippleOn() { if (RIPPLE === null) RIPPLE = load().P.CALM_RIPPLE !== 0; return RIPPLE; }
function load() {
  return H.load({ W, H: HH, dpr: 1.5, now: 1000, search: '?bgq=0' });
}
/* the sheet's rows, sampled as world points: the drawn rows (the scene's
   ROWS, DMAX and XSPAN; the renderer's ROW_POW), every 0.03 of sn */
const GRID = [];
{
  const B0 = load().P, ROW_POW = H.rendererNumbers(['ROW_POW']).ROW_POW;
  for (let r = 0; r < B0.ROWS; r++) {
    const d = 1 + (B0.DMAX - 1) * Math.pow(r / (B0.ROWS - 1), ROW_POW);
    for (let sn = -B0.XSPAN; sn <= B0.XSPAN + 0.001; sn += 0.03) GRID.push([sn * d, d]);
  }
}
const COLS = [];
for (let x = 0; x <= W; x += 15) COLS.push(x);
const SPANS = [[300, 430], [306, 476], [420, 520]];   /* a far mountain face, a tree, a near peak */

/* an older scene without the two-dent field cannot pass: say so plainly */
{
  const P = load().P;
  const missing = ['dentAt', 'RIP', 'fieldDepth', 'CALM_FLOOR', 'ROLL_VMAX', 'PULL_VMAX'].filter(n => P[n] === undefined);
  if (missing.length) {
    console.log('check-cursor-response: FAIL - the scene has no ' + missing.join(', ') + ': this is not the A1 cursor field (follower, touch and ripple)');
    process.exit(1);
  }
}
const report = { lagPx: 0, lagPxAt: '', sheet: {}, push: 0, shove: 0, on: 0, body: 0, acc: 0, rollV: 0, pullV: 0, floorMin: Infinity, entryMs: 0,
                 seatPx: 0, seatAt: '', oldRise: 0, goneRise: 0, spike: 0, spikeAt: -1, ring: 0, ringAt: '', ghost: 0, paused: [] };
for (const name of PATHS) {
  const sim = load();
  const P = sim.P;
  const acts = path(name);
  /* the pointer's moves: [frame, x, y, came back] - came back marks the
     first move after it left, whose jump from where it left is not a step
     the field may follow */
  const pts = [];
  let over = false, since = 0, prev = null, sheetWorst = 0;
  /* a re-entry: where the pointer left ([frame, x, y]), where it came back
     ([x, y], while it stays there), and each dent's strength the frame
     before it came back */
  let left = null, back = null, onBefore = null, gone = false;
  let hist = [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (a === 'leave') { sim.leave(); over = false; gone = true; left = pts[pts.length - 1] || null; back = null; hist = []; }
    else if (a) {
      const again = !over && pts.length > 0;
      if (again && left) { back = [a.x, a.y]; onBefore = { touch: P.CUR.on, ripple: P.RIP.on }; }
      else if (back && (a.x !== back[0] || a.y !== back[1])) back = null;   /* moved on from where it came back */
      if (!over) since = 0;
      over = true;
      gone = false;
      pts.push([i, a.x, a.y, again]);
      if (again) hist = [];                    /* back from outside: a fresh path, as in the scene */
      hist.push([sim.now, a.x, a.y]);
      sim.move(a.x, a.y);
    }
    sim.frame(DT);
    since++;
    /* a parked flick starts from a gathered ripple, or it tests nothing */
    if (rippleOn() && isParked(name) && i === PARK_N - 1 && !(P.RIP.on > 0.7)) fail(parkedLabel(name) + ': precondition: the ripple is only ' + P.RIP.on.toFixed(3) + ' deep at the end of the rest');
    const t = P.simNow;
    if (P.ptr.seen && hist.length) {           /* (gone: the ring only fades where it was) */
      const off = ringOff(hist, sim.now, P.mk.x, P.mk.y);
      if (off > report.ring) { report.ring = off; report.ringAt = name + ' frame ' + i; }
    }
    /* the dents' effect on the sheet, in px */
    const sheet = GRID.map(([xw, d]) => (P.dentAt(xw, d) * HH * P.WAVE_Y) / d);
    const push = [], shove = [];
    for (const [top, bot] of SPANS) for (const x of COLS) { push.push(P.terrainPushDip(x, top, bot)); shove.push(P.terrainPushSide(x, top, bot, P.CUR_TERR_SIDE * P.S)); }
    /* each body where it is drawn (bodiesAt, matched by index: bodiesAt sorts by depth) */
    const drawn = P.bodiesW.map((b, k) => { const [x, y0] = P.surfacePoint(b.xw, b.d, t); return [x, y0 + ((P.bodyPull[k].sink - P.dentAt(b.xw, b.d)) * HH * P.WAVE_Y) / b.d - 14.7 / b.d]; });
    const cur = { on: P.CUR.on, rip: P.RIP.on, cx: P.CUR.sx, cy: P.CUR.sy, rx: P.RIP.sx, ry: P.RIP.sy };
    if (prev) {
      for (let g = 0; g < sheet.length; g++) sheetWorst = Math.max(sheetWorst, Math.abs(sheet[g] - prev.sheet[g]));
      for (let k = 0; k < push.length; k++) {
        report.push = Math.max(report.push, Math.abs(push[k] - prev.push[k]));
        report.shove = Math.max(report.shove, Math.abs(shove[k] - prev.shove[k]));
      }
      const dOn = Math.max(Math.abs(cur.on - prev.cur.on), Math.abs(cur.rip - prev.cur.rip));
      report.on = Math.max(report.on, dOn);
      if (dOn > ON_STEP) fail(name + ' frame ' + i + ': a dent\'s strength changed by ' + dOn.toFixed(3) + ' in one frame');
      /* the pointer gone: the field only fades */
      if (gone) {
        for (const [label, on0, on1] of [['touch', prev.cur.on, cur.on], ['ripple', prev.cur.rip, cur.rip]]) {
          report.goneRise = Math.max(report.goneRise, on1 - on0);
          if (on1 > on0 + 1e-9) fail(name + ' frame ' + i + ': the ' + label + ' deepened from ' + on0.toFixed(4) + ' to ' + on1.toFixed(4) + ' after the pointer had left');
        }
      }
      /* no teleport while showing: the follower's velocity is a weighted mean of the pointer's
         over the last ~0.2s, so the pointer's largest step in the last 40 frames bounds its step.
         Not the jump of a pointer that came back: counted, that 1150px let a dent sweep or jump
         across the sheet on re-entry and pass. */
      let stride = 0;
      for (let j = pts.length - 1; j > 0 && pts[j][0] > i - 40; j--) {
        if (!pts[j][3]) stride = Math.max(stride, Math.hypot(pts[j][1] - pts[j - 1][1], pts[j][2] - pts[j - 1][2]));
      }
      for (const [label, on0, on1, x0, y0, x1, y1] of [['touch', prev.cur.on, cur.on, prev.cur.cx, prev.cur.cy, cur.cx, cur.cy],
                                                        ['ripple', prev.cur.rip, cur.rip, prev.cur.rx, prev.cur.ry, cur.rx, cur.ry]]) {
        if (on0 > SHOW && on1 > SHOW && Math.hypot(x1 - x0, y1 - y0) > stride * 1.05 + 1) {
          fail(name + ' frame ' + i + ': the ' + label + ' jumped ' + Math.hypot(x1 - x0, y1 - y0).toFixed(1) + 'px while showing (the pointer\'s largest recent step ' + stride.toFixed(1) + 'px)');
        }
      }
      for (let k = 0; k < 3; k++) {
        const v = [drawn[k][0] - prev.drawn[k][0], drawn[k][1] - prev.drawn[k][1]];
        report.body = Math.max(report.body, Math.hypot(v[0], v[1]));
        if (prev.v) report.acc = Math.max(report.acc, Math.hypot(v[0] - prev.v[k][0], v[1] - prev.v[k][1]));
        drawn[k].v = v;
      }
    }
    for (const r of P.bodyRoll) report.rollV = Math.max(report.rollV, Math.hypot(r.vx, r.vd * 0.55));
    for (const p of P.bodyPull) report.pullV = Math.max(report.pullV, Math.hypot(p.vx, p.vd * 0.55));
    /* Seated after a re-entry: each dent that shows is at one end or the other, never in
       between, and one still where the pointer left only fades there. Its centre is projected
       back to the sheet at rest, [surfacePoint's x, restAt(d)], where a pointer would have to
       be to put it there: surfacePoint's y carries the wave, the dent's own depth with it
       (294px off at full strength, with the dent where it should be). */
    if (back) {
      for (const [label, w] of [['touch', P.CUR], ['ripple', P.RIP]]) {
        if (!(w.on > SHOW)) continue;
        const x = P.surfacePoint(w.xw, w.d, t)[0], y = P.restAt(w.d);
        const fromLeft = Math.hypot(x - left[1], y - left[2]), fromBack = Math.hypot(x - back[0], y - back[1]);
        const off = Math.min(fromLeft, fromBack);
        if (off > report.seatPx) { report.seatPx = off; report.seatAt = label + ', frame ' + i; }
        if (off > SEAT_PX) {
          fail(name + ' frame ' + i + ': the ' + label + ' (on ' + w.on.toFixed(3) + ') is drawn ' + off.toFixed(0)
               + 'px from both where the pointer left and where it came back: swept across the sheet instead of hopping (limit ' + SEAT_PX + ')');
        }
        if (fromLeft < fromBack) {
          report.oldRise = Math.max(report.oldRise, w.on - onBefore[label]);
          if (w.on > onBefore[label] + 1e-9) {
            fail(name + ' frame ' + i + ': the ' + label + ' where the pointer left deepened to ' + w.on.toFixed(4)
                 + ' after it came back elsewhere (it was ' + onBefore[label].toFixed(4) + ')');
          }
        }
      }
    }
    /* where the touch is, against the pointer, while the pointer is well down on the sheet */
    const last = pts[pts.length - 1];
    if (over && last) {
      const dy = last[2] - P.horizonY();
      const ex = P.centreX(P.CUR.d) + (P.CUR.xw * W * P.PERSP_X) / P.CUR.d, ey = P.restAt(P.CUR.d);
      if (dy > 120 && P.CUR.on > 0 && !P.ptr.hop) {
        const lag = Math.hypot(ex - last[1], ey - last[2]);
        if (lag > report.lagPx) { report.lagPx = lag; report.lagPxAt = name + ' frame ' + i; }
      }
      if (P.fieldDepth(last[2]) < P.DMAX && since * DT >= ENTRY_MS) {
        report.floorMin = Math.min(report.floorMin, P.CUR.on / P.CALM_FLOOR);
        if (P.CUR.on < 0.9 * P.CALM_FLOOR) fail(name + ' frame ' + i + ': the pointer has been on the sheet ' + (since * DT).toFixed(0) + 'ms and the touch is only ' + (P.CUR.on / P.CALM_FLOOR * 100).toFixed(0) + '% of CALM_FLOOR');
      }
    }
    prev = { sheet, push, shove, cur, drawn, v: prev ? drawn.map(d => d.v) : null };
  }
  report.sheet[name] = sheetWorst;
  if (sheetWorst > (name === 'drift' ? SHEET_SLOW : SHEET_FAST)) fail((isParked(name) ? parkedLabel(name) : name) + ': a sheet point moved ' + sheetWorst.toFixed(1) + 'px in one frame because of the dents (limit ' + (name === 'drift' ? SHEET_SLOW : SHEET_FAST) + ')');
}
const P0 = load().P;
if (report.push > PUSH_STEP) fail('a terrain dip changed by ' + report.push.toFixed(2) + 'px in one frame (limit ' + PUSH_STEP + ')');
if (report.shove > PUSH_STEP) fail('a terrain shove changed by ' + report.shove.toFixed(2) + 'px in one frame (limit ' + PUSH_STEP + ')');
if (report.body > BODY_STEP) fail('a body moved ' + report.body.toFixed(2) + 'px in one frame on screen (limit ' + BODY_STEP + ')');
if (report.acc > BODY_ACC) fail('a body changed speed by ' + report.acc.toFixed(2) + 'px a frame in one frame (limit ' + BODY_ACC + ')');
if (report.rollV > P0.ROLL_VMAX * 1.0001) fail('a body rolled at ' + report.rollV.toFixed(3) + ' u/s, over ROLL_VMAX ' + P0.ROLL_VMAX);
if (report.pullV > P0.PULL_VMAX * 1.0001) fail('a body was pulled at ' + report.pullV.toFixed(3) + ' u/s, over PULL_VMAX ' + P0.PULL_VMAX);

/* The fade-out (audit F23): parked low on the sheet, then gone. Every gate on the way to
   nothing is continuous - the envelope reaches 0 exactly at CUR_GATE, the ripple at RIP_GATE -
   so the sheet's change from one frame to the next falls smoothly; a gate that drops the field
   in one frame stands out as a frame that changes it more than both frames around it. */
{
  const sim = load();
  const P = sim.P;
  const field = () => GRID.map(([xw, d]) => (P.dentAt(xw, d) * HH * P.WAVE_Y) / d);
  for (let i = 0; i < 240; i++) { sim.move(150, 860); sim.frame(DT); }
  if (!(P.CUR.on > 0.2 && (!rippleOn() || P.RIP.on > 0.5))) {
    fail('fade-out: precondition: the field is not gathered under a parked pointer (touch ' + P.CUR.on.toFixed(3) + ', ripple ' + P.RIP.on.toFixed(3) + ')');
  }
  sim.leave();
  let was = field();
  const steps = [];
  for (let i = 0; i < 300; i++) {
    sim.frame(DT);
    const f = field();
    let m = 0;
    for (let k = 0; k < f.length; k++) m = Math.max(m, Math.abs(f[k] - was[k]));
    steps.push(m);
    was = f;
  }
  for (let i = 1; i < steps.length - 1; i++) {
    const e = steps[i] - Math.max(steps[i - 1], steps[i + 1]);
    if (e > report.spike) { report.spike = e; report.spikeAt = i; }
  }
  if (report.spike > SPIKE_PX) {
    fail('fade-out: ' + ((report.spikeAt + 1) * DT / 1000).toFixed(2) + 's after the pointer left, one frame changed the sheet ' + report.spike.toFixed(3)
         + 'px more than both frames around it: a gate dropped the field in one frame (limit ' + SPIKE_PX + ')');
  }
  if (P.CUR.on !== 0 || P.RIP.on !== 0) fail('fade-out: the field is not gone 5s after the pointer left (touch ' + P.CUR.on + ', ripple ' + P.RIP.on + ')');
}

/* steady sweeps: the time lag, and settling after a dead stop */
const lagMs = [];
let settleWorst = 0;
for (const pxs of [250, 1000, 2500, 6000]) {
  const sim = load();
  const P = sim.P;
  /* the follower lives in screen px, the same everywhere, so the sweep may
     run past the edges: long enough at every speed to settle into its
     steady lag (about 10 frames) */
  const y = 760;
  const hist = [[sim.now, -1000, y]];
  sim.move(-1000, y);
  sim.frames(90, DT);
  const step = (pxs * DT) / 1000;
  let x = -1000, worst = 0;
  for (let i = 0; x < 2440; i++) {
    x += step;
    hist.push([sim.now, x, y]);
    sim.move(x, y);
    sim.frame(DT);
    const off = ringOff(hist, sim.now, P.mk.x, P.mk.y);
    if (off > report.ring) { report.ring = off; report.ringAt = pxs + 'px/s sweep, frame ' + i; }
    if (i >= 10) {
      const ex = P.centreX(P.CUR.d) + (P.CUR.xw * W * P.PERSP_X) / P.CUR.d;
      worst = Math.max(worst, ((x - ex) / pxs) * 1000);
    }
  }
  lagMs.push([pxs, worst]);
  if (worst > LAG_MS) fail('steady sweep at ' + pxs + 'px/s: the touch trails the pointer by ' + worst.toFixed(0) + 'ms (limit ' + LAG_MS + ')');
  let n = 0;
  for (; n < 120; n++) {
    sim.frame(DT);
    const ex = P.centreX(P.CUR.d) + (P.CUR.xw * W * P.PERSP_X) / P.CUR.d;
    if (Math.abs(ex - x) <= 2 && Math.abs(P.restAt(P.CUR.d) - y) <= 2) break;
  }
  settleWorst = Math.max(settleWorst, (n + 1) * DT);
  if ((n + 1) * DT > SETTLE_MS) fail('after a ' + pxs + 'px/s sweep stops dead, the touch is not within 2px of the pointer for ' + ((n + 1) * DT).toFixed(0) + 'ms (limit ' + SETTLE_MS + ')');
}
if (report.ring > RING_PX) fail('the ring was drawn ' + report.ring.toFixed(1) + 'px off the last ' + RING_LAG_MS + 'ms of the pointer path (' + report.ringAt + '; limit ' + RING_PX + '): it trails the cursor it marks, or is off its path');

/* After a pause: the pointer moves while the motion is paused (a still frame
   only, every move after the first just noted), then the motion resumes.
   Each dent that shows must be within HOP_DIST of the pointer (the world
   metric) or still at the screen point the field was paused at - fading
   there, or the touch hopping from there - and never deepening there. */
for (const mode of ['seen before the pause', 'first seen while paused']) {
  const sim = H.load({ W, H: HH, dpr: 1.5, now: 1000, search: '?bgq=0', motion: mode === 'first seen while paused' ? 'paused' : 'running' });
  const P = sim.P, DW = sim.window.Bg.DEPTH_W;
  if (mode === 'seen before the pause') { sim.move(700, 700); sim.frames(120, DT); sim.motion(true); sim.frames(3, DT); }
  const hist = [];
  for (let x = 100; x <= 1300; x += 50) { hist.push([sim.now, x, 700]); sim.move(x, 700); sim.frame(DT); }
  const held = { touch: [P.CUR.sx, P.CUR.sy], ripple: [P.RIP.sx, P.RIP.sy] }, was = { touch: P.CUR.on, ripple: P.RIP.on };
  sim.motion(false);
  let ring = 0, away = 0, awayAt = '', rose = 0, near = 0;
  for (let i = 0; i < 60; i++) {
    sim.frame(DT);
    ring = Math.max(ring, ringOff(hist, sim.now, P.mk.x, P.mk.y));
    const d = P.fieldDepth(P.ptr.ty), xw = P.worldX(P.ptr.tx, d);
    for (const [label, w] of [['touch', P.CUR], ['ripple', P.RIP]]) {
      if (w.on > SHOW) {
        const dist = Math.hypot(w.xw - xw, (w.d - d) * DW), still = w.sx === held[label][0] && w.sy === held[label][1];
        if (dist <= P.HOP_DIST) near = Math.max(near, dist);
        else if (!still) { if (dist > away) { away = dist; awayAt = label + ' (on ' + w.on.toFixed(3) + '), frame ' + i; } }
        else rose = Math.max(rose, w.on - was[label]);
      }
      was[label] = w.on;
    }
  }
  if (ring > RING_PX) fail(mode + ', then resumed: the ring was drawn ' + ring.toFixed(1) + 'px from the pointer (limit ' + RING_PX + '): it swept across to it');
  if (away) fail(mode + ', then resumed: a dent showed ' + away.toFixed(2) + ' world units from the pointer and away from where the field was paused (' + awayAt
                 + '): dragged across the sheet (limit HOP_DIST ' + P.HOP_DIST + ')');
  if (rose > 1e-9) fail(mode + ', then resumed: a dent still where the field was paused deepened by ' + rose.toFixed(4) + ' in a frame');
  if (!(P.CUR.on > 0.9 * P.CALM_FLOOR) || Math.hypot(P.CUR.sx - P.ptr.tx, P.CUR.sy - P.ptr.ty) > 2) {
    fail(mode + ', then resumed: 1s later the touch is not at the pointer (on ' + P.CUR.on.toFixed(3) + ', ' + Math.hypot(P.CUR.sx - P.ptr.tx, P.CUR.sy - P.ptr.ty).toFixed(0) + 'px off)');
  }
  report.paused.push(mode + ': the ring ' + ring.toFixed(1) + 'px off the pointer, every dent near it (<= ' + near.toFixed(2) + ') or where the field was paused');
}

/* The ghost: the ripple a flick leaves behind, at rest 2.5s first so it has gathered. With
   away set, the pointer leaves the window the frame after the flick ends and is back at
   (300, 700) 2 frames later. on: the ripple's strength in each frame while it is left behind
   (null while it rides on the follower). */
function ghostRun(away) {
  const sim = load(), P = sim.P;
  sim.move(500, 760);
  sim.frames(150, DT);
  const start = P.RIP.on, n = Math.round(((600 / 3000) * 1000) / DT), on = [];
  let left = false, gone = null, prev = P.RIP.on, rose = 0;
  for (let i = 1; i <= 120 && gone === null; i++) {
    if (i <= n) sim.move(500 + (600 * i) / n, 760);
    else if (away && i === n + 1) sim.leave();
    else if (away && i >= n + 3) sim.move(300, 700);
    sim.frame(DT);
    on.push(P.RIP.att ? null : P.RIP.on);
    if (!P.RIP.att) {
      left = true;
      rose = Math.max(rose, P.RIP.on - prev);
      if (!(P.RIP.on > 0)) gone = i * DT;
    } else if (left) gone = i * DT;
    prev = P.RIP.on;
  }
  return { start, left, gone, rose, on };
}
if (!rippleOn()) report.ghost = null;
else {
  const { start, left, gone, rose, on } = ghostRun(false), away = ghostRun(true);
  let off = 0;
  for (let i = 0; i < Math.min(on.length, away.on.length); i++) if (on[i] !== null && away.on[i] !== null) off = Math.max(off, Math.abs(on[i] - away.on[i]));
  if (!(away.left && away.gone !== null)) fail('the ghost, the pointer out and back meanwhile: the ripple was ' + (away.left ? 'not gone in 2s' : 'never left behind'));
  else if (off > 1e-12 || away.gone !== gone) {
    fail('the ghost: the pointer leaving the window and coming back meanwhile changed the ripple left behind (strength up to ' + off.toExponential(2) + ' off, gone at '
         + away.gone.toFixed(0) + 'ms, not ' + (gone === null ? 'never' : gone.toFixed(0)) + '): leaving it again started its relaxing over (leftRate)');
  }
  if (!(start > 0.6)) fail('the ghost: precondition: the ripple is only ' + start.toFixed(3) + ' deep after 2.5s at rest');
  if (!left) fail('the ghost: a 3,000px/s flick did not leave the ripple behind');
  else if (gone === null || gone > GHOST_MS) fail('the ghost: the ripple a 3,000px/s flick left behind lingered ' + (gone === null ? 'over 2s' : gone.toFixed(0) + 'ms') + ' (limit ' + GHOST_MS + ')');
  if (rose > 1e-9) fail('the ghost: the ripple left behind deepened by ' + rose.toFixed(4) + ' in a frame');
  report.ghost = gone;
}

if (fails.length) {
  console.log('check-cursor-response: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1, 25)) console.log('  ' + f);
  process.exit(1);
}
const f1 = v => v.toFixed(1);
console.log('  where       steady sweeps trail by ' + lagMs.map(([s, ms]) => ms.toFixed(0) + 'ms at ' + s + 'px/s').join(', ')
            + '; a stopped pointer is reached within ' + settleWorst.toFixed(0) + 'ms; largest distance ' + f1(report.lagPx) + 'px (' + report.lagPxAt + ')');
console.log('  always      the touch at least ' + (100 * report.floorMin).toFixed(0) + '% of CALM_FLOOR once on the sheet ' + ENTRY_MS + 'ms');
console.log('  calm        sheet ' + PATHS.filter(n => !isParked(n)).map(n => n + ' ' + f1(report.sheet[n])).join(', ') + ', parked flicks '
            + PATHS.filter(isParked).map(n => f1(report.sheet[n])).join(' / ') + ' px/frame; dent strength '
            + report.on.toFixed(3) + '/frame; pushes ' + report.push.toFixed(2) + ' / ' + report.shove.toFixed(2) + ' px/frame; bodies '
            + report.body.toFixed(2) + ' px/frame, ' + report.acc.toFixed(2) + ' px/frame^2');
console.log('  capped      roll ' + report.rollV.toFixed(3) + ' u/s (cap ' + P0.ROLL_VMAX + '), pull ' + report.pullV.toFixed(3) + ' u/s (cap ' + P0.PULL_VMAX + ')');
console.log('  seated      after a re-entry a dent that shows is at most ' + f1(report.seatPx) + 'px from where the pointer left or came back ('
            + report.seatAt + '; limit ' + SEAT_PX + '), and where it left it deepens by ' + Math.max(0, report.oldRise).toFixed(4));
console.log('  gone        with the pointer out of the window a dent deepens by at most ' + Math.max(0, report.goneRise).toFixed(4) + ' a frame (limit 0)');
console.log('  fades out   no frame of the fade changes the sheet more than ' + report.spike.toFixed(3) + 'px above both frames around it (limit ' + SPIKE_PX + ')');
console.log('  the ring    at most ' + report.ring.toFixed(2) + 'px from the pointer on every path and sweep (limit ' + RING_PX + ')');
console.log('  paused      the pointer moved while paused, then resumed: ' + report.paused.join('; '));
console.log('  the ghost   ' + (report.ghost === null ? 'the ripple is off (CALM_RIPPLE 0): no ghost to leave' : 'the ripple a 3,000px/s flick leaves behind is gone ' + report.ghost.toFixed(0) + 'ms after the flick starts (limit ' + GHOST_MS + '), the same to the bit with the pointer out and back meanwhile'));
console.log('check-cursor-response: OK - ' + (PATHS.length - PARKED.length) + ' pointer paths, ' + PARKED.length + ' flicks from a parked pointer and 4 steady sweeps: the touch trails by at most '
            + Math.max(...lagMs.map(l => l[1])).toFixed(0) + 'ms, settles in ' + settleWorst.toFixed(0) + 'ms, never below '
            + (100 * report.floorMin).toFixed(0) + '% of its floor; no jump (strength ' + report.on.toFixed(3) + '/frame, sheet <= '
            + f1(Math.max(...Object.values(report.sheet))) + 'px, pushes <= ' + Math.max(report.push, report.shove).toFixed(1) + 'px, bodies <= '
            + report.body.toFixed(1) + 'px a frame); body speeds under their caps; re-entry hops (dents <= ' + f1(report.seatPx)
            + 'px from either end); gone, it only fades; fade-out with no gate step (' + report.spike.toFixed(3) + 'px); the ring on the pointer ('
            + report.ring.toFixed(2) + 'px), after a pause too, and no dent dragged across; ' + (report.ghost === null ? 'the ripple off' : 'a flick\'s ghost gone in ' + report.ghost.toFixed(0) + 'ms'));
