// Cloudflare Worker：台股即時報價轉接（只轉送證交所 MIS 行情，只允許本站呼叫）。由 Cloudflare 自 GitHub 自動部署。
// 用法：GET https://<你的 worker 網址>/?code=2330
const ALLOWED_ORIGINS = [
  'https://kckuo-ai.github.io',
];
const MIS_HOME = 'https://mis.twse.com.tw/stock/index.jsp';
const MIS_API = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
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

// 上市、上櫃分開查，各自失敗重試一次（換新 cookie）
async function queryMarket(ex) {
  try { return await queryOne(ex, false); }
  catch (e) { await new Promise(r => setTimeout(r, 300)); return queryOne(ex, true); }
}

async function query(code) {
  const res = await Promise.allSettled([queryMarket(`tse_${code}.tw`), queryMarket(`otc_${code}.tw`)]);
  const msgArray = [];
  let ok = false;
  for (const r of res) {
    if (r.status === 'fulfilled') { ok = true; (r.value.msgArray || []).forEach(x => x && x.n && msgArray.push(x)); }
  }
  if (!ok) throw new Error(res.map(r => r.reason).join('; '));
  return { msgArray };
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    if (!allowed) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    const code = (new URL(request.url).searchParams.get('code') || '').toUpperCase();
    if (!/^[0-9A-Z]{4,7}$/.test(code)) {
      return new Response('{"error":"bad code"}', { status: 400, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    }
    try {
      const data = await query(code);
      return new Response(JSON.stringify(data), {
        headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    }
  },
};
