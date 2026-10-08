'use strict';
/* Static analysis shared by the checks that read the background's source
   (check-deadcode.js, check-bg-layout.js, check-scene-headless.js).

   The parser is acorn, which node ships internally but only exposes with
   --expose-internals. A check calls reexecWithInternals(__filename) first:
   without the flag it re-runs the check with it and exits with its status.
   acorn() then returns the parser, or null if this node no longer ships it
   (the check should SKIP rather than fail).

   analyse(ast) walks one script's scopes the way the language does
   (functions and vars hoist; let, const and classes are block scoped;
   parameters, catch clauses and loop heads get their own scopes) and
   returns:
     bindings    every declared name: { name, node, kind, reads }; a plain
                 `x = ...` is a write, every other use a read
     globals     every reference that resolves to no declaration in the
                 script: { name, node, write }
     propReads   every property name read by name: .key, a literal
                 ['key'], or a destructuring pattern
     keys        every key of every object literal: { name, node, object } */
const { spawnSync } = require('child_process');

function reexecWithInternals(file) {
  if (process.execArgv.includes('--expose-internals')) return;
  const r = spawnSync(process.execPath, ['--expose-internals', file].concat(process.argv.slice(2)),
                      { env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  process.exit(r.status === null ? 1 : r.status);
}
function acorn() {
  try { return require('internal/deps/acorn/acorn/dist/acorn'); }
  catch (e) { return null; }
}
function parse(parser, src, file) {
  try { return parser.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
  catch (e) { e.message = file + ': ' + e.message; throw e; }
}

class Scope {
  constructor(parent, isFn) { this.parent = parent; this.isFn = isFn; this.vars = new Map(); }
  fnScope() { let s = this; while (!s.isFn) s = s.parent; return s; }
  declare(name, node, kind) { if (!this.vars.has(name)) this.vars.set(name, { name, node, kind, reads: 0 }); }
  lookup(name) { for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name); return null; }
}
const SKIP = new Set(['type', 'loc', 'start', 'end']);
const kids = node => Object.keys(node).filter(k => !SKIP.has(k)).map(k => [k, node[k]]);
function names(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p);
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => names(e, out));
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => names(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'AssignmentPattern') names(p.left, out);
  else if (p.type === 'RestElement') names(p.argument, out);
  return out;
}

function analyse(ast) {
  /* pass 1: scopes and declarations (function declarations and vars hoist) */
  const scopeOf = new Map(), bindings = [];
  function declare(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    if (/Function/.test(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) scope.declare(node.id.name, node.id, 'function');
      const fs = new Scope(scope, true);
      scopeOf.set(node, fs);
      if (node.type === 'FunctionExpression' && node.id) fs.declare(node.id.name, node.id, 'function');
      node.params.forEach(p => names(p, []).forEach(id => fs.declare(id.name, id, 'param')));
      if (node.body.type === 'BlockStatement') { scopeOf.set(node.body, fs); node.body.body.forEach(s => declare(s, fs)); }
      else declare(node.body, fs);
      node.params.forEach(p => declare(p, fs));
      return;
    }
    let inner = scope;
    if (/^(BlockStatement|ForStatement|ForOfStatement|ForInStatement|CatchClause)$/.test(node.type)) {
      inner = new Scope(scope, false);
      scopeOf.set(node, inner);
      if (node.type === 'CatchClause' && node.param) names(node.param, []).forEach(id => inner.declare(id.name, id, 'catch'));
    }
    if (node.type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? scope.fnScope() : scope;
      node.declarations.forEach(d => names(d.id, []).forEach(id => target.declare(id.name, id, node.kind)));
    }
    if (node.type === 'ClassDeclaration' && node.id) scope.declare(node.id.name, node.id, 'class');
    for (const [, v] of kids(node)) {
      if (Array.isArray(v)) v.forEach(c => declare(c, inner));
      else if (v && typeof v.type === 'string') declare(v, inner);
    }
  }
  const top = new Scope(null, true);
  scopeOf.set(ast, top);
  ast.body.forEach(s => declare(s, top));
  const declIds = new Set();
  for (const s of new Set(scopeOf.values())) for (const v of s.vars.values()) { declIds.add(v.node); bindings.push(v); }

  /* pass 2: references and property reads */
  const propReads = new Set(), globals = [];
  function refs(node, scope, parent, key) {
    if (!node || typeof node.type !== 'string') return;
    const sc = scopeOf.get(node) || scope;
    if (node.type === 'Identifier') {
      if (declIds.has(node)) return;
      if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
      if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return;
      if (/^(LabeledStatement|BreakStatement|ContinueStatement)$/.test(parent.type)) return;
      const write = parent.type === 'AssignmentExpression' && key === 'left' && parent.operator === '=';
      const b = sc.lookup(node.name);
      if (b) { if (!write) b.reads++; }
      else globals.push({ name: node.name, node, write });
      return;
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') propReads.add(node.property.name);
    if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal') propReads.add(String(node.property.value));
    if (node.type === 'ObjectPattern') node.properties.forEach(p => { if (p.key && p.key.type === 'Identifier') propReads.add(p.key.name); });
    for (const [k, v] of kids(node)) {
      if (Array.isArray(v)) v.forEach(c => refs(c, sc, node, k));
      else if (v && typeof v.type === 'string') refs(v, sc, node, k);
    }
  }
  ast.body.forEach(s => refs(s, top, ast, 'body'));

  /* object-literal keys (plain `key: value` and shorthand; not getters) */
  const keys = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ObjectExpression') {
      for (const p of node.properties) {
        if (p.type === 'Property' && p.kind === 'init' && !p.computed && p.key.type === 'Identifier') keys.push({ name: p.key.name, node: p, object: node });
      }
    }
    for (const [, v] of kids(node)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  })(ast);
  return { bindings, globals, propReads, keys };
}

/* The object literal a script publishes as its namespace (`globalThis.Bg =
   { ... }` or `window.Bg = { ... }`), or null. */
function namespaceObject(ast, name) {
  let found = null;
  (function walk(node) {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.right.type === 'ObjectExpression'
        && node.left.type === 'MemberExpression' && !node.left.computed && node.left.property.name === name
        && node.left.object.type === 'Identifier' && /^(globalThis|window|self)$/.test(node.left.object.name)) {
      found = node.right;
      return;
    }
    for (const [, v] of kids(node)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  })(ast);
  return found;
}

module.exports = { reexecWithInternals, acorn, parse, analyse, namespaceObject };
