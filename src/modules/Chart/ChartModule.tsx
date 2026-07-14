import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { ChevronDown, PenTool, RotateCcw, Magnet, Eraser, Crosshair, Minus, TrendingUp, Play, Pause, StepForward, X, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { useUIStore } from '@/store/uiStore'
import { useGlobalState } from '@/store/globalState'
import { useDataStore } from '@/store/dataStore'
import type { Candle, Timeframe } from '@/types/domain'
import { TF_SECONDS } from '@/types/domain'
import { aggregateCandles } from '@/utils/quantLogic'
import { chartOptions, CANDLE_COLORS } from './chartTheme'
import { fmtNum } from '@/utils/format'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']

interface HudData {
  o: number
  h: number
  l: number
  c: number
  v: number
  up: boolean
}

type ToolMode = 'cursor' | 'hline' | 'trend'

interface ReplayPos {
  dir: 1 | -1
  entry: number
  entryTime: number
  size: number
  sl: number | null
  tp: number | null
}

const toCandleData = (cs: Candle[]) =>
  cs.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }))

const toVolData = (cs: Candle[]) =>
  cs.map((c) => ({
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(52,199,89,0.45)' : 'rgba(255,59,48,0.45)',
  }))

export default function ChartModule() {
  const theme = useGlobalState((s) => s.theme)
  const activeTab = useGlobalState((s) => s.activeTab)
  const datasets = useDataStore((s) => s.datasets)
  const selectedPairId = useDataStore((s) => s.selectedPairId)
  const setSelectedPair = useDataStore((s) => s.setSelectedPair)
  const chartTimeframe = useDataStore((s) => s.chartTimeframe)
  const setChartTimeframe = useDataStore((s) => s.setChartTimeframe)
  const scripts = useDataStore((s) => s.scripts)
  const activeIndicators = useDataStore((s) => s.activeIndicators)
  const toggleIndicator = useDataStore((s) => s.toggleIndicator)
  const setTopBarCenter = useUIStore((s) => s.setTopBarCenter)

  const dataset = useMemo(() => datasets.find((d) => d.id === selectedPairId) ?? null, [datasets, selectedPairId])
  const full = useMemo(
    () => (dataset ? aggregateCandles(dataset.data, TF_SECONDS[chartTimeframe]) : []),
    [dataset, chartTimeframe],
  )

  /* ---------- refs ---------- */
  const mainEl = useRef<HTMLDivElement>(null)
  const subEl = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const subChartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const fullRef = useRef<Candle[]>([])
  const startRef = useRef(0) // index awal window di full
  const endRef = useRef(0) // index akhir (eksklusif) — berubah saat replay
  const mapRef = useRef<Map<number, Candle>>(new Map())
  const priceLinesRef = useRef<IPriceLine[]>([])
  const trendSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const trendFirstRef = useRef<{ idx: number; price: number } | null>(null)
  const indicatorMarkersRef = useRef<SeriesMarker<Time>[]>([])
  const replayMarkersRef = useRef<SeriesMarker<Time>[]>([])
  const syncingRef = useRef(false)
  const magnetRef = useRef(false)
  const toolRef = useRef<ToolMode>('cursor')
  const replayRef = useRef({ active: false, idx: 0, playing: false, speed: 4 })
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const replayPosRef = useRef<ReplayPos | null>(null)
  const pendingSlTpRef = useRef<'sl' | 'tp' | null>(null)

  /* ---------- UI state ---------- */
  const [hud, setHud] = useState<HudData | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tool, setToolState] = useState<ToolMode>('cursor')
  const [magnet, setMagnetState] = useState(false)
  const [replay, setReplay] = useState({ active: false, playing: false, speed: 4, pct: 60 })
  const [vBalance, setVBalance] = useState(10000)
  const [replayPnl, setReplayPnl] = useState({ floating: 0, realized: 0, hasPos: false, dir: 0 })
  const [subVisible, setSubVisible] = useState(false)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)

  const setTool = (t: ToolMode) => {
    toolRef.current = t
    setToolState(t)
    trendFirstRef.current = null
  }
  const setMagnet = (m: boolean) => {
    magnetRef.current = m
    setMagnetState(m)
  }

  // Menggunakan API bawaan lightweight-charts secara langsung
  const refreshMarkers = useCallback(() => {
    candleRef.current?.setMarkers([...indicatorMarkersRef.current, ...replayMarkersRef.current])
  }, [])

  const rebuildMap = useCallback(() => {
    const m = new Map<number, Candle>()
    for (const c of fullRef.current) m.set(c.time, c)
    mapRef.current = m
  }, [])

  /* ---------- Top Bar contextual ---------- */
  useEffect(() => {
    if (activeTab !== 'chart') return

    const indicatorScripts = scripts.filter((s) => s.type === 'indicator')
    
    setTopBarCenter(
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar max-w-full">
        {/* Pair Selector */}
        <div className="relative shrink-0">
          <select
            value={selectedPairId ?? ''}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="appearance-none bg-secondary/80 rounded-full pl-3 pr-7 h-8 text-[13px] font-semibold outline-none cursor-pointer"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.pair}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
        </div>
        {/* Timeframe Selector */}
        <div className="flex items-center bg-secondary/80 rounded-full p-0.5 shrink-0">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setChartTimeframe(tf)}
              className={`ios-press px-2 sm:px-2.5 h-7 rounded-full text-[12px] font-medium ${
                chartTimeframe === tf ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        {/* Indicator Manager */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="ios-press shrink-0 flex items-center gap-1 bg-secondary/80 rounded-full px-3 h-8 text-[13px] font-medium">
              <PenTool size={14} />
              <span className="hidden sm:inline">Indikator</span>
              {activeIndicators.length > 0 && (
                <span className="bg-primary text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {activeIndicators.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="rounded-2xl w-64 p-2" align="center">
            <p className="text-[13px] font-semibold px-2 py-1.5">Indicator Manager</p>
            {indicatorScripts.length === 0 && (
              <p className="text-[13px] text-muted-foreground px-2 py-3">Belum ada script indikator. Buat di Tab Code Editor.</p>
            )}
            {indicatorScripts.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-secondary cursor-pointer text-[14px]"
              >
                <Checkbox
                  checked={activeIndicators.includes(s.id)}
                  onCheckedChange={() => toggleIndicator(s.id)}
                />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">{s.overlay ? 'overlay' : 'sub-window'}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
        {/* Replay Toggle */}
        <button
          onClick={() => toggleReplay()}
          className={`ios-press shrink-0 flex items-center gap-1 rounded-full px-3 h-8 text-[13px] font-medium ${
            replay.active ? 'bg-primary text-white' : 'bg-secondary/80'
          }`}
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Replay</span>
        </button>
      </div>,
    )
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    datasets,
    selectedPairId,
    chartTimeframe,
    scripts,
    activeIndicators,
    replay.active,
    setTopBarCenter,
    setSelectedPair,
    setChartTimeframe,
    toggleIndicator,
  ])

  /* ---------- Chart init ---------- */
  useEffect(() => {
    if (!mainEl.current) return
    const dark = theme === 'dark'
    const chart = createChart(mainEl.current, {
      ...chartOptions(dark),
      width: mainEl.current.clientWidth,
      height: mainEl.current.clientHeight,
    })

    // Menggunakan pemanggilan method bawaan (lebih aman saat build kompilasi)
    const candle = chart.addCandlestickSeries({
      upColor: CANDLE_COLORS.up,
      downColor: CANDLE_COLORS.down,
      wickUpColor: CANDLE_COLORS.up,
      wickDownColor: CANDLE_COLORS.down,
      borderVisible: false,
    })

    const vol = chart.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    chartRef.current = chart
    candleRef.current = candle
    volRef.current = vol

    /* HUD dari crosshair */
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || replayRef.current.playing) return
      const c = mapRef.current.get(param.time as number)
      if (c) setHud({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, up: c.close >= c.open })
    })

    /* Lazy loading linear */
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncingRef.current) return
      if (range.from < 100 && startRef.current > 0 && !replayRef.current.active) {
        extendBack(1000)
      }
      if (subChartRef.current) {
        syncingRef.current = true
        subChartRef.current.timeScale().setVisibleLogicalRange(range)
        syncingRef.current = false
      }
    })

    /* Drawing tools handler */
    chart.subscribeClick((param) => {
      const candleSeries = candleRef.current
      if (!candleSeries || !param.point) return

      if (replayRef.current.active && pendingSlTpRef.current) {
        const price = snapPrice(param.point.y, param.point.x)
        if (price !== null) placeReplayLine(pendingSlTpRef.current, price)
        pendingSlTpRef.current = null
        return
      }
      if (replayRef.current.active) return

      const t = toolRef.current
      if (t === 'hline') {
        const price = snapPrice(param.point.y, param.point.x)
        if (price !== null) {
          const line = candleSeries.createPriceLine({
            price,
            color: '#FF9500',
            lineWidth: 1,
            lineStyle: 0,
            axisLabelVisible: true,
            title: 'H-Line',
          })
          priceLinesRef.current.push(line)
          toast.success('Horizontal line ditambahkan', { duration: 1200 })
        }
      } else if (t === 'trend') {
        const logical = chart.timeScale().coordinateToLogical(param.point.x)
        if (logical === null) return
        const idx = Math.max(0, Math.min(fullRef.current.length - 1, Math.round(logical) + startRef.current))
        const price = snapPrice(param.point.y, param.point.x)
        if (price === null) return
        if (!trendFirstRef.current) {
          trendFirstRef.current = { idx, price }
          toast('Titik pertama tersimpan — klik titik kedua', { duration: 1800 })
        } else {
          const a = trendFirstRef.current
          trendFirstRef.current = null
          drawTrendline(a.idx, a.price, idx, price)
        }
      }
    })

    const ro = new ResizeObserver(() => {
      if (mainEl.current && chartRef.current) {
        chartRef.current.resize(mainEl.current.clientWidth, mainEl.current.clientHeight)
      }
      if (subEl.current && subChartRef.current) {
        subChartRef.current.resize(subEl.current.clientWidth, subEl.current.clientHeight)
      }
    })
    ro.observe(mainEl.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- Theme update ---------- */
  useEffect(() => {
    const dark = theme === 'dark'
    chartRef.current?.applyOptions(chartOptions(dark))
    subChartRef.current?.applyOptions(chartOptions(dark))
  }, [theme])

  /* ---------- Data load / window ---------- */
  useEffect(() => {
    fullRef.current = full
    rebuildMap()
    if (!candleRef.current || !volRef.current || !chartRef.current) return
    exitReplay()
    clearDrawings()
    const start = Math.max(0, full.length - 2000)
    startRef.current = start
    endRef.current = full.length
    const slice = full.slice(start)
    candleRef.current.setData(toCandleData(slice))
    volRef.current.setData(toVolData(slice))
    chartRef.current.timeScale().fitContent()
    if (slice.length) {
      const last = slice[slice.length - 1]
      setHud({ o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume, up: last.close >= last.open })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  const extendBack = (count: number) => {
    const chart = chartRef.current
    const candle = candleRef.current
    const vol = volRef.current
    if (!chart || !candle || !vol) return
    const start = startRef.current
    if (start <= 0) return
    const newStart = Math.max(0, start - count)
    const added = start - newStart
    const vis = chart.timeScale().getVisibleLogicalRange()
    startRef.current = newStart
    const slice = fullRef.current.slice(newStart, endRef.current)
    candle.setData(toCandleData(slice))
    vol.setData(toVolData(slice))
    if (vis) {
      chart.timeScale().setVisibleLogicalRange({ from: vis.from + added, to: vis.to + added })
    }
  }

  /* ---------- Magnet snap ---------- */
  const snapPrice = (y: number, x: number): number | null => {
    const candle = candleRef.current
    const chart = chartRef.current
    if (!candle || !chart) return null
    const price = candle.coordinateToPrice(y)
    if (price === null) return null
    if (!magnetRef.current) return price
    const logical = chart.timeScale().coordinateToLogical(x)
    if (logical === null) return price
    const idx = Math.round(logical)
    const c = fullRef.current[startRef.current + idx]
    if (!c) return price
    const yH = candle.priceToCoordinate(c.high)
    const yL = candle.priceToCoordinate(c.low)
    if (yH !== null && Math.abs(y - yH) <= 10) return c.high
    if (yL !== null && Math.abs(y - yL) <= 10) return c.low
    return price
  }

  /* ---------- Trendline ---------- */
  const drawTrendline = (idx1: number, p1: number, idx2: number, p2: number) => {
    const chart = chartRef.current
    if (!chart) return
    const from = Math.min(idx1, idx2)
    const to = Math.max(idx1, idx2)
    if (to - from < 1) return
    const pa = idx1 <= idx2 ? p1 : p2
    const pb = idx1 <= idx2 ? p2 : p1
    const data: { time: UTCTimestamp; value: number }[] = []
    for (let i = from; i <= to; i++) {
      const c = fullRef.current[i]
      if (!c) continue
      const ratio = (i - from) / (to - from)
      data.push({ time: c.time as UTCTimestamp, value: pa + (pb - pa) * ratio })
    }
    const line = chart.addLineSeries({
      color: '#FF9500',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    line.setData(data)
    trendSeriesRef.current.push(line)
    toast.success('Trendline ditambahkan', { duration: 1200 })
  }

  const clearDrawings = () => {
    if (candleRef.current) {
      for (const l of priceLinesRef.current) candleRef.current.removePriceLine(l)
    }
    if (chartRef.current) {
      for (const s of trendSeriesRef.current) chartRef.current.removeSeries(s)
    }
    priceLinesRef.current = []
    trendSeriesRef.current = []
    trendFirstRef.current = null
  }

  /* ---------- Crosshair mode ---------- */
  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: { mode: tool === 'cursor' ? CrosshairMode.Normal : CrosshairMode.Magnet },
    })
  }, [tool])

  /* ---------- Indikator ---------- */
  const indicatorDataRef = useRef<
    Map<
      string,
      {
        markers?: SeriesMarker<Time>[]
        series?: ISeriesApi<'Histogram'> | ISeriesApi<'Line'>
      }
    >
  >(new Map())
  const slLineRef = useRef<IPriceLine | null>(null)
  const tpLineRef = useRef<IPriceLine | null>(null)
  const replayRealizedRef = useRef(0)

  useEffect(() => {
    const view = fullRef.current.slice(startRef.current, endRef.current)
    if (!view.length) return

    for (const [id, entry] of indicatorDataRef.current) {
      if (!activeIndicators.includes(id)) {
        if (entry.series && subChartRef.current) subChartRef.current.removeSeries(entry.series)
        indicatorDataRef.current.delete(id)
      }
    }

    let subNeeded = false
    for (const id of activeIndicators) {
      const script = scripts.find((s) => s.id === id)
      if (!script) continue
      if (!script.overlay) subNeeded = true
      const worker = new Worker(new URL('../../workers/indicatorWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        worker.terminate()
        if (e.data.type === 'error') {
          toast.error(`Indikator ${script.name}: ${e.data.message}`)
          return
        }
        if (e.data.type === 'done') {
          if (script.overlay) {
            const prev = indicatorDataRef.current.get(id) ?? {}
            indicatorDataRef.current.set(id, { ...prev, markers: e.data.markers })
            indicatorMarkersRef.current = [...indicatorDataRef.current.values()].flatMap((v) => v.markers ?? [])
            refreshMarkers()
          } else if (subChartRef.current) {
            const prev = indicatorDataRef.current.get(id)
            if (prev?.series) subChartRef.current.removeSeries(prev.series)
            const hasColor = (e.data.series as { color?: string }[]).some((p) => p.color)
            const series = hasColor
              ? subChartRef.current.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
              : subChartRef.current.addLineSeries({
                  color: '#007AFF',
                  lineWidth: 2,
                  priceLineVisible: false,
                  lastValueVisible: true,
                })
            series.setData(e.data.series.map((p: { time: number; value: number; color?: string }) => ({
              time: p.time as UTCTimestamp,
              value: p.value,
              ...(p.color ? { color: p.color } : {}),
            })))
            indicatorDataRef.current.set(id, { ...prev, series })
            subChartRef.current.timeScale().fitContent()
          }
        }
      }
      worker.postMessage({ code: script.code, candles: view, params: script.params, overlay: script.overlay, reqId: id })
    }

    setSubVisible(subNeeded)
    if (!subNeeded && subChartRef.current) {
      subChartRef.current.remove()
      subChartRef.current = null
      for (const [, entry] of indicatorDataRef.current) delete entry.series
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, full, scripts])

  /* ---------- Sub-chart lifecycle ---------- */
  useEffect(() => {
    if (!subVisible || !subEl.current || subChartRef.current) {
      setTimeout(() => {
        if (mainEl.current && chartRef.current) {
          chartRef.current.resize(mainEl.current.clientWidth, mainEl.current.clientHeight)
        }
      }, 30)
      return
    }
    const dark = theme === 'dark'
    const sub = createChart(subEl.current, {
      ...chartOptions(dark),
      width: subEl.current.clientWidth,
      height: subEl.current.clientHeight,
      timeScale: { visible: false },
    })
    subChartRef.current = sub
    sub.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncingRef.current) return
      syncingRef.current = true
      chartRef.current?.timeScale().setVisibleLogicalRange(range)
      syncingRef.current = false
    })
    setTimeout(() => {
      if (mainEl.current && chartRef.current) {
        chartRef.current.resize(mainEl.current.clientWidth, mainEl.current.clientHeight)
      }
    }, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subVisible])

  /* ---------- Bar Replay ---------- */
  const setReplaySlice = () => {
    const slice = fullRef.current.slice(startRef.current, endRef.current)
    candleRef.current?.setData(toCandleData(slice))
    volRef.current?.setData(toVolData(slice))
  }

  const enterReplay = () => {
    const n = fullRef.current.length
    if (n < 2100) {
      toast.error('Data tidak cukup untuk Bar Replay (minimal ~2100 bar).')
      return
    }
    const idx = Math.floor(n * 0.6)
    replayRef.current = { active: true, idx, playing: false, speed: replayRef.current.speed }
    startRef.current = Math.max(0, idx - 2000)
    endRef.current = idx
    setReplaySlice()
    chartRef.current?.timeScale().fitContent()
    replayRealizedRef.current = 0
    setReplay({ active: true, playing: false, speed: replayRef.current.speed, pct: (idx / n) * 100 })
    setReplayPnl({ floating: 0, realized: 0, hasPos: false, dir: 0 })
    toast('Mode Bar Replay aktif — data masa depan disembunyikan', { duration: 2200 })
  }

  const exitReplay = () => {
    if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    replayRef.current = { active: false, idx: 0, playing: false, speed: replayRef.current.speed }
    replayPosRef.current = null
    replayMarkersRef.current = []
    refreshMarkers()
    if (candleRef.current) {
      if (slLineRef.current) candleRef.current.removePriceLine(slLineRef.current)
      if (tpLineRef.current) candleRef.current.removePriceLine(tpLineRef.current)
    }
    slLineRef.current = null
    tpLineRef.current = null
    startRef.current = Math.max(0, fullRef.current.length - 2000)
    endRef.current = fullRef.current.length
    if (candleRef.current && fullRef.current.length) {
      setReplaySlice()
      chartRef.current?.timeScale().fitContent()
    }
    setReplay({ active: false, playing: false, speed: replayRef.current.speed, pct: 60 })
    setReplayPnl({ floating: 0, realized: 0, hasPos: false, dir: 0 })
  }

  const toggleReplay = () => {
    if (replayRef.current.active) exitReplay()
    else enterReplay()
  }

  const updateReplayPosition = (bar: Candle) => {
    const pos = replayPosRef.current
    if (!pos) return
    const hitSL = pos.sl !== null && (pos.dir === 1 ? bar.low <= pos.sl : bar.high >= pos.sl)
    const hitTP = pos.tp !== null && (pos.dir === 1 ? bar.high >= pos.tp : bar.low <= pos.tp)
    if (hitSL && hitTP) closeReplayPos(pos.sl as number, 'SL')
    else if (hitSL) closeReplayPos(pos.sl as number, 'SL')
    else if (hitTP) closeReplayPos(pos.tp as number, 'TP')
    else {
      const floating = (bar.close - pos.entry) * pos.dir * pos.size
      setReplayPnl((p) => ({ ...p, floating }))
    }
  }

  const closeReplayPos = (price: number, reason: string) => {
    const pos = replayPosRef.current
    if (!pos) return
    const pnl = (price - pos.entry) * pos.dir * pos.size
    replayRealizedRef.current += pnl
    replayPosRef.current = null
    replayMarkersRef.current = []
    refreshMarkers()
    if (candleRef.current) {
      if (slLineRef.current) candleRef.current.removePriceLine(slLineRef.current)
      if (tpLineRef.current) candleRef.current.removePriceLine(tpLineRef.current)
    }
    slLineRef.current = null
    tpLineRef.current = null
    setReplayPnl({ floating: 0, realized: replayRealizedRef.current, hasPos: false, dir: 0 })
    toast(`Posisi ditutup (${reason}) — PnL ${pnl >= 0 ? '+' : ''}${fmtNum(pnl)}`, { duration: 1800 })
  }

  const replayStep = () => {
    const r = replayRef.current
    if (!r.active || r.idx >= fullRef.current.length) {
      setReplay((s) => ({ ...s, playing: false }))
      replayRef.current.playing = false
      return
    }
    const bar = fullRef.current[r.idx]
    r.idx += 1
    endRef.current = r.idx
    candleRef.current?.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
    volRef.current?.update({
      time: bar.time as UTCTimestamp,
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(52,199,89,0.45)' : 'rgba(255,59,48,0.45)',
    })
    updateReplayPosition(bar)
    setHud({ o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume, up: bar.close >= bar.open })
    setReplay((s) => ({ ...s, pct: (r.idx / fullRef.current.length) * 100 }))
  }

  const replayOrder = (dir: 1 | -1) => {
    const r = replayRef.current
    if (!r.active) return
    const bar = fullRef.current[r.idx - 1]
    if (!bar) return
    const price = bar.close
    if (replayPosRef.current) closeReplayPos(price, 'Reverse')
    const dist = price * 0.01
    const size = (vBalance * 0.01) / dist
    replayPosRef.current = { dir, entry: price, entryTime: bar.time, size, sl: null, tp: null }
    replayMarkersRef.current = [
      {
        time: bar.time as UTCTimestamp,
        position: dir === 1 ? 'belowBar' : 'aboveBar',
        color: dir === 1 ? '#34C759' : '#FF3B30',
        shape: dir === 1 ? 'arrowUp' : 'arrowDown',
        text: dir === 1 ? 'BUY' : 'SELL',
      },
    ]
    refreshMarkers()
    setReplayPnl({ floating: 0, realized: replayRealizedRef.current, hasPos: true, dir })
  }

  const placeReplayLine = (kind: 'sl' | 'tp', price: number) => {
    const pos = replayPosRef.current
    if (!pos) {
      toast.error('Buka posisi virtual terlebih dahulu.')
      return
    }
    const candle = candleRef.current
    if (!candle) return
    if (kind === 'sl') {
      if (slLineRef.current) candle.removePriceLine(slLineRef.current)
      slLineRef.current = candle.createPriceLine({ price, color: '#FF3B30', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'SL' })
      pos.sl = price
    } else {
      if (tpLineRef.current) candle.removePriceLine(tpLineRef.current)
      tpLineRef.current = candle.createPriceLine({ price, color: '#34C759', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'TP' })
      pos.tp = price
    }
    toast.success(`${kind.toUpperCase()} ditempatkan di ${fmtNum(price)}`, { duration: 1400 })
  }

  /* ---------- Play loop ---------- */
  useEffect(() => {
    if (!replay.playing) {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current)
      return
    }
    replayTimerRef.current = setInterval(replayStep, 1000 / replay.speed)
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.playing, replay.speed])

  const setPlaying = (p: boolean) => {
    replayRef.current.playing = p
    setReplay((s) => ({ ...s, playing: p }))
  }
  const setSpeed = (sp: number) => {
    replayRef.current.speed = sp
    setReplay((s) => ({ ...s, speed: sp }))
  }
  const scrub = (pct: number) => {
    const r = replayRef.current
    if (!r.active) return
    const idx = Math.max(startRef.current + 1, Math.min(fullRef.current.length, Math.floor((pct / 100) * fullRef.current.length)))
    r.idx = idx
    endRef.current = idx
    setReplaySlice()
    setReplay((s) => ({ ...s, pct }))
  }

  /* ---------- Draggable panel ---------- */
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const onDragStart = (e: React.PointerEvent) => {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const parentRect = panel.offsetParent?.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    const move = (ev: PointerEvent) => {
      if (!dragRef.current || !parentRect) return
      const x = Math.max(0, Math.min(parentRect.width - rect.width, ev.clientX - parentRect.left - dragRef.current.dx))
      const y = Math.max(0, Math.min(parentRect.height - rect.height, ev.clientY - parentRect.top - dragRef.current.dy))
      setPanelPos({ x, y })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- cleanup ---------- */
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    }
  }, [])

  if (!dataset) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center text-muted-foreground">
        <p>Pilih atau tambahkan dataset di Tab File.</p>
      </div>
    )
  }

  const hudColor = hud ? (hud.up ? 'text-[#34C759]' : 'text-[#FF3B30]') : ''

  return (
    <div className="relative h-[calc(100vh-3.5rem)] overflow-hidden select-none">
      {/* Main canvas */}
      <div ref={mainEl} className="absolute inset-x-0 top-0" style={{ bottom: subVisible ? '26%' : 0 }} />
      {/* Dynamic sub-window (overlay:false indicators) */}
      {subVisible && (
        <div
          ref={subEl}
          className="absolute inset-x-0 bottom-0 border-t border-border bg-card"
          style={{ height: '26%' }}
        />
      )}

      {/* HUD + Drawing Tools trigger */}
      <div className="absolute top-2 left-2 z-20 flex flex-col items-start gap-2">
        <div className="flex items-center gap-2">
          {hud && (
            <div className="glass-strong rounded-xl px-3 py-1.5 font-mono-num text-[11px] sm:text-[12px] flex items-center gap-2 sm:gap-3 shadow-sm">
              <span>O <b className={hudColor}>{fmtNum(hud.o)}</b></span>
              <span>H <b className={hudColor}>{fmtNum(hud.h)}</b></span>
              <span>L <b className={hudColor}>{fmtNum(hud.l)}</b></span>
              <span>C <b className={hudColor}>{fmtNum(hud.c)}</b></span>
              <span className="hidden sm:inline">V <b className="text-foreground/80">{fmtNum(hud.v, 0)}</b></span>
            </div>
          )}
          <button
            onClick={() => setToolsOpen((o) => !o)}
            className={`ios-press w-8 h-8 rounded-xl glass-strong flex items-center justify-center shadow-sm ${
              toolsOpen || tool !== 'cursor' ? 'text-primary' : 'text-foreground/70'
            }`}
            title="Drawing Tools"
          >
            <PenTool size={15} />
          </button>
        </div>

        {/* Floating Drawing Tools (collapsible, slide-down) */}
        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{ maxHeight: toolsOpen ? 320 : 0, opacity: toolsOpen ? 1 : 0 }}
        >
          <div className="glass-strong rounded-2xl p-1.5 flex flex-col gap-0.5 shadow-lg w-[172px]">
            <ToolButton
              active={tool === 'cursor'}
              onClick={() => setTool('cursor')}
              icon={<Crosshair size={15} />}
              label="Crosshair"
            />
            <ToolButton
              active={tool === 'trend'}
              onClick={() => setTool('trend')}
              icon={<TrendingUp size={15} />}
              label="Trendline"
            />
            <ToolButton
              active={tool === 'hline'}
              onClick={() => setTool('hline')}
              icon={<Minus size={15} />}
              label="Horizontal Line"
            />
            <ToolButton
              active={magnet}
              onClick={() => setMagnet(!magnet)}
              icon={<Magnet size={15} />}
              label="Soft Magnet"
            />
            <ToolButton
              active={false}
              onClick={() => {
                clearDrawings()
                toast.success('Semua drawing dihapus', { duration: 1200 })
              }}
              icon={<Eraser size={15} />}
              label="Eraser"
            />
          </div>
        </div>
      </div>

      {/* Tool hint */}
      {tool !== 'cursor' && !replay.active && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 glass-strong rounded-full px-3 py-1 text-[12px] text-primary font-medium shadow-sm">
          {tool === 'hline'
            ? 'Klik chart untuk menempatkan garis horizontal'
            : trendFirstRef.current
              ? 'Klik titik kedua trendline'
              : 'Klik titik pertama trendline'}
          {magnet ? ' · Magnet aktif' : ''}
        </div>
      )}

      {/* Replay Floating Controller */}
      {replay.active && (
        <div
          ref={panelRef}
          className="absolute z-30 w-[268px] glass-strong rounded-2xl shadow-xl border border-white/30 dark:border-white/10"
          style={panelPos ? { left: panelPos.x, top: panelPos.y } : { left: 12, bottom: 100 }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing border-b border-border/50"
            onPointerDown={onDragStart}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <GripVertical size={14} className="text-muted-foreground" /> Bar Replay
            </span>
            <button onClick={exitReplay} className="ios-press w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
              <X size={13} />
            </button>
          </div>

          <div className="p-3 space-y-3">
            {/* Playback */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaying(!replay.playing)}
                className="ios-press w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center"
              >
                {replay.playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>
              <button
                onClick={() => replayStep()}
                className="ios-press w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
                title="Maju 1 bar"
              >
                <StepForward size={15} />
              </button>
              <div className="flex-1">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>Speed</span>
                  <span>{replay.speed} bar/dtk</span>
                </div>
                <Slider
                  value={[replay.speed]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={(v) => setSpeed(v[0])}
                />
              </div>
            </div>

            {/* Scrub */}
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>Posisi data</span>
                <span>{Math.round(replay.pct)}%</span>
              </div>
              <Slider value={[replay.pct]} min={1} max={100} step={0.5} onValueChange={(v) => scrub(v[0])} />
            </div>

            {/* Virtual Order Panel */}
            <div className="rounded-xl bg-secondary/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold">Virtual Order</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Balance $</span>
                  <input
                    type="number"
                    value={vBalance}
                    onChange={(e) => setVBalance(Math.max(100, Number(e.target.value) || 0))}
                    className="w-20 h-6 rounded-md bg-card px-1.5 text-[12px] font-mono-num text-right outline-none border border-border"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => replayOrder(1)}
                  className="ios-press h-8 rounded-lg bg-[#34C759] text-white text-[13px] font-semibold"
                >
                  Buy Market
                </button>
                <button
                  onClick={() => replayOrder(-1)}
                  className="ios-press h-8 rounded-lg bg-[#FF3B30] text-white text-[13px] font-semibold"
                >
                  Sell Market
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => {
                    pendingSlTpRef.current = 'sl'
                    toast('Klik chart untuk menempatkan Stop Loss', { duration: 2000 })
                  }}
                  className="ios-press h-7 rounded-lg bg-card border border-border text-[12px] font-medium text-[#FF3B30]"
                >
                  Set SL
                </button>
                <button
                  onClick={() => {
                    pendingSlTpRef.current = 'tp'
                    toast('Klik chart untuk menempatkan Take Profit', { duration: 2000 })
                  }}
                  className="ios-press h-7 rounded-lg bg-card border border-border text-[12px] font-medium text-[#34C759]"
                >
                  Set TP
                </button>
              </div>
            </div>

            {/* PnL Tracker */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-secondary/60 py-1.5">
                <p className="text-[10px] text-muted-foreground">Floating PnL</p>
                <p className={`font-mono-num text-[14px] font-semibold ${replayPnl.floating >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                  {replayPnl.floating >= 0 ? '+' : ''}{fmtNum(replayPnl.floating)}
                </p>
              </div>
              <div className="rounded-xl bg-secondary/60 py-1.5">
                <p className="text-[10px] text-muted-foreground">Realized PnL</p>
                <p className={`font-mono-num text-[14px] font-semibold ${replayPnl.realized >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                  {replayPnl.realized >= 0 ? '+' : ''}{fmtNum(replayPnl.realized)}
                </p>
              </div>
            </div>
            {replayPnl.hasPos && (
              <button
                onClick={() => {
                  const bar = fullRef.current[replayRef.current.idx - 1]
                  if (bar) closeReplayPos(bar.close, 'Manual Close')
                }}
                className="ios-press w-full h-7 rounded-lg bg-foreground/90 text-background text-[12px] font-medium"
              >
                Tutup Posisi ({replayPnl.dir === 1 ? 'LONG' : 'SHORT'})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`ios-press flex items-center gap-2 px-2.5 py-2 rounded-xl text-[13px] font-medium text-left ${
        active ? 'bg-primary text-white' : 'hover:bg-secondary text-foreground/80'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
