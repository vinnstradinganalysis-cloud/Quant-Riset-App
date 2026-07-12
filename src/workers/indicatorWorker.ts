/// <reference lib="webworker" />
import type { Candle } from '@/types/domain'
import { compileEntry, makeHelpers } from '@/utils/scriptApi'

/*
 * Menjalankan script indikator pengguna di atas data candle.
 * - overlay: true  → menghasilkan markers (panah/label) di chart harga
 * - overlay: false → menghasilkan seri untuk sub-window (histogram/line)
 */
self.onmessage = (e: MessageEvent) => {
  const { code, candles, params, overlay, reqId } = e.data as {
    code: string
    candles: Candle[]
    params: Record<string, number>
    overlay: boolean
    reqId: string
  }
  try {
    const fn = compileEntry(code, 'calculate') as (
      ctx: Record<string, unknown>,
      i: number,
    ) => unknown
    const helpers = makeHelpers(candles)
    const markers: {
      time: number
      position: 'aboveBar' | 'belowBar' | 'inBar'
      color: string
      shape: 'arrowUp' | 'arrowDown' | 'circle'
      text?: string
    }[] = []
    const series: { time: number; value: number; color?: string }[] = []

    const ctx: Record<string, unknown> = { candles, params, ...helpers }
    const step = Math.max(1, Math.ceil(candles.length / 8000))
    for (let i = 0; i < candles.length; i++) {
      const out = fn(ctx, i) as
        | number
        | null
        | undefined
        | { marker?: (typeof markers)[number]; value?: number; color?: string }
      if (out === null || out === undefined) continue
      if (typeof out === 'number') {
        if (!overlay && i % step === 0 && isFinite(out)) series.push({ time: candles[i].time, value: out })
        continue
      }
      if (out.marker) markers.push({ ...out.marker, time: candles[i].time })
      if (typeof out.value === 'number' && !overlay && i % step === 0 && isFinite(out.value)) {
        series.push({ time: candles[i].time, value: out.value, color: out.color })
      }
    }
    // Batasi kepadatan marker: jika terlalu banyak, pangkas & hilangkan label teks
    let finalMarkers = markers
    if (finalMarkers.length > 600) {
      const k = Math.ceil(finalMarkers.length / 600)
      finalMarkers = finalMarkers.filter((_, i) => i % k === 0)
    }
    if (finalMarkers.length > 120) {
      finalMarkers = finalMarkers.map((m) => ({ ...m, text: undefined }))
    }
    self.postMessage({ type: 'done', reqId, markers: finalMarkers, series })
  } catch (err) {
    self.postMessage({ type: 'error', reqId, message: (err as Error).message })
  }
}
