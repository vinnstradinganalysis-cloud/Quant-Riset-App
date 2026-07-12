import type { BacktestMetrics, Candle, EquityPoint, Trade, WFARun } from '@/types/domain'

/* ================= Statistik dasar ================= */

export function mean(xs: number[]): number {
  if (!xs.length) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (xs.length - 1))
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (base + 1 < sorted.length) return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  return sorted[base]
}

export function skewness(xs: number[]): number {
  if (xs.length < 3) return 0
  const m = mean(xs)
  const sd = std(xs)
  if (sd === 0) return 0
  let s = 0
  for (const x of xs) s += Math.pow((x - m) / sd, 3)
  return s / xs.length
}

export function kurtosis(xs: number[]): number {
  if (xs.length < 4) return 3
  const m = mean(xs)
  const sd = std(xs)
  if (sd === 0) return 3
  let s = 0
  for (const x of xs) s += Math.pow((x - m) / sd, 4)
  return s / xs.length
}

export function durbinWatson(xs: number[]): number {
  if (xs.length < 2) return 2
  let num = 0
  let den = 0
  const m = mean(xs)
  for (let i = 1; i < xs.length; i++) num += (xs[i] - xs[i - 1]) * (xs[i] - xs[i - 1])
  for (const x of xs) den += (x - m) * (x - m)
  return den === 0 ? 2 : num / den
}

// Inverse normal CDF (Acklam's algorithm) untuk Q-Q plot
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  if (p <= 0) return -4
  if (p >= 1) return 4
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/* ================= Agregasi timeframe ================= */

