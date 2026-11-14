'use strict';
/*
 * Brisk compiler: one pass over the source, straight to JavaScript.
 *
 * Every Brisk line becomes exactly one JavaScript line, so error line numbers match.
 * The same source compiles for two targets:
 *   node  the backend. `screen` blocks are left out.
 *   web   the frontend. Bodies of `server fn`, `server` and `route` are left out, and each
 *         server fn becomes a stub that calls the backend.
 *         With offline: true the backend code is kept, for a preview that needs no server.
 *
 * compile(source, { target, offline, known, arity, fields, hasServer })
 *   -> { code, errors, lines, uses, declared, arity, fields, server, data, routes, screen }
 */

const GLOBALS = new Set((
  'Math Number String Boolean Array Object JSON Date Promise Map Set RegExp Error Symbol BigInt Infinity NaN ' +
  'parseInt parseFloat isNaN isFinite console setTimeout setInterval clearTimeout clearInterval fetch globalThis ' +
  'document window localStorage navigator location requestAnimationFrame ' +
  'require process module exports Buffer __dirname __filename ' +
  'ui test ' +
  'new typeof instanceof in of return if else for while do function const let var true false null undefined this ' +
  'async await try catch finally throw class extends super delete void yield switch case default break continue static'
).split(' '));
const TYPES = new Set(['text', 'number', 'yes/no', 'list', 'any']);

/* Shared scanner state. The compiler is not re-entrant, which keeps the hot loop free of allocation. */
let P = 0, ERR = '', DEPTH = 0, LINE = 0, LSTART = 0;
let DECL = null, MISS = null, CALLS = null, WROTE = false;

function isWord(k) { return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95 || k === 36; }
function isStart(k) { return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || k === 95 || k === 36; }
function declareList(text) {
  const names = text.match(/[A-Za-z_$][\w$]*/g);
  if (names) for (const n of names) DECL.add(n);
}
function blank(s, i, n) {
  let c;
  while (i < n) {
    c = s.charCodeAt(i);
    if (c === 35) return true;
    if (c !== 32 && c !== 9 && c !== 13) return false;
    i++;
  }
  return true;
}

/* Count the values in a call. s[i] is the opening bracket. Returns -1 when it cannot tell. */
function countArgs(s, i, n) {
  let depth = 0, commas = 0, any = false, c, q;
  for (; i < n; i++) {
    c = s.charCodeAt(i);
    if (c === 34 || c === 39 || c === 96) {
      q = c; i++;
      while (i < n && s.charCodeAt(i) !== q) { if (s.charCodeAt(i) === 92) i++; i++; }
      any = true; continue;
    }
    if (c === 35) return -1;
    if (c === 40 || c === 91 || c === 123) { depth++; if (depth > 1) any = true; continue; }
    if (c === 41 || c === 93 || c === 125) { depth--; if (depth === 0) return any ? commas + 1 : 0; continue; }
    if (c === 44 && depth === 1) { commas++; continue; }
    if (c === 46 && s.charCodeAt(i + 1) === 46 && s.charCodeAt(i + 2) === 46) return -1;
    if (c !== 32 && c !== 9) any = true;
  }
  return -1;
}

/* "text {expr}" -> `text ${expr}`. s[i] is the opening quote. Sets P after the closing quote. */
function str(s, i, n) {
  let o = '`', from = ++i, c, d, j, depth;
  while (i < n) {
    c = s.charCodeAt(i);
    if (c === 34) { P = i + 1; return o + s.slice(from, i) + '`'; }
    if (c === 92) {
      d = s.charCodeAt(i + 1);
      if (d === 123 || d === 125) { o += s.slice(from, i) + s.charAt(i + 1); i += 2; from = i; } else i += 2;
      continue;
    }
    if (c === 96 || c === 36) { o += s.slice(from, i) + '\\' + s.charAt(i); i++; from = i; continue; }
    if (c === 123) {
      depth = 1; j = i + 1;
      while (j < n && depth) { d = s.charCodeAt(j); if (d === 123) depth++; else if (d === 125) depth--; j++; }
      if (depth) { ERR = 'This string has a { without a matching }'; P = n; return o + '`'; }
      o += s.slice(from, i) + '${' + expr(s, i + 1, j - 1) + '}'; i = j; from = i; continue;
    }
    i++;
  }
  ERR = 'This string is missing its closing quote'; P = n; return o + s.slice(from, n) + '`';
}

