import type { EChartsOption } from 'echarts'
import type { BacktestResult, Trade } from '@/types/domain'
import { mean, normalQuantile, quantile, std } from '@/utils/quantLogic'

const UP = '#34C759'
const DOWN = '#FF3B30'
const BLUE = '#0A84FF'

function axisStyle(dark: boolean) {
  return {
    axisLine: { lineStyle: { color: dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' } },
    axisLabel: { color: dark ? '#8E8E93' : '#6C6C70', fontSize: 10 },
    splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
  }
}

function tooltipStyle(dark: boolean) {
  return {
    backgroundColor: dark ? 'rgba(28,28,30,0.95)' : 'rgba(255,255,255,0.95)',
    borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    textStyle: { color: dark ? '#fff' : '#000', fontSize: 11 },
  }
}

const fmtTime = (t: number) =>
  new Date(t * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })

/* ---------- 1. Equity / Balance / Drawdown ---------- */

export function equityOption(result: BacktestResult, dark: boolean): EChartsOption {
  const eq = result.equity
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(dark) },
    legend: {
      data: ['Balance', 'Equity', 'Drawdown %'],
      textStyle: { color: dark ? '#AEAEB2' : '#6C6C70', fontSize: 11 },
      top: 0,
    },
    grid: { left: 56, right: 56, top: 34, bottom: 56 },
    xAxis: {
      type: 'category',
      data: eq.map((p) => p.time),
      ...axisStyle(dark),
      axisLabel: { ...axisStyle(dark).axisLabel, formatter: (v: string | number) => fmtTime(Number(v)) },
    },
    yAxis: [
      { type: 'value', scale: true, name: 'USD', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
      { type: 'value', scale: true, name: 'DD %', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark), splitLine: { show: false } },
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', height: 18, bottom: 8, borderColor: 'transparent', backgroundColor: dark ? '#1C1C1E' : '#F2F2F7', fillerColor: 'rgba(10,132,255,0.15)', handleStyle: { color: BLUE } },
    ],
    series: [
      {
        name: 'Balance',
        type: 'line',
        data: eq.map((p) => p.balance),
        lineStyle: { width: 2.5, color: BLUE },
        itemStyle: { color: BLUE },
        showSymbol: false,
        areaStyle: { color: 'rgba(10,132,255,0.08)' },
      },
      {
        name: 'Equity',
        type: 'line',
        data: eq.map((p) => p.equity),
        lineStyle: { width: 1.5, type: 'dashed', color: '#AF52DE' },
        itemStyle: { color: '#AF52DE' },
        showSymbol: false,
      },
      {
        name: 'Drawdown %',
        type: 'line',
        yAxisIndex: 1,
        data: eq.map((p) => p.drawdown),
        lineStyle: { width: 1, color: 'rgba(255,59,48,0.5)' },
        showSymbol: false,
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,59,48,0)' },
              { offset: 1, color: 'rgba(255,59,48,0.35)' },
            ],
          },
        },
      },
    ],
  }
}

/* ---------- 2. Monte Carlo spaghetti ---------- */

export function monteCarloOption(result: BacktestResult, dark: boolean): EChartsOption {
  const curves = result.monteCarlo?.curves ?? []
  const maxLen = Math.max(...curves.map((c) => c.length), 1)
  const series = curves.map((c) => ({
    type: 'line' as const,
    data: c,
    showSymbol: false,
    lineStyle: { width: 0.8, color: dark ? 'rgba(120,160,255,0.10)' : 'rgba(10,132,255,0.09)' },
    emphasis: { disabled: true },
    silent: true,
  }))
  // garis median
  const med: number[] = []
  for (let i = 0; i < maxLen; i++) {
    const vals = curves.map((c) => c[Math.min(i, c.length - 1)]).sort((a, b) => a - b)
    med.push(quantile(vals, 0.5))
  }
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(dark) },
    grid: { left: 56, right: 24, top: 24, bottom: 32 },
    xAxis: { type: 'category', name: 'Trade #', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    yAxis: { type: 'value', scale: true, ...axisStyle(dark) },
    series: [
      ...series,
      {
        type: 'line' as const,
        data: med,
        showSymbol: false,
        lineStyle: { width: 2.5, color: UP },
        name: 'Median',
      },
    ],
  }
}

/* ---------- 3. Histogram + Q-Q ---------- */

