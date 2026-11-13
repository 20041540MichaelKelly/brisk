#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { compile } = require('../src/compiler');
const { page, usesUi } = require('../src/page');

const USAGE = `Brisk

  brisk run <file.brisk>              Compile and run. Tests in the file run afterwards.
  brisk build <file.brisk> [-o out]   Write the JavaScript (or a web page, for apps that use ui.)
  brisk bench <file.brisk>            Measure compile speed on this machine
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function load(file) {
  if (!file) fail(USAGE);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`Cannot read ${file}: ${e.message}`);
  }
  const started = process.hrtime.bigint();
  const result = compile(source);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.errors.length) {
    for (const e of result.errors) console.error(`${file}:${e.line}: ${e.msg}`);
    process.exit(1);
  }
  return { source, result, ms };
}

function outPath(file, ext, args) {
  const flag = args.indexOf('-o');
  if (flag !== -1 && args[flag + 1]) return args[flag + 1];
  return file.replace(/\.brisk$/, '') + ext;
}

/* Brisk lines map one-to-one onto JavaScript lines, so the stack gives the Brisk line. */
function where(error, file) {
  const stack = String((error && error.stack) || '');
  const at = stack.indexOf(file + ':');
  if (at === -1) return file;
  const line = /^(\d+)/.exec(stack.slice(at + file.length + 1));
  return line ? `${file}:${line[1]}` : file;
}

async function run(file) {
  const { source, result } = load(file);
  if (usesUi(source)) {
    const out = outPath(file, '.html', []);
    fs.writeFileSync(out, page(result.code, path.basename(file, '.brisk')));
    console.log(`${file} is an app. Wrote ${out}. Open that file in a browser to use it.`);
    return;
  }
  const tests = [];
  globalThis.test = (name, fn) => tests.push({ name, fn });
  try {
    new vm.Script(result.code, { filename: file }).runInThisContext();
  } catch (e) {
    fail(`${where(e, file)}: ${e && e.name ? e.name + ': ' + e.message : e}`);
  }
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  pass  ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${t.name}: ${e.message} (${where(e, file)})`);
    }
  }
  if (tests.length) console.log(`${tests.length - failed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

function build(file, args) {
  const { source, result, ms } = load(file);
  const app = usesUi(source);
  const out = outPath(file, app ? '.html' : '.js', args);
  fs.writeFileSync(out, app ? page(result.code, path.basename(file, '.brisk')) : result.code);
  console.log(`Compiled ${result.lines} lines in ${ms.toFixed(2)} ms. Wrote ${out}`);
}

function bench(file) {
  const { source, result } = load(file);
  for (let i = 0; i < 50; i++) compile(source);
  const started = process.hrtime.bigint();
  let runs = 0;
  let seconds = 0;
  do {
    compile(source);
    runs++;
    seconds = Number(process.hrtime.bigint() - started) / 1e9;
  } while (seconds < 1);
  const rate = Math.round((result.lines * runs) / seconds);
  console.log(`${result.lines} lines, compiled ${runs} times in ${seconds.toFixed(2)} s`);
  console.log(`${rate.toLocaleString('en')} lines per second`);
}

const [command, file, ...args] = process.argv.slice(2);
if (command === 'run') run(file);
else if (command === 'build') build(file, args);
else if (command === 'bench') bench(file);
else {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
