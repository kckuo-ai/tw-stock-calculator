const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

describe('tick steps and snapping', () => {
  it('returns correct stock tick sizes across all price tiers', () => {
    assert.equal(C.stepAt(999, 'stock'), 1);
    assert.equal(C.stepAt(1000, 'stock'), 5);
    assert.equal(C.stepAt(4995, 'stock'), 5);
    assert.equal(C.stepAt(5000, 'stock'), 10);
    assert.equal(C.stepAt(9990, 'stock'), 10);
    assert.equal(C.stepAt(10000, 'stock'), 50);
    assert.equal(C.stepAt(49950, 'stock'), 50);
    assert.equal(C.stepAt(50000, 'stock'), 100);
    assert.equal(C.stepAt(99900, 'stock'), 100);
    assert.equal(C.stepAt(100000, 'stock'), 500);
  });

  it('returns correct ETF and bond ETF tick sizes', () => {
    for (const kind of ['etf', 'bond']) {
      assert.equal(C.stepAt(4999, kind), 1);
      assert.equal(C.stepAt(5000, kind), 5);
      assert.equal(C.stepAt(15000, kind), 5);
    }
  });

  it('steps up and down cleanly across tier boundaries', () => {
    assert.equal(C.up(999, 'stock'), 1000);
    assert.equal(C.down(1000, 'stock'), 999);
    assert.equal(C.up(4995, 'stock'), 5000);
    assert.equal(C.down(5000, 'stock'), 4995);
    assert.equal(C.up(99900, 'stock'), 100000);
    assert.equal(C.down(100000, 'stock'), 99900);
    assert.equal(C.down(0, 'stock'), 0);
  });

  it('snaps arbitrary prices to nearest valid tick', () => {
    assert.equal(C.snap(1002, 'stock'), 1000);
    assert.equal(C.snap(1003, 'stock'), 1005);
    assert.equal(C.snap(5002, 'etf'), 5000);
    assert.equal(C.snap(5003, 'etf'), 5005);
  });
});

describe('fee, trade, and break-even', () => {
  it('applies discount, floors to integer yuan, and enforces minFee', () => {
    // 100,000 * 0.001425 * 0.6 = 85.5 -> floor 85
    assert.equal(C.fee(100000, 6, 20), 85);
    // 10,000 * 0.001425 * 0.6 = 8.55 -> minFee 20
    assert.equal(C.fee(10000, 6, 20), 20);
    // odd-lot minFee 1
    assert.equal(C.fee(1000, 6, 1), 1);
  });

  it('computes cash stock trade PnL accurately', () => {
    const res = C.trade({ buyC: 10000, sellC: 10500, shares: 1000, kind: 'stock', discount: 6, minFee: 20 });
    assert.equal(res.cost, 100000);
    assert.equal(res.value, 105000);
    assert.equal(res.buyFee, 85);
    assert.equal(res.sellFee, 89); // 105000 * 0.001425 * 0.6 = 89.775 -> 89
    assert.equal(res.tax, 315);   // 105000 * 0.003 = 315
    assert.equal(res.total, 100489);
    assert.equal(res.pnl, 4511);
  });

  it('finds lowest break-even tick with pnl >= 0', () => {
    const p = { buyC: 10000, shares: 1000, kind: 'stock', discount: 6, minFee: 20 };
    const be = C.breakEven(p);
    assert.ok(be > p.buyC);
    assert.ok(C.trade({ ...p, sellC: be }).pnl >= 0);
    assert.ok(C.trade({ ...p, sellC: C.down(be, 'stock') }).pnl < 0);
  });

  it('computes daily price limits aligned to ticks', () => {
    const lim = C.limits(10000, 'stock'); // 100.00 -> 110.00 / 90.00
    assert.equal(lim.hi, 11000);
    assert.equal(lim.lo, 9000);
  });

  it('handles bondTax exemption date boundary', () => {
    assert.equal(C.bondTax('2026-12-31'), 0);
    assert.equal(C.bondTax('2027-01-01'), 0.001);
  });
});

describe('credit trading (margin, short, credit day-trade)', () => {
  it('computes marginLong loan, interest, own funds, and maintenance ratio', () => {
    const r = C.marginLong({
      buyC: 10000, sellC: 11000, shares: 1000, kind: 'stock',
      discount: 6, minFee: 20, ratio: 0.6, rate: 0.0645, days: 30,
    });
    assert.equal(r.loan, 60000);
    assert.equal(r.interest, Math.round(60000 * 0.0645 * 30 / 365)); // 318
    assert.equal(r.own, 100000 - 60000 + r.buyFee);
    assert.ok(r.maint > 1.8 && r.maint < 1.85);
    assert.equal(r.callC, 7800); // 60000 * 1.3 * 100 / 1000 = 7800 (78.00)
  });

  it('computes shortSell deposit, collateral, borrow fee, and call price', () => {
    const r = C.shortSell({
      entryC: 10000, exitC: 9500, shares: 1000, kind: 'stock',
      discount: 6, minFee: 20, ratio: 0.9, sbl: 0.001, rate: 0.001, days: 10,
    });
    assert.equal(r.deposit, 90000);
    assert.equal(r.borrow, 100);
    assert.equal(r.tax, 300);
    assert.ok(r.pnl > 0);
    assert.ok(r.callC > 10000);
  });

  it('computes creditDayTrade using non-daytrade tax rate and zero interest', () => {
    const r = C.creditDayTrade({
      buyC: 10000, sellC: 10200, shares: 1000, kind: 'daytrade',
      discount: 6, minFee: 20, sbl: 0.001, dir: 'long',
    });
    // 資券當沖不適用現股當沖減半，應以 3‰ 課稅
    assert.equal(r.tax, Math.floor(102000 * 0.003));
    assert.equal(r.borrow, Math.floor(102000 * 0.001));
    assert.equal(r.pnl, 102000 - 100000 - r.buyFee - r.sellFee - r.tax - r.borrow);
  });
});
