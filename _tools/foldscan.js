'use strict';
/* How the swell's coefficients bear on the floor turning back on itself.

     y(xw, d, t) = horizonY() + H * PERSP_Y / d + wave(xw, d, t) * H * WAVE_Y / d

   The sheet turns back on itself wherever y stops falling as d grows: the
   farther part is then drawn below the nearer one, and behind it. Two
   lines matter, and they are not the same line:

     column lines    a column is drawn at one WORLD x (render-webgl.js: COLS
                     of them over +-COL_SPAN). Along it only the swell's d
                     terms change with depth - kd, what the first table
                     scales - and at the live table, a quarter of the
                     original kd, every column falls the whole way down.
     screen columns  a row crossing is a farther row drawn below a nearer
                     one in the same column of PIXELS, and there the world x
                     moves with depth (xw = worldX(sx, d) = sn * d), so the
                     swell's xw terms change along it as well, by kx * sn
                     per unit of depth: 4.2 * sn for the first term, against
                     0.34 for its kd. The kd do not decide this one. It
                     turns back at every kd scale, 0 included (audit G1.5);
                     the amplitudes do (the second table), and they are
                     also how far everything travels.

   The ambient swell alone: the scene's own waveBase, with the live WAVE
   table's kd (or amp) scaled in place for each row, the way
   check-wave-parity.js retunes it; no swell event, no dent and no well
   (seattest.js measures the live sheet with all of them). 1440x900, look
   at rest, 40 moments over 58.5s; screen columns every 6px of the gutters
   the card leaves (harness.cssCard), d from the first row to the last
   (1 to DMAX), only where the sheet is drawn (|sn| <= XSPAN). Each row:
   the worst forward step (below 0: the line falls the whole way) and, for
   the screen columns, the worst overlap: how far below the highest nearer
   point of its column a point of the sheet is drawn (how deep it is hidden).

   Since W2a the floor is opaque and depth-tested, so the sheet hiding
   itself is drawn as a crest hiding what is behind it, to the pixel
   (check-webgl-floor.js). On the Canvas wireframe it showed as braided
   rows (G1.1), and this scan, which looked only along a world x, printed
   "ok" for the live table (-0.029 px) while the drawn rows crossed by
   20-66 px. Loads the background scripts under SITE_ROOT through
   harness.js; SKIPs on a root whose scene has no WAVE table (before W2a). */
const H = require('./harness');

const sim = H.load({ W: 1440, H: 900, dpr: 1, search: '?bgq=0' });
const P = sim.P, Bg = sim.window.Bg;
if (!Bg || !Array.isArray(Bg.WAVE)) {
  console.log('foldscan: SKIP - no WAVE table in the scene under ' + H.ROOT + ' (before W2a)');
  process.exit(0);
}
const WAVE = Bg.WAVE, KD = WAVE.map(w => w.kd), AMP = WAVE.map(w => w.amp);
const R = H.rendererNumbers(['COLS', 'COL_SPAN']);
const card = H.cssCard(P.W);
if (P.EVF.on || (P.CUR.on > 0) || (P.RIP.on > 0)) throw new Error('foldscan: a swell event or a dent is on before any frame ran');

/* the sheet's y with the ambient swell alone: waveBase with no event and
   no dent (none has started: no frame has run), and no wells (wave adds them) */
const y = (xw, d, t) => P.restAt(d) + (P.waveBase(xw, d, t) * P.H * P.WAVE_Y) / d;
const TIMES = [];
for (let i = 0; i < 40; i++) TIMES.push(i * 1500);
const DS = [];
for (let d = 1; d <= P.DMAX + 1e-9; d += 0.02) DS.push(d);
const COLX = [];
for (let sx = 3; sx < P.W; sx += 6) if (sx < card.left || sx > card.right) COLX.push(sx);
const XC = [];
for (let j = 0; j < R.COLS; j++) XC.push(-R.COL_SPAN + (2 * R.COL_SPAN * j) / (R.COLS - 1));

