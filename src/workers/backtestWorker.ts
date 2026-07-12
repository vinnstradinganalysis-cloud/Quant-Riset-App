/// <reference lib="webworker" />
import type { BacktestMetrics, BacktestResult, Candle, EquityPoint, Trade, WFARun } from '@/types/domain'
import { compileEntry, makeHelpers } from '@/utils/scriptApi'
import { computeWFE, mean, quantile, std, skewness, kurtosis, durbinWatson, monteCarlo } from '@/utils/quantLogic'

/* ============ Tipe pesan ============ */

interface RunRequest {
  cmd: 'single' | 'optimize'
  candles: Candle[]
  code: string
  params: Record<string, number>
  deposit: number
  riskPct: number
  priceModel: 'ohlc' | 'open'
  startTime?: number
  endTime?: number
  forwardRatio?: number // 0 = nonaktif
  strategyName: string
  pair: string
  timeframe: string
  ranges?: Record<string, { start: number; step: number; stop: number }>
  method?: 'grid' | 'genetic'
  reqId: string
}

interface Position {
  dir: 1 | -1
  entry: number
  size: number
  sl: number | null
  tp: number | null
  entryTime: number
  mae: number
  mfe: number
  signal: number
}

interface RunStats {
  maxDD: number
  maxDDpct: number
  ulcer: number
  maxRecovery: number
  startTime: number
  endTime: number
}

interface RunOutput {
  trades: Trade[]
  equity: EquityPoint[] | null
  stats: RunStats
}

/* ============ Core backtest loop ============ */

type OnBarFn = (ctx: Record<string, unknown>, i: number) => void

