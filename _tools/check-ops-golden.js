'use strict';
/* Golden op streams: proves a refactor of the background scripts changes
   nothing.

   Four scripted scenarios, 900 frames each, at 1440x900 dpr 1.5 and 390x844
   dpr 3 (8 runs). Every call the page makes on its WebGL context (the
   harness's recording stub: harness.js makeGL) is serialised with every
   argument - numbers rounded to 1e-6; a uniform array as its values; a
   buffer's data (over 64 values) as its length and SHA-1 - and compared
   with a recorded golden. That is everything the renderer hands the GPU:
   the shaders' source, the meshes, and each frame's uniforms (the swell's
   phase, the event, the dents, the wells, the view, the terrain's push, the
   sun, the bodies, the ring) and draw calls. What the GPU makes of them is
   the browser checks' (check-webgl-*.js, check-wave-parity.js).

   FORMAT 3 (W3). Formats 1 and 2 recorded the Canvas 2D renderer's ctx
   calls, which W3 deleted; a golden of theirs cannot be compared with this
   and the check says so. Each run loads with ?gl=1&bgq=0: the WebGL
   renderer on a site from before W3 (where ?gl=1 asked for it), and the
   quality governor held at its top level on a site from W3 on (it would
   otherwise react to the scenarios' 165 Hz run and long frames, which are
   there to test the scene's clock, not the governor: check-governor.js).

   A text form (harness.serializeOp, one line per op) of the Canvas stream
   was ~450KB a frame, and formatting the numbers was 16% of the time on its
   own. So the stream is hashed in an equivalent
   binary encoding instead (rounded values as integer micro-units, so equal
   text <=> equal bytes), alongside a second, exact encoding of every bit.
   The golden keeps, per frame, the op count, both SHA-1s and a short hash
   of each 1024-op chunk, plus the text of a few sample frames. On a
   mismatch the check replays the recorded source (if it still exists,
   checked by md5) and prints the exact first differing op as text.

     record:   SITE_ROOT=<root> GOLDEN=<dir> node _tools/check-ops-golden.js --record
     compare:  GOLDEN=<dir> node _tools/check-ops-golden.js

   The root to record is the site before the change (a copy of it): any
   root with the WebGL renderer, so not _baseline, whose page draws with
   Canvas 2D and makes no WebGL context to record.

   GOLDEN unset means SKIP, not fail: most changes alter the streams on
   purpose. Point GOLDEN at a recording only for a change that must be
   behaviour-preserving. Exit 1 on any difference at 1e-6; a difference only
   in the exact streams is reported but passes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const H = require('./harness');

const FORMAT = 3;
/* the WebGL renderer, at a fixed quality level (see above) */
const SEARCH = '?gl=1&bgq=0';
const FRAMES = 900;
const CHUNK = 1024;
const SIZES = [{ W: 1440, H: 900, dpr: 1.5 }, { W: 390, H: 844, dpr: 3 }];
const SAMPLE = [-1, 0, 1, 2, 450];

/* The clock: 60Hz with sub-ms jitter, a dropped frame every 97, a run at
   165Hz, and one long stall (tick clamps it to 64ms). */
function dtAt(i) {
  if (i === 450) return 480;
  if (i >= 600 && i < 700) return 6.06;
  if (i % 97 === 13) return 33.4;
  const j = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
  return 16.7 + (j - 0.5) * 1.6;
}
/* deterministic pseudo-random point in the unit square */
function key(k) {
  const a = Math.sin(k * 12.9898 + 1.3) * 43758.5453, b = Math.sin(k * 78.233 + 0.7) * 12345.6789;
  return [a - Math.floor(a), b - Math.floor(b)];
}
/* now0 places each run in a different swell-event window (EVENT_MS 48s):
   idle starts at load, gutter and flicks cross a live event, mountains sits
   in a quiet gap. */
