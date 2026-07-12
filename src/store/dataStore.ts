import { create } from 'zustand'
import type { BacktestResult, Candle, Dataset, ScriptMeta, Timeframe } from '@/types/domain'
import * as db from '@/utils/dbManager'

export const DEFAULT_SCRIPTS: Omit<ScriptMeta, 'id' | 'updatedAt'>[] = [
  {
    name: 'Volume Oscillator',
    type: 'indicator',
    overlay: false,
    params: { Fast: 5, Slow: 20 },
    code: `// name: Volume Oscillator
// overlay: false
// type: indicator
// params: { "Fast": 5, "Slow": 20 }
// Histogram rasio volume rata-rata cepat vs lambat (sub-window).
function calculate(ctx, i) {
  const fast = ctx.volumeSma(ctx.params.Fast, i);
  const slow = ctx.volumeSma(ctx.params.Slow, i);
  if (fast === null || slow === null || slow === 0) return null;
  const ratio = (fast / slow - 1) * 100;
  return { value: ratio, color: ratio >= 0 ? '#34C759' : '#FF3B30' };
}
`,
  },
  {
    name: 'Engulfing Markers',
    type: 'indicator',
    overlay: true,
    params: {},
    code: `// name: Engulfing Markers
// overlay: true
// type: indicator
// params: {}
// Menandai pola bullish/bearish engulfing langsung di chart harga.
function calculate(ctx, i) {
  if (i < 1) return null;
  const c = ctx.candles;
  const a = c[i - 1], b = c[i];
  const bull = a.close < a.open && b.close > b.open && b.close >= a.open && b.open <= a.close;
  const bear = a.close > a.open && b.close < b.open && b.open >= a.close && b.close <= a.open;
  if (bull) return { marker: { position: 'belowBar', color: '#34C759', shape: 'arrowUp', text: 'Bullish Engulfing' } };
  if (bear) return { marker: { position: 'aboveBar', color: '#FF3B30', shape: 'arrowDown', text: 'Bearish Engulfing' } };
  return null;
}
`,
  },
  {
    name: 'Engulfing + Volume Trigger',
    type: 'strategy',
    overlay: true,
    params: { VolMult: 2.0, ATR_Period: 14, SL_ATR: 1.5, TP_ATR: 2.5, MinBody: 0.4 },
    code: `// name: Engulfing + Volume Trigger
// overlay: true
// type: strategy
// params: { "VolMult": 2.0, "ATR_Period": 14, "SL_ATR": 1.5, "TP_ATR": 2.5, "MinBody": 0.4 }
// Entry saat pola engulfing kuat divalidasi lonjakan volume.
// SL/TP berbasis ATR. Keluar pada sinyal berlawanan.
function onBar(ctx, i) {
  if (i < 30) return;
  const c = ctx.candles;
  const a = c[i - 1], b = c[i];
  const volAvg = ctx.volumeSma(20, i);
  const atr = ctx.atr(ctx.params.ATR_Period, i);
  if (!volAvg || !atr) return;

  const volRatio = b.volume / volAvg;
  const body = Math.abs(b.close - b.open);
  const range = (b.high - b.low) || 1e-9;
  const strong = body / range >= ctx.params.MinBody;
  const bull = a.close < a.open && b.close > b.open && b.close >= a.open && b.open <= a.close && strong;
  const bear = a.close > a.open && b.close < b.open && b.open >= a.close && b.close <= a.open && strong;
  const spike = volRatio >= ctx.params.VolMult;
  const price = ctx.execPrice;

  if (!ctx.position && spike && bull) {
    ctx.buy({ sl: price - ctx.params.SL_ATR * atr, tp: price + ctx.params.TP_ATR * atr, signal: volRatio });
  } else if (!ctx.position && spike && bear) {
    ctx.sell({ sl: price + ctx.params.SL_ATR * atr, tp: price - ctx.params.TP_ATR * atr, signal: volRatio });
  } else if (ctx.position) {
    const dir = ctx.position.dir;
    if (dir === 1 && bear) ctx.close('Bearish Engulfing');
    else if (dir === -1 && bull) ctx.close('Bullish Engulfing');
  }
}
`,
  },
  {
    name: 'EMA Crossover',
    type: 'strategy',
    overlay: true,
    params: { Fast: 12, Slow: 48, SL_ATR: 2.0, TP_ATR: 3.0 },
    code: `// name: EMA Crossover
// overlay: true
// type: strategy
// params: { "Fast": 12, "Slow": 48, "SL_ATR": 2.0, "TP_ATR": 3.0 }
// Entry pada perpotongan EMA cepat/lambat, SL/TP berbasis ATR.
function onBar(ctx, i) {
  if (i < 60) return;
  const fast = ctx.ema(ctx.params.Fast, i);
  const slow = ctx.ema(ctx.params.Slow, i);
  const fastPrev = ctx.ema(ctx.params.Fast, i - 1);
  const slowPrev = ctx.ema(ctx.params.Slow, i - 1);
  const atr = ctx.atr(14, i);
  if (fast === null || slow === null || fastPrev === null || slowPrev === null || !atr) return;

  const crossUp = fastPrev <= slowPrev && fast > slow;
  const crossDn = fastPrev >= slowPrev && fast < slow;
  const price = ctx.execPrice;

  if (!ctx.position && crossUp) {
    ctx.buy({ sl: price - ctx.params.SL_ATR * atr, tp: price + ctx.params.TP_ATR * atr, signal: fast - slow });
  } else if (!ctx.position && crossDn) {
    ctx.sell({ sl: price + ctx.params.SL_ATR * atr, tp: price - ctx.params.TP_ATR * atr, signal: fast - slow });
  } else if (ctx.position) {
    const dir = ctx.position.dir;
    if (dir === 1 && crossDn) ctx.close('EMA Cross Down');
    else if (dir === -1 && crossUp) ctx.close('EMA Cross Up');
  }
}
`,
  },
]

