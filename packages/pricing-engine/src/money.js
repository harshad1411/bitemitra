// Integer money arithmetic (PRICING.md §1). Amounts are integer paise; rates are integer basis points.
// Phase 1 ships only these primitives; the pricing pipeline is Phase 4.

const MAX = Number.MAX_SAFE_INTEGER;

/** @param {number} v @param {string} [name] */
export function assertPaise(v, name = 'amount') {
  if (!Number.isSafeInteger(v)) throw new TypeError(`${name} must be a safe integer number of paise, got ${v}`);
  return v;
}

/** @param {number} v @param {string} [name] */
export function assertBps(v, name = 'rate') {
  if (!Number.isSafeInteger(v) || v < 0) throw new TypeError(`${name} must be a non-negative integer (basis points), got ${v}`);
  return v;
}

/**
 * Integer division rounding half away from zero.
 * @param {number} numerator
 * @param {number} denominator positive
 */
export function divRoundHalfUp(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError('divRoundHalfUp expects safe integers and a positive denominator');
  }
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((n * 2 + denominator) / (2 * denominator));
}

/**
 * amount × bps / 10 000, rounded half-up. The ONLY percentage function (PRICING.md §1.2).
 * @param {number} amountPaise
 * @param {number} bps
 */
export function applyBps(amountPaise, bps) {
  assertPaise(amountPaise);
  assertBps(bps);
  const product = amountPaise * bps;
  if (!Number.isSafeInteger(product) || Math.abs(product) > MAX) throw new RangeError('applyBps overflow');
  return divRoundHalfUp(product, 10_000);
}

/**
 * Tax contained in a tax-inclusive amount: gross × rate / (10 000 + rate), half-up.
 * @param {number} grossPaise
 * @param {number} rateBps
 */
export function inclusiveTax(grossPaise, rateBps) {
  assertPaise(grossPaise);
  assertBps(rateBps);
  return divRoundHalfUp(grossPaise * rateBps, 10_000 + rateBps);
}

/**
 * Round to a multiple of `stepPaise` (e.g. 100 = nearest ₹1).
 * @param {number} amountPaise
 * @param {number} stepPaise
 * @param {'HALF_UP' | 'UP' | 'DOWN'} [direction]
 */
export function roundToStep(amountPaise, stepPaise, direction = 'HALF_UP') {
  assertPaise(amountPaise);
  if (!Number.isSafeInteger(stepPaise) || stepPaise <= 0) throw new TypeError('stepPaise must be a positive integer');
  if (direction === 'UP') return Math.ceil(amountPaise / stepPaise) * stepPaise;
  if (direction === 'DOWN') return Math.floor(amountPaise / stepPaise) * stepPaise;
  return divRoundHalfUp(amountPaise, stepPaise) * stepPaise;
}

/**
 * Split `totalPaise` across weights so the parts sum EXACTLY to the total (largest-remainder method;
 * ties go to the earlier index — deterministic).
 * @param {number} totalPaise non-negative
 * @param {number[]} weights non-negative integers, not all zero
 * @returns {number[]}
 */
export function allocate(totalPaise, weights) {
  assertPaise(totalPaise);
  if (totalPaise < 0) throw new RangeError('allocate expects a non-negative total');
  if (!weights.length) throw new RangeError('allocate needs at least one weight');
  weights.forEach((w, i) => assertPaise(w, `weights[${i}]`));
  if (weights.some((w) => w < 0)) throw new RangeError('weights must be non-negative');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new RangeError('weights must not all be zero');
  const base = weights.map((w) => Math.floor((totalPaise * w) / sum));
  const remainders = weights.map((w, i) => ({ i, r: (totalPaise * w) % sum }));
  let left = totalPaise - base.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left === 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}