const SCENARIOS = {
  /* no pointer at all */
  idle: { now0: 1200, step() {} },
  /* a slow Lissajous sweep in the left gutter, low on the sheet */
  gutter: {
    now0: 2 * 48000 + 3000,
    step(sim, i, W, Hh) {
      if (i >= 30 && i < 870) sim.move(W * (0.10 + 0.07 * Math.sin(i * 0.011)), Hh * (0.72 + 0.20 * Math.sin(i * 0.017)));
    }
  },
  /* screen-wide flicks (3 frames each, then a hold), leaving the window,
     re-entering far away, more flicks, a window blur, then small wiggles */
  flicks: {
    now0: 5 * 48000 + 12000,
    step(sim, i, W, Hh) {
      if (i === 60) sim.move(0.15 * W, 0.80 * Hh);
      if (i === 400) sim.leave();
      if (i === 550) sim.move(0.92 * W, 0.55 * Hh);
      if (i === 700) sim.blur();
      if (i === 760) sim.move(0.5 * W, 0.95 * Hh);
      if ((i > 60 && i < 400) || (i > 550 && i < 700)) {
        const c = Math.floor(i / 12), ph = i % 12;
        if (ph < 3) {
          const [ax, ay] = key(c - 1), [bx, by] = key(c), f = (ph + 1) / 3;
          sim.move(W * (ax + (bx - ax) * f), Hh * (ay + (by - ay) * f));
        }
      }
      if (i > 760 && i % 5 === 0) sim.move(W * (0.5 + 0.01 * Math.sin(i)), Hh * (0.95 - 0.01 * Math.cos(i)));
    }
  },
  /* above the horizon over the mountain faces, left gutter then right,
     dipping across the horizon (0.42H) and back */
  mountains: {
    now0: 7 * 48000 + 30000,
    step(sim, i, W, Hh) {
      if (i < 20 || i >= 880) return;
      const u = 0.5 - 0.5 * Math.cos((i - 20) * 0.012);
      let x = W * (0.02 + 0.25 * u);
      if (i >= 450) x = W - x;
      sim.move(x, Hh * (0.355 + 0.115 * Math.sin(i * 0.021)));
    }
  }
};
const NAMES = Object.keys(SCENARIOS);
const runName = (s, z) => s + '-' + z.W + 'x' + z.H + '@' + z.dpr;
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
function scenarioHash() {
  return sha1([FORMAT, FRAMES, CHUNK, JSON.stringify(SIZES), dtAt.toString(), key.toString()]
    .concat(NAMES.map(n => n + ':' + SCENARIOS[n].now0 + ':' + SCENARIOS[n].step.toString())).join('\n'));
}

/* ---- binary op encoding ----------------------------------------------------
   One record per op: op name, target, set flag, then each value tagged by
   type. Numbers: rounded -> Math.round(v * 1e6) as a double, -0 folded into
   0 (the text form prints both as "0"); exact -> the raw IEEE bits. Paint
   ops append fill, stroke and lineWidth, as serializeOp does. */
class Encoder {
  constructor(exact) { this.exact = exact; this.buf = Buffer.alloc(1 << 20); this.off = 0; this.n = 0; this.marks = []; }
  reset() { this.off = 0; this.n = 0; this.marks = []; }
  room(k) {
    if (this.off + k <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.off + k) len *= 2;
    const nb = Buffer.alloc(len);
    this.buf.copy(nb, 0, 0, this.off);
    this.buf = nb;
  }
  str(s) {
    const len = Buffer.byteLength(s);
    this.room(len + 5);
    this.buf[this.off++] = 1;
    this.buf.writeUInt32LE(len, this.off); this.off += 4;
    this.off += this.buf.write(s, this.off);
  }
  val(v) {
    if (typeof v === 'number') {
      this.room(9);
      this.buf[this.off++] = 0;
      let x = v;
      if (!this.exact && Number.isFinite(v)) { x = Math.round(v * 1e6); if (x === 0) x = 0; }
      this.buf.writeDoubleLE(x, this.off); this.off += 8;
    } else if (typeof v === 'string') this.str(v);
    else if (v && v.__gl) { this.room(1); this.buf[this.off++] = 5; this.str(v.__gl + v.id + (v.name ? ':' + v.name : '')); }
    else if (v && v.__data) { this.room(1); this.buf[this.off++] = 6; this.str(v.__data + ' ' + v.length + ' ' + v.sha1); }
    else if (v && v.__gradient) { this.room(5); this.buf[this.off++] = 2; this.buf.writeUInt32LE(v.id, this.off); this.off += 4; }
    else if (Array.isArray(v)) {
      this.room(5); this.buf[this.off++] = 4; this.buf.writeUInt32LE(v.length, this.off); this.off += 4;
      for (const e of v) this.val(e);
    } else { this.room(1); this.buf[this.off++] = 3; this.str(String(v)); }
  }
  op(r) {
    if (this.n % CHUNK === 0) this.marks.push(this.off);
    this.n++;
    this.str(r.op);
    this.str(r.target || '');
    this.room(2);
    this.buf[this.off++] = r.set ? 1 : 0;
    this.buf[this.off++] = Math.min(255, r.args.length);
    for (const a of r.args) this.val(a);
    if (!r.set && r.target !== 'gl' && PAINT.has(r.op)) { this.val(r.fill); this.val(r.stroke); this.val(r.lw); }
  }
  digest(withChunks) {
    const out = { n: this.n, h: sha1(this.buf.subarray(0, this.off)) };
    if (withChunks) {
      out.c = this.marks.map((m, k) => sha1(this.buf.subarray(m, k + 1 < this.marks.length ? this.marks[k + 1] : this.off)).slice(0, 12));
    }
    return out;
  }
}
const PAINT = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clearRect', 'drawImage']);

