'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const { compile } = require('../src/compiler');
const { page, usesUi } = require('../src/web');
const { makeData } = require('../src/data');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'bin', 'brisk.js');
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/* Compile with some names already known, so short snippets do not trip the "not defined" check. */
const KNOWN = ['a', 'b', 'c', 'x', 'y', 'obj', 'list', 'name', 'Task'];
const js = (source, opts) => {
  const r = compile(source, Object.assign({ known: KNOWN }, opts));
  assert.deepStrictEqual(r.errors, [], source);
  return r.code.replace(/\n+$/, '');
};
const errors = (source, opts) => compile(source, opts).errors;
const brisk = (...args) => execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const failing = (...args) => {
  try { brisk(...args); } catch (e) { return e.stderr; }
  throw new Error('expected the command to fail: ' + args.join(' '));
};
const request = (port, method, url, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'Content-Type': 'application/json' } }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(JSON.stringify(body));
  req.end();
});
/* Start `brisk serve` on a copy of an example, so the example folder stays clean. */
async function withServer(example, port, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brisk-'));
  fs.cpSync(path.join(root, 'examples'), dir, { recursive: true });
  const child = spawn('node', [cli, 'serve', path.join(dir, example), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => { log += d; });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (String(d).includes('running at')) resolve(); });
      child.on('exit', () => reject(new Error('serve stopped early: ' + log)));
    });
    await fn();
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

