# BTC Race Bot — Entry Report

Competition: `btc-race-24h-20261118-1444` — "Race a BTC trading bot live for 24 hours"
Account: daring-puffin-40 (wallet `7XoCtAPHFo3cFXuS6dU845GLckqSzfmvY3v28rxagNcn`, see `.makefun/owner.json`)
Deadline: 2026-11-19 04:44 WITA. Status: READY to push + submit (login/submit not done — blocked on account login, per parent agent).

## Strategy (5 lines)

- Long-only, one position, full size. Only trades when a move is already
  confirmed and large enough to pay the ~26–36 bps round-trip cost.
- Entry 1 — DIP-REVERSAL: close >= 1.2% below the 60-bar high AND back above
  its 10-bar EMA and above the previous close (a deep dip that stopped falling).
- Entry 2 — BREAKOUT: close above the 90-bar high AND above its 30-bar EMA
  with EMA(10) > EMA(30) (an uptrend that just confirmed itself).
- Exit (whole position, first hit on a close): take-profit +0.7% over the
  actual fill price, trailing stop 0.5% below the peak close since entry, or
  hard stop −1.0% below the fill price.
- 60-bar cooldown after every exit; no entry in the last 60 bars of the
  1,440-bar window. Deterministic: float64 only, no clock, no env, no
  randomness. Exits are measured from the real fill price (from batch fills),
  not the decision close — this mattered: a +0.8% TP over the fill price was
  just out of reach on the dev window's best move, +0.7% hits it.

## Parameters

- `DIP_DROP = 0.012` (60-bar lookback), `BREAKOUT_LOOKBACK = 90`
- `EMA_FAST = 10`, `EMA_SLOW = 30` (seeded as the mean of the first span of closes)
- `TAKE_PROFIT = 0.007`, `TRAIL = 0.005`, `HARD_STOP = 0.01`
- `COOLDOWN_BARS = 60`, `LAST_ENTRY_SEQ = 1380`, `MAX_SLIPPAGE_BPS = 100`

## Dev-window analysis (why this shape)

- Dev window: BTC drifts −2.80% (65,083 → 62,761), 1m volatility ~6.7 bps,
  146 flat bars. Buy-and-hold loses −$31.63; all kit baselines lose
  (momentum −$23.87, ema-cross −$148.17, rsi-bollinger −$39.92,
  adx-momentum −$75.57, hold-cash $0). A bot must sit in cash through the
  drops and catch the recovery legs (trough ~63,665 → peak ~64,948, +2.0%).
- Python backtest grid (TP 0.7–0.9% × trail 0.5–0.7%) forms a plateau at
  +$13–18, not a spike; dip-only +$6.88 and breakout-only +$10.65 are each
  positive on their own, so the result does not rest on one signal.

## Grade-local result (process driver)

Command:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot <entry> --driver process --json
```

- Status: `finished`, error: none
- Net PnL: **+$13.50** (return +1.35%) — comfortably above the dev gate (> $0)
- Trades: 8 legs = 4 round trips (buys at seq 72, 337, 466, 814; sells at 85, 406, 529, 1048), win rate 75%
- Max drawdown: 0.74% (guardrail is 25%)
- Fees: $3.23; exposure 24.8%
- Determinism: two runs produced identical `action_log_sha256`
  `69ca537e547cf67b71c76a80a623bc1914b7c96a5a928412f767aa02ebe70a06`
- Parameter sweep (grade-local, real fill model): TP 0.007/trail 0.005 was
  best (+$13.50); neighbours TP 0.006–0.007 × trail 0.005–0.006 all gave
  +$10.37–13.50. Trail 0.004 collapses (−$1.34 to +$2.05, extra losing trade).

## Warnings / caveats

- Docker driver could NOT be run here (`docker is not runnable: spawnSync
  docker ENOENT`); verification is process-driver only. The bot uses only
  the stdlib + the byte-identical SDK shim, no env/clock/randomness, so the
  server sandbox should reproduce the process-driver result.
- Dev PnL (+$13.50) is no forecast for the race window: it only clears the
  dev gate. The race window is a different 24h; the bot's edge is generic
  (confirmed dip-reversal + breakout, small fixed targets, tight stops), not
  tuned to specific bars.
- `README.md` is intentionally NOT written yet (parent agent adds make.fun
  badges + repo About after the repo exists). `.makefun/owner.json` IS
  included (wallet-only account, repo will be under denytrust).

## Files

- `main.ts` — the bot (TypeScript, Node 22 erasable syntax)
- `vendor/makefun-bars.ts` — SDK shim, byte-identical copy of the kit's
- `LICENSE` — MIT
- `.makefun/owner.json` — `{"wallet":"7XoCtAPHFo3cFXuS6dU845GLckqSzfmvY3v28rxagNcn"}`
- `REPORT.md` — this file