/* Run one scenario of a source (as H.source returns it: its files run one
   after another, as the page loads them). text(i) says whether frame i
   (-1 = the ops issued while the scripts loaded) also needs its text lines.
   onFrame(i, rounded, exact, lines) returns true to stop. */
function play(scenario, size, source, text, onFrame) {
  const sc = SCENARIOS[scenario];
  const R = new Encoder(false), X = new Encoder(true);
  let lines = text(-1) ? [] : null;
  const sim = H.load({ W: size.W, H: size.H, dpr: size.dpr, now: sc.now0, files: source.files, search: SEARCH,
                       record: r => { R.op(r); X.op(r); if (lines) lines.push(H.serializeOp(r)); } });
  if (!sim.gl) throw new Error('the page under ' + H.ROOT + ' made no WebGL context with ' + SEARCH + ': nothing to compare (format ' + FORMAT + ' records the WebGL stream)');
  if (onFrame(-1, R, X, lines)) return;
  for (let i = 0; i < FRAMES; i++) {
    R.reset(); X.reset(); lines = text(i) ? [] : null;
    sc.step(sim, i, size.W, size.H);
    sim.frame(dtAt(i));
    if (onFrame(i, R, X, lines)) return;
  }
}

/* ---- child jobs ------------------------------------------------------------ */
function jobRecord(job) {
  const source = H.source('background');
  const frames = [], samples = {};
  let load = null, ops = 0;
  play(job.scenario, job.size, source, i => SAMPLE.includes(i), (i, R, X, lines) => {
    const d = R.digest(true);
    d.x = X.digest(false).h;
    ops += d.n;
    if (i < 0) load = d; else frames.push(d);
    if (lines) samples[i] = lines.join('\n');
    return false;
  });
  const name = runName(job.scenario, job.size);
  fs.writeFileSync(path.join(job.dir, name + '.json'),
    JSON.stringify({ format: FORMAT, run: name, scenario: job.scenario, size: job.size, load, frames }));
  fs.writeFileSync(path.join(job.dir, name + '.samples.json.br'),
    zlib.brotliCompressSync(Buffer.from(JSON.stringify(samples)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
  return { name, ops };
}

function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let k = 0; k < n; k++) if (a[k] !== b[k]) return k;
  return -1;
}
/* the text of frame `frame` of a run, from a given source */
function frameText(job, source, frame) {
  let out = null;
  play(job.scenario, job.size, source, i => i === frame, (i, R, X, lines) => {
    if (i !== frame) return false;
    out = lines;
    return true;
  });
  return out;
}
function jobCompare(job) {
  const name = runName(job.scenario, job.size);
  const gold = JSON.parse(fs.readFileSync(path.join(job.dir, name + '.json'), 'utf8'));
  const source = H.source('background');
  let ops = 0, diff = null, exactDiff = null;
  play(job.scenario, job.size, source, () => false, (i, R, X) => {
    const g = i < 0 ? gold.load : gold.frames[i];
    const d = R.digest(true);
    ops += d.n;
    if (d.n !== g.n || d.h !== g.h) {
      diff = { frame: i, n: d.n, goldN: g.n, chunk: Math.max(0, firstDiff(d.c, g.c)) };
      return true;
    }
    if (!exactDiff && X.digest(false).h !== g.x) exactDiff = { frame: i };
    return false;
  });
  if (diff) {
    /* name the exact op: the golden side from a replay of the recorded
       source if it is still there, else from the sample frames */
    let goldLines = null, why = '';
    try {
      const man = JSON.parse(fs.readFileSync(path.join(job.dir, 'manifest.json'), 'utf8'));
      const g = H.source('background', man.source.root);
      if (md5(g.src) !== man.source.md5) why = 'the recorded source has changed since recording';
      else goldLines = frameText(job, g, diff.frame);
    } catch (e) { why = 'the recorded source is unavailable (' + e.message + ')'; }
    if (!goldLines) {
      const samp = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(job.dir, name + '.samples.json.br'))).toString());
      if (samp[diff.frame] !== undefined) goldLines = samp[diff.frame].split('\n');
    }
    const curLines = frameText(job, source, diff.frame);
    if (goldLines && curLines) {
      const k = firstDiff(curLines, goldLines);
      diff.op = k;
      diff.current = curLines.slice(Math.max(0, k - 2), k + 3);
      diff.golden = goldLines.slice(Math.max(0, k - 2), k + 3);
    } else diff.why = (why ? why + '; ' : '') + 'frame ' + diff.frame + ' is not a sample frame';
  }
  return { name, ops, diff, exactDiff };
}

