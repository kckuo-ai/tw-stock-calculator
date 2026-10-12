#!/usr/bin/env python3
"""產生 data/quotes.json：上市、上櫃股票與 ETF 的最新行情。

1. 代碼清單與前一交易日收盤：證交所、櫃買中心 OpenAPI（每日更新）
2. 當日行情：證交所 MIS 即時系統批次查詢（盤中為最新成交，收盤後為當日收盤），
   含開盤、最高、最低、成交量、昨收、漲跌停。

輸出格式：
{"updated": "...", "q": {"2330": [名稱, 價格, 漲跌, 市場, 開, 高, 低, 量(張), 日期YYYYMMDD, 時間HH:MM:SS, 昨收], ...}}
只用標準函式庫，供 GitHub Actions 執行。
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TWSE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
MIS_HOME = "https://mis.twse.com.tw/stock/index.jsp"
MIS_API = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "quotes.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
TW = timezone(timedelta(hours=8))

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(url, referer=None):
    headers = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    if referer:
        headers["Referer"] = referer
    with opener.open(urllib.request.Request(url, headers=headers), timeout=60) as r:
        return r.read().decode("utf-8-sig")


def num(v):
    try:
        n = float(str(v).replace(",", "").strip())
        return n if n == n else None
    except (TypeError, ValueError):
        return None


def roc_to_ymd(s):
    """'1151009' -> '20261009'"""
    s = str(s or "").strip()
    if len(s) == 7 and s.isdigit():
        return f"{int(s[:3]) + 1911}{s[3:]}"
    return s if len(s) == 8 and s.isdigit() else ""


def load_daily():
    q, errors = {}, []
    try:
        for x in json.loads(get(TWSE)):
            code, p = (x.get("Code") or "").strip(), num(x.get("ClosingPrice"))
            if code and p:
                vol = num(x.get("TradeVolume"))
                q[code] = [x.get("Name", "").strip(), p, num(x.get("Change")) or 0, "tse",
                           num(x.get("OpeningPrice")), num(x.get("HighestPrice")), num(x.get("LowestPrice")),
                           round(vol / 1000) if vol else None, roc_to_ymd(x.get("Date")), "", None]
    except Exception as e:  # noqa: BLE001
        errors.append(f"TWSE daily: {e}")
    try:
        for x in json.loads(get(TPEX)):
            code, p = (x.get("SecuritiesCompanyCode") or "").strip(), num(x.get("Close"))
            if code and p and code not in q:
                vol = num(x.get("TradingShares"))
                q[code] = [(x.get("CompanyName") or "").strip(), p, num(x.get("Change")) or 0, "otc",
                           num(x.get("Open")), num(x.get("High")), num(x.get("Low")),
                           round(vol / 1000) if vol else None, roc_to_ymd(x.get("Date")), "", None]
    except Exception as e:  # noqa: BLE001
        errors.append(f"TPEx daily: {e}")
    for c, v in q.items():
        v[10] = round(v[1] - v[2], 4) if v[1] is not None else None
    return q, errors


def first(s):
    return num(str(s or "").split("_")[0])


def apply_mis(q):
    """以 MIS 批次查詢覆蓋當日行情。回傳成功筆數。"""
    try:
        get(MIS_HOME)  # 取得 session cookie
    except Exception as e:  # noqa: BLE001
        print(f"MIS home: {e}", file=sys.stderr)
    keys = [f"{v[3]}_{c}.tw" for c, v in q.items()]
    ok = 0
    for i in range(0, len(keys), 60):
        chunk = keys[i:i + 60]
        url = f"{MIS_API}?ex_ch={urllib.parse.quote('|'.join(chunk), safe='|_.')}&json=1&delay=0&_={int(time.time() * 1000)}"
        try:
            data = json.loads(get(url, referer=MIS_HOME))
        except Exception as e:  # noqa: BLE001
            print(f"MIS chunk {i}: {e}", file=sys.stderr)
            time.sleep(1)
            continue
        for it in data.get("msgArray", []):
            code = (it.get("c") or "").strip()
            if code not in q:
                continue
            prev = num(it.get("y"))
            last = num(it.get("z")) or first(it.get("b")) or first(it.get("a"))
            if not last and not prev:
                continue
            price = last or prev
            v = q[code]
            v[0] = (it.get("n") or v[0]).strip()
            v[1] = price
            v[2] = round(price - prev, 4) if prev else v[2]
            v[4], v[5], v[6] = num(it.get("o")), num(it.get("h")), num(it.get("l"))
            v[7] = int(num(it.get("v")) or 0) or None
            v[8] = (it.get("d") or v[8] or "").strip()
            v[9] = (it.get("t") or "").strip()
            v[10] = prev
            ok += 1
        time.sleep(0.4)
    return ok


def main():
    q, errors = load_daily()
    for e in errors:
        print(e, file=sys.stderr)
    print(f"daily list: {len(q)}")
    if len(q) < 500:
        print("Too few codes; keeping previous file.", file=sys.stderr)
        sys.exit(0)
    ok = apply_mis(q)
    print(f"MIS updated: {ok}")
    for c in ("2330", "0050", "00981A", "6488"):
        print(c, q.get(c))

    try:
        with open(OUT, encoding="utf-8") as f:
            if json.load(f).get("q") == json.loads(json.dumps(q, ensure_ascii=False)):
                print("No data change; skip write.")
                return
    except (OSError, ValueError):
        pass
    data = {"updated": datetime.now(TW).strftime("%Y-%m-%d %H:%M"), "q": q}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(q)} quotes")


if __name__ == "__main__":
    main()
