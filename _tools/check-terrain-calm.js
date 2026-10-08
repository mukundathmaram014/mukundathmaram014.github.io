'use strict';
/* The mountains and trees never move fast because of the cursor - by ANY
   route, the floor under them included (the owner: "the mountains still
   jitter when I move past them fast, it should basically never move fast,
   always calm and peaceful").

   check-terrain-jolt bounds the push's own part of a point's motion and
   leaves the floor's out by design, and that is where the jitter was: a
   pointer swept along the mountains' feet ran the cursor's floor dent under
   their bases, and the terrain, welded to the floor, rode it at up to
   1,135px/s with its speed changing 11px/frame^2. And the push itself,
   rate-limited, started and stopped within a frame (0.24-0.26px/frame^2).

   Two runs on one clock, one with the pointer and one without: the
   difference is all the cursor does. Every 37th massif point and every 5th
   stroke point, through the shader's own math (scenery-twin.js), at 165Hz
   frames with a 125Hz mouse (getCoalescedEvents, timestamped): sweeps
   across the faces and along the feet at 1,500-3,000px/s, and flicks
   between the gutters at 5,000px/s. Limits per point, scaled by S: speed
   SPEED px/s, and its change from one frame to the next CHANGE px/frame^2.
   The bloom is left out (the twins read it as none): it is the scenery
   answering a pointer that lingers, on purpose and quickly, and
   check-bloom holds it to its own limits - that it eases, never snaps,
   and that a pass like these brings none. Honours SITE_ROOT. Exit 1 on
   failure. */
const H = require('./harness'), Twin = require('./scenery-twin');
const DT = 1000 / 165, SPEED = 60, CHANGE = 0.08;
{
  const Bg = H.load({ W: 1440, H: 900, dpr: 1 }).window.Bg;
  if (!(Bg && Bg.TPUSH && Bg.renderers && Bg.renderers.webgl && Bg.renderers.webgl.sceneryMesh)) {
    console.log('check-terrain-calm: SKIP - ' + H.ROOT + ' has no WebGL scenery');
    process.exit(0);
  }
}
function path(kind) {
  const ev = []; let t = 0;
  const line = (x0, y0, x1, y1, v) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / v * 125)); for (let i = 1; i <= n; i++) { t += 8; ev.push([t, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); } };
  const rest = (x, y, ms) => { for (let k = 0; k < ms / 8; k++) { t += 8; ev.push([t, x, y]); } };
  if (kind === 'face sweeps') { rest(-40, 330, 600); for (const [y, v] of [[330, 1500], [260, 3000], [400, 2500]]) { line(-40, y, 1480, y, v); rest(1480, y, 300); line(1480, y, -40, y, v); rest(-40, y, 300); } }
  if (kind === 'feet sweeps') { rest(-40, 450, 600); for (const [y, v] of [[450, 1500], [470, 3000], [430, 2500]]) { line(-40, y, 1480, y, v); rest(1480, y, 300); line(1480, y, -40, y, v); rest(-40, y, 300); } }
  if (kind === 'flicks') { rest(150, 380, 800); let p = [150, 380]; for (const q of [[1300, 300], [120, 450], [1250, 420], [200, 250], [1350, 480]]) { line(p[0], p[1], q[0], q[1], 5000); rest(q[0], q[1], 500); p = q; } }
  return ev;
}
let failed = false;
const rows = [];
for (const kind of ['face sweeps', 'feet sweeps', 'flicks']) {
  const A = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' }), B = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' });
  const BgA = A.window.Bg, BgB = B.window.Bg, S = BgA.S;
  for (const G of [BgA, BgB]) if (G.bloomAt) G.bloomAt = () => 0;   /* the bloom: check-bloom */
  const twA = Twin.make(BgA), twB = Twin.make(BgB);
  twA.strokeAt = twA.strokeRest; twB.strokeAt = twB.strokeRest;   /* the trees' poses are the bloom's too (THE FORKS) */
  const pts = [];
  for (let i = 0; i < twA.massifs; i += 37) pts.push(['m', i]);
  for (let i = 0; i < twA.strokes; i += 5) pts.push(['s', i]);
  const ev = path(kind), base = A.now, prev = new Map(), prevV = new Map();
  const m1 = [0, 0], m2 = [0, 0], s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
  let k = 0, t = 0, vMax = 0, jMax = 0, at = '';
  for (let f = 0; f < Math.ceil(ev[ev.length - 1][0] / DT); f++) {
    t += DT;
    const batch = [];
    while (k < ev.length && ev[k][0] <= t) { batch.push({ clientX: ev[k][1], clientY: ev[k][2], timeStamp: base + ev[k][0] }); k++; }
    if (batch.length) { const l = batch[batch.length - 1]; A.move(l.clientX, l.clientY, { timeStamp: l.timeStamp, getCoalescedEvents() { return batch; } }); }
    A.frame(DT); B.frame(DT);
    const tm = BgA.simNow;
    for (const [kindP, i] of pts) {
      let dx, dy;
      if (kindP === 'm') { const a = twA.massifAt(i, tm, m1), b = twB.massifAt(i, tm, m2); dx = a[0] - b[0]; dy = a[1] - b[1]; }
      else { const a = twA.strokeAt(i, tm, s1), b = twB.strokeAt(i, tm, s2); dx = a[2] - b[2]; dy = a[3] - b[3]; }
      const key = kindP + i, p0 = prev.get(key);
      if (p0) {
        const vx = dx - p0[0], vy = dy - p0[1], v = Math.hypot(vx, vy) * 165 / S;
        if (f > 100 && v > vMax) { vMax = v; at = (kindP === 'm' ? 'massif point ' : 'tree point ') + i + ', frame ' + f; }
        const pv = prevV.get(key);
        if (pv && f > 100) jMax = Math.max(jMax, Math.hypot(vx - pv[0], vy - pv[1]) / S);
        prevV.set(key, [vx, vy]);
      }
      prev.set(key, [dx, dy]);
    }
  }
  rows.push(kind + ' ' + vMax.toFixed(0) + 'px/s, ' + jMax.toFixed(3) + 'px/frame^2');
  if (vMax > SPEED) { failed = true; console.log('check-terrain-calm: FAIL - ' + kind + ': the cursor moves the terrain at ' + vMax.toFixed(0) + 'px/s (' + at + '; limit ' + SPEED + ' x S)'); }
  if (jMax > CHANGE) { failed = true; console.log('check-terrain-calm: FAIL - ' + kind + ': the terrain\'s speed changes ' + jMax.toFixed(3) + 'px/frame^2 in a frame (limit ' + CHANGE + ' x S): it snaps, not eases'); }
}
if (!failed) console.log('check-terrain-calm: OK - at 165Hz with a 125Hz mouse, the cursor moves no mountain or tree point faster than ' + SPEED + 'px/s or changes its speed more than ' + CHANGE + 'px/frame^2, the floor under them included: ' + rows.join('; '));
process.exit(failed ? 1 : 0);
