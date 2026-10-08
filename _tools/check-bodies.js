'use strict';
/* The three bodies, left alone (scene.js bodyRoll, bodyPull, softFloor).

   F8: each body rolls down the slope it is drawn on. The slope used to be
   read at the orbit point, a median 0.27 world units from the drawn body -
   most of a quarter wave - so a body rolled UPHILL 42.9% of the time it was
   moving, about what chance would give. Read where it is drawn, 21.8%: the
   rest is the spring pulling it back toward its orbit over a crest.
   Limit: under UPHILL_MAX of moving body-frames.

   F22: the depth floor is a smooth max. The orbit reaches d = 1.5, below
   the 1.8 floor, so a hard floor bound 72 times in ten minutes and every
   contact was a corner in the motion: a one-frame change of up to 0.73px a
   frame in a body's screen velocity, 13x the 99th percentile. Now no body
   ever sits on the floor, none goes below it, and no visible change of
   velocity in a frame exceeds ACC_MAX.

   Six minutes of scene time at 1440x900 with no pointer, every frame
   drawn (?bgq=0: the quality governor's top level held), at the scene
   time each frame was drawn at (simNow). Exit 1 on failure. */
const H = require('./harness');

const UPHILL_MAX = 0.30, ACC_MAX = 0.3, MINUTES = 6, DT = 16.7, W = 1440, HH = 900;
const sim = H.load({ W, H: HH, dpr: 1, now: 1000, search: '?bgq=0' });
const P = sim.P;
const fails = [];
let moving = 0, uphill = 0, onFloor = 0, minD = Infinity, worstAcc = 0, at = '';
let prev = null, prevV = null;
const N = Math.round(MINUTES * 60000 / DT);
for (let i = 0; i < N; i++) {
  sim.frame(DT);
  if (i < 300) continue;
  const t = P.simNow, hh = 0.05;
  const pos = [];
  for (let k = 0; k < 3; k++) {
    const b = P.bodiesW[k], r = P.bodyRoll[k];
    const gx = (P.waveBase(b.xw + hh, b.d, t) - P.waveBase(b.xw - hh, b.d, t)) / (2 * hh);
    const gd = (P.waveBase(b.xw, b.d + hh, t) - P.waveBase(b.xw, b.d - hh, t)) / (2 * hh);
    if (Math.hypot(r.vx, r.vd) > 0.02) { moving++; if (r.vx * gx + r.vd * gd < 0) uphill++; }
    if (Math.abs(b.d - 1.8) < 1e-9) onFloor++;
    minD = Math.min(minD, b.d);
    const [x, y] = P.surfacePoint(b.xw, b.d, t);
    pos.push([x, y - 14.7 / b.d]);
  }
  if (prev) {
    const v = pos.map((p, k) => [p[0] - prev[k][0], p[1] - prev[k][1]]);
    if (prevV) for (let k = 0; k < 3; k++) {
      if (Math.abs(pos[k][0] - W / 2) < 0.163 * W) continue;          /* behind the card */
      const a = Math.hypot(v[k][0] - prevV[k][0], v[k][1] - prevV[k][1]);
      if (a > worstAcc) { worstAcc = a; at = (i * DT / 1000).toFixed(1) + 's body ' + k + ' at d ' + P.bodiesW[k].d.toFixed(3); }
    }
    prevV = v;
  }
  prev = pos;
}
const share = uphill / moving;
if (!(share < UPHILL_MAX)) fail('bodies roll uphill ' + (100 * share).toFixed(1) + '% of the time they move (limit ' + 100 * UPHILL_MAX + '%): the slope is not read where they are drawn');
if (onFloor) fail(onFloor + ' body-frames sit exactly on d = 1.8: the depth floor is a hard clamp again');
if (!(minD > 1.8)) fail('a body went to depth ' + minD.toFixed(4) + ', not above the 1.8 floor');
if (!(worstAcc < ACC_MAX)) fail('a visible body changed screen velocity by ' + worstAcc.toFixed(3) + 'px/frame in one frame (limit ' + ACC_MAX + ') at ' + at);
function fail(m) { fails.push(m); }
if (fails.length) {
  console.log('check-bodies: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-bodies: OK - ' + MINUTES + ' min idle: bodies roll uphill ' + (100 * share).toFixed(1) + '% of the time they move (limit '
            + 100 * UPHILL_MAX + '%), never touch the floor (lowest d ' + minD.toFixed(4) + '), and change visible velocity by at most '
            + worstAcc.toFixed(3) + 'px/frame in a frame (limit ' + ACC_MAX + ')');
