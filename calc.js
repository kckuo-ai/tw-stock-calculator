// 台股交易計算核心（以「分」= 0.01 元為整數單位，避免浮點誤差）
(function (root) {
  const FEE_RATE = 0.001425;
  const TAX = { stock: 0.003, daytrade: 0.0015, etf: 0.001 };

  // 跳動單位（單位：分）。cents 為價格*100
  function stepAt(cents, kind) {
    if (kind === 'etf') return cents < 5000 ? 1 : 5;
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

  function fee(amount, discount, minFee) {
    // 券商實務：手續費無條件捨去，且不低於最低手續費
    const f = Math.floor(amount * FEE_RATE * (discount / 10));
    return Math.max(f, minFee);
  }

  // buyC / sellC 單位為分；shares 為股數
  function trade({ buyC, sellC, shares, kind, discount, minFee }) {
    const cost = Math.round(buyC * shares) / 100;
    const value = Math.round(sellC * shares) / 100;
    const buyFee = fee(cost, discount, minFee);
    const sellFee = fee(value, discount, minFee);
    const tax = Math.floor(value * TAX[kind]);
    const total = cost + buyFee + sellFee + tax;
    const pnl = Math.round((value - total) * 100) / 100;
    const ret = total > 0 ? pnl / total : 0;
    return { cost, value, buyFee, sellFee, tax, total, pnl, ret };
  }

  // 損益兩平：從買價起往上找第一個損益 >= 0 的檔位
  function breakEven(p) {
    let c = snap(p.buyC, p.kind);
    for (let i = 0; i < 2000; i++) {
      if (trade({ ...p, sellC: c }).pnl >= 0) return c;
      c = up(c, p.kind);
    }
    return null;
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

  const api = { stepAt, up, down, snap, fee, trade, breakEven, ladder, limits, TAX, FEE_RATE };
  if (typeof module !== 'undefined') module.exports = api; else root.StockCalc = api;
})(this);
