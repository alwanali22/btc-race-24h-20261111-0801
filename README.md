# BTC Race Bot — Deep-Dip Bounce

A bot for make.fun's "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261111-0801`): it trades Coinbase Wrapped BTC (CBBTC)
against USDC on 1-minute bars, starting with 1,000 USDC of paper money.

## Strategy

The dev window is a choppy, slowly falling day (-1.07%; every baseline loses
money on it), so this bot trades rarely and only buys real panic dips:

- **Tier 1:** when the close falls 1.5% below the rolling 120-bar (2h) high,
  buy half the equity.
- **Tier 2:** if the fall deepens to 2.5% below that high, buy the other half.
- **Exit:** sell everything at +1.5% from the first entry, or on a 1.5%
  trailing pullback from the peak since entry. After an exit, no new entry
  for 10 bars, so a trailing-stop sale into a still-falling market is not
  re-bought one bar later for another round of fees.

One round trip pays about 26-28 bps in fees, slippage and price impact, so
the 1.5% take-profit clears that with room to spare. All decisions are
integer basis-point math on the bar closes: the bot is exactly deterministic
(the same bars always give the same orders), never reads the clock, the
environment or any file outside the repository, and never uses randomness.

## Local grade (dev window, kit's own grader)

```
net PnL   +9.76 USDC  (return +0.98%)
trading   2 trades, win rate 1.00, max drawdown 1.01%, 0 rejected
fees      0.80 USDC; at 2x fees net PnL +8.95 USDC
guardrails met; L1 regrade reproduced byte for byte
```

For comparison on the same dev window: EMA cross -89.29, ADX momentum -59.40,
RSI-Bollinger -29.65, buy-and-hold -13.44, momentum -12.03 USDC. The dev gate
needs net PnL above 0 — this bot clears it.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte for byte
- `LICENSE` — MIT