export interface TesterSettings {
  strategyId: string
  datasetId: string
  timeframe: Timeframe
  priceModel: 'ohlc' | 'open'
  startDate: string
  endDate: string
  deposit: number
  riskPct: number
  testType: 'single' | 'optimization'
  optMethod: 'grid' | 'genetic'
  forwardEnabled: boolean
  forwardRatio: number
  paramValues: Record<string, number>
  paramRanges: Record<string, { start: number; step: number; stop: number }>
  accordionOpen: string[]
}

interface DataStore {
  ready: boolean
  datasets: Dataset[]
  scripts: ScriptMeta[]
  selectedPairId: string | null
  chartTimeframe: Timeframe
  activeIndicators: string[]
  tester: TesterSettings
  lastResult: BacktestResult | null
  generating: { active: boolean; pct: number }

  loadAll: () => Promise<void>
  generateSampleData: () => void
  addDataset: (pair: string, candles: Candle[], sizeBytes: number) => Promise<void>
  removeDataset: (id: string) => Promise<void>
  renameDataset: (id: string, pair: string) => Promise<void>
  appendDataset: (id: string, candles: Candle[]) => Promise<void>
  addScript: (script: ScriptMeta) => Promise<void>
  removeScript: (id: string) => Promise<void>
  setSelectedPair: (id: string | null) => void
  setChartTimeframe: (tf: Timeframe) => void
  toggleIndicator: (id: string) => void
  updateTester: (patch: Partial<TesterSettings>) => void
  setLastResult: (result: BacktestResult | null) => void
}

const TESTER_KEY = 'quantlab.tester'