function scan() {
  let col = -Infinity, colAt = '', step = -Infinity, stepAt = '', over = 0, overAt = '';
  for (const t of TIMES) {
    /* the column lines, each where it is on the sheet (|xc / d| <= XSPAN) */
    for (const xc of XC) {
      let prev = null;
      for (const d of DS) {
        if (Math.abs(xc / d) > P.XSPAN) continue;
        const v = y(xc, d, t);
        if (prev !== null && v - prev > col) { col = v - prev; colAt = 'd=' + d.toFixed(2) + ' xw=' + xc.toFixed(2); }
        prev = v;
      }
    }
    /* the screen columns */
    for (const sx of COLX) {
      let prev = null, crest = Infinity;
      for (const d of DS) {
        const xw = P.worldX(sx, d);
        if (Math.abs(xw / d) > P.XSPAN) continue;
        const v = y(xw, d, t);
        if (prev !== null && v - prev > step) { step = v - prev; stepAt = 'd=' + d.toFixed(2) + ' x=' + sx; }
        if (v - crest > over) { over = v - crest; overAt = 'd=' + d.toFixed(2) + ' x=' + sx; }
        crest = Math.min(crest, v);
        prev = v;
      }
    }
  }
  return { col, colAt, step, stepAt, over, overAt };
}
const fmt = v => ((v >= 0 ? '+' : '') + v.toFixed(3) + ' px').padStart(11);

console.log('foldscan: the ambient swell (scene.js WAVE), ' + P.W + 'x' + P.H + ', look at rest, 40 moments over 58.5s;');
console.log('  screen columns in the gutters (x < ' + card.left + ' or > ' + card.right + '), d 1..' + P.DMAX);
console.log('');
console.log('the d coefficients (kd), scaled: x4 is where they started, x1 is the live table');
console.log('  kd scale  kd                     column lines (world x)    screen columns');
console.log('                                   worst step                worst step   worst overlap');
for (const k of [4, 3.2, 2.4, 2, 1.6, 1.4, 1.2, 1, 0.8, 0]) {
  WAVE.forEach((w, i) => { w.kd = KD[i] * k; });
  const r = scan();
  console.log(('  x' + k + (k === 1 ? ' (live)' : '')).padEnd(12)
              + ('[' + WAVE.map(w => (w.kd + 0).toFixed(3)).join(', ') + ']').padEnd(25)
              + fmt(r.col) + (r.col < 0 ? '  falls     ' : '  turns back')
              + fmt(r.step) + fmt(r.over) + (r.over > 0.5 ? '  (' + r.overAt + ')' : ''));
}
WAVE.forEach((w, i) => { w.kd = KD[i]; });
console.log('');
console.log('the amplitudes (amp), scaled, kd as live: the screen columns, and how far the swell carries the near floor');
console.log('  amp scale  amp                    worst step   worst overlap   near floor travel');
const TRAVEL_X = card.left / 2, TRAVEL_D = 1.25;
for (const k of [1, 0.75, 0.5, 0.35, 0.25]) {
  WAVE.forEach((w, i) => { w.amp = AMP[i] * k; });
  const r = scan();
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t <= 60000; t += 100) { const v = y(P.worldX(TRAVEL_X, TRAVEL_D), TRAVEL_D, t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  console.log(('  x' + k + (k === 1 ? ' (live)' : '')).padEnd(13)
              + ('[' + WAVE.map(w => w.amp.toFixed(3)).join(', ') + ']').padEnd(23)
              + fmt(r.step) + fmt(r.over) + ('     ' + (hi - lo).toFixed(0) + ' px').padStart(14));
}
WAVE.forEach((w, i) => { w.amp = AMP[i]; });
console.log('');
console.log('foldscan: done - at the live table the column lines fall the whole way; the sheet still hides itself at a');
console.log('  screen column, which the opaque, depth-tested floor draws (check-webgl-floor.js)');
