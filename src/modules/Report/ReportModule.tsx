import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Download, FlaskConical, TrendingUp, ShieldAlert, Target, Award, Activity, Brain } from 'lucide-react'
import { toast } from 'sonner'
import { useUIStore } from '@/store/uiStore'
import { useGlobalState } from '@/store/globalState'
import { useDataStore } from '@/store/dataStore'
import { strategyScore } from '@/utils/quantLogic'
import { fmtDuration, fmtMoney, fmtNum, fmtPct } from '@/utils/format'
import { Button } from '@/components/ui/button'
import {
  equityOption,
  monteCarloOption,
  histogramOption,
  qqOption,
  signalReturnOption,
  maeMfeOption,
  calendarOption,
  dayHourOption,
  wfaOption,
  gaugeOption,
} from './reportCharts'

/* ---------- Lazy render via IntersectionObserver (NFR-2) ---------- */

function LazyChart({ option, height = 300 }: { option: EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const theme = useGlobalState((s) => s.theme)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [visible])

  return (
    <div ref={ref} style={{ height }}>
      {visible && (
        <ReactECharts
          key={theme}
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
      )}
    </div>
  )
}

/* ---------- Metric card ---------- */

function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  const color = tone === 'good' ? 'text-[#34C759]' : tone === 'bad' ? 'text-[#FF3B30]' : 'text-foreground'
  return (
    <div className="ios-card p-3.5">
      <p className="text-[11px] text-muted-foreground font-medium leading-tight">{label}</p>
      <p className={`font-mono-num text-[18px] font-semibold mt-1 ${color}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  )
}

function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div className="flex items-start gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h2 className="font-semibold text-[16px] leading-tight">{title}</h2>
        {desc && <p className="text-[12px] text-muted-foreground">{desc}</p>}
      </div>
    </div>
  )
}

export default function ReportModule() {
  const theme = useGlobalState((s) => s.theme)
  const dark = theme === 'dark'
  const setActiveTab = useGlobalState((s) => s.setActiveTab)
  const setTopBarCenter = useUIStore((s) => s.setTopBarCenter)
  const setTopBarRightExtra = useUIStore((s) => s.setTopBarRightExtra)
  const result = useDataStore((s) => s.lastResult)

  useEffect(() => {
    setTopBarCenter(<h1 className="font-semibold text-[15px] sm:text-[17px] truncate">Quant Report & Analytics</h1>)
    setTopBarRightExtra(
      <button
        onClick={() => {
          toast('Membuka dialog cetak — pilih "Save as PDF"', { duration: 3000 })
          setTimeout(() => window.print(), 400)
        }}
        className="ios-press w-9 h-9 rounded-full bg-secondary/80 flex items-center justify-center text-foreground/80"
        title="Export PDF"
      >
        <Download size={17} />
      </button>,
    )
    return () => {
      setTopBarCenter(null)
      setTopBarRightExtra(null)
    }
  }, [setTopBarCenter, setTopBarRightExtra])

  const score = useMemo(
    () => (result ? strategyScore(result.metrics, result.wfa?.aggregateWFE ?? null) : null),
    [result],
  )

  if (!result || !score) {
    return (
      <div className="max-w-[560px] mx-auto px-6 pt-24 pb-32 text-center">
        <div className="ios-card p-10">
          <FlaskConical size={44} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="font-semibold text-[19px] mb-2">Belum ada hasil backtest</h2>
          <p className="text-[14px] text-muted-foreground mb-6">
            Jalankan simulasi di Tab Strategy Tester untuk menghasilkan laporan analitik institusional.
          </p>
          <Button className="rounded-full" onClick={() => setActiveTab('tester')}>
            Buka Strategy Tester
          </Button>
        </div>
      </div>
    )
  }

  const m = result.metrics
  const tone = (v: number) => (v > 0 ? 'good' : v < 0 ? 'bad' : 'neutral')

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-6 pb-32 space-y-5">
      {/* Header ringkas */}
      <div className="ios-card p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <p className="text-[12px] text-muted-foreground">Strategi</p>
            <p className="font-semibold text-[17px]">{result.strategyName}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground">Pair / TF</p>
            <p className="font-semibold text-[17px]">
              {result.pair} · {result.timeframe}
            </p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground">Deposit</p>
            <p className="font-semibold text-[17px] font-mono-num">{fmtMoney(result.deposit)}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground">Final Balance</p>
            <p className={`font-semibold text-[17px] font-mono-num ${m.netProfit >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
              {fmtMoney(m.finalBalance)}
            </p>
          </div>
          <div className="ml-auto">
            <p className="text-[12px] text-muted-foreground">Tanggal</p>
            <p className="font-medium text-[14px]">{new Date(result.createdAt).toLocaleString('id-ID')}</p>
          </div>
        </div>
      </div>

      {/* Metrik kunci */}
      <div>
        <SectionTitle icon={<Activity size={15} />} title="Key Performance Metrics" desc="Profil kinerja & risiko dasar" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <MetricCard label="Net Profit" value={fmtMoney(m.netProfit)} tone={tone(m.netProfit)} />
          <MetricCard label="Profit Factor" value={fmtNum(m.profitFactor)} tone={m.profitFactor >= 1 ? 'good' : 'bad'} />
          <MetricCard label="Total Trades" value={String(m.totalTrades)} />
          <MetricCard label="Win Rate" value={fmtPct(m.winRate, 1)} tone={m.winRate >= 50 ? 'good' : 'neutral'} />
          <MetricCard label="Max Drawdown" value={fmtMoney(m.maxDrawdown)} hint={fmtPct(m.maxDrawdownPct)} tone="bad" />
          <MetricCard label="Expectancy / Trade" value={fmtMoney(m.expectancy)} tone={tone(m.expectancy)} />
          <MetricCard label="Gross Profit" value={fmtMoney(m.grossProfit)} tone="good" />
          <MetricCard label="Gross Loss" value={fmtMoney(m.grossLoss)} tone="bad" />
          <MetricCard label="Consecutive Wins" value={String(m.consecutiveWins)} />
          <MetricCard label="Consecutive Losses" value={String(m.consecutiveLosses)} />
          <MetricCard label="SQN (Van Tharp)" value={fmtNum(m.sqn)} tone={m.sqn >= 2 ? 'good' : 'neutral'} />
          <MetricCard label="Recovery Factor" value={fmtNum(m.recoveryFactor)} tone={m.recoveryFactor >= 1 ? 'good' : 'bad'} />
        </div>
      </div>

      {/* Risk & ratio */}
      <div>
        <SectionTitle icon={<ShieldAlert size={15} />} title="Institutional Risk & Tail Analytics" desc="Analisis downside & rasio penyesuaian risiko" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <MetricCard label="VaR 95%" value={fmtMoney(m.var95)} tone="bad" />
          <MetricCard label="VaR 99%" value={fmtMoney(m.var99)} tone="bad" />
          <MetricCard label="CVaR (Exp. Shortfall)" value={fmtMoney(m.cvar95)} tone="bad" />
          <MetricCard label="Ulcer Index" value={fmtNum(m.ulcerIndex)} tone={m.ulcerIndex < 5 ? 'good' : 'neutral'} />
          <MetricCard label="Max Time to Recovery" value={fmtDuration(m.maxTimeToRecovery)} />
          <MetricCard label="Information Ratio" value={fmtNum(m.informationRatio)} tone={tone(m.informationRatio)} />
          <MetricCard label="Calmar Ratio" value={fmtNum(m.calmarRatio)} tone={m.calmarRatio >= 1 ? 'good' : 'neutral'} />
          <MetricCard label="Omega Ratio" value={fmtNum(m.omegaRatio)} tone={m.omegaRatio >= 1 ? 'good' : 'bad'} />
          <MetricCard label="Skewness" value={fmtNum(m.skewness)} tone={m.skewness > 0 ? 'good' : 'neutral'} />
          <MetricCard label="Kurtosis" value={fmtNum(m.kurtosis)} hint="Normal ≈ 3" />
          <MetricCard label="Durbin-Watson" value={fmtNum(m.durbinWatson)} hint="≈2 = independen" />
          <MetricCard label="Annualized Return" value={fmtPct(m.annualizedReturnPct, 1)} tone={tone(m.annualizedReturnPct)} />
        </div>
      </div>

      {/* Equity curve */}
      <div className="ios-card p-4 sm:p-5">
        <SectionTitle icon={<TrendingUp size={15} />} title="Equity, Balance & Underwater Drawdown" />
        <LazyChart option={equityOption(result, dark)} height={340} />
      </div>

      {/* Monte Carlo */}
      <div className="ios-card p-4 sm:p-5">
        <SectionTitle
          icon={<Brain size={15} />}
          title="Monte Carlo Permutation (500 iterasi)"
          desc="Proyeksi kurva ekuitas dengan urutan trade diacak"
        />
        <div className="grid grid-cols-3 gap-2.5 mb-2">
          <MetricCard label="Risk of Ruin (DD>20%)" value={fmtPct(result.monteCarlo?.ruinProbability ?? 0, 1)} tone={(result.monteCarlo?.ruinProbability ?? 0) < 5 ? 'good' : 'bad'} />
          <MetricCard label="Median Final Balance" value={fmtMoney(result.monteCarlo?.medianFinal ?? 0)} />
          <MetricCard label="Worst Drawdown" value={fmtPct(result.monteCarlo?.worstDrawdownPct ?? 0, 1)} tone="bad" />
        </div>
        <LazyChart option={monteCarloOption(result, dark)} height={300} />
      </div>

      {/* Distribusi & Q-Q */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="ios-card p-4 sm:p-5">
          <SectionTitle icon={<Activity size={15} />} title="Profit Distribution" desc="Histogram PnL per trade vs kurva normal" />
          <LazyChart option={histogramOption(result.trades, dark)} height={260} />
        </div>
        <div className="ios-card p-4 sm:p-5">
          <SectionTitle icon={<Target size={15} />} title="Q-Q Plot" desc="Deteksi fat-tail vs distribusi normal teoretis" />
          <LazyChart option={qqOption(result.trades, dark)} height={260} />
        </div>
      </div>

      {/* Signal dependency + MAE/MFE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="ios-card p-4 sm:p-5">
          <SectionTitle
            icon={<Target size={15} />}
            title="Signal vs Return Dependency"
            desc="Pembuktian predictive edge sinyal konfirmasi (hijau = profit)"
          />
          <LazyChart option={signalReturnOption(result.trades, dark)} height={260} />
        </div>
        <div className="ios-card p-4 sm:p-5">
          <SectionTitle icon={<Activity size={15} />} title="MAE / MFE Excursion" desc="Efisiensi eksekusi SL/TP — money left on the table" />
          <LazyChart option={maeMfeOption(result.trades, dark)} height={260} />
        </div>
      </div>

      {/* Kalender kinerja */}
      <div className="ios-card p-4 sm:p-5">
        <SectionTitle icon={<TrendingUp size={15} />} title="Time-Series Heatmap (Kalender Kinerja)" desc="Return bulanan ($)" />
        <LazyChart option={calendarOption(result.trades, dark)} height={200} />
      </div>

      {/* Distribusi hari & jam */}
      <div className="ios-card p-4 sm:p-5">
        <SectionTitle icon={<Activity size={15} />} title="Distribusi Profit: Hari & Jam" />
        <LazyChart option={dayHourOption(result.trades, dark)} height={340} />
      </div>

      {/* WFA */}
      {result.wfa && (
        <div className="ios-card p-4 sm:p-5">
          <SectionTitle
            icon={<ShieldAlert size={15} />}
            title="Walk-Forward Analysis Matrix"
            desc="In-Sample vs Out-of-Sample — validasi robustness strategi"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
            <MetricCard
              label="Walk-Forward Efficiency (WFE)"
              value={fmtPct(result.wfa.aggregateWFE * 100, 1)}
              tone={result.wfa.aggregateWFE >= 0.5 ? 'good' : 'bad'}
              hint={result.wfa.aggregateWFE >= 0.5 ? '✓ Di atas ambang 50%' : '✗ Di bawah ambang 50%'}
            />
            {result.wfa.runs.slice(0, 2).map((r) => (
              <MetricCard
                key={r.window}
                label={`Window ${r.window}: IS → OOS`}
                value={`${fmtMoney(r.isProfit)} → ${fmtMoney(r.oosProfit)}`}
                tone={r.oosProfit >= 0 ? 'good' : 'bad'}
              />
            ))}
          </div>
          <LazyChart option={wfaOption(result, dark)} height={Math.max(160, result.wfa.runs.length * 52)} />
        </div>
      )}

      {/* Strategy Score */}
      <div className="ios-card p-5 sm:p-6">
        <SectionTitle
          icon={<Award size={15} />}
          title="The Strategy Score Matrix"
          desc="Skor komposit 0–100 dari 4 pilar pembobotan"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
          <LazyChart option={gaugeOption(score.score, score.grade, score.color, dark)} height={280} />
          <div className="space-y-3">
            {score.pillars.map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-[13px] mb-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono-num text-muted-foreground">
                    {p.value} / {p.max}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${(p.value / p.max) * 100}%`, backgroundColor: score.color }}
                  />
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-secondary/60 p-3 text-[12px] text-muted-foreground leading-relaxed">
              <strong style={{ color: score.color }}>{score.grade}</strong> —{' '}
              {score.score >= 80
                ? 'Strategi memiliki keunggulan probabilitas tinggi; layak dipertimbangkan untuk transaksi nyata.'
                : score.score >= 50
                  ? 'Strategi memiliki potensi, namun risk-reward atau rasio filter belum efisien. Optimalkan parameter.'
                  : 'Strategi gagal melewati uji integritas matematis; risiko kerugian jangka panjang tinggi.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
