'use strict';
/* Every script and stylesheet the pages load carries its content's stamp
   (stamp.js: ?v=<sha-256 prefix>), so a browser can never run a new file
   beside an old cached one. Fails when a file was edited and
   `node _tools/stamp.js` was not run. Honours SITE_ROOT; SKIPs a root
   whose pages carry no stamps at all (sites from before stamps). */
const S = require('./stamp');
const refs = S.survey();
if (!refs.some(r => r.have)) {
  console.log('check-stamps: SKIP - ' + S.ROOT + ' has no stamped references (before stamp.js)');
  process.exit(0);
}
const bad = refs.filter(r => !r.want || r.have !== r.want);
if (bad.length) {
  console.log('check-stamps: FAIL - ' + bad.length + ' stale or missing stamp' + (bad.length === 1 ? '' : 's') + ', the first: '
    + bad[0].page + ' ' + bad[0].url + (bad[0].want ? (bad[0].have ? ' stamped ' + bad[0].have + ', content ' + bad[0].want : ' unstamped') : ' missing')
    + ' - run node _tools/stamp.js');
  process.exit(1);
}
console.log('check-stamps: OK - ' + refs.length + ' script and stylesheet references in ' + [...new Set(refs.map(r => r.page))].join(', ') + ' carry their content stamps');
