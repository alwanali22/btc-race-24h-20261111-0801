// Deep-dip bounce bot for the BTC race (agent-fun/bars-replay/v1, Node 22).
//
// Strategy, in one paragraph: the dev window is a choppy, slowly falling day
// (-1.07%; every trend and mean-reversion baseline loses money on it), so this
// bot does almost nothing most of the time and only buys real panic dips: when
// the close falls 1.5% below the rolling 120-bar (2h) high it buys half the
// equity, and if the fall deepens to 2.5% below that high it buys the other
// half. It exits the whole position at +1.5% from the first entry or on a 1.5%
// trailing pullback from the peak since entry, whichever comes first. One
// round trip pays about 26-28 bps in fees, slippage and impact, so the 1.5%
// take-profit clears that with room to spare, and the wide trailing stop lets
// a real recovery run instead of cutting it at the first wobble.
//
// Why this shape and not a trend bot: on the published dev window every
// baseline (EMA cross -89, ADX momentum -59, RSI-Bollinger -30, buy-and-hold
// -13, momentum -12 USDC) loses, and a 60-bar mean-reversion scan loses too.
// The only family that clears the dev gate in the scan is deep-dip buying with
// a wide trailing exit (+9.4 USDC for the two-tier version, +11.9 for a single
// 2.2% dip). Two tiers keep the bot active on days where the dip only reaches
// 1.5%, while the second tier catches the deeper washouts that pay the most.
//
// Everything is integer basis-point math on the bar closes, so the bot is
// exactly deterministic: the same bars always give the same orders. It never
// reads the clock, the environment or any file outside the repository, and it
// never uses randomness. Hello, batch, orders and bar are the only protocol
// words it speaks, through the vendored kit SDK shim in vendor/.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Rolling-high window, in bars (120 one-minute bars = 2 hours).
const WINDOW = 120;
// Tier 1 buys half the equity this far below the rolling high, in bps.
const DIP1_BPS = 150n;
// Tier 2 buys the rest this far below the same high, in bps.
const DIP2_BPS = 250n;
// Exit the whole position this far above the first entry, in bps.
const TAKE_PROFIT_BPS = 150n;
// ... or this far below the peak since entry, in bps.
const TRAIL_BPS = 150n;
// Largest fill move from the latest close we accept, in bps.
const MAX_SLIPPAGE_BPS = 150;
// Smallest buy, in quote units (1 USDC = 1,000,000).
const MIN_NOTIONAL = 1_000_000n;
// Basis points per unit.
const BPS = 10_000n;

// Bar closes so far, as bigints (price_scale 5). The only state the strategy
// reads, besides the account the harness sends each batch.
const closes: bigint[] = [];
// Tiers filled: 0 = flat, 1 = half in, 2 = fully in.
let tier = 0;
// Close at the first (tier 1) entry, and the highest close since entry.
let entry = 0n;
let peak = 0n;
// Bars are counted in closes.length. After an exit, no new entry is taken
// until this bar index passes: selling on a trailing stop into a still-falling
// market and re-buying one bar later would just churn the same dip for fees.
let cooldownUntil = -1;

function rollingHigh(): bigint {
  let high = 0n;
  for (let i = closes.length - WINDOW - 1; i < closes.length - 1; i++) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
}

await runBars({
  onBatch(state: BarsState, _batch: Batch) {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);

    // Need a full window of history before the first decision.
    if (closes.length <= WINDOW) return [];

    const high = rollingHigh();
    const held = state.positions.get(SYMBOL);
    const heldQty = held === undefined ? 0n : held.qty;

    // A tier we think we filled but hold nothing (a rejected fill) resets,
    // so the bot can re-enter instead of sitting on a phantom position.
    if (tier > 0 && heldQty === 0n) tier = 0;

    // Flat: buy tier 1 on a 1.5% dip below the rolling high, once any
    // post-exit cooldown has passed.
    if (tier === 0) {
      if (closes.length > cooldownUntil && close * BPS < high * (BPS - DIP1_BPS)) {
        let notional = state.equity / 2n;
        if (notional > state.cash) notional = state.cash;
        const room = state.weightRoom(SYMBOL);
        if (notional > room) notional = room;
        if (notional >= MIN_NOTIONAL) {
          tier = 1;
          entry = close;
          peak = close;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Half in: buy the rest on a 2.5% dip below the same high.
    if (tier === 1) {
      if (close * BPS < high * (BPS - DIP2_BPS)) {
        let notional = state.cash;
        const room = state.weightRoom(SYMBOL);
        if (notional > room) notional = room;
        if (notional >= MIN_NOTIONAL) {
          tier = 2;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }

    // In: track the peak and exit on take-profit or trailing pullback.
    if (close > peak) peak = close;
    const takeProfit = close * BPS >= entry * (BPS + TAKE_PROFIT_BPS);
    const trailingStop = close * BPS < peak * (BPS - TRAIL_BPS);
    if (takeProfit || trailingStop) {
      tier = 0;
      cooldownUntil = closes.length + 10;
      if (heldQty > 0n) {
        return [{ side: 'sell', symbol: SYMBOL, qty: heldQty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