/*
 * Translate s[i..n) in place: and/or/not/is/isnt/nil, == and !=, strings, `all Thing`, `fn(x) -> ...`.
 * Notes every name it does not know yet and every call, for the checks at the end.
 * Stops at a # comment and trims both ends.
 */
function expr(s, i, n) {
  let o = '', c, j, k, w, r, from, p, q, d, depth, a, b;
  while (i < n && ((c = s.charCodeAt(i)) === 32 || c === 9)) i++;
  from = i;
  while (i < n) {
    c = s.charCodeAt(i);
    if (c === 32) { i++; continue; }
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36) {
      j = i + 1; while (j < n && isWord(s.charCodeAt(j))) j++;
      if (i > LSTART && s.charCodeAt(i - 1) === 46) { i = j; continue; }            /* a property */
      p = j; while (p < n && s.charCodeAt(p) === 32) p++;
      d = p < n ? s.charCodeAt(p) : 0;
      if (d === 58) { i = j; continue; }                                             /* a key in { key: value } */
      k = j - i;
      w = s.slice(i, j);
      if (k < 5 && k > 1) {
        r = '';
        switch (w) {
          case 'and': r = '&&'; break;
          case 'or': r = '||'; break;
          case 'not': r = '!'; break;
          case 'is': r = '==='; break;
          case 'isnt': r = '!=='; break;
          case 'nil': r = 'null'; break;
          case 'all':
            if (p > j && d >= 65 && d <= 90) {
              q = p + 1; while (q < n && isWord(s.charCodeAt(q))) q++;
              w = s.slice(p, q);
              if (!DECL.has(w) && !GLOBALS.has(w)) MISS.push(w, LINE);
              o += s.slice(from, i) + '__all(' + w + ')'; i = from = q; continue;
            }
            break;
          case 'save':
            /* save Thing { ... } used as a value, with the whole { } on this line */
            if (p > j && d >= 65 && d <= 90) {
              q = p + 1; while (q < n && isWord(s.charCodeAt(q))) q++;
              a = q; while (a < n && s.charCodeAt(a) === 32) a++;
              if (s.charCodeAt(a) === 123 && a < n) {
                depth = 0; b = a;
                for (; b < n; b++) {
                  k = s.charCodeAt(b);
                  if (k === 34 || k === 39) { r = k; b++; while (b < n && s.charCodeAt(b) !== r) { if (s.charCodeAt(b) === 92) b++; b++; } }
                  else if (k === 123) depth++;
                  else if (k === 125 && --depth === 0) break;
                }
                r = '';
                if (b < n) {
                  w = s.slice(p, q);
                  if (!DECL.has(w) && !GLOBALS.has(w)) MISS.push(w, LINE);
                  o += s.slice(from, i) + '__save(' + w + ',' + expr(s, a, b + 1) + ')';
                  i = from = b + 1; WROTE = true; continue;
                }
              }
            }
            break;
          case 'fn':
            q = p; w = '';
            if (d === 40) {
              depth = 1; q = p + 1;
              while (q < n && depth) { k = s.charCodeAt(q); if (k === 40) depth++; else if (k === 41) depth--; q++; }
              if (depth) { w = 'fn'; break; }
              w = s.slice(p + 1, q - 1);
              while (q < n && s.charCodeAt(q) === 32) q++;
            }
            if (q + 1 < n && s.charCodeAt(q) === 45 && s.charCodeAt(q + 1) === 62) {
              declareList(w);
              o += s.slice(from, i) + '(' + w + ')=>'; i = from = q + 2; continue;
            }
            w = 'fn';
            break;
        }
        if (r) { o += s.slice(from, i) + r; from = j; i = j; continue; }
      }
      if (!DECL.has(w) && !GLOBALS.has(w)) MISS.push(w, LINE);
      if (d === 40 && p === j) { k = countArgs(s, j, n); if (k >= 0) CALLS.push(w, k, LINE); }
      i = j; continue;
    }
    if (c === 34) { o += s.slice(from, i) + str(s, i, n); i = from = P; continue; }
    if (c === 35) break;
    if (c === 40 || c === 91 || c === 123) { DEPTH++; i++; continue; }
    if (c === 41 || c === 93 || c === 125) { DEPTH--; i++; continue; }
    if (c === 61 && s.charCodeAt(i + 1) === 62 && i + 1 < n) {
      /* a JavaScript arrow function: learn its parameter names */
      p = i - 1; while (p >= LSTART && s.charCodeAt(p) === 32) p--;
      if (p >= LSTART && s.charCodeAt(p) === 41) {
        depth = 0; q = p;
        while (q >= LSTART) { k = s.charCodeAt(q); if (k === 41) depth++; else if (k === 40) { depth--; if (!depth) break; } q--; }
        if (q >= LSTART) declareList(s.slice(q + 1, p));
      } else {
        q = p; while (q >= LSTART && isWord(s.charCodeAt(q))) q--;
        if (q < p) DECL.add(s.slice(q + 1, p + 1));
      }
      i += 2; continue;
    }
    if ((c === 61 || c === 33) && s.charCodeAt(i + 1) === 61 && i + 1 < n) {
      if (s.charCodeAt(i + 2) === 61 && i + 2 < n) { i += 3; continue; }
      k = i > 0 ? s.charCodeAt(i - 1) : 0;
      if (c === 61 && (k === 60 || k === 62)) { i += 2; continue; }
      o += s.slice(from, i) + (c === 61 ? '===' : '!=='); i += 2; from = i; continue;
    }
    if (c >= 48 && c <= 57) {
      j = i + 1;
      while (j < n) { k = s.charCodeAt(j); if (isWord(k) || (k === 46 && s.charCodeAt(j + 1) !== 46)) j++; else break; }
      i = j; continue;
    }
    if (c === 39) {
      j = i + 1;
      while (j < n) { k = s.charCodeAt(j); if (k === 92) j += 2; else if (k === 39) break; else j++; }
      if (j >= n) { ERR = 'This string is missing its closing quote'; i = n; break; }
      i = j + 1; continue;
    }
    i++;
  }
  while (i > from && ((c = s.charCodeAt(i - 1)) === 32 || c === 9 || c === 13)) i--;
  return o + s.slice(from, i);
}

