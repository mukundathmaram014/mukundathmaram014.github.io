'use strict';
/* The ring and the field must move EVENLY on a real display, where the
   mouse reports at its own rate, not the display's.

   check-cursor-response drives the pointer with one event per 60Hz frame,
   the one case where input and frames never disagree, so it could not see
   this: a ring drawn at the newest event froze on 202 of ~800 frames of a
   steady circle with a 125Hz mouse on 165Hz frames (three frames in four
   get a new position), then jumped twice as far - the owner's "it flicks
   around". And a ripple let go on speed alone was dropped and regrown
   behind the pointer 4 times in 5s of a gentle 300px/s circle.

   Here: 165Hz frames; a 125, 250 or 1000Hz mouse with +-15% timing jitter;
   Chrome's delivery (one pointermove per frame, the rest in
   getCoalescedEvents(), every sample timestamped). A steady elliptical
   circle at 300, 900 and 2000px/s; a 150px/s drift. Checked:
     - no stalls: the ring moves on every frame (step > 1% of its mean);
     - even: the spread of the ring's frame-to-frame step (coefficient of
       variation) is within CV_SLACK of the follower's, which only shows
       the path's own speed changes around the ellipse;
     - the ripple stays with the pointer on these gentle paths: no let-go.
   Honours SITE_ROOT. Exit 1 on failure. */
const H = require('./harness');
const DT = 1000 / 165, CV_SLACK = 0.03;
let failed = false;
const fail = m => { failed = true; console.log('check-cursor-judder: FAIL - ' + m); };
const worst = { cv: 0, stalls: 0, flips: 0 };

function run(mouseHz, speed, R, cy) {
  const sim = H.load({ W: 1699, H: 888, dpr: 1.5, now: 1000, search: '?bgq=0' });
  const P = sim.P;
  const w = speed / R, cx = 300;
  const pos = t => [cx + R * Math.cos(w * t / 1000), cy + 0.45 * R * Math.sin(w * t / 1000)];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ev = [];
  for (let te = 0; te < 8000;) { te += (1000 / mouseHz) * (1 + (rnd() - 0.5) * 0.3); ev.push(te); }
  const base = sim.now, rec = [];
  let k = 0, t = 0, flips = 0, att = null;
  for (let f = 0; f < 165 * 7; f++) {
    t += DT;
    const batch = [];
    while (k < ev.length && ev[k] <= t) { const [x, y] = pos(ev[k]); batch.push({ clientX: x, clientY: y, timeStamp: base + ev[k] }); k++; }
    if (batch.length) {
      const l = batch[batch.length - 1];
      sim.move(l.clientX, l.clientY, { timeStamp: l.timeStamp, getCoalescedEvents() { return batch; } });
    }
    sim.frame(DT);
    if (f > 330) {
      rec.push([P.mk.x, P.mk.y, P.ptr.x, P.ptr.y]);
      if (att !== null && att !== P.RIP.att) flips++;
      att = P.RIP.att;
    }
  }
  const step = (a, b) => rec.slice(1).map((r, i) => Math.hypot(r[a] - rec[i][a], r[b] - rec[i][b]));
  const cv = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return [Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m, m]; };
  const ring = step(0, 1), [ringCv, ringMean] = cv(ring), [folCv] = cv(step(2, 3));
  const stalls = ring.filter(v => v < 0.01 * ringMean).length;
  const label = mouseHz + 'Hz mouse, ' + speed + 'px/s';
  if (stalls) fail(label + ': the ring stood still on ' + stalls + ' frames of steady motion');
  if (ringCv > folCv + CV_SLACK) fail(label + ': the ring steps unevenly (spread ' + ringCv.toFixed(3) + ' against the path\'s ' + folCv.toFixed(3) + ')');
  if (flips) fail(label + ': the ripple let go of the pointer ' + flips + ' times on a gentle path');
  worst.cv = Math.max(worst.cv, ringCv - folCv); worst.stalls += stalls; worst.flips += flips;
}
for (const hz of [125, 250, 1000]) for (const sp of [300, 900, 2000]) run(hz, sp, 220, 640);
run(125, 300, 150, 520);      /* mid-sheet, where perspective makes the same move fast in world units */
run(125, 150, 150, 600);      /* a slow drift */
if (!failed) console.log('check-cursor-judder: OK - 11 steady paths at 165Hz with 125/250/1000Hz mice: the ring never stalls (0 frames), steps as evenly as the path (spread within '
  + worst.cv.toFixed(3) + ' of it), and the ripple stays with the pointer (0 let-gos)');
process.exit(failed ? 1 : 0);
