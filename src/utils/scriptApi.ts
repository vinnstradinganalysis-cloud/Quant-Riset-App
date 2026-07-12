import type { Candle } from '@/types/domain'

/*
 * API indikator bawaan yang tersedia di dalam ctx untuk script pengguna.
 * Semua fungsi dihitung "per bar" terhadap posisi i saat ini (tanpa lookahead).
 */
export function makeHelpers(candles: Candle[]) {
  return {
    sma(period: number, i: number, src: 'close' | 'open' | 'high' | 'low' = 'close'): number | null {
      if (i < period - 1) return null
      let s = 0
      for (let k = i - period + 1; k <= i; k++) s += candles[k][src]
      return s / period
    },
    ema(period: number, i: number, src: 'close' | 'open' | 'high' | 'low' = 'close'): number | null {
      if (i < period - 1) return null
      const k = 2 / (period + 1)
      let ema = candles[i - period + 1][src]
      for (let j = i - period + 2; j <= i; j++) ema = candles[j][src] * k + ema * (1 - k)
      return ema
    },
    highest(period: number, i: number): number | null {
      if (i < period - 1) return null
      let h = -Infinity
      for (let k = i - period + 1; k <= i; k++) h = Math.max(h, candles[k].high)
      return h
    },
    lowest(period: number, i: number): number | null {
      if (i < period - 1) return null
      let l = Infinity
      for (let k = i - period + 1; k <= i; k++) l = Math.min(l, candles[k].low)
      return l
    },
    atr(period: number, i: number): number | null {
      if (i < period) return null
      let s = 0
      for (let k = i - period + 1; k <= i; k++) {
        const c = candles[k]
        const pc = candles[k - 1].close
        s += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc))
      }
      return s / period
    },
    rsi(period: number, i: number): number | null {
      if (i < period) return null
      let gain = 0, loss = 0
      for (let k = i - period + 1; k <= i; k++) {
        const diff = candles[k].close - candles[k - 1].close
        if (diff > 0) gain += diff
        else loss -= diff
      }
      if (loss === 0) return 100
      const rs = gain / loss
      return 100 - 100 / (1 + rs)
    },
    volumeSma(period: number, i: number): number | null {
      if (i < period - 1) return null
      let s = 0
      for (let k = i - period + 1; k <= i; k++) s += candles[k].volume
      return s / period
    },
  }
}

export type Helpers = ReturnType<typeof makeHelpers>

export interface ScriptMetaParsed {
  name: string
  overlay: boolean
  type: 'indicator' | 'strategy'
  params: Record<string, number>
}

/*
 * Membaca metadata dari komentar di baris awal kode:
 *   // name: Engulfing + Volume Trigger
 *   // overlay: true
 *   // type: strategy
 *   // params: { "VolMult": 2.0, "RiskPct": 1 }
 */
export function parseScriptMeta(code: string, fallbackName: string, fallbackType: 'indicator' | 'strategy'): ScriptMetaParsed {
  const head = code.slice(0, 2000)
  const nameM = /\/\/\s*name\s*:\s*(.+)/i.exec(head)
  const overlayM = /\/\/\s*overlay\s*:\s*(true|false)/i.exec(head)
  const typeM = /\/\/\s*type\s*:\s*(indicator|strategy)/i.exec(head)
  const paramsM = /\/\/\s*params\s*:\s*(\{[^}]*\})/i.exec(head)
  let params: Record<string, number> = {}
  if (paramsM) {
    try {
      const raw = paramsM[1].replace(/'/g, '"')
      const obj = JSON.parse(raw)
      for (const k of Object.keys(obj)) {
        const v = Number(obj[k])
        if (isFinite(v)) params[k] = v
      }
    } catch { /* abaikan params rusak */ }
  }
  const type = (typeM?.[1] as 'indicator' | 'strategy') ?? fallbackType
  return {
    name: nameM?.[1]?.trim() || fallbackName,
    overlay: overlayM ? overlayM[1] === 'true' : fallbackType === 'strategy',
    type,
    params,
  }
}

export function compileEntry(code: string, kind: 'onBar' | 'calculate'): (...args: unknown[]) => unknown {
  const factory = new Function(
    `"use strict";\n${code}\n;return ${kind};`,
  )
  return factory()
}