function loadTester(): Partial<TesterSettings> {
  try {
    const raw = localStorage.getItem(TESTER_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

const defaultTester: TesterSettings = {
  strategyId: '',
  datasetId: '',
  timeframe: 'M15',
  priceModel: 'ohlc',
  startDate: '',
  endDate: '',
  deposit: 10000,
  riskPct: 1,
  testType: 'single',
  optMethod: 'grid',
  forwardEnabled: false,
  forwardRatio: 0.25,
  paramValues: {},
  paramRanges: {},
  accordionOpen: ['main', 'time', 'type', 'params'],
  ...loadTester(),
}

export const useDataStore = create<DataStore>((set, get) => ({
  ready: false,
  datasets: [],
  scripts: [],
  selectedPairId: null,
  chartTimeframe: 'M15',
  activeIndicators: [],
  tester: defaultTester,
  lastResult: null,
  generating: { active: false, pct: 0 },

  loadAll: async () => {
    const [datasets, scripts, latest] = await Promise.all([
      db.listDatasets(),
      db.listScripts(),
      db.getLatestResult(),
    ])

    const SEED_VERSION = 2
    const seedVersion = (await db.kvGet<number>('scriptsSeedVersion')) ?? 0
    let finalScripts = scripts
    if (!scripts.length || seedVersion < SEED_VERSION) {
      // (re)seed script bawaan — versi terbaru memperbaiki pola penutupan posisi
      const custom = scripts.filter(
        (s) => !DEFAULT_SCRIPTS.some((d) => d.name === s.name),
      )
      await Promise.all(scripts.map((s) => db.deleteScript(s.id)))
      const seeded = DEFAULT_SCRIPTS.map((s) => ({
        ...s,
        id: db.uid('scr'),
        updatedAt: Date.now(),
      }))
      await Promise.all(seeded.map((s) => db.saveScript(s)))
      await db.kvSet('scriptsSeedVersion', SEED_VERSION)
      finalScripts = [...seeded, ...custom].sort((a, b) => a.name.localeCompare(b.name))
    }

    const tester = { ...get().tester }
    const strategyExists = finalScripts.some((s) => s.id === tester.strategyId && s.type === 'strategy')
    if (!tester.strategyId || !strategyExists) {
      const strat =
        finalScripts.find((s) => s.name === 'Engulfing + Volume Trigger') ??
        finalScripts.find((s) => s.type === 'strategy')
      if (strat) tester.strategyId = strat.id
    }
    if (!tester.datasetId && datasets.length) tester.datasetId = datasets[0].id

    set({
      datasets,
      scripts: finalScripts,
      lastResult: latest ?? null,
      selectedPairId: get().selectedPairId ?? datasets[0]?.id ?? null,
      tester,
      ready: true,
    })
  },

  generateSampleData: () => {
    if (get().generating.active) return
    set({ generating: { active: true, pct: 0 } })
    const worker = new Worker(new URL('../workers/sampleDataWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = async (e) => {
      if (e.data.type === 'progress') {
        set({ generating: { active: true, pct: e.data.pct } })
      } else if (e.data.type === 'done') {
        worker.terminate()
        const candles = e.data.candles as Candle[]
        const sizeBytes = candles.length * 64
        await get().addDataset('XAUUSD', candles, sizeBytes)
        set({ generating: { active: false, pct: 100 } })
      }
    }
    worker.onerror = () => {
      worker.terminate()
      set({ generating: { active: false, pct: 0 } })
    }
    worker.postMessage({ days: 120, startPrice: 2620, seed: 2026 })
  },

  addDataset: async (pair, candles, sizeBytes) => {
    const id = db.uid('ds')
    const meta = db.extractMeta(id, pair, candles, sizeBytes)
    const ds: Dataset = { ...meta, data: candles }
    await db.saveDataset(ds)
    set((s) => ({
      datasets: [ds, ...s.datasets],
      selectedPairId: s.selectedPairId ?? id,
      tester: { ...s.tester, datasetId: s.tester.datasetId || id },
    }))
  },

  removeDataset: async (id) => {
    await db.deleteDataset(id)
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id)
      return {
        datasets,
        selectedPairId: s.selectedPairId === id ? datasets[0]?.id ?? null : s.selectedPairId,
        tester: { ...s.tester, datasetId: s.tester.datasetId === id ? datasets[0]?.id ?? '' : s.tester.datasetId },
      }
    })
  },

  renameDataset: async (id, pair) => {
    const ds = get().datasets.find((d) => d.id === id)
    if (!ds) return
    const updated = { ...ds, pair }
    await db.saveDataset(updated)
    set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? updated : d)) }))
  },

  appendDataset: async (id, candles) => {
    const ds = get().datasets.find((d) => d.id === id)
    if (!ds) return
    const meta = db.extractMeta(id, ds.pair, candles, ds.sizeBytes + candles.length * 64)
    const updated: Dataset = { ...meta, createdAt: ds.createdAt, data: candles }
    await db.saveDataset(updated)
    set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? updated : d)) }))
  },

  addScript: async (script) => {
    await db.saveScript(script)
    set((s) => {
      const exists = s.scripts.some((x) => x.id === script.id)
      return {
        scripts: exists
          ? s.scripts.map((x) => (x.id === script.id ? script : x))
          : [...s.scripts, script].sort((a, b) => a.name.localeCompare(b.name)),
      }
    })
  },

  removeScript: async (id) => {
    await db.deleteScript(id)
    set((s) => ({
      scripts: s.scripts.filter((x) => x.id !== id),
      activeIndicators: s.activeIndicators.filter((x) => x !== id),
    }))
  },

  setSelectedPair: (id) => set({ selectedPairId: id }),
  setChartTimeframe: (tf) => set({ chartTimeframe: tf }),

  toggleIndicator: (id) =>
    set((s) => ({
      activeIndicators: s.activeIndicators.includes(id)
        ? s.activeIndicators.filter((x) => x !== id)
        : [...s.activeIndicators, id],
    })),

  updateTester: (patch) =>
    set((s) => {
      const tester = { ...s.tester, ...patch }
      try {
        const { paramValues, paramRanges, ...rest } = tester
        localStorage.setItem(TESTER_KEY, JSON.stringify({ ...rest, paramValues, paramRanges }))
      } catch { /* ignore */ }
      return { tester }
    }),

  setLastResult: (result) => set({ lastResult: result }),
}))