export function histogramOption(trades: Trade[], dark: boolean): EChartsOption {
  const pnls = trades.map((t) => t.pnl)
  if (!pnls.length) return { backgroundColor: 'transparent' }
  const m = mean(pnls)
  const sd = std(pnls) || 1
  const min = Math.min(...pnls)
  const max = Math.max(...pnls)
  const bins = 28
  const width = (max - min) / bins || 1
  const counts = new Array(bins).fill(0)
  for (const p of pnls) {
    const idx = Math.min(bins - 1, Math.floor((p - min) / width))
    counts[idx]++
  }
  const labels = counts.map((_, i) => Math.round((min + (i + 0.5) * width) * 100) / 100)
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(dark) },
    grid: { left: 44, right: 16, top: 24, bottom: 40 },
    xAxis: { type: 'category', data: labels, name: 'PnL ($)', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    yAxis: { type: 'value', name: 'Freq', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    series: [
      {
        type: 'bar',
        data: counts.map((c, i) => ({
          value: c,
          itemStyle: { color: labels[i] >= 0 ? 'rgba(52,199,89,0.8)' : 'rgba(255,59,48,0.8)', borderRadius: [3, 3, 0, 0] },
        })),
      },
      {
        type: 'line',
        data: counts.map((_, i) => {
          const x = labels[i]
          const z = (x - m) / sd
          return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI)) * pnls.length * width
        }),
        showSymbol: false,
        lineStyle: { color: BLUE, width: 2 },
      },
    ],
  }
}

export function qqOption(trades: Trade[], dark: boolean): EChartsOption {
  const pnls = trades.map((t) => t.pnl).sort((a, b) => a - b)
  const n = pnls.length
  if (!n) return { backgroundColor: 'transparent' }
  const pts: [number, number][] = pnls.map((p, i) => [normalQuantile((i + 0.5) / n), p])
  const m = mean(pnls)
  const sd = std(pnls) || 1
  const xs = [-3.2, 3.2]
  return {
    backgroundColor: 'transparent',
    tooltip: { ...tooltipStyle(dark) },
    grid: { left: 52, right: 16, top: 24, bottom: 40 },
    xAxis: { type: 'value', name: 'Normal Quantile', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    yAxis: { type: 'value', name: 'PnL', scale: true, nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    series: [
      { type: 'scatter', data: pts, symbolSize: 5, itemStyle: { color: BLUE, opacity: 0.7 } },
      {
        type: 'line',
        data: xs.map((x) => [x, m + sd * x]),
        showSymbol: false,
        lineStyle: { color: DOWN, width: 1.5, type: 'dashed' },
      },
    ],
  }
}

/* ---------- 4. Signal vs Return ---------- */

export function signalReturnOption(trades: Trade[], dark: boolean): EChartsOption {
  const pts = trades
    .filter((t) => t.signal !== 0)
    .map((t) => ({ value: [t.signal, t.pnl], itemStyle: { color: t.pnl >= 0 ? 'rgba(52,199,89,0.75)' : 'rgba(255,59,48,0.75)' } }))
  return {
    backgroundColor: 'transparent',
    tooltip: { ...tooltipStyle(dark) },
    grid: { left: 52, right: 16, top: 24, bottom: 40 },
    xAxis: { type: 'value', name: 'Signal Value', scale: true, nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    yAxis: { type: 'value', name: 'Net Profit', scale: true, nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    series: [{ type: 'scatter', data: pts, symbolSize: 7 }],
  }
}

/* ---------- 5. MAE / MFE ---------- */

export function maeMfeOption(trades: Trade[], dark: boolean): EChartsOption {
  const mfe = trades.map((t) => ({ value: [t.mfe, t.pnl], itemStyle: { color: 'rgba(52,199,89,0.6)' } }))
  const mae = trades.map((t) => ({ value: [t.mae, t.pnl], itemStyle: { color: 'rgba(255,59,48,0.6)' } }))
  return {
    backgroundColor: 'transparent',
    tooltip: { ...tooltipStyle(dark) },
    legend: { data: ['MFE', 'MAE'], textStyle: { color: dark ? '#AEAEB2' : '#6C6C70', fontSize: 11 }, top: 0 },
    grid: { left: 52, right: 16, top: 30, bottom: 40 },
    xAxis: { type: 'value', name: 'Excursion ($)', scale: true, nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    yAxis: { type: 'value', name: 'Closed PnL', scale: true, nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    series: [
      { name: 'MFE', type: 'scatter', data: mfe, symbolSize: 7 },
      { name: 'MAE', type: 'scatter', data: mae, symbolSize: 7 },
    ],
  }
}

/* ---------- 6. Kalender kinerja (bulan × tahun) + hari + jam ---------- */

export function calendarOption(trades: Trade[], dark: boolean): EChartsOption {
  const monthYear = new Map<string, number>()
  const years = new Set<number>()
  for (const t of trades) {
    const d = new Date(t.exitTime * 1000)
    const y = d.getFullYear()
    const m = d.getMonth()
    years.add(y)
    const k = `${y}-${m}`
    monthYear.set(k, (monthYear.get(k) ?? 0) + t.pnl)
  }
  const yearList = [...years].sort()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const data: [number, number, number][] = []
  for (const y of yearList) {
    for (let m = 0; m < 12; m++) {
      const v = monthYear.get(`${y}-${m}`)
      if (v !== undefined) data.push([m, yearList.indexOf(y), Math.round(v * 100) / 100])
    }
  }
  const vals = data.map((d) => d[2])
  const maxAbs = Math.max(Math.abs(Math.min(...vals, 0)), Math.abs(Math.max(...vals, 0)), 1)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipStyle(dark),
      formatter: (p: unknown) => {
        const v = (p as { value: [number, number, number] }).value
        return `${months[v[0]]} ${yearList[v[1]]}: $${v[2].toLocaleString()}`
      },
    },
    grid: { left: 52, right: 16, top: 16, bottom: 32 },
    xAxis: { type: 'category', data: months, ...axisStyle(dark), splitArea: { show: true } },
    yAxis: { type: 'category', data: yearList.map(String), ...axisStyle(dark), splitArea: { show: true } },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      calculable: false,
      show: false,
      inRange: { color: ['#FF6B60', '#FFE5E3', '#F2F2F7', '#D4F2DC', '#1E9E4A'] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          fontSize: 9,
          color: dark ? '#E5E5EA' : '#3A3A3C',
          formatter: (p: unknown) => {
            const v = (p as { value: [number, number, number] }).value
            return Math.abs(v[2]) >= 1000 ? `${(v[2] / 1000).toFixed(1)}k` : `${Math.round(v[2])}`
          },
        },
        itemStyle: { borderRadius: 4, borderColor: dark ? '#000' : '#fff', borderWidth: 2 },
      },
    ],
  }
}

export function dayHourOption(trades: Trade[], dark: boolean): EChartsOption {
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
  const dayPnl = new Array(7).fill(0)
  const hourPnl = new Array(24).fill(0)
  for (const t of trades) {
    const d = new Date(t.exitTime * 1000)
    dayPnl[d.getDay()] += t.pnl
    hourPnl[d.getHours()] += t.pnl
  }
  const bar = (data: number[]) =>
    data.map((v) => ({ value: Math.round(v * 100) / 100, itemStyle: { color: v >= 0 ? UP : DOWN, borderRadius: [3, 3, 0, 0] } }))
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle(dark) },
    grid: [
      { left: 44, right: 16, top: 20, height: '32%' },
      { left: 44, right: 16, top: '62%', height: '28%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: days, ...axisStyle(dark) },
      { type: 'category', gridIndex: 1, data: hourPnl.map((_, i) => `${i}`), name: 'Jam', nameTextStyle: { color: dark ? '#8E8E93' : '#6C6C70' }, ...axisStyle(dark) },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, ...axisStyle(dark) },
      { type: 'value', gridIndex: 1, ...axisStyle(dark) },
    ],
    series: [
      { type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: bar(dayPnl), name: 'Hari' },
      { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: bar(hourPnl), name: 'Jam' },
    ],
  }
}