function runBacktest(
  candles: Candle[],
  fn: OnBarFn,
  params: Record<string, number>,
  deposit: number,
  riskPct: number,
  priceModel: 'ohlc' | 'open',
  collect: boolean,
  progressCb?: (pct: number) => void,
): RunOutput {
  const helpers = makeHelpers(candles)
  let balance = deposit
  let pos: Position | null = null
  const trades: Trade[] = []
  let tradeId = 0

  const n = candles.length
  const step = collect ? Math.max(1, Math.ceil(n / 6000)) : 1
  const equity: EquityPoint[] | null = collect ? [] : null

  // online drawdown stats
  let peak = deposit
  let maxDD = 0
  let maxDDpct = 0
  let ddSq = 0
  let ddCount = 0
  let peakTime = candles.length ? candles[0].time : 0
  let inRecovery = false
  let recoveryStart = 0
  let maxRecovery = 0

  const ctx: Record<string, unknown> = {
    candles,
    params,
    balance,
    position: null,
    execPrice: 0,
    ...helpers,
    buy: (opts: { sl?: number | null; tp?: number | null; signal?: number } = {}) => openPos(1, opts),
    sell: (opts: { sl?: number | null; tp?: number | null; signal?: number } = {}) => openPos(-1, opts),
    close: (reason = 'Signal') => closePos(ctx.execPrice as number, reason),
  }

  function openPos(dir: 1 | -1, opts: { sl?: number | null; tp?: number | null; signal?: number }) {
    const price = ctx.execPrice as number
    if (pos) closePos(price, 'Reverse')
    const sl = opts.sl ?? null
    const tp = opts.tp ?? null
    const dist = sl !== null ? Math.abs(price - sl) : price * 0.01
    if (dist <= 0) return
    const risk = balance * (riskPct / 100)
    const size = risk / dist
    if (!isFinite(size) || size <= 0) return
    pos = {
      dir,
      entry: price,
      size,
      sl,
      tp,
      entryTime: candles[curIdx].time,
      mae: 0,
      mfe: 0,
      signal: opts.signal ?? 0,
    }
    ctx.position = pos
  }

  function closePos(price: number, reason: string) {
    if (!pos) return
    const pnl = (price - pos.entry) * pos.dir * pos.size
    balance += pnl
    trades.push({
      id: ++tradeId,
      dir: pos.dir,
      entryTime: pos.entryTime,
      entryPrice: pos.entry,
      exitTime: candles[curIdx].time,
      exitPrice: price,
      size: pos.size,
      pnl,
      sl: pos.sl,
      tp: pos.tp,
      mae: pos.mae,
      mfe: pos.mfe,
      signal: pos.signal,
      reason,
    })
    pos = null
    ctx.position = null
    ctx.balance = balance
  }

  let curIdx = 0
  const progressStep = Math.max(1, Math.floor(n / 40))

  for (let i = 1; i < n; i++) {
    curIdx = i
    const bar = candles[i]
    const execPrice = priceModel === 'open' ? bar.open : bar.close
    ctx.execPrice = execPrice
    ctx.balance = balance

    // 1) Manajemen posisi: SL / TP
    const posNow = pos as Position | null
    if (posNow) {
      const floatHigh = (bar.high - posNow.entry) * posNow.dir * posNow.size
      const floatLow = (bar.low - posNow.entry) * posNow.dir * posNow.size
      posNow.mfe = Math.max(posNow.mfe, floatHigh)
      posNow.mae = Math.min(posNow.mae, floatLow)

      if (priceModel === 'open') {
        if (posNow.sl !== null && (posNow.dir === 1 ? bar.open <= posNow.sl : bar.open >= posNow.sl)) {
          closePos(bar.open, 'SL')
        } else if (posNow.tp !== null && (posNow.dir === 1 ? bar.open >= posNow.tp : bar.open <= posNow.tp)) {
          closePos(bar.open, 'TP')
        }
      } else {
        const hitSL = posNow.sl !== null && (posNow.dir === 1 ? bar.low <= posNow.sl : bar.high >= posNow.sl)
        const hitTP = posNow.tp !== null && (posNow.dir === 1 ? bar.high >= posNow.tp : bar.low <= posNow.tp)
        if (hitSL && hitTP) {
          closePos(posNow.sl as number, 'SL') // pesimis: SL lebih dulu dalam satu candle
        } else if (hitSL) {
          closePos(posNow.sl as number, 'SL')
        } else if (hitTP) {
          closePos(posNow.tp as number, 'TP')
        }
      }
    }

    // 2) Sinyal strategi (dieksekusi di harga eksekusi bar ini)
    try {
      fn(ctx, i)
    } catch (err) {
      throw new Error(`Runtime error di bar ${i}: ${(err as Error).message}`)
    }

    // 3) Equity & drawdown tracking
    const posAfter = pos as Position | null
    const floating = posAfter ? (execPrice - posAfter.entry) * posAfter.dir * posAfter.size : 0
    const eq = balance + floating
    if (balance >= peak) {
      if (inRecovery) {
        maxRecovery = Math.max(maxRecovery, bar.time - recoveryStart)
        inRecovery = false
      }
      peak = balance
      peakTime = bar.time
    } else {
      const dd = peak - balance
      const ddp = peak > 0 ? (dd / peak) * 100 : 0
      if (dd > maxDD) maxDD = dd
      if (ddp > maxDDpct) maxDDpct = ddp
      ddSq += ddp * ddp
      ddCount++
      if (!inRecovery) {
        inRecovery = true
        recoveryStart = peakTime
      }
    }
    if (equity && i % step === 0) {
      equity.push({
        time: bar.time,
        balance,
        equity: eq,
        drawdown: peak > 0 ? -((peak - balance) / peak) * 100 : 0,
      })
    }
    if (progressCb && i % progressStep === 0) progressCb((i / n) * 100)
  }

  // tutup posisi terbuka di akhir data
  if (pos && n > 0) {
    curIdx = n - 1
    closePos(candles[n - 1].close, 'End of Data')
  }
  if (inRecovery && n) maxRecovery = Math.max(maxRecovery, candles[n - 1].time - recoveryStart)
  if (equity && n) {
    equity.push({
      time: candles[n - 1].time,
      balance,
      equity: balance,
      drawdown: peak > 0 ? -((peak - balance) / peak) * 100 : 0,
    })
  }

  return {
    trades,
    equity,
    stats: {
      maxDD,
      maxDDpct,
      ulcer: ddCount ? Math.sqrt(ddSq / ddCount) : 0,
      maxRecovery,
      startTime: n ? candles[0].time : 0,
      endTime: n ? candles[n - 1].time : 0,
    },
  }
}