check('let and var', () => {
  assert.strictEqual(js('let total = 1'), 'const total = 1;');
  assert.strictEqual(js('var count = 2'), 'let count = 2;');
});
check('say with string interpolation', () => {
  assert.strictEqual(js('say "Hi {name}"'), 'console.log(`Hi ${name}`);');
  assert.strictEqual(js('say "cost \\{5\\} $5"'), 'console.log(`cost {5} \\$5`);');
  assert.strictEqual(js('say {\n  a: 1\n}'), 'console.log({\na: 1\n});');
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
  assert.strictEqual(js('fn add(m, n)\n  return m + n\nend'), 'function add(m, n){\nreturn m + n;\n};');
  assert.strictEqual(js('for i in 1..3\nend'), 'for(let i=(1);i<=(3);i++){\n};');
  assert.strictEqual(js('for item in list\nend'), 'for(const item of (list)){\n};');
  assert.strictEqual(js('while a < 3\nend'), 'while(a < 3){\n};');
});
check('inline functions', () => {
  assert.strictEqual(js('x = list.map(fn(n) -> n * 2)'), 'x = list.map((n)=> n * 2);');
  assert.strictEqual(js('x = fn -> a + 1'), 'x = ()=> a + 1;');
  assert.strictEqual(js('x = list.map((n) => n * 2)'), 'x = list.map((n) => n * 2);');
  assert.strictEqual(js('x = list.map(n => n * 2)'), 'x = list.map(n => n * 2);');
});
check('comments and blank lines keep line numbers aligned', () => {
  const r = compile('# one\n\nsay 1 # two\n');
  assert.strictEqual(r.code, '\n\nconsole.log(1);\n\n');
  assert.strictEqual(r.lines, 4);
});
check('structure errors carry the line', () => {
  assert.deepStrictEqual(errors('say 1\nend')[0], { line: 2, msg: 'This "end" has nothing to close' });
  assert.deepStrictEqual(errors('if true\nsay 1')[0], { line: 1, msg: 'This "if" is missing its "end"' });
  assert.strictEqual(errors('say "oops')[0].line, 1);
  assert.strictEqual(errors('let total = (1')[0].msg, 'A bracket opened on this line is never closed');
});
check('undefined names are caught, with a suggestion', () => {
  assert.deepStrictEqual(errors('let total = 1\nsay totl'), [{ line: 2, msg: '"totl" is not defined. Did you mean "total"?' }]);
  assert.deepStrictEqual(errors('say later()\nfn later()\n  return 1\nend'), []);
  assert.deepStrictEqual(errors('let o = { size: 1 }\nsay o.size, o.anything, Math.max(1, 2), "{o.size}"'), []);
  assert.strictEqual(errors('say "{missing}"')[0].msg, '"missing" is not defined.');
  assert.deepStrictEqual(errors('for i in 1..3\n  say i\nend\nlet { q, r } = { q: 1, r: 2 }\nsay q + r'), []);
});
check('calls with the wrong number of values are caught', () => {
  assert.deepStrictEqual(errors('fn add(m, n)\n  return m + n\nend\nsay add(1, 2, 3)'),
    [{ line: 4, msg: '"add" takes 2 values, but this line gives it 3.' }]);
  assert.deepStrictEqual(errors('fn add(m, n)\n  return m + n\nend\nsay add(1, [2, 3])\nsay add("a, b", add(1, 2))'), []);
  assert.strictEqual(errors('fn one(m)\n  return m\nend\none()')[0].msg, '"one" takes 1 value, but this line gives it 0.');
});
check('data blocks', () => {
  assert.strictEqual(js('data Note\n  title: text\n  stars: number\nend'), 'const Note=__data("Note",{\n"title":"text",\n"stars":"number",\n});');
  assert.strictEqual(errors('data Note\n  title: string\nend')[0].msg, 'Unknown type "string". Use text, number, yes/no, list or any.');
  assert.strictEqual(js('let data = 5\nsay data'), 'const data = 5;\nconsole.log(data);');
});
check('save, all, update and remove', () => {
  const head = 'data Note\n  title: text\nend\n';
  const body = (s) => js(head + s).split('\n').slice(3).join('\n');
  assert.strictEqual(body('save Note { title: "a" }'), '__save(Note,{ title: `a` });');
  assert.strictEqual(body('let n = save Note { title: "a{1}" }'), 'const n = __save(Note,{ title: `a${1}` });');
  assert.strictEqual(body('save Note {\n  title: "a"\n}'), '__save(Note,{\ntitle: `a`\n});');
  assert.strictEqual(body('for n in all Note\n  update n { title: "b" }\n  remove n\nend'),
    'for(const n of (__all(Note))){\n__update(n,{ title: `b` });\n__remove(n);\n};');
  assert.deepStrictEqual(errors(head + 'save Note { titel: "a" }'), [{ line: 4, msg: 'Note has no field "titel". Did you mean "title"?' }]);
  assert.strictEqual(js('let remove = 1\nlet update = 2\nsay remove + update'), 'const remove = 1;\nconst update = 2;\nconsole.log(remove + update);');
});
check('server fn and screen compile differently for each side', () => {
  const src = 'server fn add(text)\n  return text\nend\nscreen\n  ui.button("Go", fn -> add("x"))\nend';
  assert.strictEqual(compile(src, { target: 'node' }).code, '__server.add=add;function add(text){\nreturn text;\n};\n\n\n\n');
  assert.strictEqual(compile(src, { target: 'web' }).code,
    'function add(text){return __call("add",[text]);};\n\n\n__screen(function(){\nui.button(`Go`, ()=> add(`x`));\n});\n');
  assert.deepStrictEqual(compile(src, { target: 'web' }).errors, []);
  assert.strictEqual(errors(src + '\nadd()')[0].msg, '"add" takes 1 value, but this line gives it 0.');
});
check('routes exist only on the backend', () => {
  const src = 'route GET "/hi/:who"\n  return "Hi {req.params.who}"\nend';
  assert.strictEqual(compile(src, { target: 'node' }).code, '__route("GET","/hi/:who",function(req){\nreturn `Hi ${req.params.who}`;\n});\n');
  assert.strictEqual(compile(src, { target: 'web' }).code, '\n\n\n');
  assert.strictEqual(errors('route FETCH "/x"\nend')[0].msg, 'Write a route like this: route GET "/hello"');
});
check('a screen cannot change data when there is a server', () => {
  const src = 'data Note\n  title: text\nend\nserver fn add()\n  save Note { title: "ok" }\nend\nscreen\n  save Note { title: "no" }\nend';
  assert.deepStrictEqual(errors(src).map((e) => e.line), [8]);
  assert.deepStrictEqual(errors('data Note\n  title: text\nend\nscreen\n  save Note { title: "fine" }\nend'), []);
});
check('saved data checks fields and types', () => {
  let db = { next: 1, rows: {} };
  const store = makeData(() => db, (next) => { db = next; });
  const Note = store.data('Note', { title: 'text', stars: 'number', tags: 'list', open: 'yes/no' });
  const n = store.save(Note, { title: 'a' });
  assert.deepStrictEqual(n, { id: 'Note-1', title: 'a', stars: 0, tags: [], open: false });
  assert.throws(() => store.save(Note, { titel: 'a' }), /Note has no field "titel"\. Did you mean "title"\?/);
  assert.throws(() => store.save(Note, { stars: 'five' }), /Note\.stars should be a number, but got "five"\./);
  store.update(n, { stars: 5 });
  assert.strictEqual(store.all(Note)[0].stars, 5);
  store.remove(n);
  assert.deepStrictEqual(store.all(Note), []);
  assert.throws(() => store.remove(n), /There is no Note with the id Note-1/);
});
check('compiled code runs', () => {
  const out = [];
  new Function('console', js('var t = 0\nfor i in 1..4\n  t = t + i\nend\nsay "total {t}"'))({ log: (x) => out.push(x) });
  assert.deepStrictEqual(out, ['total 10']);
});
check('apps are built into a page whose scripts parse', () => {
  const source = fs.readFileSync(path.join(root, 'examples', 'tip-splitter.brisk'), 'utf8');
  assert.ok(usesUi(source) && !usesUi('say "build"'));
  const html = page([compile(source, { target: 'web' }).code], { title: 'Tip <splitter>' });
  assert.ok(html.startsWith('<!DOCTYPE html>') && html.includes('<title>Tip &lt;splitter></title>'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.strictEqual(scripts.length, 3);
  for (const m of scripts) new Function(m[1]);
});
check('the command line runs a script and its tests', () => {
  const out = brisk('run', 'examples/hello.brisk');
  assert.ok(out.includes('Hello Mick, the sum of squares is 55'));
  assert.ok(out.includes('2 passed, 0 failed'));
});
check('the command line reports mistakes as file:line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brisk-'));
  fs.writeFileSync(path.join(dir, 'lib.brisk'), 'fn double(n)\n  return n * 2\nend\n');
  fs.writeFileSync(path.join(dir, 'main.brisk'), 'use "lib.brisk"\nsay double(4)\nsay duble(4)\n');
  assert.match(failing('check', path.join(dir, 'main.brisk')), /main\.brisk:3: "duble" is not defined\. Did you mean "double"\?/);
  fs.writeFileSync(path.join(dir, 'main.brisk'), 'use "lib.brisk"\nsay double(4)\nlet o = nil\nsay o.size\n');
  assert.match(failing('run', path.join(dir, 'main.brisk')), /main\.brisk:4: TypeError/);
  fs.writeFileSync(path.join(dir, 'main.brisk'), 'use "gone.brisk"\n');
  assert.match(failing('check', path.join(dir, 'main.brisk')), /main\.brisk:1: Cannot find "gone\.brisk" to use\./);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('every example passes the checker', () => {
  for (const f of fs.readdirSync(path.join(root, 'examples')).filter((n) => n.endsWith('.brisk'))) {
    assert.match(brisk('check', path.join('examples', f)), /No problems found/, f);
  }
});
check('serve: a full-stack app answers over HTTP', async () => {
  await withServer('tasks.brisk', 39411, async () => {
    const home = await request(39411, 'GET', '/');
    assert.ok(home.type.startsWith('text/html') && home.text.includes('function addTask(text){return __call("addTask",[text]);}'));
    assert.ok(!home.text.includes('__save('), 'server code must not reach the browser');
    for (const m of home.text.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
    const added = (await request(39411, 'POST', '/__brisk/call/addTask', { args: ['Buy milk'] })).json();
    assert.deepStrictEqual(added.result, { id: 'Task-1', text: 'Buy milk', done: false });
    await request(39411, 'POST', '/__brisk/call/finish', { args: [added.result] });
    assert.deepStrictEqual((await request(39411, 'GET', '/__brisk/data')).json().rows.Task, [{ id: 'Task-1', text: 'Buy milk', done: true }]);
    const cleared = (await request(39411, 'POST', '/__brisk/call/clearDone', { args: [] })).json();
    assert.deepStrictEqual(cleared.rows.Task, []);
    const bad = (await request(39411, 'POST', '/__brisk/call/finish', { args: [added.result] })).json();
    assert.ok(!bad.ok && /There is no Task with the id Task-1/.test(bad.error));
    assert.strictEqual((await request(39411, 'POST', '/__brisk/call/nope', { args: [] })).status, 404);
  });
});
check('serve: routes, params and used files', async () => {
  await withServer('api.brisk', 39412, async () => {
    assert.strictEqual((await request(39412, 'GET', '/hello/Mick')).text, 'Hello Mick');
    const made = (await request(39412, 'POST', '/notes', { title: 'three short words' })).json();
    assert.deepStrictEqual(made, { id: 'Note-1', title: 'three short words', words: 3 });
    assert.deepStrictEqual((await request(39412, 'GET', '/notes')).json(), [made]);
    assert.strictEqual((await request(39412, 'GET', '/missing')).status, 404);
    assert.strictEqual((await request(39412, 'GET', '/')).status, 404);
  });
});
check('build: a backend app becomes a folder that runs on its own', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brisk-'));
  brisk('build', 'examples/tasks.brisk', '-o', dir);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['app.js', 'index.html', 'package.json', 'runtime']);
  const child = spawn('node', [path.join(dir, 'app.js')], { env: Object.assign({}, process.env, { PORT: '39413' }), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', resolve); child.on('exit', () => reject(new Error('built app stopped early'))); });
    const added = (await request(39413, 'POST', '/__brisk/call/addTask', { args: ['From the built app'] })).json();
    assert.strictEqual(added.result.text, 'From the built app');
    assert.ok(fs.existsSync(path.join(dir, 'data.json')));
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('server blocks, fail and preview builds', () => {
  const src = 'server\n  say "started"\nend\nserver fn risky(n)\n  fail "no {n}"\nend\nscreen\n  ui.button("Go", fn -> risky(1))\nend';
  assert.strictEqual(compile(src, { target: 'node' }).code, '{\nconsole.log(`started`);\n};\n__server.risky=risky;function risky(n){\nthrow new Error(`no ${n}`);\n};\n\n\n\n');
  assert.strictEqual(compile(src, { target: 'web' }).code.split('\n').slice(0, 4).join('|'), '|||function risky(n){return __call("risky",[n]);};');
  const preview = compile(src, { target: 'web', offline: true });
  assert.deepStrictEqual(preview.errors, []);
  assert.ok(preview.code.includes('function risky(n){\nthrow new Error(`no ${n}`);') && preview.code.includes('__screen(function(){'));
  assert.strictEqual(js('let fail = 1\nsay fail'), 'const fail = 1;\nconsole.log(fail);');
});
check('showcase: checks, tests and preview build', () => {
  assert.match(brisk('check', 'examples/showcase/board.brisk'), /No problems found\. \d+ lines, frontend and backend\./);
  assert.ok(brisk('run', 'examples/showcase/stats.test.brisk').includes('3 passed, 0 failed'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brisk-'));
  const out = path.join(dir, 'p.html');
  brisk('build', 'examples/showcase/board.brisk', '--preview', '-o', out);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('function addIdea(title){') && !html.includes('__call("addIdea"'));
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('showcase: served with a backend', async () => {
  await withServer('showcase/board.brisk', 39414, async () => {
    const call = async (name, ...args) => (await request(39414, 'POST', '/__brisk/call/' + name, { args })).json();
    const start = (await request(39414, 'GET', '/api/stats')).json();
    assert.deepStrictEqual(start, { ideas: 4, votes: 11, shipped: 0 });
    assert.strictEqual((await call('addIdea', 'abc')).error, 'An idea needs at least 4 letters');
    assert.strictEqual((await call('addIdea', 'user accounts')).error, 'That idea is already on the board');
    const made = await call('addIdea', '  Dark mode  ');
    assert.deepStrictEqual(made.result, { id: 'Idea-5', title: 'Dark mode', votes: 1, shipped: false });
    for (let i = 0; i < 6; i++) await call('vote', Object.assign({}, made.result, { votes: 1 + i }));
    const ranked = (await request(39414, 'GET', '/api/ideas')).json();
    assert.deepStrictEqual([ranked[0].title, ranked[0].votes], ['Dark mode', 7]);
    await call('ship', ranked[0]);
    assert.strictEqual((await call('clearShipped')).rows.Idea.length, 4);
    const home = (await request(39414, 'GET', '/')).text;
    assert.ok(home.includes('__call("addIdea"') && !home.includes('already on the board'), 'backend code and messages stay on the server');
  });
});

(async () => {
  let failed = 0;
  for (const c of checks) {
    try { await c.fn(); console.log('  pass  ' + c.name); }
    catch (e) { failed++; console.log('  FAIL  ' + c.name + '\n' + String(e && e.stack || e).split('\n').slice(0, 12).join('\n')); }
  }
  console.log((checks.length - failed) + ' of ' + checks.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})();
