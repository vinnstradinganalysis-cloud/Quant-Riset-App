import { lazy, Suspense, useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useGlobalState, type TabKey } from '@/store/globalState'
import { useDataStore } from '@/store/dataStore'
import { Database, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const ChartModule = lazy(() => import('@/modules/Chart/ChartModule'))
const FileModule = lazy(() => import('@/modules/File/FileModule'))
const CodeEditorModule = lazy(() => import('@/modules/CodeEditor/CodeEditorModule'))
const StrategyTesterModule = lazy(() => import('@/modules/StrategyTester/StrategyTesterModule'))
const ReportModule = lazy(() => import('@/modules/Report/ReportModule'))

const MODULES: Record<TabKey, typeof ChartModule> = {
  chart: ChartModule,
  file: FileModule,
  editor: CodeEditorModule,
  tester: StrategyTesterModule,
  report: ReportModule,
}

function FirstRunGate() {
  const generating = useDataStore((s) => s.generating)
  const generateSampleData = useDataStore((s) => s.generateSampleData)

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
      <div className="ios-card max-w-md w-full p-8 text-center">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
          style={{ background: 'linear-gradient(145deg, #5AC8FA 0%, #007AFF 55%, #5856D6 100%)' }}
        >
          <Database className="text-white" size={30} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Selamat datang di QuantLab</h1>
        <p className="text-muted-foreground text-[15px] mb-6 leading-relaxed">
          Platform riset kuantitatif 100% client-side. Untuk memulai, kami akan membuat dataset contoh{' '}
          <span className="font-semibold text-foreground">XAUUSD 1-Minute</span> (~120 hari) langsung di perangkat Anda.
        </p>
        {generating.active ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-primary font-medium">
              <Loader2 className="animate-spin" size={18} />
              Membuat data contoh… {Math.round(generating.pct)}%
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${generating.pct}%` }}
              />
            </div>
          </div>
        ) : (
          <Button size="lg" className="rounded-full px-8" onClick={generateSampleData}>
            Buat Data Contoh & Mulai
          </Button>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const activeTab = useGlobalState((s) => s.activeTab)
  const ready = useDataStore((s) => s.ready)
  const datasets = useDataStore((s) => s.datasets)
  const loadAll = useDataStore((s) => s.loadAll)
  const [visited, setVisited] = useState<Set<TabKey>>(new Set(['chart']))

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    setVisited((v) => (v.has(activeTab) ? v : new Set(v).add(activeTab)))
  }, [activeTab])

  if (!ready) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    )
  }

  if (!datasets.length) {
    return (
      <>
        <FirstRunGate />
        <Toaster position="top-center" />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="pt-14">
        {(Object.keys(MODULES) as TabKey[]).map((key) => {
          if (!visited.has(key)) return null
          const Mod = MODULES[key]
          return (
            <div key={key} style={{ display: activeTab === key ? 'block' : 'none' }}>
              <Suspense
                fallback={
                  <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" size={28} />
                  </div>
                }
              >
                <Mod />
              </Suspense>
            </div>
          )
        })}
      </main>
      <BottomNav />
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}
