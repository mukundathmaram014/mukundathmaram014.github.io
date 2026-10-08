'use strict';
/* The lateral cursor field must never be able to fold a silhouette back on
   itself (README "The scenery"): displaced x = sx + shove(sx, ...) has to stay
   strictly increasing, or a mountain polygon shoved per vertex would
   self-intersect. Nothing is shoved per vertex today (a peak slides as
   one, by the shove at its centre; a tree bends by the shove at its root),
   so this guards the shove's own shape - the bound SIDE < 2.24 * SX
   (scene.js terrainShove) - for the day something is.

   The shove is the one the renderer's terrain feels: terrainPushSide, from
   the terrain's copy of the field (TPUSH), at the trees' amplitude
   (CUR_TERR_SIDE * S), the larger of the two. The sweep of the old
   sidetest.js (a Canvas probe, retired in W3):
   settle the pointer at (700, 300) for 120 frames, then step it across the
   full width (7px a frame at y=300) and at every position compare
   displaced x 2px apart over sx = -200..1640, with a silhouette spanning y
   200..460. Exit 1 if any forward step is <= 0.

   The shove is off today (CUR_TERR_SIDE 0: the bloom replaced the
   physical push, scene.js THE BLOOM), so the sweep finds no shove and
   says so; it still fails if one comes back and folds. The bloom's curl
   cannot fold anything: it turns each point about the root by an angle
   of its distance alone, which keeps every distance from the root. */
const H = require('./harness');

let sim;
try { sim = H.load({ W: 1440, H: 900, dpr: 2, search: '?bgq=0' }); }
catch (e) { console.log('check-monotonic: FAIL - ' + e.message); process.exit(1); }
const P = sim.P;
/* an older root (before W2b) has only the direct push, cursorTerrainX */
if (typeof P.terrainPushSide !== 'function' && typeof P.cursorTerrainX !== 'function') { console.log('check-monotonic: FAIL - neither terrainPushSide nor cursorTerrainX found'); process.exit(1); }
const amp = () => P.CUR_TERR_SIDE * (P.S || 1);
const shove = (x, top, bot) => (P.terrainPushSide ? P.terrainPushSide(x, top, bot, amp()) : P.cursorTerrainX(x, top, bot));

sim.move(700, 300);
sim.frames(120, 16.7);
let worst = Infinity, worstAt = 0, worstPtr = 0, strongest = 0;
for (let px = 0; px <= 1440; px += 7) {
  sim.move(px, 300);
  sim.frame(16.7);
  for (let sx = -200; sx <= 1640; sx += 2) {
    const s = shove(sx, 200, 460);
    strongest = Math.max(strongest, Math.abs(s));
    const b = (sx + 2) + shove(sx + 2, 200, 460);
    if (b - (sx + s) < worst) { worst = b - (sx + s); worstAt = sx; worstPtr = px; }
  }
}
const msg = 'smallest forward step over a 2px span ' + worst.toFixed(3) + 'px at sx=' + worstAt
          + ' (pointer target x=' + worstPtr + '), pointer x 0..1440, sx -200..1640, shove up to ' + strongest.toFixed(1) + 'px';
if (amp() > 0 && !(strongest > 0.5 * 0.6065 * amp())) { console.log('check-monotonic: FAIL - the shove never came on (' + strongest.toFixed(2) + 'px): ' + msg); process.exit(1); }
if (!(worst > 0)) { console.log('check-monotonic: FAIL - ' + msg + ': the silhouette folds back on itself'); process.exit(1); }
console.log('check-monotonic: OK - ' + (amp() > 0 ? msg : 'the shove is off (CUR_TERR_SIDE 0, the bloom replaced it): ' + msg));
