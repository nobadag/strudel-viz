// serve-local.js
// strudel-extensions配下の.mjsファイルを、strudel.ccのREPLからimport()できるように
// CORS付きで配信するだけの最小静的サーバー。ロジックは一切持たない。
//
// なぜ必要か:
//   GitHub上にpushしてjsDelivr経由でimportする方法(README参照)は、CDNキャッシュが
//   効くため編集内容がすぐには反映されない。ローカルで書き換えながら確認したい間は、
//   このサーバーを立てて http://localhost:PORT/notehighway.mjs のように直接importする方が早い。
//
// 使い方:
//   node serve-local.js
//   → strudel.cc側で: await import('http://localhost:8420/notehighway.mjs')
//
// (localhostはstrudel-viz-bridge.jsと同じ理由で、https配信のstrudel.ccからでも
//  Mixed Content扱いにならない信頼済みオリジンとして使える)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.STRUDEL_SERVE_PORT ? Number(process.env.STRUDEL_SERVE_PORT) : 8420;
const ROOT = __dirname;

const CONTENT_TYPES = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(ROOT, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ''));

  // ROOT配下からはみ出すパスは弾く(単純なpath traversal対策)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store', // 編集内容をすぐ反映させたいのでキャッシュさせない
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[serve-local] serving ${ROOT} at http://localhost:${PORT}/`);
  console.log(`[serve-local] example: await import('http://localhost:${PORT}/notehighway.mjs')`);
});

process.on('SIGINT', () => {
  console.log('\n[serve-local] shutting down...');
  server.close(() => process.exit(0));
});
