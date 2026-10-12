#!/usr/bin/env python3
"""抓取上市（TWSE）與上櫃（TPEx）每日收盤行情，輸出 data/quotes.json。

格式：{"updated": "...", "q": {"2330": ["台積電", 收盤, 漲跌, "tse"|"otc"], ...}}
只用標準函式庫，供 GitHub Actions 定時執行。
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

TWSE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "quotes.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def num(v):
    try:
        n = float(str(v).replace(",", "").strip())
        return n
    except (TypeError, ValueError):
        return None


def main():
    q = {}
    errors = []
    try:
        for x in get(TWSE):
            p = num(x.get("ClosingPrice"))
            if x.get("Code") and p:
                q[x["Code"].strip()] = [x.get("Name", "").strip(), p, num(x.get("Change")) or 0, "tse"]
    except Exception as e:  # noqa: BLE001
        errors.append(f"TWSE: {e}")
    try:
        for x in get(TPEX):
            p = num(x.get("Close"))
            code = (x.get("SecuritiesCompanyCode") or "").strip()
            if code and p and code not in q:
                q[code] = [(x.get("CompanyName") or "").strip(), p, num(x.get("Change")) or 0, "otc"]
    except Exception as e:  # noqa: BLE001
        errors.append(f"TPEx: {e}")

    for e in errors:
        print(e, file=sys.stderr)
    if len(q) < 500:
        print(f"Only {len(q)} quotes fetched; keeping previous file.", file=sys.stderr)
        sys.exit(1 if not os.path.exists(OUT) else 0)

    tw = timezone(timedelta(hours=8))
    data = {"updated": datetime.now(tw).strftime("%Y-%m-%d %H:%M"), "q": q}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(q)} quotes")


if __name__ == "__main__":
    main()
