/// <reference lib="webworker" />
import type { Candle } from '@/types/domain'

const REQUIRED = ['time', 'open', 'high', 'low', 'close', 'volume'] as const

function normalizeRow(row: Record<string, unknown>): Candle | null {
  const lower: Record<string, unknown> = {}
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k]
  for (const key of REQUIRED) {
    if (typeof lower[key] !== 'number' || !isFinite(lower[key] as number)) return null
  }
  let time = lower.time as number
  // epoch milidetik → detik
  if (time > 1e11) time = Math.floor(time / 1000)
  return {
    time: Math.floor(time),
    open: lower.open as number,
    high: lower.high as number,
    low: lower.low as number,
    close: lower.close as number,
    volume: lower.volume as number,
  }
}

self.onmessage = (e: MessageEvent) => {
  const { text, mode } = e.data as { text: string; mode: 'new' | 'append'; existing?: Candle[] }
  try {
    self.postMessage({ type: 'progress', pct: 5, label: 'Mem-parse JSON…' })
    const parsed = JSON.parse(text)
    const arr: Record<string, unknown>[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.candles)
          ? parsed.candles
          : []
    if (!arr.length) {
      self.postMessage({ type: 'error', message: 'JSON tidak berisi array data candle.' })
      return
    }

    // validasi kolom pada sampel pertama
    const sample = arr[0]
    const keys = Object.keys(sample).map((k) => k.toLowerCase())
    const missing = REQUIRED.filter((k) => !keys.includes(k))
    if (missing.length) {
      self.postMessage({
        type: 'error',
        message: `Format tidak valid. Kolom wajib hilang: ${missing.join(', ')}. Diperlukan: time, open, high, low, close, volume.`,
      })
      return
    }

    self.postMessage({ type: 'progress', pct: 15, label: 'Memvalidasi baris…' })
    const out: Candle[] = new Array(arr.length)
    let valid = 0
    const step = Math.max(1, Math.floor(arr.length / 40))
    for (let i = 0; i < arr.length; i++) {
      const c = normalizeRow(arr[i])
      if (c) out[valid++] = c
      if (i % step === 0) {
        self.postMessage({ type: 'progress', pct: 15 + (i / arr.length) * 60, label: `Memvalidasi ${i.toLocaleString()} baris…` })
      }
    }
    if (valid < 10) {
      self.postMessage({ type: 'error', message: 'Terlalu sedikit baris valid. Periksa tipe data numerik pada kolom OHLCV.' })
      return
    }
    out.length = valid

    let merged = out
    if (mode === 'append' && e.data.existing?.length) {
      self.postMessage({ type: 'progress', pct: 80, label: 'Menggabungkan data…' })
      merged = (e.data.existing as Candle[]).concat(out)
    }

    // sorting kronologis + hapus duplikat timestamp
    self.postMessage({ type: 'progress', pct: 85, label: 'Mengurutkan & menghapus duplikat…' })
    merged.sort((a, b) => a.time - b.time)
    const dedup: Candle[] = []
    let lastTime = -Infinity
    for (const c of merged) {
      if (c.time !== lastTime) {
        dedup.push(c)
        lastTime = c.time
      }
    }

    self.postMessage({ type: 'progress', pct: 100, label: 'Selesai' })
    self.postMessage({ type: 'done', candles: dedup })
  } catch (err) {
    self.postMessage({ type: 'error', message: `Gagal mem-parse JSON: ${(err as Error).message}` })
  }
}
