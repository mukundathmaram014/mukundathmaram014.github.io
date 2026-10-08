'use strict';
/* The WebGL renderer's scenery vertex shader, in JS, from the scene's own
   functions: where each massif corner and each stroke end is drawn, given
   the mesh render-webgl.js builds (Bg.renderers.webgl.sceneryMesh()) and
   the scene as it stands. The shader is held to this in a browser
   (check-wave-parity.js, through renderer.probeScenery); node checks use
   it to measure the scenery without a GPU (check-terrain-jolt.js).

     const Twin = require('./scenery-twin');
     const tw = Twin.make(Bg);                 Bg: a page's or the harness's window.Bg
     tw.mesh                                   sceneryMesh() at the current size
     tw.massifAt(i, t, out)                    massif vertex i (CSS px) into out [x, y]
     tw.strokeAt(i, t, out)                    stroke vertex i's bent ends: [ax, ay, bx, by]
     tw.massifRest(i, t, out)                  vertex i with no push: the floor and the
                                               height alone (what the push moves it from)
     tw.massifSlid(i, t, out)                  vertex i slid as the push slides it, but not
                                               pressed (the press is the push's other part)
     tw.strokeRest(i, t, out)                  the same for a stroke vertex
     tw.floorAt(x, d, t)                       the floor's y under screen x at depth d
     tw.groundAt(x, d, t)                      the same without the cursor's dents: what
                                               the scenery stands on (the shader's refAt)
     tw.bases()                                what stands on the floor: { massif: the corners
                                               on the ground (h = 0), one per place; root:
                                               the stroke vertices at a tree's or conifer's
                                               root, one per object }
     tw.cloudAt(i, out)                        cloud vertex i (CSS px): CLOUD_VS's placement
     tw.cloudRest(i, out)                      the same with no bloom
     tw.massif(i), tw.stroke(i)                a vertex's attributes, by name (a massif's
                                               bary: its barycentric coordinates in its
                                               facet; slack, cut and ends: see below)

   The shader's math, step for step (render-webgl.js MASSIF_GLSL,
   STROKE_GLSL): a massif corner is read the push at its xc over the span
   (restAt(d) - hspan, restAt(d)); a peak (slide 1) slides by the shove at
   its centre; the dip is read at the slid centre (a ridge: at its own x);
   the corner stands at x0 + shiftX(d) + slide, on the floor there without
   the cursor's dents (refY: surfacePoint at (worldX(x, d), d) less
   dentAt's share), raised by h * max(0.2, 1 - dip /
   hspan) (the skirt, h < 0, unpressed). A point where the mesh cut an
   edge (cut: its edge's corners L and R, x0L < x0R, as ends) stands as
   high over the floor under it as the straight line from L to R does
   there, on the floor without the cursor's dents (refY; L and R on it at
   their own x, slid as the point is, unpressed), unless that is more than
   its slack from the point's own height, when it keeps to the slack: h'.
   It is drawn h' over the floor, pressed by the point's own g but by no
   more than its span's: y = floor - h' + (1 - g) * min(h', hspan)
   (massifAt: no piece turns over, the edge bends only as far as that
   needs, and the push moves the point no more than a corner). A stroke's
   root is at x0 +
   shiftX(d) on the floor without the dents (refY); its points (lx, ly)
   turn about it (below).
   Then the bloom (scene.js THE BLOOM): a massif point is moved as its
   facet's shard (render-webgl.js shardAt: on the screen, turned about the
   facet's centroid as placed, shrunk toward it, drifted out from the foot,
   by the bloom over the centroid; its share a smoothstep of its facet's
   lowest corner's height over SHARD_PIN * S);
   a stroke's segment comes posed by the renderer's own poseStrokes (THE
   FORKS: each branch turned at its joint out of the cursor's disc, on the
   CPU; the shader draws what it is given), and a cloud's facet as
   a shard about its centroid (CLOUD_VS).
   This is also the layout render-webgl.js documents for sceneryMesh. */
const MF = 28, SF = 20, CF = 20;

