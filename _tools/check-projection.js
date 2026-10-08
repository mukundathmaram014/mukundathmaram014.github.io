'use strict';
/* The projection lives in one place (README "The projection and the one
   parallax rule"; audit F45).

   scene.js defines HORIZON, LOOK_X, LOOK_Y, PAR_D0, PERSP_X, PERSP_Y and
   WAVE_Y once, plus tiltY(), horizonY(), shiftX(d), centreX(d), restAt(d),
   worldX(sx, d), standX(f, d) and skyX(f, par), and every site that has to
   line up with the sheet goes through them. The horizon used to be written
   out eight times and the rest plane seven; retune one copy and the terrain
   leaves the floor (18px at 900px tall).

   Static: none of the hand-written projection literals may come back in
   code (comments are ignored), and each constant and helper is defined
   exactly once. Live, through the probe, at rest and with look moving:
     - worldX inverts surfacePoint's x at every depth (round trip within
       1e-9 world units);
     - restAt(d) is surfacePoint's y with the wave taken out (1e-9 px);
     - horizonY() reads the EASED look.y, never look.ty (README "Smoothness traps");
     - something standing on the sheet slides exactly as far as the sheet
       at its own depth: standX(f, d) - f * W = centreX(d) - W / 2 (audit
       G3.1, the one parallax rule; check-parallax.js measures what is
       drawn);
     - the near floor (d = 1) slides LOOK_X * look.x, and from PAR_D0 on
       nothing slides.
   Exit 1 on any failure. */
const H = require('./harness');

const fails = [];
const { src } = H.source('background');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const LITERALS = [
  [/\bH\s*\*\s*0\.42\b/g, 'H * 0.42 (horizon: horizonY / HORIZON)'],
  [/\blook\.y\s*\*\s*16\b/g, 'look.y * 16 (horizon: horizonY / LOOK_Y)'],
  [/\bH\s*\*\s*0\.60?\b/g, 'H * 0.60 (rest plane: restAt / PERSP_Y)'],
  [/\bW\s*\*\s*0\.62\b/g, 'W * 0.62 (sideways scale: worldX / PERSP_X)'],
  [/\blook\.x\s*\*\s*30\b/g, 'look.x * 30 (shiftX / skyX / LOOK_X)'],
  [/\bH\s*\*\s*0\.085\b/g, 'H * 0.085 (wave scale: WAVE_Y)']
];
for (const [re, what] of LITERALS) {
  const n = (code.match(re) || []).length;
  if (n) fails.push(n + ' hand-written ' + what);
}
for (const name of ['HORIZON', 'LOOK_X', 'LOOK_Y', 'PAR_D0', 'PERSP_X', 'PERSP_Y', 'WAVE_Y']) {
  const n = (code.match(new RegExp('\\bconst\\s+' + name + '\\s*=', 'g')) || []).length;
  if (n !== 1) fails.push(name + ' defined ' + n + 'x (need exactly 1)');
}
for (const fn of ['tiltY', 'horizonY', 'shiftX', 'centreX', 'restAt', 'worldX', 'standX', 'skyX', 'surfacePoint']) {
  const n = (code.match(new RegExp('\\bfunction\\s+' + fn + '\\s*\\(', 'g')) || []).length;
  if (n !== 1) fails.push('function ' + fn + ' defined ' + n + 'x (need exactly 1)');
}

let worstInv = 0, worstRest = 0, checked = 0, slid = 0;
if (!fails.length) try {
  const sim = H.load({ W: 1440, H: 900, dpr: 1.5, now: 3000 });
  const P = sim.P;
  const probe = (label) => {
    const t = sim.now;
    for (const d of [1, 1.8, 2.65, 4.95, 6.05, 6.49, 9.1]) {
      for (const xw of [-5.2, -3.1, -1, 0, 0.7, 2.35, 4.8]) {
        const [x, y] = P.surfacePoint(xw, d, t);
        worstInv = Math.max(worstInv, Math.abs(P.worldX(x, d) - xw));
        worstRest = Math.max(worstRest, Math.abs(y - P.restAt(d) - P.wave(xw, d, t) * P.H * P.WAVE_Y / d));
        checked++;
      }
    }
    /* what stands on the sheet slides with the sheet at its own depth */
    for (const d of [1, 2.65, 4.95, 5.65, 6.49, 7, 9.1]) {
      const slide = P.standX(0.3, d) - 0.3 * P.W, centre = P.centreX(d) - P.W / 2;
      if (Math.abs(slide - centre) > 1e-9) fails.push(label + ': standX(f, ' + d + ') slides ' + slide + 'px, the sheet there ' + centre + 'px');
    }
    const near = P.shiftX(1), far = P.shiftX(P.PAR_D0), beyond = P.shiftX(P.PAR_D0 + 2);
    if (Math.abs(near - P.look.x * P.LOOK_X) > 1e-9) fails.push(label + ': the near floor slides ' + near + 'px, LOOK_X * look.x is ' + P.look.x * P.LOOK_X);
    if (Math.abs(far) > 0 || Math.abs(beyond) > 0) fails.push(label + ': the sheet slides ' + far + 'px at PAR_D0 and ' + beyond + 'px beyond it');
    slid = Math.max(slid, Math.abs(near));
  };
  sim.frames(30, 16.7);
  probe('idle');
  /* throw the pointer from the top-left to the bottom-right corner: one
     frame later look.ty is at its target and look.y has barely moved */
  sim.move(0, 0); sim.frames(200, 16.7);
  sim.move(1440, 900); sim.frame(16.7);
  const eased = P.H * P.HORIZON + P.look.y * P.LOOK_Y, raw = P.H * P.HORIZON + P.look.ty * P.LOOK_Y;
  if (!(Math.abs(P.horizonY() - eased) < 1e-9)) fails.push('horizonY() = ' + P.horizonY() + ', eased look.y gives ' + eased);
  if (!(Math.abs(raw - eased) > 1)) fails.push('test did not separate look.y from look.ty (' + raw + ' vs ' + eased + ')');
  probe('pointer moving');
  sim.frames(120, 16.7);
  probe('pointer settled');
  if (!(worstInv <= 1e-9)) fails.push('worldX(surfacePoint(xw, d)[0], d) misses xw by ' + worstInv.toExponential(2));
  if (!(worstRest <= 1e-9)) fails.push('surfacePoint y - restAt(d) - wave * H * WAVE_Y / d = ' + worstRest.toExponential(2) + 'px');
  if (!(slid > 3)) fails.push('look.x never slid the near floor more than ' + slid.toFixed(2) + 'px: the parallax half tested nothing');
} catch (e) {
  fails.push('live probe threw: ' + e.message);
}
if (fails.length) {
  console.log('check-projection: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-projection: OK - one definition of each constant and helper, no hand-written copies; '
            + checked + ' points: worldX round trip ' + worstInv.toExponential(1) + ', rest plane '
            + worstRest.toExponential(1) + 'px; horizonY reads eased look.y; standX slides with the sheet at its own depth'
            + ' (near floor up to ' + slid.toFixed(1) + 'px, nothing from PAR_D0)');
