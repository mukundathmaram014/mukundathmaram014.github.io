'use strict';
/* dt is clamped to 64ms once, at the top of the scene's advance (scene.js,
   which main.js's tick calls), before anything integrates it (README "The
   scene clock"). The field follower, the marker, the ripple, the bodies'
   pull and roll and every eased value rely on that one clamp: their own
   re-clamps were redundant and are gone (audit F46), so losing the top one
   would let a stall reach a spring as a single giant step.

   And since the scene runs on its own clock, advanced by that same clamped
   dt (scene.js simNow; audit F6), so does everything else: the orbit, the
   swell and its events, the terrain. A long frame - a stall, or the first
   frame after a hidden tab - is one 64ms step of the whole scene, never the
   whole gap at once.

   Two identical runs; at the same moment one takes a 5000ms frame and the
   other a 64ms frame. The scene clock must move on by 64ms in both, every
   field of the scene's state (look, ptr, mk, CUR, RIP, EVF, the bodies, the
   terrain's copy of the field TPUSH, simNow) must come out bit-identical,
   and so must every call of the frame drawn then (the WebGL renderer's, on
   the harness's recording stub: every uniform it hands the GPU). The page
   runs at ?bgq=0, the quality governor's top level held: this is the
   scene's clamp, not the governor's pacing (check-governor.js). Exit 1 on
   any difference. */
const crypto = require('crypto');
const H = require('./harness');

const STATE = ['look', 'ptr', 'mk', 'CUR', 'RIP', 'EVF'];
const LISTS = ['bodiesW', 'bodyPull', 'bodyRoll', 'TPUSH'];
function run(longDt) {
  let hash = null, ops = 0;
  const sim = H.load({ W: 1440, H: 900, dpr: 1.5, now: 2000, search: '?bgq=0' });
  const P = sim.P;
  sim.move(300, 700);
  sim.frames(90, 16.7);
  sim.move(1200, 640);                /* in motion when the long frame lands */
  sim.frame(16.7);
  const t0 = P.simNow;
  hash = crypto.createHash('sha1');
  sim.setRecord(r => { ops++; hash.update(H.serializeOp(r, true) + '\n'); });
  sim.frame(longDt);
  sim.setRecord(null);
  const out = [['simNow', P.simNow]];
  for (const n of STATE) if (P[n]) for (const k of Object.keys(P[n]).sort()) out.push([n + '.' + k, P[n][k]]);
  for (const n of LISTS) (P[n] || []).forEach((o, i) => { for (const k of Object.keys(o).sort()) out.push([n + '[' + i + '].' + k, o[k]]); });
  return { out, step: P.simNow - t0, hash: hash.digest('hex'), ops };
}
const a = run(5000), b = run(64);
const fails = [];
if (!(a.step === 64)) fails.push('a 5000ms frame moved the scene clock ' + a.step + 'ms (need 64)');
if (a.out.length !== b.out.length) fails.push(a.out.length + ' state values after 5000ms vs ' + b.out.length + ' after 64ms');
else a.out.forEach(([k, v], i) => {
  if (k !== b.out[i][0] || !Object.is(v, b.out[i][1])) fails.push(k + ' ' + v + ' after 5000ms vs ' + b.out[i][1] + ' after 64ms');
});
if (!(a.ops > 0) || a.hash !== b.hash) fails.push('the frame drawn after 5000ms (' + a.ops + ' ops) differs from the one after 64ms (' + b.ops + ' ops)');
if (fails.length) {
  console.log('check-dtclamp: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  process.exit(1);
}
console.log('check-dtclamp: OK - a 5000ms frame advances the scene exactly like a 64ms one (the clock by ' + a.step
            + 'ms; all ' + a.out.length + ' state values bit-identical, the scene clock, orbit and swell included, and the '
            + a.ops.toLocaleString('en-US') + '-call frame drawn then)');