/* ============ Metrik ============ */

function assembleMetrics(trades: Trade[], stats: RunStats, deposit: number): BacktestMetrics {
  const pnls = trades.map((t) => t.pnl)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const netProfit = grossProfit - grossLoss
  const n = pnls.length

  let curW = 0, curL = 0, maxW = 0, maxL = 0
  for (const p of pnls) {
    if (p > 0) { curW++; curL = 0; maxW = Math.max(maxW, curW) }
    else if (p < 0) { curL++; curW = 0; maxL = Math.max(maxL, curL) }
    else { curW = 0; curL = 0 }
  }

  const sorted = [...pnls].sort((a, b) => a - b)
  const var95 = -quantile(sorted, 0.05)
  const var99 = -quantile(sorted, 0.01)
  const tail = sorted.filter((x) => x <= quantile(sorted, 0.05))
  const cvar95 = tail.length ? -mean(tail) : 0

  const expectancy = n ? netProfit / n : 0
  const sd = std(pnls)
  const sqn = n > 1 && sd > 0 ? (Math.sqrt(n) * expectancy) / sd : 0
  const recoveryFactor = stats.maxDD > 0 ? netProfit / stats.maxDD : netProfit > 0 ? 99 : 0

  const rets = pnls.map((p) => p / deposit)
  const retsSd = std(rets)
  const informationRatio = retsSd > 0 ? mean(rets) / retsSd : 0

  const years = Math.max((stats.endTime - stats.startTime) / (365.25 * 86400), 1 / 365)
  const finalBalance = deposit + netProfit
  const annualizedReturnPct = deposit > 0 ? (Math.pow(Math.max(finalBalance, 1) / deposit, 1 / years) - 1) * 100 : 0
  const calmarRatio = stats.maxDDpct > 0 ? annualizedReturnPct / stats.maxDDpct : annualizedReturnPct > 0 ? 99 : 0

  let up = 0, down = 0
  for (const r of rets) {
    if (r > 0) up += r
    else down -= r
  }
  const omegaRatio = down > 0 ? up / down : up > 0 ? 99 : 0

  return {
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    totalTrades: n,
    winRate: n ? (wins.length / n) * 100 : 0,
    maxDrawdown: stats.maxDD,
    maxDrawdownPct: stats.maxDDpct,
    expectancy,
    consecutiveWins: maxW,
    consecutiveLosses: maxL,
    sqn,
    recoveryFactor,
    var95,
    var99,
    cvar95,
    ulcerIndex: stats.ulcer,
    maxTimeToRecovery: stats.maxRecovery,
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

/* ============ WFA ============ */

function runWFA(
  candles: Candle[],
  fn: OnBarFn,
  params: Record<string, number>,
  deposit: number,
  riskPct: number,
  priceModel: 'ohlc' | 'open',
  forwardRatio: number,
  progressCb: (pct: number, label: string) => void,
): { runs: WFARun[]; aggregateWFE: number } {
  const WINDOWS = 5
  const runs: WFARun[] = []
  const winSize = Math.floor(candles.length / WINDOWS)
  for (let w = 0; w < WINDOWS; w++) {
    const slice = candles.slice(w * winSize, w === WINDOWS - 1 ? candles.length : (w + 1) * winSize)
    const split = Math.floor(slice.length * (1 - forwardRatio))
    const isData = slice.slice(0, split)
    const oosData = slice.slice(split)
    progressCb((w / WINDOWS) * 100, `Walk-Forward window ${w + 1}/${WINDOWS}…`)
    const isRun = runBacktest(isData, fn, params, deposit, riskPct, priceModel, false)
    const oosRun = runBacktest(oosData, fn, params, deposit, riskPct, priceModel, false)
    const isProfit = isRun.trades.reduce((a, t) => a + t.pnl, 0)
    const oosProfit = oosRun.trades.reduce((a, t) => a + t.pnl, 0)
    runs.push({
      window: w + 1,
      isProfit,
      oosProfit,
      wfe: isProfit > 0 ? oosProfit / isProfit : 0,
    })
  }
  return { runs, aggregateWFE: computeWFE(runs) }
}

/* ============ Optimasi ============ */

function buildGrid(ranges: Record<string, { start: number; step: number; stop: number }>): Record<string, number>[] {
  const keys = Object.keys(ranges).filter((k) => ranges[k].step > 0 && ranges[k].stop >= ranges[k].start)
  const valueLists: number[][] = keys.map((k) => {
    const r = ranges[k]
    const vals: number[] = []
    for (let v = r.start; v <= r.stop + 1e-9; v += r.step) vals.push(Math.round(v * 1e6) / 1e6)
    return vals.length ? vals : [r.start]
  })
  const combos: Record<string, number>[] = []
  const walk = (idx: number, acc: Record<string, number>) => {
    if (idx === keys.length) {
      combos.push({ ...acc })
      return
    }
    for (const v of valueLists[idx]) {
      acc[keys[idx]] = v
      walk(idx + 1, acc)
    }
  }
  if (keys.length) walk(0, {})
  return combos
}

function snapToGrid(v: number, r: { start: number; step: number; stop: number }): number {
  const snapped = Math.round((v - r.start) / r.step) * r.step + r.start
  return Math.round(Math.max(r.start, Math.min(r.stop, snapped)) * 1e6) / 1e6
}

function randomCombo(ranges: Record<string, { start: number; step: number; stop: number }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(ranges)) {
    const r = ranges[k]
    const steps = Math.max(0, Math.round((r.stop - r.start) / r.step))
    out[k] = snapToGrid(r.start + Math.random() * steps * r.step, r)
  }
  return out
}

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const req = e.data
  const post = (msg: Record<string, unknown>) => self.postMessage({ ...msg, reqId: req.reqId })

  try {
    post({ type: 'progress', pct: 1, label: 'Mengompilasi strategi…' })
    const fn = compileEntry(req.code, 'onBar') as OnBarFn

    // filter rentang waktu
    let data = req.candles
    if (req.startTime || req.endTime) {
      data = data.filter(
        (c) => (!req.startTime || c.time >= req.startTime) && (!req.endTime || c.time <= req.endTime),
      )
    }
    if (data.length < 100) {
      post({ type: 'error', message: 'Data terlalu sedikit untuk diuji (minimal 100 bar pada rentang waktu yang dipilih).' })
      return
    }

    const { deposit, riskPct, priceModel } = req

    if (req.cmd === 'single') {
      let wfa: BacktestResult['wfa']
      if (req.forwardRatio && req.forwardRatio > 0) {
        post({ type: 'progress', pct: 2, label: 'Menjalankan Walk-Forward Analysis…' })
        wfa = runWFA(data, fn, req.params, deposit, riskPct, priceModel, req.forwardRatio, (pct, label) =>
          post({ type: 'progress', pct: 2 + pct * 0.43, label }),
        )
      }
      post({ type: 'progress', pct: 48, label: 'Menjalankan backtest utama…' })
      const run = runBacktest(data, fn, req.params, deposit, riskPct, priceModel, true, (pct) =>
        post({ type: 'progress', pct: 48 + pct * 0.42, label: 'Backtest berjalan…' }),
      )
      const metrics = assembleMetrics(run.trades, run.stats, deposit)

      post({ type: 'progress', pct: 92, label: 'Monte Carlo permutation (500 iterasi)…' })
      const mc = monteCarlo(run.trades.map((t) => t.pnl), deposit, 500, 20)

      const result: BacktestResult = {
        id: `bt_${Date.now().toString(36)}`,
        strategyName: req.strategyName,
        pair: req.pair,
        timeframe: req.timeframe,
        deposit,
        params: req.params,
        trades: run.trades,
        equity: run.equity ?? [],
        metrics,
        wfa,
        monteCarlo: mc,
        createdAt: Date.now(),
      }
      post({ type: 'progress', pct: 100, label: 'Selesai' })
      post({ type: 'done', result })
      return
    }

    /* ---------- Optimasi ---------- */
    const ranges = req.ranges ?? {}
    const grid = buildGrid(ranges)
    if (!grid.length) {
      post({ type: 'error', message: 'Tidak ada kombinasi parameter valid. Periksa Start/Step/Stop.' })
      return
    }

    const evaluated = new Map<string, { params: Record<string, number>; metrics: BacktestMetrics }>()
    const keyOf = (p: Record<string, number>) => JSON.stringify(p)

    const evaluate = (params: Record<string, number>) => {
      const k = keyOf(params)
      const cached = evaluated.get(k)
      if (cached) return cached
      const merged = { ...req.params, ...params }
      const run = runBacktest(data, fn, merged, deposit, riskPct, priceModel, false)
      const metrics = assembleMetrics(run.trades, run.stats, deposit)
      const entry = { params: merged, metrics }
      evaluated.set(k, entry)
      return entry
    }

    const method = req.method ?? 'grid'
    if (method === 'grid') {
      const MAX = 200
      const stride = Math.max(1, Math.ceil(grid.length / MAX))
      let done = 0
      for (let gi = 0; gi < grid.length; gi += stride) {
        evaluate(grid[gi])
        done++
        if (done % 5 === 0) {
          post({ type: 'progress', pct: 5 + (gi / grid.length) * 85, label: `Grid search: ${done} kombinasi…` })
        }
      }
    } else {
      // Fast Optimization — algoritma genetik sederhana
      const POP = 12
      const GEN = 8
      let population: Record<string, number>[] = []
      for (let i = 0; i < POP; i++) population.push(randomCombo(ranges))
      for (let g = 0; g < GEN; g++) {
        const scored = population
          .map((p) => evaluate(p))
          .sort((a, b) => b.metrics.netProfit - a.metrics.netProfit)
        const elites = scored.slice(0, 4).map((s) => s.params)
        const next: Record<string, number>[] = [...elites]
        while (next.length < POP) {
          const parent = elites[Math.floor(Math.random() * elites.length)]
          const child: Record<string, number> = {}
          for (const k of Object.keys(ranges)) {
            const r = ranges[k]
            if (Math.random() < 0.35) {
              child[k] = snapToGrid(parent[k] + (Math.random() - 0.5) * 4 * r.step, r)
            } else {
              child[k] = parent[k]
            }
          }
          next.push(child)
        }
        // imigran acak untuk menjaga diversitas
        next[next.length - 1] = randomCombo(ranges)
        population = next
        post({ type: 'progress', pct: 5 + ((g + 1) / GEN) * 85, label: `Genetic algorithm: generasi ${g + 1}/${GEN}…` })
      }
    }

    const rows = [...evaluated.values()]
      .map((v) => ({
        params: v.params,
        netProfit: v.metrics.netProfit,
        maxDrawdownPct: v.metrics.maxDrawdownPct,
        profitFactor: v.metrics.profitFactor,
        winRate: v.metrics.winRate,
        totalTrades: v.metrics.totalTrades,
        sqn: v.metrics.sqn,
      }))
      .sort((a, b) => b.netProfit - a.netProfit)

    const best = rows[0]
    post({ type: 'progress', pct: 92, label: 'Menjalankan backtest final dengan parameter terbaik…' })
    const finalRun = runBacktest(data, fn, best.params, deposit, riskPct, priceModel, true)
    const metrics = assembleMetrics(finalRun.trades, finalRun.stats, deposit)
    const mc = monteCarlo(finalRun.trades.map((t) => t.pnl), deposit, 500, 20)

    let wfa: BacktestResult['wfa']
    if (req.forwardRatio && req.forwardRatio > 0) {
      wfa = runWFA(data, fn, best.params, deposit, riskPct, priceModel, req.forwardRatio, () => undefined)
    }

    const result: BacktestResult = {
      id: `bt_${Date.now().toString(36)}`,
      strategyName: req.strategyName,
      pair: req.pair,
      timeframe: req.timeframe,
      deposit,
      params: best.params,
      trades: finalRun.trades,
      equity: finalRun.equity ?? [],
      metrics,
      wfa,
      monteCarlo: mc,
      createdAt: Date.now(),
    }
    post({ type: 'progress', pct: 100, label: 'Selesai' })
    post({ type: 'done', result, optimization: rows, method })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
