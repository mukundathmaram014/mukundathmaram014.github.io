'use strict';
/* The background must run anywhere without throwing or handing the GPU a
   non-finite number. A throw used to stop the animation for good, and a
   NaN in a uniform throws nothing at all: the GPU draws the sheet, the
   scenery or a body off screen or not at all, and the page looks merely
   empty.

   600 frames at 1440x900, 375x812, 2560x1440 and 3840x2160, each at dpr 1,
   1.5 and 2, once with the pointer idle and once with a scripted sweep: a
   raster across the full width at seven heights (bottom edge, sheet, the
   horizon, over the mountains, the sky), leaving the window and coming back.
   One 250ms stall at frame 300. The page as it ships (the quality governor
   adapting). Every call the WebGL renderer makes on the harness's recording
   stub is checked: no throw, no non-finite number in any argument - every
   uniform value, every buffer's data - and nothing the strict stub rejects.
   Exit 1 on any failure. */
const H = require('./harness');

const FRAMES = 600;
const SIZES = [[1440, 900], [375, 812], [2560, 1440], [3840, 2160]];
const DPRS = [1, 1.5, 2];
const MODES = ['idle', 'sweep'];
const YS = [0.97, 0.80, 0.62, 0.46, 0.40, 0.30, 0.08];

function sweep(sim, i, W, Hh) {
  if (i < 20) return;
  if (i === 540) { sim.leave(); return; }
  if (i > 540 && i < 570) return;
  const k = (i - 20) % 518, row = Math.floor(k / 74), f = (k % 74) / 73;
  sim.move((row % 2 ? 1 - f : f) * W, YS[row] * Hh);
}
const dtAt = i => (i === 300 ? 250 : 16.7);

function job({ W, Hh, dpr, mode }) {
  const out = { W, H: Hh, dpr, mode, ops: 0, frames: 0, throws: null, nonFinite: 0, firstNonFinite: null, problems: 0, firstProblem: null };
  let frame = -1;
  const onOp = r => {
    out.ops++;
    if (H.nonFinite(r)) {
      if (!out.nonFinite) out.firstNonFinite = 'frame ' + frame + ' ' + H.serializeOp(r);
      out.nonFinite++;
    }
  };
  let sim;
  try { sim = H.load({ W, H: Hh, dpr, record: onOp }); }
  catch (e) { out.throws = 'load: ' + e.message; return out; }
  for (let i = 0; i < FRAMES; i++) {
    frame = i;
    try {
      if (mode === 'sweep') sweep(sim, i, W, Hh);
      sim.frame(dtAt(i));
    } catch (e) { out.throws = 'frame ' + i + ': ' + e.message; break; }
    out.frames++;
  }
  out.problems = sim.problems.length;
  if (out.problems) { const p = sim.problems[0]; out.firstProblem = 'frame ' + p.frame + ' ' + p.kind + ' ' + p.op + '(' + p.args.join(',') + ')'; }
  return out;
}

async function main() {
  const j = H.jobArg();
  if (j) { H.jobResult(job(j)); return; }
  const jobs = [];
  for (const [W, Hh] of SIZES) for (const dpr of DPRS) for (const mode of MODES) jobs.push({ W, Hh, dpr, mode });
  const res = await H.pool(__filename, jobs);
  const bad = res.filter(r => r.error || r.throws || r.nonFinite || r.problems || r.frames !== FRAMES);
  const ops = res.reduce((s, r) => s + (r.ops || 0), 0);
  if (bad.length) {
    console.log('check-exec: FAIL - ' + bad.length + '/' + res.length + ' runs');
    for (const r of bad) {
      const tag = r.error ? '' : '  ' + r.W + 'x' + r.H + ' dpr ' + r.dpr + ' ' + r.mode + ': ';
      console.log(tag + (r.error || r.throws || (r.nonFinite ? r.nonFinite + ' non-finite args, first ' + r.firstNonFinite : '')
                  + (r.problems ? ' ' + r.problems + ' rejected ops, first ' + r.firstProblem : '')));
    }
    process.exit(1);
  }
  console.log('check-exec: OK - ' + res.length + ' runs x ' + FRAMES + ' frames (4 sizes x dpr 1/1.5/2 x idle/sweep), '
              + ops.toLocaleString('en-US') + ' GL calls, no throw, no non-finite argument, nothing rejected');
}
main().catch(e => { console.log('check-exec: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
