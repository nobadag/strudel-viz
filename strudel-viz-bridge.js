// strudel-viz-bridge.js
// strudel.cc REPLタブ(送信側)と three.js ビジュアライザタブ(受信側)を
// ws://localhost:PORT でつなぐだけの最小pub/subリレー。
// ロジックは一切持たない — 受け取ったメッセージを他の全クライアントに転送するだけ。
//
// 使い方:
//   npm install ws
//   node strudel-viz-bridge.js
//
// Windowsのローカルで動かすことを推奨(strudel.ccがhttpsのため、
// Tailscale IP宛のws://だとMixed Contentでブロックされる。
// localhostは大抵のブラウザで信頼済みオリジン扱いなので回避できる)。

const WebSocket = require('ws');

const PORT = process.env.STRUDEL_VIZ_PORT ? Number(process.env.STRUDEL_VIZ_PORT) : 8181;
const wss = new WebSocket.Server({ port: PORT });

console.log(`[strudel-viz-bridge] listening on ws://localhost:${PORT}`);
console.log('[strudel-viz-bridge] waiting for strudel.cc (sender) and viz page (receiver) to connect...');

let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  const id = clientCount;
  console.log(`[strudel-viz-bridge] client #${id} connected (${req.socket.remoteAddress}) — total: ${wss.clients.size}`);

  ws.on('message', (data, isBinary) => {
    // 送信元以外の全クライアントにそのまま転送
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });
  });

  ws.on('close', () => {
    console.log(`[strudel-viz-bridge] client #${id} disconnected — total: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[strudel-viz-bridge] client #${id} error:`, err.message);
  });
});

process.on('SIGINT', () => {
  console.log('\n[strudel-viz-bridge] shutting down...');
  wss.close(() => process.exit(0));
});
