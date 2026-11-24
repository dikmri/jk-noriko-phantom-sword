/**
 * ファイルログ。開発サーバーの /__log へ行を送り、./logs/game.log に追記される。
 * 1 行の形式:  <時刻> [<イベント名>] args=<JSON> result=<JSON>
 */
const buf: string[] = [];
let timer: number | undefined;
/** 記録先（開発サーバー）が無いとき（GitHub Pages など）は送らない */
let disabled = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function stamp(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${oh}:${om}`
  );
}

function safe(v: unknown): string {
  if (v === undefined) return '-';
  try {
    const s = JSON.stringify(v, (_k, val) => (typeof val === 'number' && !Number.isInteger(val) ? Math.round(val * 1000) / 1000 : val));
    if (s === undefined) return String(v);
    return s.length > 900 ? s.slice(0, 900) + '…' : s;
  } catch {
    return String(v);
  }
}

function flush(): void {
  timer = undefined;
  if (buf.length === 0 || disabled) return;
  const body = buf.join('\n') + '\n';
  buf.length = 0;
  fetch('/__log', { method: 'POST', body, keepalive: true }).then(
    (r) => {
      if (!r.ok) disabled = true; // 静的配信では記録先が無い
    },
    () => {},
  );
}

/** イベントを 1 行記録する。 */
export function log(event: string, args?: unknown, result?: unknown): void {
  const line = `${stamp()} [${event}] args=${safe(args)} result=${safe(result)}`;
  if (disabled) return;
  buf.push(line);
  if (timer === undefined) timer = window.setTimeout(flush, 500);
}

export function initLog(): void {
  window.addEventListener('error', (e) => {
    log('exception', { message: e.message, source: e.filename, line: e.lineno, col: e.colno }, { stack: e.error?.stack ?? null });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    log('exception.promise', { message: r?.message ?? String(e.reason) }, { stack: r?.stack ?? null });
  });
  window.addEventListener('pagehide', () => {
    if (buf.length && !disabled) {
      navigator.sendBeacon('/__log', buf.join('\n') + '\n');
      buf.length = 0;
    }
  });
  log('app.start', { ua: navigator.userAgent, w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio });
}
