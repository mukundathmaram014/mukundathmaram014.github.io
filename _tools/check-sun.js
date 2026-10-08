'use strict';
/* The sun's centre never sits under the card (audit G4.4; scene.js, sunAt).

   The opaque card (.shell, at most 860px wide and centred) hides the middle
   of the canvas. The sun used to sit at SUN.fx * W, which put its centre
   under the card on any window narrower than about 1130px (16% of the disc
   showing at 1024x768, none at 844x390). Now main.js measures the card on
   every size change (Bg.setCard) and the scene puts the sun in whichever
   margin is wider: the gutter beside the card, or the strip above it.

   Harness half (always runs; a .shell stub laid out like site.css): at
   widths 320-3840 and several heights, the card main.js hands the scene is
   the stub's box, and the sun's centre is outside the card at look.y -0.5,
   0 and +0.5 (it rides the horizon, check-parallax.js), on the left and,
   with SUN.fx mirrored, on the right; with no card it is at (fx * W,
   fy * H) exactly; at 1440x900 the card changes nothing.

   Browser half (headless Chrome, the real layout and its 15px scrollbar;
   SKIP when puppeteer-core or Chrome is missing): the page resized through
   the same kind of sweep, and once scrolled down - Bg.CARD is the .shell's
   box with the scroll taken out, the centre is outside the card, and the
   share of the disc on screen and clear of the card is reported.
   Exit 1 on failure. */
const H = require('./harness');
const B = require('./browser');

const fails = [];
const fail = m => fails.push(m);
const WIDTHS = [320, 360, 390, 412, 600, 640, 641, 667, 700, 768, 834, 844, 900, 908, 915, 916, 931, 960, 1024, 1100, 1180, 1280, 1366, 1440, 1920, 2560, 3840];
const HEIGHTS = [375, 600, 900, 1194, 2160];

/* the card as site.css lays it out: max-width 860, centred, body padding
   28px 24px (12px 10px at 640px and under) */
function cssCard(W) {
  const narrow = W <= 640, pad = narrow ? 10 : 24, top = narrow ? 12 : 28;
  const w = Math.min(860, W - 2 * pad), left = (W - w) / 2;
  return { left, right: left + w, top, bottom: 100000 };
}
/* is (x, y) under the card? */
const under = (c, x, y) => x >= c.left && x <= c.right && y >= c.top;
/* the share of the disc on the canvas and clear of the card (0.5px grid) */
function visible(c, W, Hh, x, y, r) {
  let tot = 0, vis = 0;
  for (let yy = y - r; yy <= y + r; yy += 0.5) for (let xx = x - r; xx <= x + r; xx += 0.5) {
    if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
    tot++;
    if (xx >= 0 && xx < W && yy >= 0 && yy < Hh && !(xx >= c.left && xx < c.right && yy >= c.top)) vis++;
  }
  return tot ? vis / tot : 0;
}

/* ---- harness half -------------------------------------------------------- */
let cases = 0, worstVis = 1, worstAt = '';
const view = { W: 1440, H: 900 };
const card = H.makeElement('div');
card.getBoundingClientRect = () => {
  const c = cssCard(view.W);
  return { x: c.left, y: c.top, left: c.left, top: c.top, right: c.right, bottom: c.bottom, width: c.right - c.left, height: c.bottom - c.top };
};
const sim = H.load({ W: 1440, H: 900, dpr: 1, now: 1200, querySelector: sel => (sel === '.shell' ? card : null) });
const P = sim.P;
const fx0 = P.SUN.fx;
for (const Hh of HEIGHTS) for (const W of WIDTHS) {
  view.W = W; view.H = Hh;
  sim.resize(W, Hh);
  sim.frame(16.7);
  const c = cssCard(W), tag = W + 'x' + Hh;
  const got = P.CARD || { on: false };
  if (!got.on || got.left !== c.left || got.right !== c.right || got.top !== c.top) {
    fail(tag + ': the scene has the card ' + JSON.stringify(got) + ', the page laid it out at ' + JSON.stringify(c));
  }
  for (const fx of [fx0, 1 - fx0]) {
    P.SUN.fx = fx;
    for (const ly of [-0.5, 0, 0.5]) {
      P.look.y = ly;
      const [x, y, r] = P.sunAt();
      cases++;
      if (under(c, x, y)) fail(tag + ' fx ' + fx + ' look.y ' + ly + ': the sun\'s centre (' + x.toFixed(1) + ', ' + y.toFixed(1) + ') is under the card');
      if (fx === fx0) {
        const v = visible(c, W, Hh, x, y, r);
        if (v < worstVis) { worstVis = v; worstAt = tag; }
      }
    }
    P.look.y = 0;
  }
  P.SUN.fx = fx0;
}
/* at 1440x900 the card changes nothing, and with no card the sun is where it always was */
view.W = 1440; view.H = 900;
sim.resize(1440, 900); sim.frame(16.7);
P.look.x = P.look.y = 0;
const at1440 = P.sunAt();
const plain = H.load({ W: 1440, H: 900, dpr: 1, now: 1200 });
plain.frame(16.7);
plain.P.look.x = plain.P.look.y = 0;
const noCard = plain.P.sunAt();
if (plain.P.CARD && plain.P.CARD.on) fail('with no .shell on the page the scene still has a card: ' + JSON.stringify(plain.P.CARD));
if (noCard[0] !== P.SUN.fx * 1440 || noCard[1] !== P.SUN.fy * 900 || noCard[2] !== P.SUN.r * 900) fail('with no card the sun is at ' + noCard + ', not (fx * W, fy * H, r * H)');
if (at1440.some((v, k) => v !== noCard[k])) fail('at 1440x900 the card moved the sun: ' + at1440 + ' against ' + noCard);
/* a card that is not a card (not finite, or no width) is no card */
if (plain.P.setCard) {
  for (const bad of [[NaN, 900, 28], [100, Infinity, 28], [100, 900, NaN], [900, 100, 28], []]) {
    plain.P.setCard(...bad);
    const sun = plain.P.sunAt();
    if (plain.P.CARD.on || sun.some(v => !Number.isFinite(v))) fail('setCard(' + bad.join(', ') + ') left the card ' + JSON.stringify(plain.P.CARD) + ' and the sun at ' + sun);
  }
}

