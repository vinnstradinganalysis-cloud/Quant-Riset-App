import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Settings2, CalendarClock, FlaskConical, SlidersHorizontal, ChevronDown, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { useUIStore } from '@/store/uiStore'
import { useGlobalState } from '@/store/globalState'
import { useDataStore } from '@/store/dataStore'
import { aggregateCandles } from '@/utils/quantLogic'
import { TF_SECONDS, type BacktestResult, type Timeframe } from '@/types/domain'
import { saveResult } from '@/utils/dbManager'
import { dateInputToEpoch, epochToDateInput, fmtMoney, fmtNum, fmtPct } from '@/utils/format'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']

interface OptRow {
  params: Record<string, number>
  netProfit: number
  maxDrawdownPct: number
  profitFactor: number
  winRate: number
  totalTrades: number
  sqn: number
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function SelectBox({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full bg-secondary/70 rounded-xl pl-3 pr-8 h-10 text-[14px] font-medium outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
    </div>
  )
}

export default function StrategyTesterModule() {
  const setTopBarCenter = useUIStore((s) => s.setTopBarCenter)
  const setActiveTab = useGlobalState((s) => s.setActiveTab)
  const scripts = useDataStore((s) => s.scripts)
  const datasets = useDataStore((s) => s.datasets)
  const tester = useDataStore((s) => s.tester)
  const updateTester = useDataStore((s) => s.updateTester)
  const setLastResult = useDataStore((s) => s.setLastResult)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [optRows, setOptRows] = useState<OptRow[]>([])
  const [optMethod, setOptMethod] = useState<string>('')
  const [sortKey, setSortKey] = useState<keyof OptRow>('netProfit')
  const [sortDir, setSortDir] = useState<-1 | 1>(-1)
  const workerRef = useRef<Worker | null>(null)

  const strategies = useMemo(() => scripts.filter((s) => s.type === 'strategy'), [scripts])
  const strategy = strategies.find((s) => s.id === tester.strategyId) ?? null
  const dataset = datasets.find((d) => d.id === tester.datasetId) ?? null

  /* sinkron parameter saat strategi berganti */
  useEffect(() => {
    if (!strategy) return
    const paramValues = { ...tester.paramValues }
    const paramRanges = { ...tester.paramRanges }
    let changed = false
    for (const [k, v] of Object.entries(strategy.params)) {
      if (!(k in paramValues)) {
        paramValues[k] = v
        changed = true
      }
      if (!(k in paramRanges)) {
        const step = v >= 10 ? 1 : v >= 1 ? 0.5 : 0.1
        paramRanges[k] = { start: Math.max(0, Math.round((v * 0.5) * 100) / 100), step, stop: Math.round(v * 2 * 100) / 100 }
        changed = true
      }
    }
    // hapus param yang sudah tidak ada di script
    for (const k of Object.keys(paramValues)) {
      if (!(k in strategy.params)) {
        delete paramValues[k]
        delete paramRanges[k]
        changed = true
      }
    }
    if (changed) updateTester({ paramValues, paramRanges })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy?.id])

  const startTest = () => {
    if (!strategy) {
      toast.error('Pilih strategi terlebih dahulu.')
      return
    }
    if (!dataset) {
      toast.error('Pilih dataset terlebih dahulu.')
      return
    }
    if (running) return

    const candles = aggregateCandles(dataset.data, TF_SECONDS[tester.timeframe])
    const startTime = dateInputToEpoch(tester.startDate)
    const endTime = dateInputToEpoch(tester.endDate, true)

    const w = new Worker(new URL('../../workers/backtestWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    setRunning(true)
    setProgress({ pct: 0, label: 'Menyiapkan…' })
    setOptRows([])

    w.onmessage = async (e) => {
      const msg = e.data
      if (msg.type === 'progress') {
        setProgress({ pct: msg.pct, label: msg.label })
      } else if (msg.type === 'error') {
        toast.error(msg.message)
        setRunning(false)
        w.terminate()
      } else if (msg.type === 'done') {
        const result = msg.result as BacktestResult
        await saveResult(result)
        setLastResult(result)
        setRunning(false)
        w.terminate()
        if (msg.optimization) {
          setOptRows(msg.optimization as OptRow[])
          setOptMethod(msg.method === 'genetic' ? 'Genetic Algorithm' : 'Grid Search')
        }
        toast.success('Backtest selesai!', {
          description: `${result.strategyName} · ${result.pair} ${result.timeframe} · Net ${fmtMoney(result.metrics.netProfit)}`,
          action: {
            label: 'Lihat Hasil',
            onClick: () => setActiveTab('report'),
          },
          duration: 8000,
        })
      }
    }
    w.onerror = () => {
      toast.error('Backtest worker gagal.')
      setRunning(false)
      w.terminate()
    }

    w.postMessage({
      cmd: tester.testType === 'optimization' ? 'optimize' : 'single',
      candles,
      code: strategy.code,
      params: tester.paramValues,
      deposit: tester.deposit,
      riskPct: tester.riskPct,
      priceModel: tester.priceModel,
      startTime,
      endTime,
      forwardRatio: tester.forwardEnabled ? tester.forwardRatio : 0,
      strategyName: strategy.name,
      pair: dataset.pair,
      timeframe: tester.timeframe,
      ranges: tester.paramRanges,
      method: tester.optMethod,
      reqId: Date.now().toString(36),
    })
  }

  const stopTest = () => {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    toast('Backtest dibatalkan.')
  }

  /* ---------- Top Bar: START TEST ---------- */
  useEffect(() => {
    setTopBarCenter(
      running ? (
        <button
          onClick={stopTest}
          className="ios-press flex items-center gap-1.5 bg-destructive text-white rounded-full px-4 sm:px-5 h-9 text-[13px] sm:text-[14px] font-semibold shadow-sm"
        >
          <Square size={13} /> STOP
        </button>
      ) : (
        <button
          onClick={startTest}
          className="ios-press flex items-center gap-1.5 bg-primary text-white rounded-full px-4 sm:px-5 h-9 text-[13px] sm:text-[14px] font-semibold shadow-sm"
        >
          <Play size={13} /> START TEST
        </button>
      ),
    )
    return () => setTopBarCenter(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTopBarCenter, running, tester, strategy, dataset])

  const sortedRows = useMemo(() => {
    return [...optRows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir
      return 0
    })
  }, [optRows, sortKey, sortDir])

  const setSort = (k: keyof OptRow) => {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1))
    else {
      setSortKey(k)
      setSortDir(-1)
    }
  }

  const paramKeys = strategy ? Object.keys(strategy.params) : []

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 pt-6 pb-36">
      <Accordion
        type="multiple"
        value={tester.accordionOpen}
        onValueChange={(v) => updateTester({ accordionOpen: v as string[] })}
        className="space-y-3"
      >
        {/* Card 1: Pengaturan Utama */}
        <AccordionItem value="main" className="ios-card border-none px-4 sm:px-5">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2 font-semibold text-[16px]">
              <Settings2 size={17} className="text-primary" /> Pengaturan Utama
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Strategi">
                <SelectBox
                  value={tester.strategyId}
                  onChange={(v) => updateTester({ strategyId: v })}
                  options={strategies.map((s) => ({ value: s.id, label: s.name }))}
                />
              </Field>
              <Field label="Data / Pair">
                <SelectBox
                  value={tester.datasetId}
                  onChange={(v) => updateTester({ datasetId: v })}
                  options={datasets.map((d) => ({ value: d.id, label: d.pair }))}
                />
              </Field>
              <Field label="Timeframe">
                <SelectBox
                  value={tester.timeframe}
                  onChange={(v) => updateTester({ timeframe: v as Timeframe })}
                  options={TIMEFRAMES.map((t) => ({ value: t, label: t }))}
                />
              </Field>
              <Field label="Model Harga">
                <RadioGroup
                  value={tester.priceModel}
                  onValueChange={(v) => updateTester({ priceModel: v as 'ohlc' | 'open' })}
                  className="flex gap-4 h-10 items-center"
                >
                  <label className="flex items-center gap-1.5 text-[14px] cursor-pointer">
                    <RadioGroupItem value="ohlc" /> 1-Minute OHLC
                  </label>
                  <label className="flex items-center gap-1.5 text-[14px] cursor-pointer">
                    <RadioGroupItem value="open" /> Open Prices Only
                  </label>
                </RadioGroup>
              </Field>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Card 2: Rentang Waktu & Modal */}
        <AccordionItem value="time" className="ios-card border-none px-4 sm:px-5">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2 font-semibold text-[16px]">
              <CalendarClock size={17} className="text-primary" /> Rentang Waktu & Modal
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Waktu Mulai">
                <input
                  type="date"
                  value={tester.startDate}
                  min={dataset ? epochToDateInput(dataset.startDate) : undefined}
                  max={dataset ? epochToDateInput(dataset.endDate) : undefined}
                  onChange={(e) => updateTester({ startDate: e.target.value })}
                  className="w-full bg-secondary/70 rounded-xl px-3 h-10 text-[14px] outline-none"
                />
              </Field>
              <Field label="Waktu Akhir">
                <input
                  type="date"
                  value={tester.endDate}
                  min={dataset ? epochToDateInput(dataset.startDate) : undefined}
                  max={dataset ? epochToDateInput(dataset.endDate) : undefined}
                  onChange={(e) => updateTester({ endDate: e.target.value })}
                  className="w-full bg-secondary/70 rounded-xl px-3 h-10 text-[14px] outline-none"
                />
              </Field>
              <Field label="Modal Awal (Initial Deposit)">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[14px]">$</span>
                  <input
                    type="number"
                    value={tester.deposit}
                    onChange={(e) => updateTester({ deposit: Math.max(100, Number(e.target.value) || 0) })}
                    className="w-full bg-secondary/70 rounded-xl pl-7 pr-3 h-10 text-[14px] font-mono-num outline-none"
                  />
                </div>
              </Field>
              <Field label="Risiko per Trade (%)">
                <input
                  type="number"
                  step="0.1"
                  value={tester.riskPct}
                  onChange={(e) => updateTester({ riskPct: Math.max(0.01, Number(e.target.value) || 0) })}
                  className="w-full bg-secondary/70 rounded-xl px-3 h-10 text-[14px] font-mono-num outline-none"
                />
              </Field>
            </div>
            {dataset && (
              <p className="text-[12px] text-muted-foreground mt-3">
                Data tersedia: {epochToDateInput(dataset.startDate)} — {epochToDateInput(dataset.endDate)} · kosongkan
                untuk memakai seluruh rentang.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Card 3: Mode Pengujian */}
        <AccordionItem value="type" className="ios-card border-none px-4 sm:px-5">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2 font-semibold text-[16px]">
              <FlaskConical size={17} className="text-primary" /> Mode Pengujian
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            <RadioGroup
              value={tester.testType}
              onValueChange={(v) => updateTester({ testType: v as 'single' | 'optimization' })}
              className="space-y-3"
            >
              <label className="flex items-start gap-2.5 cursor-pointer">
                <RadioGroupItem value="single" className="mt-0.5" />
                <span>
                  <span className="block text-[14px] font-medium">Single Backtest</span>
                  <span className="block text-[12px] text-muted-foreground">Uji dengan satu set parameter tetap.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <RadioGroupItem value="optimization" className="mt-0.5" />
                <span>
                  <span className="block text-[14px] font-medium">Optimization</span>
                  <span className="block text-[12px] text-muted-foreground">Uji ribuan kombinasi parameter.</span>
                </span>
              </label>
            </RadioGroup>

            {tester.testType === 'optimization' && (
              <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
                <Field label="Metode Optimasi">
                  <RadioGroup
                    value={tester.optMethod}
                    onValueChange={(v) => updateTester({ optMethod: v as 'grid' | 'genetic' })}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <label className="flex items-center gap-1.5 text-[14px] cursor-pointer">
                      <RadioGroupItem value="grid" /> Slow (Grid Search)
                    </label>
                    <label className="flex items-center gap-1.5 text-[14px] cursor-pointer">
                      <RadioGroupItem value="genetic" /> Fast (Genetic Algorithm)
                    </label>
                  </RadioGroup>
                </Field>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={tester.forwardEnabled}
                      onCheckedChange={(c) => updateTester({ forwardEnabled: !!c })}
                    />
                    <span className="text-[14px] font-medium">Forward Testing (Walk-Forward)</span>
                  </label>
                  {tester.forwardEnabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-muted-foreground">Porsi forward:</span>
                      <div className="w-28">
                        <SelectBox
                          value={String(tester.forwardRatio)}
                          onChange={(v) => updateTester({ forwardRatio: Number(v) })}
                          options={[
                            { value: '0.5', label: '1/2 data' },
                            { value: String(1 / 3), label: '1/3 data' },
                            { value: '0.25', label: '1/4 data' },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {tester.testType === 'single' && (
              <div className="mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={tester.forwardEnabled}
                    onCheckedChange={(c) => updateTester({ forwardEnabled: !!c })}
                  />
                  <span className="text-[14px] font-medium">Sertakan Walk-Forward Analysis (5 window)</span>
                </label>
                {tester.forwardEnabled && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-[13px] text-muted-foreground">Porsi forward per window:</span>
                    <div className="w-28">
                      <SelectBox
                        value={String(tester.forwardRatio)}
                        onChange={(v) => updateTester({ forwardRatio: Number(v) })}
                        options={[
                          { value: '0.5', label: '1/2' },
                          { value: String(1 / 3), label: '1/3' },
                          { value: '0.25', label: '1/4' },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Card 4: Parameter Input (dynamic) */}
        <AccordionItem value="params" className="ios-card border-none px-4 sm:px-5">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2 font-semibold text-[16px]">
              <SlidersHorizontal size={17} className="text-primary" /> Parameter Input
              <span className="text-[12px] font-normal text-muted-foreground">
                {tester.testType === 'optimization' ? '· Start / Step / Stop' : '· Value'}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-5">
            {!strategy && <p className="text-[14px] text-muted-foreground">Pilih strategi di Card 1.</p>}
            {strategy && paramKeys.length === 0 && (
              <p className="text-[14px] text-muted-foreground">Strategi ini tidak memiliki parameter.</p>
            )}
            {strategy && paramKeys.length > 0 && tester.testType === 'single' && (
              <div className="divide-y divide-border/60">
                {paramKeys.map((k) => (
                  <div key={k} className="flex items-center justify-between py-2.5">
                    <span className="text-[14px] font-medium">{k}</span>
                    <input
                      type="number"
                      step="any"
                      value={tester.paramValues[k] ?? strategy.params[k]}
                      onChange={(e) =>
                        updateTester({
                          paramValues: { ...tester.paramValues, [k]: Number(e.target.value) },
                        })
                      }
                      className="w-32 bg-secondary/70 rounded-xl px-3 h-9 text-[14px] font-mono-num text-right outline-none"
                    />
                  </div>
                ))}
              </div>
            )}
            {strategy && paramKeys.length > 0 && tester.testType === 'optimization' && (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-[13px] min-w-[420px]">
                  <thead>
                    <tr className="text-muted-foreground text-[12px]">
                      <th className="text-left font-medium py-2">Variabel</th>
                      <th className="text-right font-medium py-2 px-1">Start</th>
                      <th className="text-right font-medium py-2 px-1">Step</th>
                      <th className="text-right font-medium py-2 px-1">Stop</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {paramKeys.map((k) => {
                      const r = tester.paramRanges[k] ?? { start: 0, step: 1, stop: 10 }
                      const set = (field: 'start' | 'step' | 'stop', val: number) =>
                        updateTester({
                          paramRanges: { ...tester.paramRanges, [k]: { ...r, [field]: val } },
                        })
                      return (
                        <tr key={k}>
                          <td className="py-2.5 font-medium pr-2">{k}</td>
                          {(['start', 'step', 'stop'] as const).map((f) => (
                            <td key={f} className="py-1.5 px-1">
                              <input
                                type="number"
                                step="any"
                                value={r[f]}
                                onChange={(e) => set(f, Number(e.target.value))}
                                className="w-full bg-secondary/70 rounded-lg px-2 h-8 text-[13px] font-mono-num text-right outline-none"
                              />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Hasil optimasi */}
      {optRows.length > 0 && (
        <div className="ios-card p-4 sm:p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-[16px]">Hasil Optimasi ({optMethod})</h3>
            <span className="text-[12px] text-muted-foreground">{optRows.length} kombinasi dievaluasi</span>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead>
                <tr className="text-muted-foreground text-[12px] border-b border-border/60">
                  <th className="text-left font-medium py-2">#</th>
                  {(
                    [
                      ['netProfit', 'Net Profit'],
                      ['maxDrawdownPct', 'Max DD %'],
                      ['profitFactor', 'Profit Factor'],
                      ['winRate', 'Win Rate'],
                      ['totalTrades', 'Trades'],
                      ['sqn', 'SQN'],
                    ] as [keyof OptRow, string][]
                  ).map(([k, label]) => (
                    <th key={k} className="text-right font-medium py-2 px-2">
                      <button onClick={() => setSort(k)} className="inline-flex items-center gap-0.5 hover:text-foreground">
                        {label}
                        <ArrowUpDown size={11} className={sortKey === k ? 'text-primary' : ''} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono-num">
                {sortedRows.slice(0, 25).map((row, i) => (
                  <tr key={i} className={i === 0 ? 'bg-primary/5' : ''}>
                    <td className="py-2 font-sans text-muted-foreground">{i + 1}</td>
                    <td className={`text-right py-2 px-2 ${row.netProfit >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                      {fmtMoney(row.netProfit)}
                    </td>
                    <td className="text-right py-2 px-2">{fmtPct(row.maxDrawdownPct)}</td>
                    <td className="text-right py-2 px-2">{fmtNum(row.profitFactor)}</td>
                    <td className="text-right py-2 px-2">{fmtPct(row.winRate, 1)}</td>
                    <td className="text-right py-2 px-2">{row.totalTrades}</td>
                    <td className="text-right py-2 px-2">{fmtNum(row.sqn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedRows[0] && (
            <p className="text-[12px] text-muted-foreground mt-3">
              Parameter terbaik:{' '}
              <span className="font-mono-num">
                {Object.entries(sortedRows[0].params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Progress bar (slide-up, menempel di atas Bottom Nav) */}
      <div
        className="fixed z-30 inset-x-0 flex justify-center px-4 transition-all duration-300 ease-in-out"
        style={{
          bottom: 'max(84px, calc(env(safe-area-inset-bottom) + 84px))',
          transform: running ? 'translateY(0)' : 'translateY(140%)',
          opacity: running ? 1 : 0,
        }}
      >
        <div className="glass-strong rounded-2xl shadow-xl border border-white/30 dark:border-white/10 px-4 py-3 w-full max-w-md">
          <div className="flex items-center justify-between text-[12px] font-medium mb-1.5">
            <span>{progress.label}</span>
            <span className="font-mono-num">{Math.round(progress.pct)}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
