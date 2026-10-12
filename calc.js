// 台股交易計算核心（以「分」= 0.01 元為整數單位，避免浮點誤差）
(function (root) {
  const FEE_RATE = 0.001425;
  // 證交稅：股票 3‰、當沖 1.5‰（優惠至 2027/12/31）、ETF 1‰、
  // 債券 ETF 停徵（至 2026/12/31；延長案 2026/10 尚在立法院，過期前需確認）
  const BOND_EXEMPT_UNTIL = '2026-12-31';
  const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const bondTax = (today) => ((today || taipeiToday()) <= BOND_EXEMPT_UNTIL ? 0 : 0.001);
  const TAX = { stock: 0.003, daytrade: 0.0015, etf: 0.001, get bond() { return bondTax(); } };

  // 跳動單位（單位：分）。cents 為價格*100
  function stepAt(cents, kind) {
    if (kind === 'etf' || kind === 'bond') return cents < 5000 ? 1 : 5;
    if (cents < 1000) return 1;      // < 10 元：0.01
    if (cents < 5000) return 5;      // 10~50：0.05
    if (cents < 10000) return 10;    // 50~100：0.1
    if (cents < 50000) return 50;    // 100~500：0.5
    if (cents < 100000) return 100;  // 500~1000：1
    return 500;                      // >= 1000：5
  }
  const up = (c, k) => c + stepAt(c, k);
  const down = (c, k) => (c <= 0 ? 0 : Math.max(0, c - stepAt(c - 1, k)));

  // 將任意價格調整到合法檔位（向下取整到該區間的跳動單位）
  function snap(c, k) {
    const s = stepAt(c, k);
    return Math.round(c / s) * s;
  }

  // 無條件捨去至元；先取到小數 6 位，避免 855.9999999 這類浮點誤差被捨成 855
  const floorYuan = x => Math.floor(Number(x.toFixed(6)));

  function fee(amount, discount, minFee) {
    // 券商實務：手續費無條件捨去，且不低於最低手續費
    const f = floorYuan(amount * FEE_RATE * (discount / 10));
    return Math.max(f, minFee);
  }

  // buyC / sellC 單位為分；shares 為股數
  function trade({ buyC, sellC, shares, kind, discount, minFee }) {
    const cost = Math.round(buyC * shares) / 100;
    const value = Math.round(sellC * shares) / 100;
    const buyFee = fee(cost, discount, minFee);
    const sellFee = fee(value, discount, minFee);
    const tax = floorYuan(value * TAX[kind]);
    const total = cost + buyFee + sellFee + tax;
    const pnl = Math.round((value - total) * 100) / 100;
    const ret = total > 0 ? pnl / total : 0;
    return { cost, value, buyFee, sellFee, tax, total, pnl, ret };
  }

  // 損益兩平：損益 >= 0 的最低檔位價。
  // 先用連續公式估算（同 stock.epoch.tw），再逐檔確認；因手續費、稅無條件捨去，實際兩平價可能再低一檔。
  function breakEven(p) {
    if (!(p.shares > 0) || !(p.buyC > 0)) return null;
    const ok = c => trade({ ...p, sellC: c }).pnl >= 0;
    const r = FEE_RATE * (p.discount / 10), t = TAX[p.kind];
    const cost = p.buyC / 100 * p.shares, buyFee = Math.max(p.minFee, cost * r);
    let est = (cost + buyFee + p.minFee) / (p.shares * (1 - t));          // 賣出手續費以最低計
    const f = 1 - r - t;
    if (f > 0) { const m = (cost + buyFee) / (p.shares * f); if (m * p.shares * r >= p.minFee) est = m; }
    let c = Math.ceil(est * 100);
    c = Math.ceil(c / stepAt(c, p.kind)) * stepAt(c, p.kind);
    for (let i = 0; i < 100000 && !ok(c); i++) c = up(c, p.kind);
    for (let i = 0; i < 100000; i++) { const d = down(c, p.kind); if (d > 0 && d < c && ok(d)) c = d; else break; }
    return c;
  }

  // 以 centerC 為中心產生上下 n 檔；limitUp/limitDown 可選（分）
  function ladder(centerC, n, kind, limitUp, limitDown) {
    const c0 = snap(centerC, kind);
    const ups = [], downs = [];
    let c = c0;
    for (let i = 0; i < n; i++) {
      const nx = up(c, kind);
      if (limitUp && nx > limitUp) break;
      ups.push(nx); c = nx;
    }
    c = c0;
    for (let i = 0; i < n; i++) {
      const nx = down(c, kind);
      if (nx <= 0 || (limitDown && nx < limitDown) || nx === c) break;
      downs.push(nx); c = nx;
    }
    return [...ups.reverse(), c0, ...downs]; // 高 → 低
  }

  // 漲跌停價：昨收 ±10%，漲停向下取檔、跌停向上取檔
  function limits(prevC, kind) {
    let hi = Math.floor(prevC * 1.1);
    let lo = Math.ceil(prevC * 0.9);
    const sh = stepAt(hi, kind); hi = Math.floor(hi / sh) * sh;
    const sl = stepAt(lo, kind); lo = Math.ceil(lo / sl) * sl;
    return { hi, lo };
  }

  const api = { BOND_EXEMPT_UNTIL, bondTax, stepAt, up, down, snap, fee, trade, breakEven, ladder, limits, TAX, FEE_RATE };
  if (typeof module !== 'undefined') module.exports = api; else root.StockCalc = api;
})(this);
