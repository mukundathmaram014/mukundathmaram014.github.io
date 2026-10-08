'use strict';
/* Runs every _tools/check-*.js, one after another (each may fan out to
   child processes itself), and prints one line per check plus a total.
   Exit 1 if any check fails. SITE_ROOT and GOLDEN pass through to every
   check; a check's full output is shown only when it fails.

     node _tools/run-all.js
     GOLDEN=<golden dir> node _tools/run-all.js      also compare op streams */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const checks = fs.readdirSync(dir).filter(f => /^check-.*\.js$/.test(f)).sort();
let failed = 0;
const t0 = Date.now();
console.log('run-all: ' + checks.length + ' checks against ' + require('./harness').ROOT
            + (process.env.GOLDEN ? ', GOLDEN=' + process.env.GOLDEN : ''));
for (const f of checks) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const lines = out.split(/\r?\n/);
  const summary = lines.filter(l => /^check-[\w-]+: /.test(l)).pop() || lines.pop() || '(no output)';
  const ok = r.status === 0;
  if (!ok) failed++;
  const label = !ok ? '  FAIL  ' : /^check-[\w-]+: SKIP\b/.test(summary) ? '  skip  ' : '  pass  ';
  console.log(label + f.padEnd(22) + ((Date.now() - t) / 1000).toFixed(1).padStart(6) + 's  '
              + summary.replace(/^check-[\w-]+: /, ''));
  if (!ok) for (const l of lines) if (l !== summary) console.log('          | ' + l);
}
console.log('run-all: ' + (failed ? failed + ' of ' + checks.length + ' checks FAILED' : 'all ' + checks.length + ' checks pass')
            + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(failed ? 1 : 0);
