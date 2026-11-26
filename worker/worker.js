// Cloudflare Worker：台股即時報價轉接（只轉送證交所 MIS 行情，只允許本站呼叫）。由 GitHub Actions 自動部署（.github/workflows/deploy-worker.yml）。
// 用法：GET https://<你的 worker 網址>/?code=2330（即時報價）、/?nav=0050（ETF 即時預估淨值）
const VERSION = '4';
const ALLOWED_ORIGINS = [
  'https://kckuo-ai.github.io',
];
const MIS_HOME = 'https://mis.twse.com.tw/stock/index.jsp';
const MIS_API = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
// 證交所「ETF 即時預估淨值」：各投信（元大、國泰…）每 15 秒回報給證交所的預估淨值，全部 ETF 一次回傳
const MIS_ETF = 'https://mis.twse.com.tw/stock/data/all_etf.txt';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let cookie = '';          // 同一個執行個體內重複使用 session cookie
let cookieAt = 0;

async function getCookie(force) {
  if (!force && cookie && Date.now() - cookieAt < 10 * 60 * 1000) return cookie;
  const r = await fetch(MIS_HOME, { headers: { 'User-Agent': UA } });
  const set = r.headers.get('set-cookie') || '';
  cookie = set.split(/,(?=[^;]+=)/).map(s => s.split(';')[0].trim()).filter(Boolean).join('; ');
  cookieAt = Date.now();
  return cookie;
}

async function queryOne(ex, force) {
  const url = `${MIS_API}?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${Date.now()}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': MIS_HOME, 'Accept': 'application/json', 'Cookie': await getCookie(force) },
  });
  const text = await r.text();
  return JSON.parse(text); // 非 JSON（例如 520 錯誤頁）會丟出例外
}

// 上市、上櫃分開查。證交所偶爾回 520 錯誤頁，失敗時最多重試 2 次（第 2 次起換新 cookie）
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function queryMarket(ex) {
  let err;
  for (const [i, wait] of [0, 300, 800].entries()) {
    if (wait) await sleep(wait);
    try { return await queryOne(ex, i > 0); } catch (e) { err = e; }
  }
  throw err;
}

async function query(code) {
  const first = await queryBoth(code);
  if (first.msgArray.length) return first;
  // 證交所偶爾回傳空的 msgArray，隔一下再查一次；仍然空的才當作查無此代碼
  await sleep(500);
  return queryBoth(code);
}

async function queryBoth(code) {
  const res = await Promise.allSettled([queryMarket(`tse_${code}.tw`), queryMarket(`otc_${code}.tw`)]);
  const msgArray = [];
  let ok = false;
  for (const r of res) {
    if (r.status === 'fulfilled') { ok = true; (r.value.msgArray || []).forEach(x => x && x.n && msgArray.push(x)); }
  }
  if (!ok) throw new Error(res.map(r => r.reason).join('; '));
  return { msgArray };
}

let etfCache = null, etfAt = 0;
async function etfAll() {
  if (etfCache && Date.now() - etfAt < 10 * 1000) return etfCache;
  let text = '';
  for (const force of [false, true]) {
    const r = await fetch(`${MIS_ETF}?${Date.now()}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://mis.twse.com.tw/stock/etf_nav.jsp?ex=tse', 'Accept': 'application/json', 'Cookie': await getCookie(force) },
    });
    text = await r.text();
    try { etfCache = JSON.parse(text); etfAt = Date.now(); return etfCache; } catch (e) { /* 換 cookie 重試 */ }
  }
  throw new Error('all_etf 非 JSON：' + text.slice(0, 80));
}

// 欄位（證交所 ETF 預估淨值頁）：a 代號、b 名稱、c 已發行單位數、d 與前日單位差、e 成交價、
// f 投信預估淨值、g 預估折溢價%、h 前一營業日淨值、i 日期、j 時間
async function nav(code) {
  const j = await etfAll();
  const groups = Array.isArray(j.a1) ? j.a1 : [];
  for (const g of groups) {
    for (const it of (g && g.msgArray) || []) {
      if (it && String(it.a).trim().toUpperCase() === code) {
        return { code, name: it.b, units: it.c, unitsChg: it.d, price: it.e, nav: it.f, premium: it.g, prevNav: it.h, date: it.i, time: it.j, raw: it };
      }
    }
  }
  return { code, nav: null };
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
    'X-Worker-Version': VERSION,
    'Access-Control-Expose-Headers': 'X-Worker-Version',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    if (!allowed) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    const sp = new URL(request.url).searchParams;
    const isNav = sp.has('nav');
    const code = (sp.get('nav') || sp.get('code') || '').toUpperCase();
    if (!/^[0-9A-Z]{4,7}$/.test(code)) {
      return new Response('{"error":"bad code"}', { status: 400, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    }
    try {
      const data = isNav ? await nav(code) : await query(code);
      return new Response(JSON.stringify(data), {
        headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    }
  },
};
