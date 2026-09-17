// notehighway.mjs
//
// 音ゲーのように「ノーツが奥から手前に向かって飛んでくる」演出のための、
// viz.mjs の vizHaps() とは別系統の新規フック。
//
// なぜ vizHaps() では実現できないか:
//   vizHaps() は `hap.whole.begin > time` のノーツを送信前に捨てているため、
//   実際に発音した「その瞬間」のイベントしか受信側に届かない。ノーツが
//   奥から近づいてくる演出には「あと何秒でヒットするか」という発音前の
//   予告情報が必須なので、まったく別のデータを別のメッセージ種別
//   ('note') で送る新しい関数として実装する。
//
// なぜパターンに .vizNotes() のように差す方式ではなく自動追従にしたか:
//   stack(...)の各パート全部に書き足すのは面倒なので、codebeam.mjsの
//   beamCode()と同じ方式(getPattern()/getTime()で「今REPLで再生中の
//   トップレベルパターン全体」を自動的に追いかける)にした。
//   → import一発で、stack内の全パートが自動的にノーツとして飛んでくる。
//   レーン分けは各hapのvalue(s/note/n)から自動で決める。
//
// 仕組み:
//   毎フレーム `pat.queryArc(now, now + lookahead)` で「今から lookahead
//   サイクル先まで」に鳴る予定のhapを取得する。このサイクル数と、直前
//   フレームからの実時間経過(performance.now())の比を取ることで、
//   「1サイクルが何秒か(cps: cycles per second)」をStrudel内部APIに
//   依存せずその場で実測する。setcpm()で何BPMに設定されていても、
//   曲の途中でテンポが変わっても追従できる。
//
//   実測cpsが求まれば、「あと何サイクルでヒットするか」を「あと何秒で
//   ヒットするか」に変換できるので、受信側はその秒数ぶんかけてノーツを
//   奥から手前の判定ラインまで移動させればよい(= 音ゲーの接近演出)。
//
// 使い方 / usage (strudel.cc REPL):
//
//   await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/notehighway.mjs')
//
//   stack(
//     s('bd*2 ~ bd sd').bank('RolandTR909'),
//     note('<0 3 7 10>*4').scale('D4:minor').s('sawtooth'),
//   )
//
// これだけで、デフォルトURL(ws://localhost:8181)への送信が自動的に始まる
// (codebeam.mjsのbeamCode()と同様)。別のURLに繋ぎたい時だけ明示的に呼び直す:
//
//   const { beamNotes } = await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/notehighway.mjs')
//   beamNotes('ws://別のurl')
//
// 受信側は 'note' というtypeのメッセージを待ち受ける必要がある
// (viz.mjs の vizHaps()/vizScope() が送る旧メッセージとは別形式)。

const instances = new Map(); // url -> controller (再評価時に前の接続を片付けるため)

function hapKey(hap) {
  return String(hap.whole.begin) + '|' + JSON.stringify(hap.value);
}

// レーン識別子をhapの中身から自動で決める。sound名(s)を最優先にする
// (ドラムマシンなら 'sbd'/'sd:6' のように音ごとに自然にレーンが分かれる)。
function laneIdFor(hap) {
  const v = hap.value ?? {};
  if (typeof v === 'string') return v;
  return String(v.s ?? v.sound ?? v.note ?? v.n ?? 'default');
}

/**
 * beamNotes(url, options)
 *
 * 「今REPLで再生中のトップレベルパターン全体」を自動的に追いかけて、
 * これから鳴る予定のhapを「あと何秒でヒットするか」付きで送信し続ける。
 * import時に一度、デフォルトURLで自動的に呼ばれる。
 *
 * @param {string} url               中継サーバーのWebSocket URL (default: ws://localhost:8181)
 * @param {object} [options]
 * @param {number} [options.lookahead=1]  何サイクル先まで予告として送るか。
 *   この値が大きいほど、ノーツが奥から見え始めてから判定ラインに
 *   到達するまでの「飛んでくる時間」が長くなる(演出上の接近速度に直結)。
 */
export function beamNotes(url = 'ws://localhost:8181', options = {}) {
  // 同じurlで既に動いているものがあれば、まず綺麗に止めてから作り直す
  // (REPL再評価のたびに書いても二重に走らないようにする)
  instances.get(url)?.stop();

  const { lookahead = 1 } = options;
  const ws = new WebSocket(url);
  let connected = false;
  ws.addEventListener('open', () => { connected = true; });
  ws.addEventListener('close', () => { connected = false; });

  const fired = new Set(); // 送信済みhapキー(同じ音の重複送信を防ぐ)

  // cps(cycles per second)の実測
  let lastCycle = null;
  let lastWallMs = null;
  let cpsEstimate = null;

  let raf = null;
  const tick = () => {
    const pat = getPattern?.();
    if (pat && connected) {
      const now = Math.max(Number(getTime()), 0);

      const nowMs = performance.now();
      if (lastCycle !== null && now > lastCycle) {
        const dCycle = now - lastCycle;
        const dMs = nowMs - lastWallMs;
        if (dMs > 0) {
          const instant = (dCycle / dMs) * 1000; // cycles/sec
          cpsEstimate = cpsEstimate == null ? instant : cpsEstimate + (instant - cpsEstimate) * 0.2;
        }
      }
      lastCycle = now;
      lastWallMs = nowMs;
      const cps = cpsEstimate ?? 1; // 初回はまだ推定できないので1と仮定(すぐ次のフレームで補正される)

      const haps = pat.queryArc(now, now + lookahead).filter((h) => h.hasOnset());
      for (const hap of haps) {
        if (!hap.whole) continue;
        const key = hapKey(hap);
        if (fired.has(key)) continue;
        fired.add(key);
        if (fired.size > 4000) fired.clear(); // 単純な上限クリア(メモリ肥大化防止)

        const begin = Number(hap.whole.begin);
        const dur = Number(hap.duration);
        const cyclesUntilHit = begin - now; // 正=まだ先, 0前後=ちょうど今

        ws.send(
          JSON.stringify({
            type: 'note',
            id: laneIdFor(hap),
            value: hap.value,
            begin,
            dur,
            cyclesUntilHit,
            cps,
          })
        );
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const controller = {
    stop() {
      if (raf != null) cancelAnimationFrame(raf);
      ws.close();
      instances.delete(url);
    },
    ws,
  };
  instances.set(url, controller);
  return controller;
}

// importした時点で、デフォルトURL(ws://localhost:8181)で自動的に起動する。
// 別のURLに繋ぎたい時だけ `const { beamNotes } = await import(...); beamNotes('ws://別のurl')`
// のように明示的に呼び直せばよい。
beamNotes();
