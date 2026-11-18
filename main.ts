// Dip-reversal + breakout momentum bot for cbBTC (agent-fun/bars-replay/v1).
//
// Idea: BTC 1-minute bars are noisy (typical 1m move ~7 bps) and a full-size
// round trip costs ~26 bps, so this bot only trades when a move is already
// confirmed and large enough to pay for itself, and it banks the move early
// instead of riding it to the end.
//
// Two independent, generic entry signals (either may fire; never both at once,
// one position at a time, full size):
//   1. DIP-REVERSAL: the close sits >= 1.2% below the highest high of the last
//      60 bars (a real wash-out, not noise) AND the close has turned back up
//      above its 10-bar EMA and above the previous close. A deep dip that has
//      stopped falling.
//   2. BREAKOUT: the close makes a new 90-bar high AND sits above its 30-bar
//      EMA while the 10-bar EMA is above the 30-bar EMA (an uptrend that just
//      confirmed itself, not a lone spike).
//
// Exits (whole position, whichever hits first on a close):
//   - take-profit at +0.7% over the actual fill price,
//   - trailing stop 0.5% below the highest close since entry,
//   - hard stop 1.0% below the fill price.
// A 60-bar cooldown after every exit keeps the bot from re-buying the same
// whipsaw. No entry in the last 60 bars of a 1,440-bar window (an order
// decided on the last batch is rejected anyway, and a late entry has no room
// to reach its target).
//
// Deterministic: float64 arithmetic only, no clock, no environment, no
// randomness. History is bounded (last 120 highs, EMA state), so the bot is
// O(1) per bar and far inside the think budget.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DIP_LOOKBACK = 60;
const DIP_DROP = 0.012; // 1.2% below the 60-bar high
const BREAKOUT_LOOKBACK = 90;
const EMA_FAST = 10;
const EMA_SLOW = 30;
const TAKE_PROFIT = 0.007; // +0.7% over fill
const TRAIL = 0.005; // 0.5% below the peak close since entry
const HARD_STOP = 0.01; // -1.0% below fill
const COOLDOWN_BARS = 60;
const LAST_ENTRY_SEQ = 1380;
const MAX_SLIPPAGE_BPS = 100;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** Highs of bars before the current one, oldest first (capped). */
  highs: number[];
  prevClose: number | null;
  entryPx: number | null;
  peakPx: number | null;
  lastExitSeq: number;
}

const series = new Map<string, Series>();

function makeEma(span: number): Ema {
  return { span, warm: [], value: null };
}

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    let sum = 0;
    for (const x of e.warm) sum += x;
    e.value = sum / e.span;
  }
}

function maxOf(xs: number[], n: number): number | null {
  if (xs.length === 0) return null;
  let m = -Infinity;
  const start = xs.length > n ? xs.length - n : 0;
  for (let i = start; i < xs.length; i++) {
    if (xs[i]! > m) m = xs[i]!;
  }
  return m;
}

await runBars({
  onBatch(state: BarsState, batch) {
    if (state.warmingUp) return [];

    // Fills from the previous batch: record the real fill price of a buy so
    // exits are measured from what was actually paid, and note exits.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      const s = series.get(fill.symbol);
      if (s === undefined) continue;
      if (fill.side === 'buy') {
        s.entryPx = Number(fill.price);
        s.peakPx = Number(fill.price);
      } else {
        s.entryPx = null;
        s.peakPx = null;
        // lastExitSeq is set when the sell is decided, not when its fill
        // lands a bar later, so the cooldown counts from the decision.
      }
    }

    const orders: (BuyInput | SellInput)[] = [];
    const { caps, fees } = state.hello;

    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      let s = series.get(bar.symbol);
      if (s === undefined) {
        s = { fast: makeEma(EMA_FAST), slow: makeEma(EMA_SLOW), highs: [], prevClose: null, entryPx: null, peakPx: null, lastExitSeq: -1000000 };
        series.set(bar.symbol, s);
      }
      const c = Number(bar.c);
      const h = Number(bar.h);
      stepEma(s.fast, c);
      stepEma(s.slow, c);

      const held = state.positions.get(bar.symbol);
      if (held !== undefined) {
        const entryPx = s.entryPx ?? c;
        if (s.peakPx === null || c > s.peakPx) s.peakPx = c;
        const peak = s.peakPx;
        const takeProfit = c >= entryPx * (1 + TAKE_PROFIT);
        const trailing = c <= peak * (1 - TRAIL);
        const hardStop = c <= entryPx * (1 - HARD_STOP);
        if (takeProfit || trailing || hardStop) {
          orders.push({ side: 'sell', symbol: bar.symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          // Cooldown counts from the exit decision (the fill lands a bar later).
          s.lastExitSeq = state.seq;
        }
      } else {
        const ready =
          state.seq >= DIP_LOOKBACK &&
          state.seq - s.lastExitSeq >= COOLDOWN_BARS &&
          state.seq < LAST_ENTRY_SEQ &&
          s.prevClose !== null &&
          s.fast.value !== null &&
          s.slow.value !== null;
        if (ready) {
          const hi60 = maxOf(s.highs, DIP_LOOKBACK);
          const hi90 = maxOf(s.highs, BREAKOUT_LOOKBACK);
          const dip =
            hi60 !== null &&
            c < hi60 * (1 - DIP_DROP) &&
            c > s.fast.value &&
            c > s.prevClose;
          const breakout =
            hi90 !== null &&
            c > hi90 &&
            c > s.slow.value &&
            s.fast.value > s.slow.value;
          if (dip || breakout) {
            const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
            const slice = state.cash < byWeight ? state.cash : byWeight;
            if (slice >= BigInt(fees.min_notional_quote_units) && slice > 0n) {
              orders.push({ side: 'buy', symbol: bar.symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
            }
          }
        }
      }

      s.highs.push(h);
      if (s.highs.length > 120) s.highs.shift();
      s.prevClose = c;
    }
    return orders;
  },
});
