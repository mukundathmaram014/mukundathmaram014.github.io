'use strict';
/* The bloom (scene.js THE BLOOM): the scenery reshapes itself under a
   pointer that lingers on it - its facets turning as shards, its trees
   breaking into turning pieces, its clouds too - quickly, smoothly, and
   never for a pointer that only passes.
   The owner: "I want the actual geometric structure of the mountains to
   change, same with the trees, and I don't want to have to hold it there
   for that long", "still not as smooth as I want".

   Through the shader's own math (scenery-twin.js) at 165Hz frames with a
   125Hz mouse (timestamped, coalesced), 1440x900:

     comes      a hand gliding onto a face and resting there: the bloom at
                the pointer reaches 90% within COME ms of the pointer
                stopping, and a tree point and a massif corner there move
                at least MOVES px from where they rest (it is a real
                change of shape, not a few px), and a cloud's corners do
                under a pointer resting on the cloud;
     passes     fast sweeps to and fro across the faces (1,500-3,000px/s,
                no pause on the scenery): the bloom stays under PASS;
     floor      a pointer resting on the open floor below the scenery, and
                one resting on the card: no bloom;
     smooth     on those paths, a glide across the faces at 150px/s, and a
                flick away from a full bloom, every 37th massif point,
                every 5th stroke point and every 7th cloud point, its
                offset from where it rests:
                no faster than SPEED px/s, and its speed never changing by
                more than CHANGE px/frame^2 from one frame to the next (an
                ease, not a snap: the old physical push at its worst
                changed 0.24px/frame^2, the floor-riding terrain 11; the
                bloom measured 147px/s and 0.076 at most, coming in 0.32s;
                then the trees were set to clear the cursor's disc,
                aggressively, their tips held to FORK_TIPV, 480px/s, and
                measured 401px/s and 0.161);
     clears     a pointer resting in a tree's canopy, and in a conifer's:
                once the bloom is full, the length of the tree's line work
                inside the cursor's disc (KEEP_R * S) is at most CLEAR of
                what it is with the tree at rest - the branches have
                turned out of it;
     feet       every base corner and root on the floor without the dents,
                however far the bloom is on (check-seat holds the same with
                no bloom; this holds it with one).

   Limits scale with S. Honours SITE_ROOT; SKIPs a root with no bloom.
   Exit 1 on failure. */
