'use strict';
/* No dead code in the background scripts (audit F46): every binding
   (function, const/let/var, parameter, destructured name) must be read
   somewhere in its scope, and every key of an object literal must be read by
   name somewhere (.key or a destructuring pattern) in any of the scripts -
   objects cross files through the scene's namespace, Bg.

   The one exception is Bg itself (scene.js's `globalThis.Bg = { ... }`): it
   is the scene's interface, and a key of it that no page script reads is
   still live when the tools read it. Such a key must be listed in
   harness.js's PROBE_NAMES, the declared test surface; anything else is
   dead. Likewise a renderer's probes (the WebGL renderer's probeWave,
   probeDepth, probeScenery and probeIds, which only the browser checks
   call) and the keys of what they and sceneryMesh return that only the
   tools read must be listed in harness.js's RENDERER_PROBES.

   What this replaced: columnMask (a function returning 1, called 2,486 times
   a frame), segments() (never called), facetFace's sideAmt / sa (never
   read), and the `det` keys on RIDGES / BANDS (never read). Dead code is a
   trap here: a maintainer edits it expecting an effect and nothing changes.

   Parses with the acorn node ships internally (jsscope.js), so this re-runs
   itself with --expose-internals. If a future node drops that module, it
   SKIPS with a notice rather than fail. Keys the platform reads (listener,
   observer and context options, WebGL's context attributes) are allowed,
   and so are the keys of the 'bgmotion' event's detail, which site.js and
   any other listener read (the motion contract: main.js). Exit 1 when
   anything is unused. */
const path = require('path');
const S = require('./jsscope');
S.reexecWithInternals(__filename);
const H = require('./harness');

const PLATFORM_KEYS = new Set(['passive', 'capture', 'once', 'signal', 'alpha', 'desynchronized',
                               'willReadFrequently', 'colorSpace',
                               'antialias', 'depth', 'stencil', 'preserveDrawingBuffer',
                               'powerPreference', 'attributes', 'attributeFilter', 'childList', 'characterData', 'subtree',
                               /* the bgmotion detail */
                               'paused', 'reason']);
const acorn = S.acorn();
if (!acorn) {
  console.log('check-deadcode: SKIP - this node (' + process.version + ') does not ship acorn internally');
  process.exit(0);
}

const { files } = H.source('background');
const probeNames = new Set(H.PROBE_NAMES), rendererProbes = new Set(H.RENDERER_PROBES || []);
const propReads = new Set(), unused = [];
let nBindings = 0;
const keys = [];
for (const f of files) {
  const ast = S.parse(acorn, f.src, f.file);
  const a = S.analyse(ast);
  const where = node => path.basename(f.file.replace(/ \(inline \w+\)$/, '')) + ':' + node.loc.start.line;
  nBindings += a.bindings.length;
  for (const b of a.bindings) if (b.reads === 0) unused.push(b.kind + ' ' + b.name + ' (' + where(b.node) + ')');
  a.propReads.forEach(k => propReads.add(k));
  const ns = S.namespaceObject(ast, 'Bg');
  for (const k of a.keys) keys.push({ name: k.name, at: where(k.node), exported: k.object === ns });
}
/* first definition of each key name, as before; a name defined in several
   object literals is judged once, and counts as exported if any is Bg's */
const byName = new Map();
for (const k of keys) {
  const seen = byName.get(k.name);
  if (!seen) byName.set(k.name, Object.assign({}, k));
  else if (k.exported) seen.exported = true;
}
let nExported = 0, nTestOnly = 0;
for (const k of byName.values()) {
  if (k.exported) nExported++;
  if (propReads.has(k.name) || PLATFORM_KEYS.has(k.name)) continue;
  if (k.exported && probeNames.has(k.name)) { nTestOnly++; continue; }
  if (!k.exported && rendererProbes.has(k.name)) { nTestOnly++; continue; }
  unused.push((k.exported ? 'Bg key ' : 'key ') + k.name + ' (' + k.at + ')'
              + (k.exported ? ': no page script reads it and it is not in harness PROBE_NAMES' : ''));
}

const which = files.length === 1 ? path.basename(files[0].file.replace(/ \(inline \w+\)$/, ''))
                                 : files.length + ' background scripts';
if (unused.length) {
  console.log('check-deadcode: FAIL - never read: ' + unused.join(', ') + ' [' + which + ']');
  process.exit(1);
}
console.log('check-deadcode: OK - all ' + nBindings + ' bindings and ' + byName.size + ' object keys in ' + which + ' are read'
            + (nExported ? ' (' + nExported + ' keys are the Bg namespace: ' + (nExported - nTestOnly + rendererProbes.size) + ' read by the page, '
                           + (nTestOnly - rendererProbes.size) + ' only by the tools, through PROBE_NAMES; and ' + rendererProbes.size
                           + ' renderer probes, through RENDERER_PROBES)' : ''));
