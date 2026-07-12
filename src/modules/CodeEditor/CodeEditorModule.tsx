import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Save, Play, FolderTree, TerminalSquare, Plus, MoreVertical, Pencil, Trash2, X, ChevronRight, AlertTriangle, CheckCircle2, FileCode2 } from 'lucide-react'
import { toast } from 'sonner'
import './monacoSetup'
import { useUIStore } from '@/store/uiStore'
import { useGlobalState } from '@/store/globalState'
import { useDataStore } from '@/store/dataStore'
import { uid } from '@/utils/dbManager'
import { parseScriptMeta } from '@/utils/scriptApi'
import type { ScriptMeta, ScriptType } from '@/types/domain'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const INDICATOR_TEMPLATE = `// name: My Indicator
// overlay: false
// type: indicator
// params: { "Period": 14 }
// Kembalikan: number | { value, color } (sub-window)
// atau { marker: { position, color, shape, text } } (overlay)
function calculate(ctx, i) {
  const rsi = ctx.rsi(ctx.params.Period, i);
  if (rsi === null) return null;
  return { value: rsi, color: rsi > 70 ? '#FF3B30' : rsi < 30 ? '#34C759' : '#007AFF' };
}
`

const STRATEGY_TEMPLATE = `// name: My Strategy
// overlay: true
// type: strategy
// params: { "Period": 20, "SL_ATR": 1.5, "TP_ATR": 2.5 }
// Fungsi dipanggil sekali per bar. Gunakan ctx.buy / ctx.sell / ctx.close.
function onBar(ctx, i) {
  if (i < ctx.params.Period + 1) return;
  const c = ctx.candles;
  const sma = ctx.sma(ctx.params.Period, i);
  const atr = ctx.atr(14, i);
  if (sma === null || !atr) return;
  const price = ctx.execPrice;

  if (!ctx.position && c[i].close > sma && c[i - 1].close <= sma) {
    ctx.buy({ sl: price - ctx.params.SL_ATR * atr, tp: price + ctx.params.TP_ATR * atr, signal: price - sma });
  } else if (!ctx.position && c[i].close < sma && c[i - 1].close >= sma) {
    ctx.sell({ sl: price + ctx.params.SL_ATR * atr, tp: price - ctx.params.TP_ATR * atr, signal: price - sma });
  }
}
`

interface ConsoleEntry {
  time: number
  ok: boolean
  text: string
}

function draftKey(id: string) {
  return `quantlab.draft.${id}`
}

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

