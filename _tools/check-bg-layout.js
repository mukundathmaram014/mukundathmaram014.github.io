'use strict';
/* The background is a set of classic scripts in assets/js/bg/ that share
   nothing but window.Bg: scene.js (the scene, which publishes Bg), the
   renderers (render-*.js) and main.js (the bootstrap and the loop).

   index.html must load every file in assets/js/bg/ exactly once, as a plain
   synchronous classic <script src> (no async, defer, nomodule or
   type=module: the scripts run in order, and main.js looks #cosmos up the
   moment it runs), after the #cosmos canvas, with scene.js first and
   main.js last. Nothing may still refer to the pre-split
   assets/js/background.js, and that file must not exist, where it could be
   edited by mistake to no effect.

   No script may declare anything at its top level (var, let, const,
   function, class) or assign an undeclared global: each keeps its code in
   an IIFE and crosses files only through Bg. In a browser a top-level
   declaration in one classic script is visible to every later one, but the
   harness runs each file inside a function of its own (harness.js, the Math
   parameter), so a name shared that way would work on the page and fail
   every check - or, declared in two files, throw on the page and pass every
   check.

   SKIP for a pre-split SITE_ROOT (no assets/js/bg/). Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const S = require('./jsscope');
S.reexecWithInternals(__filename);
const H = require('./harness');

const dir = path.join(H.ROOT, 'assets', 'js', 'bg');
if (!fs.existsSync(dir)) {
  console.log('check-bg-layout: SKIP - no assets/js/bg/ under ' + H.ROOT + ' (a pre-split layout)');
  process.exit(0);
}
const fails = [];
const onDisk = fs.readdirSync(dir).filter(f => /\.js$/.test(f)).sort();
const html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');

/* every <script> tag, with its attributes and where it sits */
const tags = [];
const re = /<script\b([^>]*)>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1];
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
  tags.push({ at: m.index, attrs, src: src ? src[1].replace(/^\.\//, '').replace(/\?v=[0-9a-f]+$/, '') : null });
}
const bg = tags.filter(t => t.src && /^assets\/js\/bg\//.test(t.src));
const names = bg.map(t => t.src.slice('assets/js/bg/'.length));
const canvasAt = html.search(/<canvas\b[^>]*\bid\s*=\s*["']cosmos["']/i);
if (canvasAt < 0) fails.push('index.html has no <canvas id="cosmos">');

for (const f of onDisk) {
  const n = names.filter(x => x === f).length;
  if (n !== 1) fails.push('assets/js/bg/' + f + ' is loaded ' + n + 'x by index.html (need exactly 1)');
}
for (const n of names) if (!onDisk.includes(n)) fails.push('index.html loads assets/js/bg/' + n + ', which does not exist');
if (names[0] !== 'scene.js') fails.push('the first background script is ' + (names[0] || 'missing') + ', not scene.js (it publishes Bg)');
if (names[names.length - 1] !== 'main.js') fails.push('the last background script is ' + (names[names.length - 1] || 'missing') + ', not main.js (it starts the loop)');
for (const t of bg) {
  if (/\b(async|defer|nomodule)\b/i.test(t.attrs)) fails.push(t.src + ' is not a plain synchronous script: <script' + t.attrs + '>');
  const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(t.attrs);
  if (type && !/^(text\/javascript|application\/javascript)?$/i.test(type[1].trim())) fails.push(t.src + ' has type="' + type[1] + '": it must be a classic script');
  if (canvasAt >= 0 && t.at < canvasAt) fails.push(t.src + ' loads before the #cosmos canvas exists');
}
if (/background\.js/.test(html)) fails.push('index.html still refers to background.js');
if (fs.existsSync(path.join(H.ROOT, 'assets', 'js', 'background.js'))) fails.push('assets/js/background.js still exists; the background lives in assets/js/bg/');

/* top level: nothing but IIFE calls (and comments) */
let topLevel = 0;
const acorn = S.acorn();
if (!acorn) fails.push('cannot check top-level declarations: this node (' + process.version + ') does not ship acorn internally');
else {
  for (const f of onDisk) {
    const file = path.join(dir, f);
    const ast = S.parse(acorn, fs.readFileSync(file, 'utf8'), file);
    for (const st of ast.body) {
      topLevel++;
      if (/Declaration$/.test(st.type)) {
        const what = st.type === 'VariableDeclaration' ? st.kind + ' ' + st.declarations.map(d => d.id.name || '(pattern)').join(', ')
                   : (st.type === 'FunctionDeclaration' ? 'function ' : 'class ') + (st.id ? st.id.name : '');
        fails.push(f + ':' + st.loc.start.line + ' declares ' + what + ' at top level; keep it inside the IIFE and share it through Bg');
      }
    }
    for (const g of S.analyse(ast).globals) {
      if (g.write) fails.push(f + ':' + g.node.loc.start.line + ' assigns the undeclared global ' + g.name + '; share it through Bg');
    }
  }
}

if (fails.length) {
  console.log('check-bg-layout: FAIL - ' + fails[0] + (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more)' : ''));
  for (const f of fails.slice(1)) console.log('  ' + f);
  process.exit(1);
}
console.log('check-bg-layout: OK - index.html loads the ' + names.length + ' scripts in assets/js/bg/ (' + names.join(', ')
            + ') once each, in that order, as plain synchronous scripts after #cosmos; nothing declared at top level ('
            + topLevel + ' top-level statements in all); background.js is gone');
