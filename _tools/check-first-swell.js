'use strict';
/* The first swell event of a visit must be seen (scene.js prepEvent,
   EVENT_SEED; audit F7).

   Scene time starts at 0 on every visit, so event n = 0 is the first one,
   from EVENT_IN * EVENT_MS (5.8s) on. Its shape used to come from hash1(0),
   which is exactly 0: smallest amplitude, at the far left edge, moving the
   visible sheet by 0.9px - the first swell anyone saw came 54s in. With
   EVENT_SEED its shape comes from hash index n + EVENT_SEED.

   The largest displacement event 0 gives anywhere in the visible gutters
   (|x - W/2| > 430, the 860px card covers the rest) over its window, at
   1440x900 and 2560x1440, must be at least MIN_PX; on a phone (390x844, no
   gutter) the whole width counts. Exit 1 on failure. */
const H = require('./harness');

const MIN_PX = 20;
const fails = [], seen = [];
for (const [W, HH] of [[1440, 900], [2560, 1440], [390, 844]]) {
  const sim = H.load({ W, H: HH, dpr: 1, now: 0 });
  const P = sim.P;
  const t0 = P.EVENT_IN * P.EVENT_MS, t1 = (P.EVENT_IN + P.EVENT_SPAN) * P.EVENT_MS;
  let best = 0, sign = 0;
  for (let t = t0; t <= t1; t += 400) {
    P.prepEvent(t);
    if (!P.EVF.on) continue;
    for (let sx = 0; sx <= W; sx += 8) {
      if (W > 900 && Math.abs(sx - W / 2) < 430) continue;
      for (let d = 1; d <= P.DMAX; d += 0.05) {
        const px = Math.abs(P.swellEvent(P.worldX(sx, d), d)) * HH * P.WAVE_Y / d;
        if (px > best) { best = px; sign = P.EVF.sign; }
      }
    }
  }
  seen.push(W + 'x' + HH + ' ' + best.toFixed(1) + 'px ' + (sign > 0 ? 'hill' : 'valley'));
  if (!(best >= MIN_PX)) fails.push(W + 'x' + HH + ': the first swell event moves the visible sheet by only ' + best.toFixed(1) + 'px (need ' + MIN_PX + ')');
}
if (fails.length) {
  console.log('check-first-swell: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  process.exit(1);
}
console.log('check-first-swell: OK - the first swell event of a visit (from 5.8s) moves the visible sheet by ' + seen.join(', ')
            + ' (need ' + MIN_PX + 'px)');