/* ---- browser half -------------------------------------------------------- */
const BROWSER = [[3840, 2160], [2560, 1440], [1920, 1080], [1440, 900], [1366, 768], [1366, 657], [1280, 720], [1180, 820], [1100, 800],
                 [1024, 768], [960, 600], [931, 600], [930, 600], [900, 600], [834, 1194], [768, 1024], [700, 500], [641, 480], [640, 480],
                 [600, 800], [412, 915], [390, 844], [360, 640], [1080, 1920], [844, 390], [915, 412], [667, 375]];
async function browserHalf() {
  const why = B.unavailable();
  if (why) return 'browser half SKIPPED (' + why + ')';
  const site = await B.serve();
  const b = await B.launch();
  const out = [];
  try {
    const s = await b.open(site.url + 'index.html?bgq=0', { width: 1440, height: 900, dpr: 1 });
    const read = () => s.evaluate(() => {
      const c = document.querySelector('.shell').getBoundingClientRect(), k = document.getElementById('cosmos').getBoundingClientRect();
      return { cw: k.width, ch: k.height, kx: k.left, ky: k.top, L: c.left, R: c.right, T: c.top + window.scrollY, sy: window.scrollY,
               card: Object.assign({}, window.Bg.CARD), sun: window.Bg.sunAt(), ly: window.Bg.look.y, LY: window.Bg.LOOK_Y };
    });
    let worst = 1, worstTag = '';
    const rows = [];
    /* the sweep, then one more: scrolled down 300px and resized there, so
       the card's box is off its top-of-page place when it is measured */
    const steps = BROWSER.map(([w, h]) => ({ w, h, scroll: 0 })).concat([{ w: 1023, h: 768, scroll: 300 }]);
    for (const st of steps) {
      if (st.scroll) await s.evaluate(y => window.scrollTo(0, y), st.scroll);
      await s.page.setViewport({ width: st.w, height: st.h, deviceScaleFactor: 1 });
      await s.frames(4);
      const r = await read();
      const tag = st.w + 'x' + st.h + (st.scroll ? ' scrolled ' + r.sy + 'px' : '');
      if (st.scroll && !(r.sy > 0)) fail('Chrome ' + tag + ': the page did not scroll, so the scrolled case tested nothing');
      const c = { left: r.L - r.kx, right: r.R - r.kx, top: r.T - r.ky };
      if (!r.card.on || Math.abs(r.card.left - c.left) > 1e-6 || Math.abs(r.card.right - c.right) > 1e-6 || Math.abs(r.card.top - c.top) > 1e-6) {
        fail('Chrome ' + tag + ': Bg.CARD is ' + JSON.stringify(r.card) + ', the .shell (scroll taken out) is ' + JSON.stringify(c));
      }
      const [x, y0, rad] = r.sun;
      let v = 1;
      for (const ly of [-0.5, 0, 0.5]) {
        const y = y0 + (ly - r.ly) * r.LY;
        if (under(c, x, y)) fail('Chrome ' + tag + ' look.y ' + ly + ': the centre of the sun (' + x.toFixed(1) + ', ' + y.toFixed(1) + ') is under the card');
        v = Math.min(v, visible(c, r.cw, r.ch, x, y, rad));
      }
      rows.push([tag, v]);
      if (v < worst) { worst = v; worstTag = tag; }
    }
    if (s.errors.length) fail('Chrome logged ' + s.errors.length + ' error(s): ' + s.errors[0].text);
    await s.close();
    const pick = ['1440x900', '1280x720', '1024x768', '960x600', '900x600', '844x390', '390x844', '1080x1920'];
    out.push('Chrome ' + BROWSER.length + ' viewports + 1 scrolled: centre never under the card; disc showing '
             + rows.filter(([t]) => pick.includes(t)).map(([t, v]) => (100 * v).toFixed(0) + '% at ' + t).join(', ')
             + ' (least ' + (100 * worst).toFixed(0) + '% at ' + worstTag + ')');
  } finally {
    await b.close();
    await site.close();
  }
  return out.join('; ');
}

browserHalf().then(note => {
  if (fails.length) {
    console.log('check-sun: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
    for (const f of fails.slice(1, 20)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('check-sun: OK - harness: ' + WIDTHS.length * HEIGHTS.length + ' viewports x 2 gutters x 3 tilts (' + cases + ' cases), the scene gets the card'
              + ' main.js measured, the centre never under it (least of the disc showing ' + (100 * worstVis).toFixed(0) + '%, at ' + worstAt
              + '), no card = (fx * W, fy * H), 1440x900 unchanged; ' + note);
}).catch(e => { console.log('check-sun: FAIL - ' + ((e && e.stack) || e)); process.exit(1); });