/* The keys of a one-line { key: value } literal, top level only. */
function topKeys(t) {
  const keys = [];
  let depth = 0, want = false, c, q, j;
  for (let i = 0; i < t.length; i++) {
    c = t.charCodeAt(i);
    if (c === 34 || c === 39 || c === 96) {
      q = c; i++;
      while (i < t.length && t.charCodeAt(i) !== q) { if (t.charCodeAt(i) === 92) i++; i++; }
      want = false; continue;
    }
    if (c === 123 || c === 91 || c === 40) { depth++; want = depth === 1 && c === 123; continue; }
    if (c === 125 || c === 93 || c === 41) { depth--; continue; }
    if (c === 44 && depth === 1) { want = true; continue; }
    if (want && c !== 32) {
      if (isStart(c)) { j = i; while (j < t.length && isWord(t.charCodeAt(j))) j++; keys.push(t.slice(i, j)); i = j - 1; }
      want = false;
    }
  }
  return keys;
}

function distance(a, b) {
  const row = [];
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}
function hint(word, candidates) {
  let best = '', bestD = 3;
  for (const c of candidates) {
    if (c === word || Math.abs(c.length - word.length) > 2) continue;
    const d = distance(word.toLowerCase(), c.toLowerCase());
    if (d < bestD && d < Math.max(word.length, 2)) { bestD = d; best = c; }
  }
  return best ? ' Did you mean "' + best + '"?' : '';
}