const H = require('./harness'), Twin = require('./scenery-twin');
const DT = 1000 / 165, COME = 500, MOVES = 12, PASS = 0.1, SPEED = 480, CHANGE = 0.25, CLEAR = 0.2, SEAT = 1e-6;
{
  const Bg = H.load({ W: 1440, H: 900, dpr: 1 }).window.Bg;
  if (!(Bg && Bg.BLOOM && Bg.bloomAt && Bg.renderers && Bg.renderers.webgl)) {
    console.log('check-bloom: SKIP - ' + H.ROOT + ' has no bloom');
    process.exit(0);
  }
}
const fails = [], notes = [];
function events(build) {
  const ev = []; let t = 0;
  const line = (x0, y0, x1, y1, v, ease) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / v * 125));
    for (let i = 1; i <= n; i++) { t += 8; const u = i / n, e = ease ? 1 - (1 - u) ** 3 : u; ev.push([t, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e]); }
  };
  const rest = (x, y, ms) => { for (let k = 0; k < ms / 8; k++) { t += 8; ev.push([t, x, y]); } };
  build(line, rest, () => t);
  return ev;
}
/* runs a path; per frame calls look(Bg, tw, f) */
function run(ev, look) {
  const sim = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' });
  const Bg = sim.window.Bg, tw = Twin.make(Bg), base = sim.now;
  let k = 0, t = 0;
  const n = Math.ceil(ev[ev.length - 1][0] / DT);
  for (let f = 0; f < n; f++) {
    t += DT;
    const batch = [];
    while (k < ev.length && ev[k][0] <= t) { batch.push({ clientX: ev[k][1], clientY: ev[k][2], timeStamp: base + ev[k][0] }); k++; }
    if (batch.length) { const l = batch[batch.length - 1]; sim.move(l.clientX, l.clientY, { timeStamp: l.timeStamp, getCoalescedEvents() { return batch; } }); }
    sim.frame(DT);
    look(Bg, tw, f, t);
  }
  return { Bg, tw };
}
/* the smoothness of everything the bloom moves on one path */
function smooth(name, ev) {
  const prev = new Map(), prevV = new Map(), m1 = [0, 0], m2 = [0, 0], s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
  let pts = null, vMax = 0, jMax = 0, at = '', bMax = 0, moved = 0;
  run(ev, (Bg, tw, f) => {
    if (!pts) { pts = []; for (let i = 0; i < tw.massifs; i += 37) pts.push(['m', i]); for (let i = 0; i < tw.strokes; i += 5) pts.push(['s', i]); for (let i = 0; i < tw.clouds; i += 7) pts.push(['c', i]); }
    const tm = Bg.simNow, S = Bg.S;
    bMax = Math.max(bMax, Bg.BLOOM.on);
    for (const [kind, i] of pts) {
      let dx, dy;
      if (kind === 'm') { const a = tw.massifAt(i, tm, m1), b = tw.massifRest(i, tm, m2); dx = a[0] - b[0]; dy = a[1] - b[1]; }
      else if (kind === 's') { const a = tw.strokeAt(i, tm, s1), b = tw.strokeRest(i, tm, s2); dx = a[2] - b[2]; dy = a[3] - b[3]; }
      else { const a = tw.cloudAt(i, m1), b = tw.cloudRest(i, m2); dx = a[0] - b[0]; dy = a[1] - b[1]; }
      moved = Math.max(moved, Math.hypot(dx, dy));
      const key = kind + i, p = prev.get(key);
      if (p) {
        const vx = (dx - p[0]) / DT * 1000, vy = (dy - p[1]) / DT * 1000, v = Math.hypot(vx, vy) / S;
        const what = { m: 'massif point ', s: 'tree point ', c: 'cloud point ' }[kind];
        if (v > vMax) { vMax = v; at = what + i + ', frame ' + f; }
        const q = prevV.get(key);
        if (q) {
          const j = Math.hypot(vx - q[0], vy - q[1]) * DT / 1000 / S;
          if (j > jMax) { jMax = j; if (j > CHANGE) at = what + i + ', frame ' + f; }
        }
        prevV.set(key, [vx, vy]);
      }
      prev.set(key, [dx, dy]);
    }
  });
  if (!(vMax <= SPEED)) fails.push(name + ': the bloom moves a point at ' + vMax.toFixed(0) + 'px/s (' + at + '; limit ' + SPEED + ' x S)');
  if (!(jMax <= CHANGE)) fails.push(name + ': a point\'s speed changes ' + jMax.toFixed(3) + 'px/frame^2 in a frame (' + at + '; limit ' + CHANGE + ' x S): it snaps, not eases');
  notes.push(name + ' ' + vMax.toFixed(0) + 'px/s, ' + jMax.toFixed(3) + 'px/frame^2 (bloom up to ' + bMax.toFixed(2) + ', points up to ' + moved.toFixed(0) + 'px from rest)');
  return { vMax, jMax, bMax, moved };
}
const FACE = [1290, 330];
/* comes */
{
  let stopAt = 0;
  const ev = events((line, rest, now) => { rest(1420, 600, 400); line(1420, 600, FACE[0], FACE[1], 900, true); stopAt = now(); rest(FACE[0], FACE[1], 2500); });
  let t90 = null, moveM = 0, moveS = 0;
  const m1 = [0, 0], m2 = [0, 0], s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
  run(ev, (Bg, tw, f, t) => {
    if (t >= stopAt && t90 === null && Bg.bloomAt(FACE[0], FACE[1]) >= 0.9) t90 = t - stopAt;
    if (f % 20 === 0 || t > ev[ev.length - 1][0] - DT) {
      const tm = Bg.simNow;
      for (let i = 0; i < tw.massifs; i += 7) { const a = tw.massifAt(i, tm, m1), b = tw.massifRest(i, tm, m2); if (Math.hypot(a[0] - FACE[0], a[1] - FACE[1]) < 120) moveM = Math.max(moveM, Math.hypot(a[0] - b[0], a[1] - b[1])); }
      for (let i = 0; i < tw.strokes; i += 3) { const a = tw.strokeAt(i, tm, s1), b = tw.strokeRest(i, tm, s2); moveS = Math.max(moveS, Math.hypot(a[2] - b[2], a[3] - b[3])); }
    }
  });
  if (t90 === null || !(t90 <= COME)) fails.push('comes: the bloom at a resting pointer ' + (t90 === null ? 'never reached 90%' : 'took ' + t90.toFixed(0) + 'ms to reach 90%') + ' (limit ' + COME + 'ms)');
  if (!(moveM >= MOVES && moveS >= MOVES)) fails.push('comes: a full bloom moves the mountain only ' + moveM.toFixed(1) + 'px and the trees ' + moveS.toFixed(1) + 'px (at least ' + MOVES + ')');
  notes.push('a resting pointer\'s bloom 90% in ' + (t90 === null ? '-' : t90.toFixed(0)) + 'ms, the mountain moved up to ' + moveM.toFixed(0) + 'px and the trees ' + moveS.toFixed(0) + 'px');
}
/* a cloud */
{
  let moveC = 0, cl = null;
  const probe = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' }).window.Bg, c = probe.CLOUDS[4];
  cl = [c.fx * probe.W + probe.skyX(0, c.par), c.fy * probe.H + probe.tiltY()];
  const ev = events((line, rest) => { rest(cl[0] + 60, cl[1] + 120, 300); line(cl[0] + 60, cl[1] + 120, cl[0], cl[1], 400, true); rest(cl[0], cl[1], 1800); });
  const m1 = [0, 0], m2 = [0, 0];
  run(ev, (Bg, tw, f) => {
    if (f % 20) return;
    for (let i = 0; i < tw.clouds; i++) { const a = tw.cloudAt(i, m1), b = tw.cloudRest(i, m2); moveC = Math.max(moveC, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  });
  if (!(moveC >= MOVES)) fails.push('a cloud: a full bloom on it moves its corners only ' + moveC.toFixed(1) + 'px (at least ' + MOVES + ')');
  notes.push('a cloud under a resting pointer moved up to ' + moveC.toFixed(0) + 'px');
}
/* clears */
{
  const probe = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' }).window.Bg;
  const ID = H.rendererNumbers(['ID_STROKE']).ID_STROKE;
  const spots = [['a tree', probe.TREES[3], ID + 3], ['a conifer', probe.CONIFERS[3], ID + probe.TREES.length + 3]].map(([what, c, id]) => {
    const x = probe.standX(c.fx, c.d), y = probe.restAt(c.d) - 0.62 * c.h;
    return { what, x, y, id };
  });
  for (const sp of spots) {
    let inRest = 0, inPosed = 0;
    const ev = events((line, rest) => { rest(sp.x + 160, sp.y + 30, 200); line(sp.x + 160, sp.y + 30, sp.x, sp.y, 400, true); rest(sp.x, sp.y, 1500); });
    const S4 = [0, 0, 0, 0], R4 = [0, 0, 0, 0];
    let last = null;
    run(ev, (Bg, tw) => { last = [Bg, tw]; });
    const [Bg, tw] = last, k = 46 * Bg.S, c = Bg.BLOOM.s[Bg.BLOOM.cur];
    /* the length of segment (a, b) within k of the bloom's centre, by 40 samples */
    const inside = (ax, ay, bx, by) => { let n = 0; for (let j = 0; j < 40; j++) { const u = (j + 0.5) / 40, x = ax + (bx - ax) * u, y = ay + (by - ay) * u; if (Math.hypot(x - c.x, y - c.y) < k) n++; } return n / 40 * Math.hypot(bx - ax, by - ay); };
    for (let i = 0; i < tw.strokes; i += 6) {
      if (tw.stroke(i).id !== sp.id) continue;   /* its own line work */
      const a = tw.strokeAt(i, Bg.simNow, S4), b = tw.strokeRest(i, Bg.simNow, R4);
      inPosed += inside(a[0], a[1], a[2], a[3]); inRest += inside(b[0], b[1], b[2], b[3]);
    }
    if (!(inRest > 20)) fails.push('clears, ' + sp.what + ': the disc holds only ' + inRest.toFixed(0) + 'px of line work at rest: it tests nothing');
    else if (!(inPosed <= CLEAR * inRest)) fails.push('clears, ' + sp.what + ': ' + inPosed.toFixed(0) + 'px of its line work stays inside the cursor\'s disc, of ' + inRest.toFixed(0) + 'px at rest (limit ' + (100 * CLEAR) + '%)');
    notes.push(sp.what + ' clears the disc: ' + inPosed.toFixed(0) + 'px of line work inside it, from ' + inRest.toFixed(0) + 'px at rest');
  }
}
/* passes */
{
  /* from the open floor (a pointer only reaches the page inside the window) */
  const ev = events((line, rest) => { rest(20, 820, 100); line(20, 820, 20, 330, 1500); for (const [y, v] of [[330, 1500], [280, 3000], [400, 2500], [350, 1500]]) { line(20, y, 1420, y, v); line(1420, y, 20, y, v); } });
  let bMax = 0;
  run(ev, Bg => { bMax = Math.max(bMax, Bg.BLOOM.on); });
  if (!(bMax <= PASS)) fails.push('passes: fast sweeps across the faces bloomed to ' + bMax.toFixed(2) + ' (limit ' + PASS + ')');
  notes.push('sweeps bloom ' + bMax.toFixed(3));
}
/* floor, card */
{
  let floorB = 0, cardB = 0, Bgf = null;
  run(events((line, rest) => { rest(1300, 720, 3000); }), Bg => { floorB = Math.max(floorB, Bg.BLOOM.on); Bgf = Bg; });
  if (!(floorB <= 1e-3)) fails.push('floor: a pointer resting on the open floor (1300, 720) bloomed to ' + floorB.toFixed(3));
  const sim = H.load({ W: 1440, H: 900, dpr: 1.5, now: 1000, search: '?bgq=0' }), Bg = sim.window.Bg;
  /* the card where main.js would put it, held there: main.js hands the scene
     its own measure every frame, and the harness's page lays nothing out */
  Bg.setCover(300, 30, 1140, 870);
  Bg.setCover = () => {};
  sim.move(700, 300);
  for (let f = 0; f < 400; f++) { sim.frame(DT); cardB = Math.max(cardB, Bg.BLOOM.on); }
  if (!(cardB <= 1e-3)) fails.push('card: a pointer resting on the card bloomed to ' + cardB.toFixed(3));
  notes.push('on the floor ' + floorB.toFixed(3) + ', on the card ' + cardB.toFixed(3));
}
/* smooth */
smooth('arrive and rest', events((line, rest) => { rest(1420, 600, 400); line(1420, 600, FACE[0], FACE[1], 900, true); rest(FACE[0], FACE[1], 1800); }));
smooth('glide', events((line, rest) => { rest(1180, 300, 1500); line(1180, 300, 1420, 420, 150); rest(1420, 420, 300); line(1420, 420, 1160, 240, 150); }));
smooth('flick away', events((line, rest) => { rest(FACE[0], FACE[1], 2000); line(FACE[0], FACE[1], 200, 400, 5000); rest(200, 400, 300); line(200, 400, 1300, 620, 5000); rest(1300, 620, 1500); }));
smooth('face to face', events((line, rest) => { rest(FACE[0], FACE[1], 1800); line(FACE[0], FACE[1], 1180, 420, 600, true); rest(1180, 420, 1800); }));
/* feet */
{
  let worst = 0, n = 0;
  const ev = events((line, rest) => { rest(FACE[0], FACE[1], 1500); line(FACE[0], FACE[1], 1200, 440, 300); rest(1200, 440, 800); });
  run(ev, (Bg, tw, f) => {
    if (f % 15) return;
    const tm = Bg.simNow, P = [0, 0], Q = [0, 0, 0, 0], b = tw.bases();
    for (const i of b.massif) { const p = tw.massifAt(i, tm, P), m = tw.massif(i); worst = Math.max(worst, Math.abs(p[1] - tw.groundAt(p[0], m.d, tm))); n++; }
    for (const i of b.root) { const p = tw.strokeAt(i, tm, Q), s = tw.stroke(i); worst = Math.max(worst, Math.abs(p[1] - tw.groundAt(p[0], s.d, tm))); n++; }
  });
  if (!(worst <= SEAT)) fails.push('feet: a base or root stands ' + worst.toExponential(2) + 'px off the floor under a bloom (limit ' + SEAT + ')');
  notes.push(n + ' bases and roots under a bloom on the floor within ' + worst.toExponential(1) + 'px');
}
if (fails.length) {
  console.log('check-bloom: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  for (const n of notes) console.log('  ' + n);
  process.exit(1);
}
console.log('check-bloom: OK - at 165Hz with a 125Hz mouse: ' + notes.join('; ') + ' (limits: 90% in ' + COME + 'ms, sweeps ' + PASS + ', ' + SPEED + 'px/s, ' + CHANGE + 'px/frame^2, all x S)');
