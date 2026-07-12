export interface Candle {
  time: number // epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface DatasetMeta {
  id: string
  pair: string
  bars: number
  startDate: number
  endDate: number
  sizeBytes: number
  createdAt: number
}

export interface Dataset extends DatasetMeta {
  data: Candle[]
}

export type ScriptType = 'indicator' | 'strategy'

export interface ScriptMeta {
  id: string
  name: string
  type: ScriptType
  overlay: boolean
  code: string
  params: Record<string, number>
  updatedAt: number
}

export interface Trade {
  id: number
  dir: 1 | -1
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  size: number
  pnl: number
  sl: number | null
  tp: number | null
  mae: number // max adverse excursion (in price * size, negative or 0)
  mfe: number // max favorable excursion
  signal: number // nilai indikator konfirmasi saat entry
  reason: string
}

export interface EquityPoint {
  time: number
  balance: number
  equity: number
  drawdown: number // negative pct from peak balance
}

export interface BacktestMetrics {
  netProfit: number
  grossProfit: number
  grossLoss: number
  profitFactor: number
  totalTrades: number
  winRate: number
  maxDrawdown: number // currency
  maxDrawdownPct: number
  expectancy: number
  consecutiveWins: number
  consecutiveLosses: number
  sqn: number
  recoveryFactor: number
  var95: number
  var99: number
  cvar95: number
  ulcerIndex: number
  maxTimeToRecovery: number // seconds
  informationRatio: number
  calmarRatio: number
  omegaRatio: number
  skewness: number
  kurtosis: number
  durbinWatson: number
  finalBalance: number
  annualizedReturnPct: number
}

export interface WFARun {
  window: number
  isProfit: number
  oosProfit: number
  wfe: number
}

export interface BacktestResult {
  id: string
  strategyName: string
  pair: string
  timeframe: string
  deposit: number
  params: Record<string, number>
  trades: Trade[]
  equity: EquityPoint[]
  metrics: BacktestMetrics
  wfa?: { runs: WFARun[]; aggregateWFE: number }
  monteCarlo?: { curves: number[][]; ruinProbability: number; medianFinal: number; worstDrawdownPct: number }
  createdAt: number
}

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'

export const TF_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
}