/* ---------- 7. WFA matrix ---------- */

export function wfaOption(result: BacktestResult, dark: boolean): EChartsOption {
  const runs = result.wfa?.runs ?? []
  const data: [number, number, number][] = []
  for (const r of runs) {
    data.push([0, r.window - 1, Math.round(r.isProfit * 100) / 100])
    data.push([1, r.window - 1, Math.round(r.oosProfit * 100) / 100])
  }
  const vals = data.map((d) => d[2])
  const maxAbs = Math.max(Math.abs(Math.min(...vals, 0)), Math.abs(Math.max(...vals, 0)), 1)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipStyle(dark),
      formatter: (p: unknown) => {
        const v = (p as { value: [number, number, number] }).value
        return `${v[0] === 0 ? 'In-Sample' : 'Out-of-Sample'} · Window ${v[1] + 1}: $${v[2].toLocaleString()}`
      },
    },
    grid: { left: 96, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: 'category',
      data: ['In-Sample', 'Out-of-Sample'],
      ...axisStyle(dark),
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: runs.map((r) => `Window ${r.window}`),
      ...axisStyle(dark),
      splitArea: { show: true },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      show: false,
      inRange: { color: ['#C4302B', '#FFE5E3', '#F2F2F7', '#D4F2DC', '#1E9E4A'] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          fontSize: 10,
          color: dark ? '#E5E5EA' : '#3A3A3C',
          formatter: (p: unknown) => `$${(p as { value: [number, number, number] }).value[2].toLocaleString()}`,
        },
        itemStyle: { borderRadius: 4, borderColor: dark ? '#000' : '#fff', borderWidth: 2 },
      },
    ],
  }
}

/* ---------- 8. Strategy Score gauge ---------- */

export function gaugeOption(score: number, grade: string, color: string, dark: boolean): EChartsOption {
  return {
    backgroundColor: 'transparent',
    series: [
      {
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: '92%',
        center: ['50%', '58%'],
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: { color },
        },
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [0.5, dark ? 'rgba(255,59,48,0.25)' : 'rgba(255,59,48,0.15)'],
              [0.8, dark ? 'rgba(10,132,255,0.25)' : 'rgba(10,132,255,0.15)'],
              [1, dark ? 'rgba(212,160,23,0.3)' : 'rgba(212,160,23,0.2)'],
            ],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '32%'],
          fontSize: 13,
          color,
          formatter: grade,
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, 0],
          fontSize: 44,
          fontWeight: 700,
          color: dark ? '#fff' : '#000',
          formatter: '{value}',
        },
        data: [{ value: score }],
      },
    ],
  }
}