export function aggregateCandles(candles: Candle[], tfSeconds: number): Candle[] {
  if (tfSeconds <= 60) return candles
  const out: Candle[] = []
  let bucketStart = -Infinity
  let cur: Candle | null = null
  for (const c of candles) {
    const b = Math.floor(c.time / tfSeconds) * tfSeconds
    if (b !== bucketStart) {
      if (cur) out.push(cur)
      bucketStart = b
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

/* ================= Metrik backtest ================= */

export function computeMetrics(
  trades: Trade[],
  equity: EquityPoint[],
  deposit: number,
  startTime: number,
  endTime: number,
): BacktestMetrics {
  const pnls = trades.map((t) => t.pnl)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const netProfit = grossProfit - grossLoss
  const n = pnls.length

  // consecutive streaks
  let curW = 0, curL = 0, maxW = 0, maxL = 0
  for (const p of pnls) {
    if (p > 0) { curW++; curL = 0; maxW = Math.max(maxW, curW) }
    else if (p < 0) { curL++; curW = 0; maxL = Math.max(maxL, curL) }
    else { curW = 0; curL = 0 }
  }

  // drawdown dari kurva balance
  let peak = deposit
  let maxDD = 0
  let maxDDpct = 0
  let ddSquares = 0
  let ddCount = 0
  let peakTime = equity.length ? equity[0].time : startTime
  let maxRecovery = 0
  let inRecovery = false
  let recoveryStart = peakTime
  for (const p of equity) {
    if (p.balance >= peak) {
      if (inRecovery) {
        maxRecovery = Math.max(maxRecovery, p.time - recoveryStart)
        inRecovery = false
      }
      peak = p.balance
      peakTime = p.time
    } else {
      const dd = peak - p.balance
      const ddp = peak > 0 ? (dd / peak) * 100 : 0
      if (dd > maxDD) maxDD = dd
      if (ddp > maxDDpct) maxDDpct = ddp
      ddSquares += ddp * ddp
      ddCount++
      if (!inRecovery) { inRecovery = true; recoveryStart = peakTime }
    }
  }
  if (inRecovery && equity.length) {
    maxRecovery = Math.max(maxRecovery, equity[equity.length - 1].time - recoveryStart)
  }
  const ulcerIndex = ddCount ? Math.sqrt(ddSquares / ddCount) : 0

  const sorted = [...pnls].sort((a, b) => a - b)
  const var95 = -quantile(sorted, 0.05)
  const var99 = -quantile(sorted, 0.01)
  const tail = sorted.filter((x) => x <= quantile(sorted, 0.05))
  const cvar95 = tail.length ? -mean(tail) : 0

  const expectancy = n ? netProfit / n : 0
  const sd = std(pnls)
  const sqn = n > 1 && sd > 0 ? (Math.sqrt(n) * expectancy) / sd : 0
  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? 99 : 0

  // returns per trade relatif deposit
  const rets = pnls.map((p) => p / deposit)
  const retsSd = std(rets)
  const informationRatio = retsSd > 0 ? mean(rets) / retsSd : 0

  const years = Math.max((endTime - startTime) / (365.25 * 86400), 1 / 365)
  const finalBalance = deposit + netProfit
  const annualizedReturnPct = deposit > 0 ? (Math.pow(Math.max(finalBalance, 1) / deposit, 1 / years) - 1) * 100 : 0
  const calmarRatio = maxDDpct > 0 ? annualizedReturnPct / maxDDpct : annualizedReturnPct > 0 ? 99 : 0

  const mar = 0
  let up = 0, down = 0
  for (const r of rets) {
    if (r > mar) up += r - mar
    else down += mar - r
  }
  const omegaRatio = down > 0 ? up / down : up > 0 ? 99 : 0

  return {
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    totalTrades: n,
    winRate: n ? (wins.length / n) * 100 : 0,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDpct,
    expectancy,
    consecutiveWins: maxW,
    consecutiveLosses: maxL,
    sqn,
    recoveryFactor,
    var95,
    var99,
    cvar95,
    ulcerIndex,
    maxTimeToRecovery: maxRecovery,
    informationRatio,
    calmarRatio,
    omegaRatio,
    skewness: skewness(pnls),
    kurtosis: kurtosis(pnls),
    durbinWatson: durbinWatson(pnls),
    finalBalance,
    annualizedReturnPct,
  }
}

/* ================= Monte Carlo permutation ================= */

export function monteCarlo(
  pnls: number[],
  deposit: number,
  iterations = 500,
  ruinThresholdPct = 20,
): { curves: number[][]; ruinProbability: number; medianFinal: number; worstDrawdownPct: number } {
  const n = pnls.length
  const curves: number[][] = []
  const finals: number[] = []
  let ruin = 0
  let worstDD = 0
  const ruinLevel = deposit * (1 - ruinThresholdPct / 100)
  for (let it = 0; it < iterations; it++) {
    // Fisher–Yates shuffle
    const arr = pnls.slice()
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t
    }
    let bal = deposit
    let peak = deposit
    let dd = 0
    const curve: number[] = [bal]
    let ruined = false
    for (const p of arr) {
      bal += p
      curve.push(bal)
      if (bal > peak) peak = bal
      const d = peak > 0 ? ((peak - bal) / peak) * 100 : 0
      if (d > dd) dd = d
      if (bal <= ruinLevel) ruined = true
    }
    curves.push(curve)
    finals.push(bal)
    if (ruined) ruin++
    if (dd > worstDD) worstDD = dd
  }
  finals.sort((a, b) => a - b)
  return {
    curves,
    ruinProbability: (ruin / iterations) * 100,
    medianFinal: quantile(finals, 0.5),
    worstDrawdownPct: worstDD,
  }
}

/* ================= Walk-Forward Efficiency ================= */

export function computeWFE(runs: WFARun[]): number {
  let isTotal = 0
  let oosTotal = 0
  for (const r of runs) {
    if (r.isProfit > 0) {
      isTotal += r.isProfit
      oosTotal += r.oosProfit
    }
  }
  return isTotal > 0 ? Math.max(oosTotal / isTotal, -1) : 0
}

/* ================= Strategy Score Matrix (0–100) ================= */

export interface ScoreBreakdown {
  score: number
  grade: 'Institutional Grade' | 'Needs Optimization' | 'Statistically Broken'
  color: string
  pillars: { name: string; value: number; max: number }[]
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function strategyScore(m: BacktestMetrics, aggregateWFE: number | null): ScoreBreakdown {
  // Pilar 1 — Return & Expectancy (25)
  const calmarPart = clamp01(m.calmarRatio / 3)
  const annPart = clamp01(m.annualizedReturnPct / 60)
  const expPart = clamp01((m.expectancy / (Math.abs(m.var95) + 1)) + 0.5)
  const p1 = 25 * (0.4 * calmarPart + 0.3 * annPart + 0.3 * expPart)

  // Pilar 2 — Robustness & WFA (25)
  let p2: number
  if (aggregateWFE !== null) {
    const wfePart = clamp01(aggregateWFE / 1.0)
    p2 = 25 * wfePart
  } else {
    // tanpa WFA: gunakan profit factor & win rate sebagai proxy
    p2 = 25 * (0.5 * clamp01((m.profitFactor - 1) / 1.5) + 0.5 * clamp01((m.winRate - 40) / 25))
  }

  // Pilar 3 — Tail Risk Control (25)
  const ulcerPart = clamp01(1 - m.ulcerIndex / 12)
  const kurtPart = clamp01(1 - Math.abs(m.kurtosis - 3) / 6)
  const ddPart = clamp01(1 - m.maxDrawdownPct / 30)
  const p3 = 25 * (0.4 * ulcerPart + 0.3 * kurtPart + 0.3 * ddPart)

  // Pilar 4 — Trade Quality (25)
  const sqnPart = clamp01(m.sqn / 3)
  const irPart = clamp01((m.informationRatio + 0.2) / 1.4)
  const p4 = 25 * (0.55 * sqnPart + 0.45 * irPart)

  const score = Math.round(Math.max(0, Math.min(100, p1 + p2 + p3 + p4)))
  const grade: ScoreBreakdown['grade'] =
    score >= 80 ? 'Institutional Grade' : score >= 50 ? 'Needs Optimization' : 'Statistically Broken'
  const color = score >= 80 ? '#D4A017' : score >= 50 ? '#0A84FF' : '#FF3B30'
  return {
    score,
    grade,
    color,
    pillars: [
      { name: 'Return & Expectancy', value: Math.round(p1 * 10) / 10, max: 25 },
      { name: 'Robustness & WFA', value: Math.round(p2 * 10) / 10, max: 25 },
      { name: 'Tail Risk Control', value: Math.round(p3 * 10) / 10, max: 25 },
      { name: 'Trade Quality', value: Math.round(p4 * 10) / 10, max: 25 },
    ],
  }
}