/* ---- main ------------------------------------------------------------------ */
async function main() {
  const job = H.jobArg();
  if (job) { H.jobResult(job.mode === 'record' ? jobRecord(job) : jobCompare(job)); return; }
  const dir = process.env.GOLDEN;
  if (!dir) {
    console.log('check-ops-golden: SKIP - GOLDEN unset (set it to a recorded golden dir to prove a change is behaviour-preserving)');
    return;
  }
  const jobsFor = mode => NAMES.flatMap(s => SIZES.map(z => ({ mode, scenario: s, size: z, dir: path.resolve(dir) })));
  if (process.argv.includes('--record')) {
    fs.mkdirSync(dir, { recursive: true });
    const { src, file } = H.source('background');
    const res = await H.pool(__filename, jobsFor('record'));
    const bad = res.filter(r => r.error);
    if (bad.length) { console.log('check-ops-golden: RECORD FAILED - ' + bad[0].error); process.exit(1); }
    const total = res.reduce((s, r) => s + r.ops, 0);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      format: FORMAT, frames: FRAMES, chunk: CHUNK, sizes: SIZES, scenarios: NAMES, sample: SAMPLE,
      scenarioHash: scenarioHash(),
      source: { root: H.ROOT, file, md5: md5(src), bytes: Buffer.byteLength(src) },
      node: process.version, recorded: new Date().toISOString(),
      runs: Object.fromEntries(res.map(r => [r.name, { ops: r.ops }])), totalOps: total
    }, null, 1));
    console.log('check-ops-golden: RECORDED ' + res.length + ' runs x ' + FRAMES + ' frames, '
                + total.toLocaleString('en-US') + ' ops from ' + file + ' into ' + dir);
    return;
  }
  let man;
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { console.log('check-ops-golden: FAIL - no golden manifest in ' + dir); process.exit(1); }
  if (man.format !== FORMAT) {
    console.log('check-ops-golden: FAIL - golden is format ' + man.format + ', this check reads ' + FORMAT + '; re-record it');
    process.exit(1);
  }
  const notes = [];
  if (man.scenarioHash !== scenarioHash()) notes.push('scenarios changed since the golden was recorded');
  if (man.node !== process.version) notes.push('recorded under node ' + man.node);
  const res = await H.pool(__filename, jobsFor('compare'));
  const errs = res.filter(r => r.error), diffs = res.filter(r => r.diff);
  const total = res.reduce((s, r) => s + (r.ops || 0), 0);
  if (errs.length) { console.log('check-ops-golden: FAIL - ' + errs[0].error); process.exit(1); }
  if (diffs.length) {
    const d = diffs[0].diff;
    console.log('check-ops-golden: DIFFERS - ' + diffs.length + '/' + res.length + ' runs; first: ' + diffs[0].name
                + ' frame ' + d.frame + (d.op !== undefined ? ' op ' + d.op : ' chunk ' + d.chunk)
                + ' (ops ' + d.n + ' vs golden ' + d.goldN + ')');
    if (d.golden) {
      console.log('  golden:  ' + d.golden.join('\n           '));
      console.log('  current: ' + d.current.join('\n           '));
    } else console.log('  (' + d.why + ')');
    for (const r of diffs.slice(1)) console.log('  also ' + r.name + ' from frame ' + r.diff.frame);
    process.exit(1);
  }
  const ex = res.filter(r => r.exactDiff);
  console.log('check-ops-golden: IDENTICAL - ' + res.length + ' runs x ' + FRAMES + ' frames, '
              + total.toLocaleString('en-US') + ' ops match at 1e-6, '
              + (ex.length ? 'NOT bit-identical (' + ex[0].name + ' frame ' + ex[0].exactDiff.frame + ')' : 'bit-identical too')
              + (notes.length ? ' [note: ' + notes.join('; ') + ']' : ''));
}
main().catch(e => { console.log('check-ops-golden: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
