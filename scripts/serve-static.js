'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {buildStatic} = require('./build-static.js');

const root = buildStatic();
const port = Number(process.env.PORT || 4174);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Ogiltig adress'); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403).end('Åtkomst nekad'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, '404.html');
  const content = fs.readFileSync(file);
  response.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(content);
});

server.listen(port, '127.0.0.1', () => console.log(`Rollands demo: http://127.0.0.1:${port}`));
