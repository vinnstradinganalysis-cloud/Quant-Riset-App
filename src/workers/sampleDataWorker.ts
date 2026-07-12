/// <reference lib="webworker" />
import type { Candle } from '@/types/domain'

/*
 * Generator data XAUUSD 1M sintetis namun realistis:
 * - Random walk dengan volatilitas berklaster (GARCH-like)
 * - Rezim tren & range berganti
 * - Sesi trading gold: ~23 jam/hari, libur akhir pekan
 * - Lonjakan volume di sekitar sesi London/NY
 */
self.onmessage = (e: MessageEvent) => {
  const { days = 120, startPrice = 2620, seed = 42 } = e.data || {}

  // PRNG deterministik (mulberry32)
  let s = seed >>> 0
  const rnd = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => {
    let u = 0, v = 0
    while (u === 0) u = rnd()
    while (v === 0) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const candles: Candle[] = []
  // mulai dari hari kerja ~N hari lalu
  let t = Math.floor(Date.now() / 1000) - days * 86400
  t = Math.floor(t / 60) * 60

  let price = startPrice
  let vol = 0.35 // volatilitas dasar per menit (USD)
  let trend = 0
  let regimeBars = 0
  const end = Math.floor(Date.now() / 1000) - 3600

  const totalEstimate = days * 1380
  let count = 0
  let lastProgress = 0

  while (t < end) {
    const d = new Date(t * 1000)
    const day = d.getUTCDay()
    const hour = d.getUTCHours()
    // akhir pekan: Jumat 22:00 UTC → Minggu 22:00 UTC
    const weekend = day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22)
    if (weekend) {
      t += 60
      continue
    }
    // pergantian rezim
    if (regimeBars <= 0) {
      regimeBars = 500 + Math.floor(rnd() * 3000)
      trend = (rnd() - 0.5) * 0.14
      if (rnd() < 0.3) trend = 0 // fase ranging
    }
    regimeBars--

    // volatilitas berklaster + efek sesi (London 7-11 UTC, NY 12-16 UTC)
    const sessionBoost = (hour >= 7 && hour <= 16) ? 1.7 : 1.0
    vol = Math.max(0.12, vol * 0.97 + Math.abs(gauss()) * 0.05 * sessionBoost)

    const open = price
    const shock = gauss() * vol * sessionBoost + trend
    let close = open + shock
    const wick = Math.abs(gauss()) * vol * 0.9
    const high = Math.max(open, close) + wick * rnd()
    const low = Math.min(open, close) - wick * rnd()
    if (low < 100) { t += 60; continue }

    // volume: dasar + lonjakan sesi + spike acak (untuk strategi volume)
    let volume = 350 + rnd() * 450
    volume *= sessionBoost
    if (rnd() < 0.02) volume *= 2.5 + rnd() * 3 // volume spike
    if (Math.abs(shock) > vol * 2.2) volume *= 1.8

    candles.push({
      time: t,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.round(volume),
    })
    price = close
    count++
    if (count - lastProgress >= 4000) {
      lastProgress = count
      self.postMessage({ type: 'progress', pct: Math.min(95, (count / totalEstimate) * 100) })
    }
    t += 60
  }

  self.postMessage({ type: 'done', candles, pair: 'XAUUSD' })
}
