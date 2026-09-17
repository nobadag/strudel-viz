// strudel-viz-bridge.debug.js
// 元の strudel-viz-bridge.js に診断用ログ + heartbeat を追加した版。
// 切断ループの原因切り分け用。問題が解決したら元のシンプル版に戻してOK。

const WebSocket = require('ws');

const PORT = process.env.STRUDEL_VIZ_PORT ? Number(process.env.STRUDEL_VIZ_PORT) : 8181;

const wss = new WebSocket.Server({ port: PORT });

// サーバーレベルのエラー(EADDRINUSEなど)を捕まえて、
// 「気づかぬうちにプロセスが落ちて再起動していた」を除外する
wss.on('error', (err) => {
  console.error(`[bridge] SERVER ERROR: ${err.code || ''} ${err.message}`);
});

console.log(`[bridge] listening on ws://localhost:${PORT} (pid: ${process.pid})`);
console.log('[bridge] waiting for strudel.cc (sender) and viz page (receiver) to connect...');

let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  const id = clientCount;
  const connectedAt = Date.now();
  ws.isAlive = true;

  console.log(`[bridge] client #${id} connected (${req.socket.remoteAddress}) — total: ${wss.clients.size}`);

  // heartbeat: pongが返ってきたら生存フラグを立てる
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });
  });

  // ★ここが今回の本題: codeとreasonを必ずログに出す
  ws.on('close', (code, reasonBuf) => {
    const aliveMs = Date.now() - connectedAt;
    const reason = reasonBuf ? reasonBuf.toString() : '';
    console.log(
      `[bridge] client #${id} disconnected — code=${code} reason="${reason}" ` +
      `aliveMs=${aliveMs} total(after)=${wss.clients.size - 1}`
    );
  });

  ws.on('error', (err) => {
    console.error(`[bridge] client #${id} error: ${err.code || ''} ${err.message}`);
  });
});

// 30秒ごとに死んでいる接続を検出・掃除する
// (これ自体が切断の原因になっていないか確認するため、まずは長めの間隔にしてある)
const HEARTBEAT_INTERVAL_MS = 30000;
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[bridge] terminating dead connection (missed pong)');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

process.on('SIGINT', () => {
  console.log('\n[bridge] shutting down...');
  clearInterval(heartbeat);
  wss.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[bridge] UNCAUGHT EXCEPTION (process would normally die here):', err);
});
