'use strict';
/*
 * The backend runtime: saved data in a JSON file, server functions, routes and the HTTP server.
 * It only needs Node's built-in modules, so `brisk build` can copy it next to a built app.
 */
const fs = require('fs');
const http = require('http');
const { makeData } = require('./data');

/* Put the names that compiled Brisk code calls onto the global object. */
function install(dataFile) {
  let db = null;
  const store = makeData(
    () => {
      if (!db) {
        try { db = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { db = { next: 1, rows: {} }; }
      }
      return db;
    },
    (next) => { db = next; fs.writeFileSync(dataFile, JSON.stringify(db, null, 2) + '\n'); }
  );
  const app = { server: {}, routes: [], store };
  globalThis.__data = store.data;
  globalThis.__save = store.save;
  globalThis.__all = store.all;
  globalThis.__update = store.update;
  globalThis.__remove = store.remove;
  globalThis.__server = app.server;
  globalThis.__route = (method, path, fn) => app.routes.push({ method, parts: path.split('/'), fn });
  if (!globalThis.test) globalThis.test = () => {};
  return app;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 1e6) { reject(new Error('The request is too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!text) return resolve(null);
      try { resolve(JSON.parse(text)); } catch (e) { resolve(text); }
    });
    req.on('error', reject);
  });
}

function match(route, method, parts) {
  if (route.method !== method || route.parts.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (route.parts[i].charAt(0) === ':') params[route.parts[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (route.parts[i] !== parts[i]) return null;
  }
  return params;
}

/* Start the HTTP server. html is the built frontend page, or null for an API-only program. */
function serve(app, html, port) {
  const send = (res, status, type, body) => {
    res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/' && html) return send(res, 200, 'text/html', html);
      if (req.method === 'GET' && path === '/__brisk/data') return json(res, 200, { rows: app.store.rows() });
      if (req.method === 'POST' && path.startsWith('/__brisk/call/')) {
        const name = path.slice('/__brisk/call/'.length);
        const fn = Object.prototype.hasOwnProperty.call(app.server, name) ? app.server[name] : null;
        if (!fn) return json(res, 404, { ok: false, error: 'There is no server fn called "' + name + '"' });
        const body = await readBody(req);
        try {
          const result = await fn.apply(null, (body && body.args) || []);
          return json(res, 200, { ok: true, result: result === undefined ? null : result, rows: app.store.rows() });
        } catch (e) {
          console.error('server fn ' + name + ': ' + (e && e.message));
          return json(res, 200, { ok: false, error: String((e && e.message) || e) });
        }
      }
      const parts = path.split('/');
      for (const route of app.routes) {
        const params = match(route, req.method, parts);
        if (!params) continue;
        const body = req.method === 'GET' ? null : await readBody(req);
        const result = await route.fn({ query: Object.fromEntries(url.searchParams), params, body });
        if (typeof result === 'string') return send(res, 200, 'text/plain', result);
        return json(res, 200, result === undefined ? null : result);
      }
      json(res, 404, { error: 'Nothing lives at ' + req.method + ' ' + path });
    } catch (e) {
      console.error(req.method + ' ' + path + ': ' + (e && e.stack || e));
      json(res, 500, { error: String((e && e.message) || e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

module.exports = { install, serve };
