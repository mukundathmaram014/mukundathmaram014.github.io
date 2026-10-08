'use strict';
/* README.md stays true to the files (the docs pass; audit F47, F52, F56).

   The README is this site's tuning guide, and it went stale once already:
   written for the Canvas 2D renderer, it described LIFTS, TERRAIN_RIDE,
   facetFace and columnMask for a whole rewrite after they were gone, its
   blog pipeline pointed at a <li> and a 'notes' link that did not exist, and
   the comments cited it by item number ("smoothness 15") as items came and
   went. Statically, under SITE_ROOT:

     references  a comment cites the README by a heading, quoted: README
                 "The scene clock". Every such citation, in the background
                 scripts, site.js, the CSS, the pages and _tools/*.js, must
                 name one of its ## or ### headings exactly; and none may
                 cite it by number (the word README, then smoothness or
                 item, then a number)
     paths       every path the README writes in backticks - under assets/,
                 blog/, _tools/ or the other top-level folders, or a
                 top-level file - exists, and so does every entry of its
                 file map (the indented block under "## Files"), which must
                 also list every script in assets/js/bg/; placeholders
                 (your-post-slug, <...>, a wildcard) are left alone
     tools       every _tools/*.js is named in the README (as name.js or
                 name), so a new check or probe cannot go undocumented
     endings     what its "Files" section says of line endings: the site's
                 own text files (index.html, README.md, blog/*.html and the
                 .js, .css and .html under assets/) CRLF, _tools/*.js LF, and
                 none mixing the two. The fonts' licences are their authors'
                 files, LF as they came, and are left alone. A rewrite of
                 check-scenery-settle.js came back CRLF and nothing noticed

   SKIP on a root with no README.md (_baseline). Exit 1 on failure. */
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const ROOT = H.ROOT;
/* the full guide lives in _private/ (gitignored: the repo's README.md is one line) */
const readme = path.join(ROOT, '_private', 'README.md');
if (!fs.existsSync(readme)) {
  console.log('check-docs: SKIP - no README.md under ' + ROOT);
  process.exit(0);
}
const text = fs.readFileSync(readme, 'utf8').replace(/\r\n/g, '\n');
const fails = [];
const fail = m => fails.push(m);

/* the headings */
const headings = new Set();
for (const line of text.split('\n')) {
  const m = /^#{2,3}\s+(.+?)\s*$/.exec(line);
  if (m) headings.add(m[1]);
}
if (headings.size < 10) fail('README.md has only ' + headings.size + ' ## / ### headings');

/* the files that may cite it */
const exists = p => { try { fs.statSync(p); return true; } catch (e) { return false; } };
const list = (dir, re) => (exists(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)) : []);
const sources = [
  ...list(path.join(ROOT, 'assets', 'js', 'bg'), /\.js$/),
  ...list(path.join(ROOT, 'assets', 'js'), /\.js$/),
  ...list(path.join(ROOT, 'assets', 'css'), /\.css$/),
  ...list(ROOT, /\.html$/),
  ...list(path.join(ROOT, 'blog'), /\.html$/),
  ...list(path.join(ROOT, '_tools'), /^[^.].*\.js$/).filter(f => path.basename(f) !== 'check-docs.js')
];
let refs = 0;
const cited = new Set();
const NUMBERED = new RegExp('README[,\']?s?\\s+(?:smoothness|item)\\s+\\d+', 'i');
for (const f of sources) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  /* a citation may wrap onto the next line of a comment */
  const flat = src.replace(/\r?\n\s*(?:\*\s?|\/\/\s?)?/g, ' ');
  for (const m of flat.matchAll(new RegExp(NUMBERED.source, 'gi'))) {
    fail(rel + ' cites the README by number ("' + m[0].replace(/\s+/g, ' ') + '"): cite a heading, README "<heading>"');
  }
  for (const m of flat.matchAll(/README "([^"]+)"/g)) {
    refs++;
    const h = m[1].replace(/\s+/g, ' ').trim();
    cited.add(h);
    if (!headings.has(h)) fail(rel + ' cites README "' + h + '", which is not a heading of README.md');
  }
}

