'use strict';
/* Content stamps on the site's own scripts and stylesheets:
   src="assets/js/bg/scene.js?v=<10 hex of its sha-256>".

   node _tools/stamp.js            write the stamps (run after editing any
                                   script or stylesheet, before deploying)
   node _tools/stamp.js --check    report, exit 1 if any is missing or stale
                                   (check-stamps.js runs this in run-all)

   Why: a browser keeps files it fetched and decides itself when to ask
   again - python's http.server sends no caching headers at all, and GitHub
   Pages allows 10 minutes. After a change, a reload got the new scene.js
   beside an old render-webgl.js and main.js: two versions of the
   background at once, so fixes seemed not to have happened (the owner saw
   the old jitter). With the file's own hash in its URL, a changed file is
   a new URL, so no browser can mix versions; an unchanged one keeps its
   URL and stays cached. Fonts are left alone: fonts.css names them, and
   they never change. Line endings are kept. Honours SITE_ROOT. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.resolve(__dirname, '..');
const REF = /(\b(?:src|href)=")((?:\.\.\/)*assets\/[^"?#]+\.(?:js|css))(?:\?v=([0-9a-f]+))?(")/g;

function pages() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'index.html'))) out.push('index.html');
  const blog = path.join(ROOT, 'blog');
  if (fs.existsSync(blog)) for (const f of fs.readdirSync(blog)) if (f.endsWith('.html')) out.push('blog/' + f);
  return out;
}
function stampOf(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}
/* every reference: { page, url, want, have } */
function survey() {
  const refs = [];
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const m of html.matchAll(REF)) {
      const file = path.join(ROOT, path.dirname(page), m[2]);
      refs.push({ page, url: m[2], have: m[3] || null, want: fs.existsSync(file) ? stampOf(file) : null });
    }
  }
  return refs;
}
function write() {
  let n = 0;
  for (const page of pages()) {
    const p = path.join(ROOT, page), html = fs.readFileSync(p, 'utf8');
    const out = html.replace(REF, (all, pre, url, have, post) => {
      const file = path.join(ROOT, path.dirname(page), url);
      if (!fs.existsSync(file)) return all;
      const want = stampOf(file);
      if (want !== have) n++;
      return pre + url + '?v=' + want + post;
    });
    if (out !== html) fs.writeFileSync(p, out);
  }
  return n;
}
module.exports = { survey, write, ROOT };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const refs = survey(), bad = refs.filter(r => r.want && r.have !== r.want), gone = refs.filter(r => !r.want);
    for (const r of bad) console.log('  ' + r.page + ': ' + r.url + (r.have ? ' is stamped ' + r.have + ', its content is ' + r.want : ' has no stamp'));
    for (const r of gone) console.log('  ' + r.page + ': ' + r.url + ' does not exist');
    process.exit(bad.length || gone.length ? 1 : 0);
  }
  const n = write();
  console.log('stamp: ' + n + ' reference' + (n === 1 ? '' : 's') + ' updated in ' + pages().join(', '));
}
