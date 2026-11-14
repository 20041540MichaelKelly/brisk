'use strict';
/*
 * A Brisk program is one file plus every file it pulls in with `use "other.brisk"`.
 * Each file is compiled on its own and runs before the files that use it, so
 * line numbers in errors always belong to the file you wrote.
 */
const fs = require('fs');
const path = require('path');
const { compile } = require('./compiler');
const { usesUi } = require('./web');

/* Read the entry file and everything it uses, ordered so that each file comes after the files it uses. */
function load(entry) {
  const files = [], seen = new Set(), problems = [];
  (function visit(file, from, line) {
    const full = path.resolve(file);
    if (seen.has(full)) return;
    seen.add(full);
    let source;
    try { source = fs.readFileSync(full, 'utf8'); }
    catch (e) {
      if (!from) throw new Error('Cannot read ' + file + ': ' + e.message);
      problems.push({ file: from, line, msg: 'Cannot find "' + path.relative(path.dirname(from), full) + '" to use.' });
      return;
    }
    const shown = path.relative(process.cwd(), full) || full;
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*use\s+"([^"]+)"/.exec(lines[i]);
      if (m) visit(path.resolve(path.dirname(full), m[1]), shown, i + 1);
    }
    files.push({ file: shown, source });
  })(entry, null, 0);
  return { files, problems };
}

/* What kind of program this is, worked out from every file in it. */
function describe(files) {
  const all = files.map((f) => f.source).join('\n');
  const server = /^[ \t]*(server\s+fn\b|server[ \t]*(#.*)?$|route\s+(GET|POST|PUT|PATCH|DELETE)\s)/m.test(all);
  const screen = /^[ \t]*screen[ \t]*(#.*)?$/m.test(all);
  return { server, screen, web: screen || usesUi(all) };
}

/* Compile every file for one target. Names, data shapes and function sizes carry across files. */
function build(project, target, kind, offline) {
  const known = new Set();
  let arity = {}, fields = {};
  const units = [], errors = project.problems.slice();
  for (const f of project.files) {
    const r = compile(f.source, { target, offline, known, arity, fields, hasServer: kind.server });
    for (const e of r.errors) errors.push({ file: f.file, line: e.line, msg: e.msg });
    for (const name of r.declared) known.add(name);
    arity = r.arity; fields = r.fields;
    units.push({ file: f.file, code: r.code, lines: r.lines });
  }
  return { units, errors };
}

module.exports = { load, describe, build };
