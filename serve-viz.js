// serve-viz.js
// strudel-viz-rhythm.html / strudel-viz-receiver.html を file:// ではなく
// http://localhost 経由で開くための最小静的サーバー。ロジックは一切持たない。
//
// なぜ必要か:
//   file://(オリジンが null 扱い)で直接開くと、Chromeの Private Network
//   Access制限に引っかかり、ws://localhost:8181 への接続が確立直後に
//   切断されることがある。http://localhost から開けば、strudel-viz-bridge.js
//   と同じ「信頼済みのループバックオリジン」になり回避できる。
//
// 使い方:
//   node serve-viz.js
//   → ブラウザで http://localhost:8090/strudel-viz-rhythm.html を開く

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.STRUDEL_VIZ_HTTP_PORT ? Number(process.env.STRUDEL_VIZ_HTTP_PORT) : 8090;
const ROOT = __dirname;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = reqPath === '/' ? '/strudel-viz-rhythm.html' : reqPath;
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[serve-viz] serving ${ROOT} at http://localhost:${PORT}/`);
  console.log(`[serve-viz] open: http://localhost:${PORT}/strudel-viz-rhythm.html`);
});

process.on('SIGINT', () => {
  console.log('\n[serve-viz] shutting down...');
  server.close(() => process.exit(0));
});
