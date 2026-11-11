# Dip Buyer v2 — Race a BTC trading bot live for 24 hours

make.fun bounty entry (btc-race-24h-20261111-0801) by alwanali22.
A deep-dip bounce bot for CBBTC on the bars-replay/v1 protocol (Node 22,
standard library only, no network, fully deterministic).

## Strategy

On the published dev window every trend, momentum and mean-reversion baseline
loses money, and so does buy-and-hold — the day is a choppy grind down
(-1.07%). The only family that clears the dev gate is buying real panic dips
and then doing nothing:

- **Tier 1:** the close falls 1.5% below the rolling 120-bar (2h) high ->
  buy **20% of equity**.
- **Tier 2:** the close falls 2.5% below the same high -> buy the rest
  (100% invested).
- **Exit all:** +1.5% from the first entry, or a 1.5% trailing pullback from
  the peak since entry; 10-bar post-exit cooldown before new entries.
- Buys are capped by the position weight room, so an order can never be
  rejected for breaching the cap. Max slippage 150 bps per order.

## v2 change vs v1

v1 bought 50% / 50%. v2 buys 20% / 80%: the second fill is always cheaper
than the first (it happens at a deeper dip), so weighting the cheaper fill
more is worth about +2.5 USDC on dev. Trigger levels are unchanged, so the
bot is exactly as active as v1 — same bars fire, same >=1-trade guardrail
behaviour. If the dip never reaches the second level the bot simply holds
its 20%, still a positive guardrail-passing trade on dev.

## Local grade (kit grade-local, --driver process, real harness)

- **net PnL +12.256257 USDC (+1.23%)**, 2 trades, win rate 1.00
- max drawdown 1.01%, exposure 63.9%, fees 0.81 USDC
- **at 2x fees: +11.446896 USDC** — clearly positive
- 0 rejected orders; guardrails met (trades_ok, drawdown_ok, compliant)
- L1 regrade reproduced byte for byte
  (action_log_sha256 73d5d131798abae9c22722e6eaad46fbe1068746f4cb3ae4a961d8ee2b3f216d)

v1 for comparison: +9.760865 USDC. v2 beats it by +2.495392 USDC on the
same dev window, with the same triggers and the same 2 fills.

## Files

- `main.ts` — the bot (entrypoint)
- `vendor/makefun-bars.ts` — kit SDK shim, byte-for-byte copy of the kit's
- `LICENSE` — MIT
- `.makefun/owner.json` — claim file (wallet 65Bu7L66sFtge9fLgP8NveuS9rYbBS3soNGbizNZmtoV)
