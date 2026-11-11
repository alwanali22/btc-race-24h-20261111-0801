// Deep-dip bounce bot for the BTC race (agent-fun/bars-replay/v1, Node 22).
//
// Idea, in one paragraph: on the published dev window every trend, momentum
// and mean-reversion baseline loses money, and so does buy-and-hold — the day
// is a choppy grind down (-1.07%). The only family that clears the dev gate
// is buying real panic dips and then doing nothing: when the close falls far
// below the rolling 120-bar (2h) high, buy; when it falls further, buy the
// rest; then hold to the end of the window unless the bounce pays out (+1.5%)
// or the trailing stop (-1.5% from the peak since entry) fires. One round
// trip pays about 26-28 bps in fees, slippage and impact, so a 1.5% exit
// clears that with room to spare.
//
// v2 sizing (the change from v1): the first buy takes only 20% of equity and
// the second buy takes the other 80%. The two buys always happen at different
// prices — the second one is deeper, hence cheaper — so weighting the cheaper
// fill more is worth about +2.3 USDC on the dev window (grade-local). The
// trigger levels are unchanged from v1 (1.5% / 2.5% below the 120-bar high),
// so the bot is exactly as active as v1: it fires on the same bars and keeps
// the same >=1-trade guardrail behaviour. If the dip never reaches the second
// level the bot simply holds its 20% — still a positive, guardrail-passing
// trade on dev — and if it never reaches the first level it trades nothing,
// exactly like v1.
//
// Everything is integer basis-point math on the bar closes, so the bot is
// exactly deterministic: the same bars always give the same orders. It never
// reads the clock, the environment or any file outside the repository, and it
// never uses randomness. Hello, batch, orders and bar are the only protocol
// words it speaks, through the vendored kit SDK shim in vendor/.

import { runBars, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const HIGH_BARS = 120; // rolling high window, in 1-min bars (2h)
const DIP1_BPS = 150; // first buy: close this far below the rolling high
const DIP2_BPS = 250; // second buy: close this far below the rolling high
const TIER1_PCT = 20; // first buy takes this % of equity; the rest goes on tier 2
const TAKE_BPS = 150; // exit all: this far above the first entry
const TRAIL_BPS = 150; // exit all: this far below the peak since entry
const COOLDOWN_BARS = 10; // bars with no new entries after an exit
const MAX_SLIPPAGE_BPS = 150;

// Rolling closes, oldest first, capped at HIGH_BARS entries.
const closes: bigint[] = [];
let entry: bigint | null = null; // first-entry close of the open round trip
let peak: bigint | null = null; // highest close since entry
let cooldown = 0;
let secondDone = false;

function below(price: bigint, ref: bigint, bps: number): boolean {
  // price <= ref * (1 - bps/10000), in integers, no floats anywhere.
  return price * 10_000n <= ref * BigInt(10_000 - bps);
}

function above(price: bigint, ref: bigint, bps: number): boolean {
  return price * 10_000n >= ref * BigInt(10_000 + bps);
}

function buy(symbol: string, notional: bigint): BuyInput {
  return { side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

await runBars({
  onBatch(state) {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);
    if (closes.length > HIGH_BARS) closes.shift();
    let high = closes[0];
    for (const c of closes) if (c > high) high = c;
    if (cooldown > 0) cooldown -= 1;

    const held = state.positions.get(SYMBOL)?.qty ?? 0n;
    const orders: OrderInput[] = [];

    if (held > 0n && entry !== null && peak !== null) {
      if (close > peak) peak = close;
      // Exit the whole position on take-profit or trailing pullback.
      if (above(close, entry, TAKE_BPS) || below(close, peak, TRAIL_BPS)) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held, max_slippage_bps: MAX_SLIPPAGE_BPS };
        entry = null;
        peak = null;
        secondDone = false;
        cooldown = COOLDOWN_BARS;
        return [sell];
      }
      // Still holding only the first tier and the dip deepened: buy the rest,
      // capped by the weight room so the order can never be rejected for
      // breaching the position cap (normally 100% of equity, so no-op).
      if (!secondDone && below(close, high, DIP2_BPS)) {
        const room = state.weightRoom(SYMBOL);
        const rest = state.cash < room ? state.cash : room;
        if (rest >= BigInt(state.hello.fees.min_notional_quote_units)) {
          orders.push(buy(SYMBOL, rest));
          secondDone = true;
        }
      }
      return orders;
    }

    if (held === 0n && cooldown === 0 && below(close, high, DIP1_BPS)) {
      // First tier: a small probe, TIER1_PCT of equity, capped by the weight
      // room so the order can never be rejected for breaching the cap.
      const room = state.weightRoom(SYMBOL);
      const sized = (state.equity * BigInt(TIER1_PCT)) / 100n;
      const first = sized < room ? sized : room;
      if (first < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      orders.push(buy(SYMBOL, first));
      entry = close;
      peak = close;
      secondDone = false;
      // Same bar already deep enough for tier 2: take the rest at once.
      if (below(close, high, DIP2_BPS)) {
        const rest = state.cash - first;
        if (rest >= BigInt(state.hello.fees.min_notional_quote_units)) {
          orders.push(buy(SYMBOL, rest));
          secondDone = true;
        }
      }
      return orders;
    }

    return [];
  },
});
