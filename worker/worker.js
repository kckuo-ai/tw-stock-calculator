// Cloudflare Worker：台股即時報價轉接（只轉送證交所 MIS 行情，只允許本站呼叫）
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

async function query(code, force) {
  const ex = `tse_${code}.tw|otc_${code}.tw`;
  const url = `${MIS_API}?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${Date.now()}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': MIS_HOME, 'Accept': 'application/json', 'Cookie': await getCookie(force) },
  });
  return r.json();
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
      let data = await query(code, false);
      if (!data.msgArray || !data.msgArray.length) data = await query(code, true); // cookie 過期時重抓一次
      return new Response(JSON.stringify(data), {
        headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
    }
  },
};
