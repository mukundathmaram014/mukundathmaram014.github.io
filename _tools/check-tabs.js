'use strict';
/* assets/js/site.js (under SITE_ROOT) in node, through the cases in
   tabtest.js: the tab controller (the 17 original cases: default tab,
   click, hash update, body data-tab, deep link, garbage hash,
   ArrowLeft/Right wrap, Home/End), the panels' tabpanel role, label and
   Tab stop, browser shortcuts left alone (Alt/Ctrl/Meta/Shift with the tab
   keys, modified and middle clicks), the motion toggle and the
   reduced-motion setting followed live, the <head> script that sets
   data-motion, and the dice: their announcements, and that the pages ship
   them hidden (the toggle too) for site.js to reveal. Prints the failing
   cases and exits 1 on any failure. */
const tabtest = require('./tabtest');

/* every case there is today: more may be added, none may go missing */
const MIN_CASES = 91;

const lines = [];
let r;
try { r = tabtest.run(l => lines.push(l)); }
catch (e) { console.log('check-tabs: FAIL - ' + e.message); process.exit(1); }
const total = r.pass + r.fail;
if (r.fail || total < MIN_CASES) {
  console.log('check-tabs: FAIL - ' + r.pass + '/' + total + ' site.js cases pass (expected all, and at least ' + MIN_CASES + ')');
  for (const l of lines) if (l.includes('FAIL')) console.log(l);
  process.exit(1);
}
console.log('check-tabs: OK - ' + r.pass + '/' + total + ' site.js cases pass ('
            + Object.entries(r.sections || {}).map(([k, n]) => k + ' ' + n).join(', ') + ')');