function compile(src, opts) {
  opts = opts || {};
  const web = opts.target === 'web';
  const offline = web && !!opts.offline;   /* a preview build: backend code runs in the browser */
  const own = [];
  const arity = Object.assign(Object.create(null), opts.arity);
  const fields = Object.assign(Object.create(null), opts.fields);
  const info = { uses: [], server: [], data: [], routes: 0, screen: false };
  const screenWrites = [];
  const stack = [], errs = [];
  const n = src.length;
  let out = '', pos = 0, ln = 0, openLine = 0, mute = -1, tail = '', curData = '';
  let eol, i, j, c, wl, t, o, m, name, ex, a, kind, last, cont, emit, p, q, text;

  DECL = new Set();
  if (opts.known) for (const k of opts.known) DECL.add(k);
  MISS = []; CALLS = []; DEPTH = 0; WROTE = false;
  const declare = (id) => { DECL.add(id); own.push(id); };
  const inside = (what) => { for (let k = 0; k < stack.length; k += 2) if (stack[k] === what) return true; return false; };
  const noteWrite = () => { if (inside('screen')) screenWrites.push(ln); };
  const close = () => {
    kind = stack[stack.length - 2]; stack.length -= 2;
    o = (kind === 'test' || kind === 'data' || kind === 'route' || kind === 'screen') ? '});' : '}';
    if (stack.length === mute) { mute = -1; o = ''; }
  };

  while (pos <= n) {
    eol = src.indexOf('\n', pos); if (eol === -1) eol = n;
    ln++; LINE = ln; LSTART = pos; i = pos; pos = eol + 1; c = 0;
    while (i < eol && ((c = src.charCodeAt(i)) === 32 || c === 9)) i++;
    if (i >= eol || c === 35 || c === 13) { out += '\n'; continue; }
    ERR = ''; o = null; cont = DEPTH > 0; emit = false;

    if (!cont && stack.length && stack[stack.length - 2] === 'data') {
      /* inside a data block every line is a field, until end */
      j = i; while (j < eol && isWord(src.charCodeAt(j))) j++;
      if (j - i === 3 && src.startsWith('end', i) && blank(src, j, eol)) close();
      else {
        m = /^([A-Za-z_]\w*)\s*:\s*([a-z/]+)\s*(?:#.*)?$/.exec(src.slice(i, eol).trim());
        if (!m) { ERR = 'Write a field like this: title: text'; o = ''; }
        else if (!TYPES.has(m[2])) { ERR = 'Unknown type "' + m[2] + '". Use text, number, yes/no, list or any.'; o = ''; }
        else { fields[curData].push(m[1]); o = JSON.stringify(m[1]) + ':' + JSON.stringify(m[2]) + ','; }
      }
    } else if (!cont && c >= 98 && c <= 119) {
      j = i + 1; while (j < eol && isWord(src.charCodeAt(j))) j++;
      wl = j - i;
      switch (c) {
        case 108:
          if (wl === 3 && src.startsWith('let', i)) { t = expr(src, j, eol); o = 'const ' + t; }
          break;
        case 118:
          if (wl === 3 && src.startsWith('var', i)) { t = expr(src, j, eol); o = 'let ' + t; }
          break;
        case 105:
          if (wl === 2 && src.charCodeAt(i + 1) === 102) { o = 'if(' + expr(src, j, eol) + '){'; stack.push('if', ln); }
          break;
        case 119:
          if (wl === 5 && src.startsWith('while', i)) { o = 'while(' + expr(src, j, eol) + '){'; stack.push('while', ln); }
          break;
        case 116:
          if (wl === 4 && src.startsWith('test', i)) { o = 'test(' + expr(src, j, eol) + ',()=>{'; stack.push('test', ln); }
          break;
        case 98:
          if (wl === 5 && src.startsWith('break', i)) o = 'break;';
          break;
        case 99:
          if (wl === 8 && src.startsWith('continue', i)) o = 'continue;';
          break;
        case 100:
          if (wl === 4 && src.startsWith('data', i)) {
            m = /^data\s+([A-Z]\w*)\s*(?:#.*)?$/.exec(src.slice(i, eol).trim());
            if (m) {
              declare(m[1]); info.data.push(m[1]); fields[m[1]] = []; curData = m[1];
              o = 'const ' + m[1] + '=__data("' + m[1] + '",{'; stack.push('data', ln);
            }
          }
          break;
        case 115:
          if (wl === 3 && src.startsWith('say', i)) {
            o = 'console.log(' + expr(src, j, eol);
            if (DEPTH > 0) tail = ')'; else o += ')';
          } else if (wl === 4 && src.startsWith('save', i)) {
            p = j; while (p < eol && src.charCodeAt(p) === 32) p++;
            a = src.charCodeAt(p);
            if (p > j && a >= 65 && a <= 90) {
              q = p; while (q < eol && isWord(src.charCodeAt(q))) q++;
              name = src.slice(p, q);
              if (!DECL.has(name) && !GLOBALS.has(name)) MISS.push(name, ln);
              t = expr(src, q, eol);
              if (fields[name] && DEPTH === 0 && t.charCodeAt(0) === 123) {
                for (const key of topKeys(t)) {
                  if (fields[name].indexOf(key) === -1 && key !== 'id') { ERR = name + ' has no field "' + key + '".' + hint(key, fields[name]); break; }
                }
              }
              o = '__save(' + name + ',' + t;
              if (DEPTH > 0) tail = ')'; else o += ')';
              noteWrite();
            }
          } else if (wl === 6 && src.startsWith('server', i)) {
            text = src.slice(i, eol).trim();
            if (/^server\s+fn\b/.test(text)) {
              m = /^server\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:#.*)?$/.exec(text);
              if (!m) { ERR = 'Write a server function like this: server fn addTask(text)'; o = ''; break; }
              declare(m[1]); declareList(m[2]); info.server.push(m[1]);
              a = m[2].trim() ? m[2].split(',').map((x) => x.trim()) : [];
              arity[m[1]] = a.length;
              stack.push('serverfn', ln);
              if (offline) o = 'function ' + m[1] + '(' + a.join(',') + '){';
              else if (web) {
                o = 'function ' + m[1] + '(' + a.join(',') + '){return __call("' + m[1] + '",[' + a.join(',') + ']);}';
                mute = stack.length - 2; emit = true;
              } else o = '__server.' + m[1] + '=' + m[1] + ';function ' + m[1] + '(' + a.join(',') + '){';
            } else if (blank(src, j, eol)) {
              /* a server block: code that runs once when the backend starts */
              info.startup = true; stack.push('server', ln);
              if (web && !offline) { o = ''; mute = stack.length - 2; }
              else o = '{';
            }
          } else if (wl === 6 && src.startsWith('screen', i) && blank(src, j, eol)) {
            info.screen = true; stack.push('screen', ln);
            if (web) o = '__screen(function(){';
            else { o = ''; mute = stack.length - 2; }
          }
          break;
        case 114:
          if (wl === 6 && src.startsWith('return', i)) o = 'return ' + expr(src, j, eol);
          else if (wl === 6 && src.startsWith('repeat', i)) { o = 'for(let __i=0,__n=(' + expr(src, j, eol) + ');__i<__n;__i++){'; stack.push('repeat', ln); }
          else if (wl === 5 && src.startsWith('route', i)) {
            text = src.slice(i, eol).trim();
            m = /^route\s+(GET|POST|PUT|PATCH|DELETE)\s+"([^"]+)"\s*(?:#.*)?$/.exec(text);
            if (m) {
              info.routes++; DECL.add('req'); stack.push('route', ln);
              if (web) { o = ''; mute = stack.length - 2; }
              else o = '__route("' + m[1] + '",' + JSON.stringify(m[2]) + ',function(req){';
            } else if (/^route\s+[A-Z"]/.test(text)) { ERR = 'Write a route like this: route GET "/hello"'; o = ''; }
          } else if (wl === 6 && src.startsWith('remove', i) && src.charCodeAt(j) === 32) {
            p = j; while (p < eol && src.charCodeAt(p) === 32) p++;
            if (isStart(src.charCodeAt(p))) { o = '__remove(' + expr(src, j, eol) + ')'; noteWrite(); }
          }
          break;
        case 117:
          if (wl === 3 && src.startsWith('use', i)) {
            m = /^use\s+"([^"]+)"\s*(?:#.*)?$/.exec(src.slice(i, eol).trim());
            if (m) { info.uses.push(m[1]); o = ''; }
          } else if (wl === 6 && src.startsWith('update', i) && src.charCodeAt(j) === 32) {
            p = j; while (p < eol && src.charCodeAt(p) === 32) p++;
            if (isStart(src.charCodeAt(p))) {
              q = p; while (q < eol && src.charCodeAt(q) !== 32 && src.charCodeAt(q) !== 123) q++;
              if (!blank(src, q, eol) && src.charCodeAt(q + (src.charCodeAt(q) === 32 ? 1 : 0)) !== 61) {
                t = expr(src, p, q);
                o = '__update(' + t + ',' + expr(src, q, eol);
                if (DEPTH > 0) tail = ')'; else o += ')';
                noteWrite();
              }
            }
          }
          break;
        case 102:
          if (wl === 2 && src.charCodeAt(i + 1) === 110) {
            t = expr(src, j, eol);
            m = /^([A-Za-z_$][\w$]*)\s*\((.*)\)$/.exec(t);
            if (!m) { ERR = 'Write a function like this: fn add(a, b)'; o = ''; break; }
            declare(m[1]); declareList(m[2]);
            if (m[2].indexOf('=') === -1 && m[2].indexOf('...') === -1) arity[m[1]] = m[2].trim() ? m[2].split(',').length : 0;
            o = 'function ' + t + '{'; stack.push('fn', ln);
          } else if (wl === 3 && src.startsWith('for', i)) {
            t = expr(src, j, eol); m = t.indexOf(' in ');
            if (m < 1) { ERR = 'Write a loop like this: for i in 1..10'; o = ''; break; }
            name = t.slice(0, m).trim(); ex = t.slice(m + 4).trim(); a = ex.indexOf('..');
            declareList(name);
            if (a > 0 && ex.charCodeAt(a + 2) !== 46) o = 'for(let ' + name + '=(' + ex.slice(0, a) + ');' + name + '<=(' + ex.slice(a + 2) + ');' + name + '++){';
            else o = 'for(const ' + name + ' of (' + ex + ')){';
            stack.push('for', ln);
          } else if (wl === 4 && src.startsWith('fail', i) && src.charCodeAt(j) === 32) {
            p = j; while (p < eol && src.charCodeAt(p) === 32) p++;
            if (src.charCodeAt(p) !== 61) o = 'throw new Error(' + expr(src, j, eol) + ')';
          }
          break;
        case 101:
          if (wl === 3 && src.startsWith('end', i)) {
            if (!blank(src, j, eol)) break;
            if (!stack.length) { ERR = 'This "end" has nothing to close'; o = ''; break; }
            close();
          } else if (wl === 4 && src.startsWith('else', i)) {
            t = expr(src, j, eol); kind = stack.length ? stack[stack.length - 2] : '';
            if (kind !== 'if') { ERR = '"else" needs an "if" above it'; o = ''; }
            else if (t === '') o = '}else{';
            else if (t.slice(0, 3) === 'if ' || t.slice(0, 3) === 'if(') o = '}else if(' + t.slice(2).trim() + '){';
            else { ERR = 'After "else" write nothing, or "if" and a condition'; o = ''; }
          } else if (wl === 6 && src.startsWith('expect', i)) {
            t = expr(src, j, eol); o = 'if(!(' + t + '))throw new Error(' + JSON.stringify('expected ' + t) + ');';
          }
          break;
      }
      /* let and var: learn the new name, or every name in a { a, b } or [a, b] pattern */
      if ((c === 108 || c === 118) && o !== null) {
        a = t.charCodeAt(0);
        if (a === 123 || a === 91) { m = t.indexOf('='); declareList(m === -1 ? t : t.slice(0, m)); }
        else { m = /^[A-Za-z_$][\w$]*/.exec(t); if (m) declare(m[0]); else ERR = ERR || 'Give the value a name, like: let total = 0'; }
      }
    }
    if (o === null) o = expr(src, i, eol);
    if (WROTE) { WROTE = false; noteWrite(); }
    if (DEPTH < 0) { ERR = ERR || 'There is a closing bracket here with no opening bracket'; DEPTH = 0; }
    if (DEPTH > 0 && !cont) openLine = ln;
    if (cont && DEPTH === 0 && tail) { o += tail; tail = ''; }
    if (ERR) { if (errs.length < 20) errs.push({ line: ln, msg: ERR }); out += '\n'; continue; }
    if (mute >= 0 && !emit) { out += '\n'; continue; }
    if (DEPTH === 0 && o.length) {
      last = o.charCodeAt(o.length - 1);
      /* no semicolon after a block opener, an existing one, or an operator that continues on the next line */
      if (last !== 123 && last !== 59 && last !== 44 && last !== 43 && last !== 45 && last !== 42 && last !== 47 && last !== 61 && last !== 46 && last !== 38 && last !== 124 && last !== 63 && last !== 58) out += o + ';\n';
      else out += o + '\n';
    } else out += o + '\n';
  }

  if (DEPTH > 0) errs.push({ line: openLine, msg: 'A bracket opened on this line is never closed' });
  if (stack.length) {
    kind = stack[stack.length - 2];
    errs.push({ line: stack[stack.length - 1], msg: 'This "' + (kind === 'serverfn' ? 'server fn' : kind) + '" is missing its "end"' });
  }
  /* names that were never defined anywhere in the program */
  const seen = new Set();
  for (let k = 0; k < MISS.length; k += 2) {
    name = MISS[k];
    if (DECL.has(name) || GLOBALS.has(name) || seen.has(name)) continue;
    seen.add(name);
    errs.push({ line: MISS[k + 1], msg: '"' + name + '" is not defined.' + (hint(name, DECL) || hint(name, GLOBALS)) });
  }
  /* calls with the wrong number of values */
  for (let k = 0; k < CALLS.length; k += 3) {
    a = arity[CALLS[k]];
    if (a !== undefined && CALLS[k + 1] !== a) {
      errs.push({ line: CALLS[k + 2], msg: '"' + CALLS[k] + '" takes ' + a + (a === 1 ? ' value' : ' values') + ', but this line gives it ' + CALLS[k + 1] + '.' });
    }
  }
  if (screenWrites.length && (opts.hasServer || info.server.length || info.routes || info.startup)) {
    for (const line of screenWrites) errs.push({ line, msg: 'Data can only be changed on the server. Move this line into a server fn and call that from here.' });
  }
  errs.sort((x, y) => x.line - y.line);
  if (errs.length > 20) errs.length = 20;

  return {
    code: out, errors: errs, lines: ln,
    uses: info.uses, declared: own, arity, fields,
    server: info.server, data: info.data, routes: info.routes, screen: info.screen
  };
}

module.exports = { compile };
