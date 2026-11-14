'use strict';
/*
 * The frontend runtime and the HTML page that Brisk apps are built into.
 * webRuntime runs in the browser, so it is turned into text and placed in the page.
 * It must not use anything from this file's scope.
 */
const { makeData } = require('./data');

function webRuntime(REMOTE, makeData) {
  var root = document.getElementById('app');
  var screenFn = null, rendering = false, queued = false, timers = [];
  var cache = { next: 1, rows: {} };
  var KEY = 'brisk:' + location.pathname;

  function add(tag, text) { var e = document.createElement(tag); if (text != null) e.textContent = text; root.appendChild(e); return e; }
  function wrap(e) {
    return { el: e,
      set: function (t) { e.textContent = t; return this; },
      hide: function () { e.style.display = 'none'; return this; },
      show: function () { e.style.display = ''; return this; },
      color: function (c) { e.style.color = c; return this; },
      remove: function () { e.remove(); } };
  }
  function timer(id) { if (rendering) timers.push(id); return id; }
  function showError(message) {
    var bar = document.getElementById('brisk-error');
    if (!bar) { bar = document.createElement('div'); bar.id = 'brisk-error'; document.body.insertBefore(bar, document.body.firstChild); }
    bar.textContent = message;
    console.error(message);
  }

  window.ui = {
    title: function (t) { document.title = t; return wrap(add('h1', t)); },
    text: function (t) { return wrap(add('p', t)); },
    button: function (t, fn) {
      var e = add('button', t);
      e.addEventListener('click', function () {
        var bar = document.getElementById('brisk-error'); if (bar) bar.remove();
        try { if (fn) fn(); } catch (err) { showError(err.message); }
      });
      return wrap(e);
    },
    input: function (hint) {
      var e = add('input'), w = wrap(e); e.placeholder = hint || '';
      Object.defineProperty(w, 'value', { get: function () { return e.value; }, set: function (v) { e.value = v; } });
      return w;
    },
    list: function (items) {
      var e = add('ul'), w = wrap(e);
      w.set = function (a) { e.textContent = ''; (a || []).forEach(function (x) { var li = document.createElement('li'); li.textContent = x; e.appendChild(li); }); return w; };
      return w.set(items);
    },
    canvas: function (w, h) {
      var e = add('canvas'); e.width = w || 300; e.height = h || 300; var c = e.getContext('2d');
      return { el: e, ctx: c, width: e.width, height: e.height,
        clear: function (color) { if (color) { c.fillStyle = color; c.fillRect(0, 0, e.width, e.height); } else c.clearRect(0, 0, e.width, e.height); },
        rect: function (x, y, w2, h2, color) { c.fillStyle = color || '#0b6e75'; c.fillRect(x, y, w2, h2); },
        circle: function (x, y, r, color) { c.fillStyle = color || '#0b6e75'; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); },
        text: function (t, x, y, color, size) { c.fillStyle = color || '#18212b'; c.font = (size || 18) + 'px system-ui,sans-serif'; c.fillText(t, x, y); },
        onTap: function (fn) { e.addEventListener('pointerdown', function (ev) { var b = e.getBoundingClientRect(); fn((ev.clientX - b.left) * e.width / b.width, (ev.clientY - b.top) * e.height / b.height); }); } };
    },
    every: function (ms, fn) { return timer(setInterval(fn, ms)); },
    after: function (ms, fn) { return timer(setTimeout(fn, ms)); },
    stop: function (id) { clearInterval(id); clearTimeout(id); },
    clear: function () { root.textContent = ''; },
    background: function (c) { document.body.style.background = c; }
  };

  /* A screen block is drawn again whenever saved data changes. Typed text and focus are kept. */
  function render() {
    queued = false;
    if (!screenFn) return;
    var before = root.querySelectorAll('input'), values = [], focus = -1, i;
    for (i = 0; i < before.length; i++) { values.push(before[i].value); if (before[i] === document.activeElement) focus = i; }
    timers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    timers = [];
    root.textContent = '';
    rendering = true;
    try { screenFn(); } catch (err) { showError(err.message); } finally { rendering = false; }
    var after = root.querySelectorAll('input');
    for (i = 0; i < after.length && i < values.length; i++) after[i].value = values[i];
    if (focus >= 0 && after[focus]) after[focus].focus();
  }
  function queueRender() { if (!queued) { queued = true; setTimeout(render, 0); } }

  if (!REMOTE) { try { var saved = localStorage.getItem(KEY); if (saved) cache = JSON.parse(saved); } catch (e) {} }
  var store = makeData(
    function () { return cache; },
    function (db) { cache = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} queueRender(); }
  );
  function local(fn) {
    return function (a, b) {
      if (REMOTE) throw new Error('Data can only be changed on the server. Move this into a server fn.');
      return fn(a, b);
    };
  }
  window.__data = store.data;
  window.__all = store.all;
  window.__save = local(store.save);
  window.__update = local(store.update);
  window.__remove = local(store.remove);
  window.__screen = function (fn) { screenFn = fn; };
  window.__call = function (name, args) {
    var p = fetch('/__brisk/call/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: args }) })
      .then(function (r) { return r.json(); })
      .then(function (m) {
        if (!m.ok) throw new Error(m.error);
        cache = { next: 0, rows: m.rows };
        render();
        return m.result;
      });
    p.catch(function (err) { showError(name + ': ' + err.message); });
    return p;
  };
  window.test = function (name, fn) {
    try { fn(); console.log('pass: ' + name); } catch (err) { console.log('FAIL: ' + name + ' — ' + err.message); }
  };
  window.__start = function () {
    if (!REMOTE) return render();
    fetch('/__brisk/data').then(function (r) { return r.json(); }).then(function (m) { cache = { next: 0, rows: m.rows }; render(); })
      .catch(function (err) { showError('Could not reach the server: ' + err.message); });
  };
}

const CSS = ':root{color-scheme:light dark}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:20px 16px;line-height:1.45;background:Canvas;color:CanvasText}main{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:12px}h1{font-size:24px;margin:0 0 4px}p{margin:0}button{font:inherit;font-weight:600;padding:12px 16px;border:0;border-radius:10px;background:#0b6e75;color:#fff}button:active{opacity:.8}input{font:inherit;font-size:16px;padding:11px 12px;border:1px solid #8a97a5;border-radius:10px;background:Field;color:FieldText}ul{margin:0;padding-left:20px}canvas{max-width:100%;border:1px solid #8a97a5;border-radius:10px;touch-action:none}#brisk-error{max-width:480px;margin:0 auto 12px;padding:10px 12px;border-radius:10px;background:#b3261e;color:#fff}';

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

/*
 * Wrap compiled Brisk code in a complete, self-contained web page.
 * scripts: the compiled code of each file, in the order they must run.
 * remote: true when the page talks to a Brisk backend, false when data lives on the device.
 */
function page(scripts, options) {
  const o = options || {};
  const list = Array.isArray(scripts) ? scripts : [scripts];
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escapeHtml(o.title || 'Brisk app') + '</title>\n<style>' + CSS + '</style>\n</head>\n<body>\n<main id="app"></main>\n' +
    '<script>(' + safeScript(webRuntime.toString()) + ')(' + (o.remote ? 'true' : 'false') + ',' + safeScript(makeData.toString()) + ');</' + 'script>\n' +
    list.map((code) => '<script>\n' + safeScript(code) + '\n</' + 'script>\n').join('') +
    '<script>__start();</' + 'script>\n</body>\n</html>\n';
}

const usesUi = (source) => /\bui\s*\./.test(source);

module.exports = { page, usesUi };
