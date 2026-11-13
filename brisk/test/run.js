'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compile } = require('../src/compiler');
const { page, usesUi } = require('../src/page');

let count = 0;
function check(name, fn) {
  fn();
  count++;
  console.log('  pass  ' + name);
}
const js = (source) => {
  const r = compile(source);
  assert.deepStrictEqual(r.errors, [], source);
  return r.code.trim();
};
const firstError = (source) => compile(source).errors[0];

check('let and var', () => {
  assert.strictEqual(js('let a = 1'), 'const a = 1;');
  assert.strictEqual(js('var b = 2'), 'let b = 2;');
});
check('say with string interpolation', () => {
  assert.strictEqual(js('say "Hi {name}"'), 'console.log(`Hi ${name}`);');
  assert.strictEqual(js('say "cost \\{5\\} $5"'), 'console.log(`cost {5} \\$5`);');
});
check('word operators', () => {
  assert.strictEqual(js('x = a and b or not c'), 'x = a && b || ! c;');
  assert.strictEqual(js('x = a is b'), 'x = a === b;');
  assert.strictEqual(js('x = a isnt nil'), 'x = a !== null;');
  assert.strictEqual(js('x = a == b'), 'x = a === b;');
  assert.strictEqual(js('x = a != b'), 'x = a !== b;');
  assert.strictEqual(js('x = a <= b'), 'x = a <= b;');
});
check('words are left alone as property names', () => {
  assert.strictEqual(js('x = obj.is'), 'x = obj.is;');
  assert.strictEqual(js('let o = {\n  is: 1,\n  or: 2\n}'), 'const o = {\nis: 1,\nor: 2\n};');
});
check('blocks', () => {
  assert.strictEqual(js('if a\n  say 1\nelse if b\n  say 2\nelse\n  say 3\nend'),
    'if(a){\nconsole.log(1);\n}else if(b){\nconsole.log(2);\n}else{\nconsole.log(3);\n};');
  assert.strictEqual(js('fn add(a, b)\n  return a + b\nend'), 'function add(a, b){\nreturn a + b;\n};');
  assert.strictEqual(js('for i in 1..3\nend'), 'for(let i=(1);i<=(3);i++){\n};');
  assert.strictEqual(js('for x in list\nend'), 'for(const x of (list)){\n};');
  assert.strictEqual(js('while a < 3\nend'), 'while(a < 3){\n};');
});
check('comments and blank lines keep line numbers aligned', () => {
  const r = compile('# one\n\nsay 1 # two\n');
  assert.strictEqual(r.code, '\n\nconsole.log(1);\n\n');
  assert.strictEqual(r.lines, 4);
});
check('compile errors carry the line', () => {
  assert.deepStrictEqual(firstError('say 1\nend'), { line: 2, msg: 'This "end" has nothing to close' });
  assert.deepStrictEqual(firstError('if a\nsay 1'), { line: 1, msg: 'This "if" is missing its "end"' });
  assert.strictEqual(firstError('say "oops').line, 1);
  assert.strictEqual(firstError('let a = (1').msg, 'A bracket opened on this line is never closed');
});
check('compiled code runs', () => {
  const out = [];
  new Function('console', js('var t = 0\nfor i in 1..4\n  t = t + i\nend\nsay "total {t}"'))({ log: (x) => out.push(x) });
  assert.deepStrictEqual(out, ['total 10']);
});
check('apps are built into a page', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'examples', 'tip-splitter.brisk'), 'utf8');
  assert.ok(usesUi(source));
  assert.ok(!usesUi('say "build"'));
  const html = page(compile(source).code, 'Tip splitter');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('ui.title(`Tip splitter`)'));
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
});
check('the command line runs the example and its tests', () => {
  const cli = path.join(__dirname, '..', 'bin', 'brisk.js');
  const out = execFileSync('node', [cli, 'run', path.join(__dirname, '..', 'examples', 'hello.brisk')], { encoding: 'utf8' });
  assert.ok(out.includes('Hello Mick, the sum of squares is 55'));
  assert.ok(out.includes('2 passed, 0 failed'));
});
check('every example compiles', () => {
  const dir = path.join(__dirname, '..', 'examples');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.brisk'))) {
    assert.deepStrictEqual(compile(fs.readFileSync(path.join(dir, f), 'utf8')).errors, [], f);
  }
});

console.log(count + ' checks passed');
