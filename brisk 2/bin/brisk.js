#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { compile } = require('../src/compiler');
const { page } = require('../src/web');
const project = require('../src/project');
const runtime = require('../src/node');

const USAGE = `Brisk

  brisk run <file.brisk>               Compile and run a script. Tests in the file run afterwards.
  brisk serve <file.brisk> [--port n]  Run an app with a backend, at http://localhost:3000
  brisk check <file.brisk>             Report mistakes without running anything
  brisk build <file.brisk> [-o out]    Write a .js file, a web page, or a folder ready to deploy
  brisk build <file.brisk> --preview   Write one web page that runs the backend code in the browser
  brisk bench <file.brisk>             Measure compile speed on this machine
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}
function option(args, flag) {
  const at = args.indexOf(flag);
  return at !== -1 && args[at + 1] ? args[at + 1] : null;
}

/* Read the program, compile it for each side it has, and stop with a list if anything is wrong. */
function prepare(file, offline) {
  if (!file) fail(USAGE);
  let loaded;
  try { loaded = project.load(file); } catch (e) { fail(e.message); }
  const kind = project.describe(loaded.files);
  const node = project.build(loaded, 'node', kind);
  const web = kind.web ? project.build(loaded, 'web', kind, offline) : null;
  if (node.errors.length) {
    for (const e of node.errors) console.error(`${e.file}:${e.line}: ${e.msg}`);
    process.exit(1);
  }
  const lines = node.units.reduce((sum, u) => sum + u.lines, 0);
  return { kind, node, web, lines, title: path.basename(file, '.brisk'), base: file.replace(/\.brisk$/, '') };
}

function html(p) {
  return page(p.web.units.map((u) => u.code), { title: p.title, remote: p.kind.server });
}

/* Brisk lines map one-to-one onto JavaScript lines, so the stack gives the Brisk line. */
function where(error, units) {
  const stack = String((error && error.stack) || '');
  for (const u of units) {
    const at = stack.indexOf(u.file + ':');
    if (at === -1) continue;
    const line = /^(\d+)/.exec(stack.slice(at + u.file.length + 1));
    if (line) return `${u.file}:${line[1]}`;
  }
  return units[units.length - 1].file;
}
function execute(units) {
  for (const u of units) {
    try { new vm.Script(u.code, { filename: u.file }).runInThisContext(); }
    catch (e) { fail(`${where(e, units)}: ${e && e.name ? e.name + ': ' + e.message : e}`); }
  }
}

async function run(file) {
  const p = prepare(file);
  if (p.kind.server) fail(`${file} has a backend. Start it with: brisk serve ${file}`);
  if (p.kind.web) {
    fs.writeFileSync(p.base + '.html', html(p));
    console.log(`${file} is an app. Wrote ${p.base}.html. Open that file in a browser to use it.`);
    return;
  }
  const tests = [];
  globalThis.test = (name, fn) => tests.push({ name, fn });
  runtime.install(p.base + '.data.json');
  execute(p.node.units);
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  pass  ${t.name}`); }
    catch (e) { failed++; console.log(`  FAIL  ${t.name}: ${e.message} (${where(e, p.node.units)})`); }
  }
  if (tests.length) console.log(`${tests.length - failed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

async function serve(file, args) {
  const p = prepare(file);
  if (!p.kind.server && !p.kind.web) fail(`${file} has no screen, server fn or route. Run it with: brisk run ${file}`);
  const port = Number(option(args, '--port') || process.env.PORT || 3000);
  const app = runtime.install(p.base + '.data.json');
  execute(p.node.units);
  try { await runtime.serve(app, p.web ? html(p) : null, port); }
  catch (e) { fail(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: brisk serve ${file} --port ${port + 1}` : e.message); }
  console.log(`${file} is running at http://localhost:${port}`);
  if (app.routes.length) console.log(`${app.routes.length} route${app.routes.length === 1 ? '' : 's'}, ${Object.keys(app.server).length} server fn`);
  console.log(`Saved data is kept in ${p.base}.data.json. Press Ctrl+C to stop.`);
}

function check(file) {
  const p = prepare(file);
  const sides = p.kind.server && p.kind.web ? 'frontend and backend' : p.kind.server ? 'backend' : p.kind.web ? 'frontend' : 'script';
  console.log(`No problems found. ${p.lines} lines, ${sides}.`);
}

function build(file, args) {
  const started = process.hrtime.bigint();
  const preview = args.includes('--preview');
  const p = prepare(file, preview);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  let out = option(args, '-o');
  if (preview) {
    if (!p.kind.web) fail(`${file} has no screen, so there is nothing to preview.`);
    out = out || p.base + '-preview.html';
    fs.writeFileSync(out, page(p.web.units.map((u) => u.code), { title: p.title, remote: false }));
    console.log(`Wrote ${out}. It needs no server: backend code runs in the browser and data is kept on the device.`);
    return;
  }
  if (p.kind.server) {
    /* a folder that runs anywhere Node does: node app.js */
    out = out || p.base + '-dist';
    fs.mkdirSync(path.join(out, 'runtime'), { recursive: true });
    for (const f of ['node.js', 'data.js']) fs.copyFileSync(path.join(__dirname, '..', 'src', f), path.join(out, 'runtime', f));
    if (p.web) fs.writeFileSync(path.join(out, 'index.html'), html(p));
    fs.writeFileSync(path.join(out, 'app.js'),
      `'use strict';\nconst fs = require('fs');\nconst path = require('path');\nconst runtime = require('./runtime/node');\n` +
      `const app = runtime.install(path.join(__dirname, 'data.json'));\n` +
      p.node.units.map((u) => `/* ${u.file} */\n${u.code}`).join('\n') +
      `\nconst page = path.join(__dirname, 'index.html');\nconst port = Number(process.env.PORT || 3000);\n` +
      `runtime.serve(app, fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : null, port).then(() => console.log('Running at http://localhost:' + port));\n`);
    fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: p.title, private: true, scripts: { start: 'node app.js' } }, null, 2) + '\n');
    console.log(`Compiled ${p.lines} lines in ${ms.toFixed(2)} ms. Wrote ${out}/. Start it with: node ${out}/app.js`);
    return;
  }
  out = out || p.base + (p.kind.web ? '.html' : '.js');
  fs.writeFileSync(out, p.kind.web ? html(p) : p.node.units.map((u) => u.code).join('\n'));
  console.log(`Compiled ${p.lines} lines in ${ms.toFixed(2)} ms. Wrote ${out}`);
}

function bench(file) {
  if (!file) fail(USAGE);
  const source = fs.readFileSync(file, 'utf8');
  const lines = compile(source).lines;
  for (let i = 0; i < 50; i++) compile(source);
  const started = process.hrtime.bigint();
  let runs = 0, seconds = 0;
  do {
    compile(source);
    runs++;
    seconds = Number(process.hrtime.bigint() - started) / 1e9;
  } while (seconds < 1);
  console.log(`${lines} lines, compiled and checked ${runs} times in ${seconds.toFixed(2)} s`);
  console.log(`${Math.round((lines * runs) / seconds).toLocaleString('en')} lines per second`);
}

const [command, file, ...args] = process.argv.slice(2);
if (command === 'run') run(file);
else if (command === 'serve') serve(file, args);
else if (command === 'check') check(file);
else if (command === 'build') build(file, args);
else if (command === 'bench') bench(file);
else {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