export default function CodeEditorModule() {
  const theme = useGlobalState((s) => s.theme)
  const scripts = useDataStore((s) => s.scripts)
  const addScript = useDataStore((s) => s.addScript)
  const removeScript = useDataStore((s) => s.removeScript)
  const setTopBarCenter = useUIStore((s) => s.setTopBarCenter)

  const [currentId, setCurrentId] = useState<string>(() => scripts[0]?.id ?? '')
  const [code, setCode] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [panelWidth, setPanelWidth] = useState(290)
  const [consoleHeight, setConsoleHeight] = useState(220)
  const [deleteTarget, setDeleteTarget] = useState<ScriptMeta | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isMobile = useIsMobile()
  const compileWorkerRef = useRef<Worker | null>(null)

  const current = scripts.find((s) => s.id === currentId) ?? null

  // sinkron pilihan awal ketika scripts termuat
  useEffect(() => {
    if (!currentId && scripts.length) setCurrentId(scripts[0].id)
  }, [scripts, currentId])

  // muat kode script aktif (prioritas draft autosave)
  useEffect(() => {
    if (!current) {
      setCode('')
      return
    }
    const draft = localStorage.getItem(draftKey(current.id))
    setCode(draft ?? current.code)
  }, [currentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // autosave draft ke localStorage (debounced)
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => {
      if (code !== current.code) localStorage.setItem(draftKey(current.id), code)
    }, 800)
    return () => clearTimeout(t)
  }, [code, current])

  const pushConsole = useCallback((ok: boolean, text: string) => {
    setConsoleEntries((prev) => [...prev.slice(-80), { time: Date.now(), ok, text }])
  }, [])

  /* ---------- Top Bar: Save & Compile ---------- */
  useEffect(() => {
    setTopBarCenter(
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => handleSave()}
          className="ios-press flex items-center gap-1.5 bg-secondary/80 rounded-full px-3.5 h-8 text-[13px] font-semibold"
        >
          <Save size={14} /> Save
        </button>
        <button
          onClick={() => handleCompile()}
          className="ios-press flex items-center gap-1.5 bg-primary text-white rounded-full px-3.5 h-8 text-[13px] font-semibold"
        >
          <Play size={13} /> Compile
        </button>
      </div>,
    )
    return () => setTopBarCenter(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTopBarCenter, code, current])

  const handleSave = async () => {
    if (!current) return
    const meta = parseScriptMeta(code, current.name, current.type)
    const updated: ScriptMeta = {
      ...current,
      name: meta.name,
      overlay: meta.overlay,
      params: meta.params,
      code,
      updatedAt: Date.now(),
    }
    await addScript(updated)
    localStorage.removeItem(draftKey(current.id))
    pushConsole(true, `Script "${updated.name}" tersimpan ke IndexedDB.`)
    toast.success(`"${updated.name}" tersimpan`)
  }

  const handleCompile = () => {
    if (!current) return
    compileWorkerRef.current?.terminate()
    const w = new Worker(new URL('../../workers/compileWorker.ts', import.meta.url), { type: 'module' })
    compileWorkerRef.current = w
    w.onmessage = async (e) => {
      const { ok, message } = e.data
      pushConsole(ok, message)
      setConsoleOpen(true)
      if (ok) {
        toast.success('Compilation Success')
        // metadata binding: simpan agar muncul di dropdown Tab Chart
        const meta = parseScriptMeta(code, current.name, current.type)
        const updated: ScriptMeta = {
          ...current,
          name: meta.name,
          overlay: meta.overlay,
          params: meta.params,
          code,
          updatedAt: Date.now(),
        }
        await addScript(updated)
        localStorage.removeItem(draftKey(current.id))
      } else {
        toast.error('Compilation Error — lihat Console')
      }
    }
    w.postMessage({ code, id: current.id })
  }

  const handleNew = (type: ScriptType) => {
    const id = uid('scr')
    const template = type === 'indicator' ? INDICATOR_TEMPLATE : STRATEGY_TEMPLATE
    const meta = parseScriptMeta(template, type === 'indicator' ? 'New Indicator' : 'New Strategy', type)
    const script: ScriptMeta = {
      id,
      name: `${meta.name} ${scripts.filter((s) => s.type === type).length + 1}`,
      type,
      overlay: meta.overlay,
      params: meta.params,
      code: template.replace('My Indicator', `${meta.name} ${scripts.length + 1}`).replace('My Strategy', `${meta.name} ${scripts.length + 1}`),
      updatedAt: Date.now(),
    }
    addScript(script)
    setCurrentId(id)
    if (isMobile) setManagerOpen(false)
  }

  const handleRename = (s: ScriptMeta) => {
    const name = window.prompt('Nama baru script:', s.name)
    if (!name?.trim()) return
    addScript({ ...s, name: name.trim(), updatedAt: Date.now() })
    toast.success('Script di-rename')
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await removeScript(deleteTarget.id)
    localStorage.removeItem(draftKey(deleteTarget.id))
    if (currentId === deleteTarget.id) {
      const rest = scripts.filter((s) => s.id !== deleteTarget.id)
      setCurrentId(rest[0]?.id ?? '')
    }
    toast.success(`Script "${deleteTarget.name}" dihapus`)
    setDeleteTarget(null)
  }

  /* ---------- Drag handle: Script Manager (desktop) ---------- */
  const onManagerDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const move = (ev: PointerEvent) => setPanelWidth(Math.max(220, Math.min(520, startW + ev.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- Drag handle: Console (desktop) ---------- */
  const onConsoleDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = consoleHeight
    const move = (ev: PointerEvent) => setConsoleHeight(Math.max(120, Math.min(480, startH - (ev.clientY - startY))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const renderGroup = (type: ScriptType, label: string) => {
    const list = scripts.filter((s) => s.type === type)
    const isCollapsed = collapsed[type]
    return (
      <div>
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [type]: !c[type] }))}
          className="w-full flex items-center gap-1 px-2 py-1.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide"
        >
          <ChevronRight size={13} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          {label}
          <span className="ml-auto text-[11px] font-normal">{list.length}</span>
        </button>
        {!isCollapsed &&
          list.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1.5 pl-6 pr-1.5 py-1.5 mx-1 rounded-xl cursor-pointer ${
                currentId === s.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary'
              }`}
              onClick={() => {
                setCurrentId(s.id)
                if (isMobile) setManagerOpen(false)
              }}
            >
              <FileCode2 size={14} className="shrink-0" />
              <span className="flex-1 truncate text-[13px] font-medium">{s.name}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="ios-press w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"
                  >
                    <MoreVertical size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl">
                  <DropdownMenuItem onClick={() => handleRename(s)} className="rounded-lg">
                    <Pencil size={14} className="mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(s)}
                    className="rounded-lg text-destructive focus:text-destructive"
                  >
                    <Trash2 size={14} className="mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
      </div>
    )
  }

  return (
    <div className="relative h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Kanvas kode penuh */}
      <div className="absolute inset-0">
        {current ? (
          <Editor
            key={currentId}
            path={`${currentId}.js`}
            language="javascript"
            value={code}
            onChange={(v) => setCode(v ?? '')}
            theme={theme === 'dark' ? 'ios-dark' : 'ios-light'}
            options={{
              fontSize: 13,
              fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
              minimap: { enabled: !isMobile },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              padding: { top: 12, bottom: 90 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              roundedSelection: false,
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: !isMobile,
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p>Belum ada script. Buat baru dari Script Manager.</p>
          </div>
        )}
      </div>

      {/* Floating icon: Script Manager (kiri atas) */}
      <button
        onClick={() => setManagerOpen((o) => !o)}
        className="ios-press absolute z-20 top-3 left-3 w-10 h-10 rounded-2xl glass-strong shadow-md flex items-center justify-center text-foreground/80"
        title="Script Manager"
      >
        <FolderTree size={18} />
      </button>

      {/* Floating icon: Console (kiri bawah) */}
      <button
        onClick={() => setConsoleOpen((o) => !o)}
        className="ios-press absolute z-20 left-3 bottom-24 w-10 h-10 rounded-2xl glass-strong shadow-md flex items-center justify-center text-foreground/80"
        title="Console Output"
      >
        <TerminalSquare size={18} />
        {consoleEntries.some((c) => !c.ok) && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white text-[9px] flex items-center justify-center">
            !
          </span>
        )}
      </button>

      {/* Panel Script Manager */}
      {managerOpen && isMobile && (
        <div className="absolute inset-0 z-30 bg-black/40" onClick={() => setManagerOpen(false)} />
      )}
      <aside
        className="absolute z-30 top-0 left-0 h-full glass-strong border-r border-border/50 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width: isMobile ? 'min(86vw, 340px)' : panelWidth,
          transform: managerOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-border/40 shrink-0">
          <span className="font-semibold text-[15px]">Script Manager</span>
          <button onClick={() => setManagerOpen(false)} className="ios-press w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X size={14} />
          </button>
        </div>
        <div className="p-3 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ios-press w-full h-9 rounded-xl bg-primary text-white text-[13px] font-semibold flex items-center justify-center gap-1.5">
                <Plus size={15} /> New Script
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="rounded-xl w-48">
              <DropdownMenuItem onClick={() => handleNew('indicator')} className="rounded-lg">
                Indicator
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNew('strategy')} className="rounded-lg">
                Strategy
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex-1 overflow-y-auto pb-6">
          {renderGroup('indicator', 'Indicators')}
          {renderGroup('strategy', 'Strategies')}
        </div>
        {/* Drag handle (desktop) */}
        {!isMobile && (
          <div
            onPointerDown={onManagerDrag}
            className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize hover:bg-primary/30 active:bg-primary/40 touch-none"
            style={{ minWidth: 6 }}
          />
        )}
      </aside>

      {/* Panel Console Output */}
      <section
        className="absolute z-30 left-0 right-0 bottom-0 glass-strong border-t border-border/50 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          height: isMobile ? 'min(55vh, 340px)' : consoleHeight,
          transform: consoleOpen ? 'translateY(0)' : 'translateY(100%)',
        }}
      >
        {/* Drag handle atas (desktop) */}
        {!isMobile && (
          <div
            onPointerDown={onConsoleDrag}
            className="absolute -top-[3px] left-0 right-0 h-[8px] cursor-row-resize hover:bg-primary/20 touch-none z-10"
          />
        )}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border/40 shrink-0">
          <span className="font-semibold text-[13px] flex items-center gap-1.5">
            <TerminalSquare size={14} /> Console Output
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConsoleEntries([])}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button onClick={() => setConsoleOpen(false)} className="ios-press w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
              <X size={12} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono-num text-[12px] space-y-1.5">
          {!consoleEntries.length && (
            <p className="text-muted-foreground">Belum ada output. Tekan Compile untuk memvalidasi kode.</p>
          )}
          {consoleEntries.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              {c.ok ? (
                <CheckCircle2 size={14} className="text-[#34C759] shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={14} className="text-[#FF3B30] shrink-0 mt-0.5" />
              )}
              <span className={c.ok ? 'text-foreground/90' : 'text-[#FF3B30]'}>{c.text}</span>
              <span className="ml-auto text-muted-foreground shrink-0">
                {new Date(c.time).toLocaleTimeString('id-ID')}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Konfirmasi hapus script */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Script?</AlertDialogTitle>
            <AlertDialogDescription>
              Script <strong>{deleteTarget?.name}</strong> akan dihapus permanen dari penyimpanan lokal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
