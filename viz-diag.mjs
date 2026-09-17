// viz-diag.mjs (一時的な診断用、viz.mjsは触らない)
const DIAG_URL = 'ws://localhost:8181';
let diagWs = null;
let lastHapSentAt = null;

function getDiagSocket() {
  if (!diagWs || diagWs.readyState === WebSocket.CLOSED || diagWs.readyState === WebSocket.CLOSING) {
    diagWs = new WebSocket(DIAG_URL);
  }
  return diagWs;
}

// vizHapsが使っている送信用WebSocketのsendを横取りして「最後に送信した時刻」を記録する
// (viz.mjs自体は無改造。WebSocket.prototype.sendだけ薄くラップする)
const origSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  if (typeof data === 'string' && data.includes('"begin"')) {
    lastHapSentAt = performance.now();
  }
  return origSend.call(this, data);
};

setInterval(() => {
  const ws = getDiagSocket();
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'diag',
    t: Date.now(),
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: document.hasFocus(),
    msSinceLastHap: lastHapSentAt ? Math.round(performance.now() - lastHapSentAt) : null,
  }));
}, 1000);

console.log('[viz-diag] started');