function make(Bg, mesh) {
  const m = mesh || Bg.renderers.webgl.sceneryMesh();
  const A = m.massif, Sx = m.stroke, C = m.cloud;
  const OUT = [0, 0];
  function floorY(x, d, t) { return Bg.surfacePoint(Bg.worldX(x, d), d, t, OUT)[1]; }
  /* the same without the cursor's dents (the shader's refAt) */
  function refY(x, d, t) { return floorY(x, d, t) - (Bg.dentAt(Bg.worldX(x, d), d) * Bg.H * Bg.WAVE_Y) / d; }
  /* push: 2 the whole push, 1 its slide alone (unpressed), 0 none */
  function standAt(x0, h, xc, hs, d, slides, t, push, out) {
    const shift = Bg.shiftX(d), rest = Bg.restAt(d), top = rest - hs;
    const slide = push < 1 || !slides ? 0 : Bg.terrainPushSide(xc + shift, top, rest, Bg.CUR_SIDE_PEAK * Bg.S);
    const dip = push < 2 ? 0 : Bg.terrainPushDip(xc + shift + slide, top, rest);
    const x = x0 + shift + slide, g = Math.max(0.2, 1 - dip / hs);
    out[0] = x; out[1] = refY(x, d, t) - (h > 0 ? h * g : h); out[2] = g;
    return out;
  }
  const SP = [0, 0, 0];
  function massifAt(i, t, out, push) {
    const o = i * MF, d = A[o + 4], slides = A[o + 6] > 0.5, x0 = A[o], h = A[o + 1], xL = A[o + 20], xR = A[o + 22];
    const s = standAt(x0, h, A[o + 2], A[o + 3], d, slides, t, push, SP);
    const p = out || [0, 0];
    p[0] = s[0]; p[1] = s[1];
    if (xR > xL) {
      /* a point where an edge was cut: as high over the floor as the edge's
         straight line there (against the floor without the dents), within
         its slack, pressed no more than its span (GLSL mix: a * (1 - u) +
         b * u) */
      const u = (x0 - xL) / (xR - xL), dx = s[0] - x0, sl = A[o + 19];
      const off = (refY(xL + dx, d, t) - A[o + 21]) * (1 - u) + (refY(xR + dx, d, t) - A[o + 23]) * u - (refY(s[0], d, t) - h);
      const hh = h - Math.min(sl, Math.max(-sl, off));
      p[1] = refY(s[0], d, t) - hh + (1 - s[2]) * Math.min(hh, A[o + 3]);
    }
    if (push === 2) {
      /* the shard (render-webgl.js shardAt) */
      const cx = A[o + 24], ch = A[o + 25], seed = A[o + 26], lo = A[o + 27], xm = slides ? A[o + 2] : cx;
      const csx = cx + Bg.shiftX(d), csy = refY(csx, d, t) - ch, b = Bg.bloomAt(csx, csy);
      if (b > 0) {
        /* on the screen, about the centroid as placed: a similarity */
        const u = Math.max(0, Math.min(1, lo / (Bg.SHARD_PIN * Bg.S))), pin = u * u * (3 - 2 * u);
        const th = -Bg.SHARD_TURN * b * seed, cs = Math.cos(th), sn = Math.sin(th), k = 1 - Bg.SHARD_SHRINK * b;
        const rx = (p[0] - csx) * k, ry = (p[1] - csy) * k;
        const qx = csx + cs * rx - sn * ry + Bg.SHARD_DRIFT * b * (cx - xm), qy = csy + sn * rx + cs * ry - Bg.SHARD_DRIFT * b * ch;
        p[0] += (qx - p[0]) * pin; p[1] += (qy - p[1]) * pin;
      }
    }
    return p;
  }
  /* the strokes posed for the bloom as it stands, made again when it moves */
  let poseKey = '', posed = null;
  function posedStrokes() {
    const B = Bg.BLOOM, k = Bg.simNow + ',' + B.s[0].on + ',' + B.s[0].x + ',' + B.s[0].y + ',' + B.s[1].on + ',' + B.s[1].x + ',' + B.s[1].y + ',' + Bg.S;
    if (k !== poseKey || !posed) {
      if (!posed) posed = new Float32Array(Sx);
      Bg.renderers.webgl.poseStrokes(Sx, posed, true);
      poseKey = k;
    }
    return posed;
  }
  function strokeAt(i, t, out, noPush) {
    const o = i * SF, x0 = Sx[o + 12], d = Sx[o + 13];
    const x = x0 + Bg.shiftX(d), ry = refY(x, d, t), Q = noPush || !Bg.BLOOM ? Sx : posedStrokes();
    const p = out || [0, 0, 0, 0];
    p[0] = x + Q[o]; p[1] = ry + Q[o + 1]; p[2] = x + Q[o + 2]; p[3] = ry + Q[o + 3];
    return p;
  }
  /* a cloud vertex: px from its centre, the centre at rest, carried by the
     sky's own parallax (skyX's par: look.x * LOOK_X * par) and the
     horizon's tilt (tiltY) */
  function cloudAt(i, out, noBloom) {
    const o = i * CF, p = out || [0, 0];
    const cx = C[o + 2] + Bg.skyX(0, 1) * C[o + 4], cy = C[o + 3] + Bg.tiltY();
    let lx = C[o], ly = C[o + 1];
    const gx = C[o + 16], gy = C[o + 17], b = noBloom ? 0 : Bg.bloomAt(cx + gx, cy + gy);
    if (b > 0) {
      /* the shard (CLOUD_VS) */
      const th = -Bg.SHARD_TURN * b * C[o + 10], cs = Math.cos(th), sn = Math.sin(th), k = 1 - Bg.SHARD_SHRINK * b;
      const rx = (lx - gx) * k, ry = (ly - gy) * k;
      lx = gx + cs * rx - sn * ry + Bg.CLOUD_DRIFT * b * gx; ly = gy + sn * rx + cs * ry + Bg.CLOUD_DRIFT * b * gy;
    }
    p[0] = cx + lx; p[1] = cy + ly;
    return p;
  }
  function bases() {
    const seen = new Set(), massif = [], root = [];
    for (let i = 0; i < A.length / MF; i++) {
      if (A[i * MF + 1] !== 0) continue;
      const k = A[i * MF] + ',' + A[i * MF + 4] + ',' + A[i * MF + 7];
      if (!seen.has(k)) { seen.add(k); massif.push(i); }
    }
    for (let i = 0; i < Sx.length / SF; i += 6) if (Sx[i * SF] === 0 && Sx[i * SF + 1] === 0) root.push(i);
    return { massif, root };
  }
  return {
    mesh: m, massifs: A.length / MF, strokes: Sx.length / SF, clouds: C.length / CF,
    bases, cloudAt: (i, out) => cloudAt(i, out, false), cloudRest: (i, out) => cloudAt(i, out, true),
    massifAt: (i, t, out) => massifAt(i, t, out, 2),
    massifRest: (i, t, out) => massifAt(i, t, out, 0),
    massifSlid: (i, t, out) => massifAt(i, t, out, 1),
    strokeAt: (i, t, out) => strokeAt(i, t, out, false),
    strokeRest: (i, t, out) => strokeAt(i, t, out, true),
    /* the floor under screen x at depth d */
    floorAt: (x, d, t) => floorY(x, d, t),
    groundAt: (x, d, t) => refY(x, d, t),
    /* the attributes the checks read by name */
    massif: i => ({ x0: A[i * MF], h: A[i * MF + 1], xc: A[i * MF + 2], hspan: A[i * MF + 3], d: A[i * MF + 4],
                    zb: A[i * MF + 5], slides: A[i * MF + 6] > 0.5, id: A[i * MF + 7],
                    widths: [A[i * MF + 10], A[i * MF + 11], A[i * MF + 12]],
                    bary: [A[i * MF + 8], A[i * MF + 9], 1 - A[i * MF + 8] - A[i * MF + 9]], slack: A[i * MF + 19],
                    cut: A[i * MF + 22] > A[i * MF + 20], ends: [A[i * MF + 20], A[i * MF + 21], A[i * MF + 22], A[i * MF + 23]],
                    fill: [A[i * MF + 13], A[i * MF + 14], A[i * MF + 15]], ink: [A[i * MF + 16], A[i * MF + 17], A[i * MF + 18]],
                    cen: [A[i * MF + 24], A[i * MF + 25]], seed: A[i * MF + 26], lo: A[i * MF + 27] }),
    stroke: i => ({ p1: [Sx[i * SF], Sx[i * SF + 1]], p2: [Sx[i * SF + 2], Sx[i * SF + 3]], x0: Sx[i * SF + 12], d: Sx[i * SF + 13],
                    h: Sx[i * SF + 14], id: Sx[i * SF + 15], along: Sx[i * SF + 8], across: Sx[i * SF + 9] })
  };
}
/* the same, as a source string for a page (page.evaluate): defines
   window.__twin = make(window.Bg) */
const SOURCE = 'window.__sceneryTwin = (function () { const MF = ' + MF + ', SF = ' + SF + ', CF = ' + CF + ';\n' + make.toString() + '\nreturn make; })();';

module.exports = { make, SOURCE, MF, SF, CF };