/* paths in backticks */
const TOP = /^(?:\.\.\/)?((?:assets|blog|_tools|_baseline|_parked|_snapshots)(?:\/[\w.\-]+)*\/?)$/;
const FILES = new Set(['index.html', 'you.jpg', 'README.md']);
let paths = 0;
for (const m of text.matchAll(/`([^`\n]+)`/g)) {
  const span = m[1].trim();
  if (/your-post-slug|<|>|\*|\.\.\.$/.test(span)) continue;
  const t = TOP.exec(span);
  const p = t ? t[1] : FILES.has(span) ? span : null;
  if (!p) continue;
  paths++;
  if (!exists(path.join(ROOT, ...p.split('/').filter(Boolean)))) fail('README.md names `' + span + '`, which does not exist');
}

/* the file map: the indented block under "## Files" */
const at = text.indexOf('\n## Files\n');
const mapped = [];
if (at < 0) fail('README.md has no "## Files" section');
else {
  const body = text.slice(at + 10, text.indexOf('\n## ', at + 10) >>> 0);
  const stack = [];
  for (const line of body.split('\n')) {
    const m = /^( {4,})(\S+)/.exec(line);
    if (!m) continue;
    const level = (m[1].length - 4) >> 1, name = m[2];
    stack.length = level;
    const p = stack.join('') + name;
    paths++;
    mapped.push(p.replace(/\/$/, ''));
    if (!exists(path.join(ROOT, ...p.split('/').filter(Boolean)))) fail('README.md\'s file map lists ' + p + ', which does not exist');
    if (name.endsWith('/')) stack[level] = name;
    else if (name.includes('/')) stack[level] = name.slice(0, name.lastIndexOf('/') + 1);
  }
  for (const f of list(path.join(ROOT, 'assets', 'js', 'bg'), /\.js$/)) {
    const p = 'assets/js/bg/' + path.basename(f);
    if (!mapped.includes(p)) fail('README.md\'s file map does not list ' + p);
  }
}

/* every tool named */
const tools = list(path.join(ROOT, '_tools'), /^[^.].*\.js$/).map(f => path.basename(f, '.js'));
for (const t of tools) {
  if (!new RegExp('(?:^|[^\\w-])' + t.replace(/[-.]/g, '\\$&') + '(?:\\.js)?(?![\\w-])').test(text)) fail('_tools/' + t + '.js is not named in README.md');
}

/* line endings, as the Files section gives them */
const walk = d => (exists(d) ? fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const ending = f => {
  const s = fs.readFileSync(f, 'latin1'), crlf = (s.match(/\r\n/g) || []).length, lf = (s.match(/\n/g) || []).length - crlf;
  return crlf && lf ? 'mixed' : crlf ? 'CRLF' : lf ? 'LF' : 'none';
};
const own = [path.join(ROOT, 'index.html'), readme, ...list(path.join(ROOT, 'blog'), /\.html$/),
             ...walk(path.join(ROOT, 'assets')).filter(f => /\.(js|css|html)$/.test(f))].filter(exists);
let ends = 0;
for (const [files, want] of [[own, 'CRLF'], [tools.map(t => path.join(ROOT, '_tools', t + '.js')), 'LF']]) {
  for (const f of files) {
    ends++;
    const got = ending(f);
    if (got !== want && got !== 'none') fail(path.relative(ROOT, f).split(path.sep).join('/') + ' has ' + got + ' line endings, where README.md says ' + want);
  }
}

if (fails.length) {
  for (const m of fails) console.log('  ' + m);
  console.log('check-docs: FAIL - ' + fails.length + ' problem' + (fails.length === 1 ? '' : 's') + ' (above), the first: ' + fails[0]);
  process.exit(1);
}
console.log('check-docs: OK - ' + refs + ' README citations in ' + sources.length + ' files, to ' + cited.size + ' of its ' + headings.size
            + ' headings, none by number; ' + paths + ' paths it names (' + mapped.length + ' in its file map) all exist; all '
            + tools.length + ' _tools scripts named; line endings as it says, in ' + ends + ' files (' + own.length + ' CRLF, '
            + tools.length + ' LF)');
