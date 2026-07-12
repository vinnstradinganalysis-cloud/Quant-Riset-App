import { useEffect, useRef, useState } from 'react'
import { Plus, MoreVertical, UploadCloud, FileJson, Pencil, Trash2, Calendar, Database, HardDrive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUIStore } from '@/store/uiStore'
import { useDataStore } from '@/store/dataStore'
import type { Candle, Dataset } from '@/types/domain'
import { fmtDate, fmtSize, fmtNum } from '@/utils/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
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

interface ParseState {
  active: boolean
  pct: number
  label: string
}

function useJsonParser() {
  const [state, setState] = useState<ParseState>({ active: false, pct: 0, label: '' })

  const parse = (file: File, mode: 'new' | 'append', existing?: Candle[]): Promise<Candle[]> =>
    new Promise((resolve, reject) => {
      setState({ active: true, pct: 0, label: 'Membaca file…' })
      const reader = new FileReader()
      reader.onerror = () => {
        setState({ active: false, pct: 0, label: '' })
        reject(new Error('Gagal membaca file.'))
      }
      reader.onload = () => {
        const worker = new Worker(new URL('../../workers/parseWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e) => {
          const msg = e.data
          if (msg.type === 'progress') {
            setState({ active: true, pct: msg.pct, label: msg.label })
          } else if (msg.type === 'done') {
            worker.terminate()
            setState({ active: false, pct: 100, label: '' })
            resolve(msg.candles as Candle[])
          } else if (msg.type === 'error') {
            worker.terminate()
            setState({ active: false, pct: 0, label: '' })
            reject(new Error(msg.message))
          }
        }
        worker.onerror = () => {
          worker.terminate()
          setState({ active: false, pct: 0, label: '' })
          reject(new Error('Worker gagal memproses file.'))
        }
        worker.postMessage({ text: reader.result as string, mode, existing })
      }
      reader.readAsText(file)
    })

  return { state, parse }
}

function Dropzone({ onFile, file }: { onFile: (f: File) => void; file: File | null }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handle = (f: File | undefined) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.json')) {
      toast.error('Hanya file .json yang didukung.')
      return
    }
    onFile(f)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        handle(e.dataTransfer.files?.[0])
      }}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        drag ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0] ?? undefined)}
      />
      {file ? (
        <div className="flex flex-col items-center gap-1.5">
          <FileJson className="text-primary" size={32} />
          <p className="font-medium text-[15px]">{file.name}</p>
          <p className="text-xs text-muted-foreground">{fmtSize(file.size)} — klik untuk ganti file</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5">
          <UploadCloud className="text-muted-foreground" size={32} />
          <p className="font-medium text-[15px]">Klik untuk Unggah atau Seret & Lepas</p>
          <p className="text-xs text-muted-foreground">Format .json dengan kolom time, open, high, low, close, volume</p>
        </div>
      )}
    </div>
  )
}

function DatasetCard({ ds, onEdit, onDelete }: { ds: Dataset; onEdit: () => void; onDelete: () => void }) {
  const initials = ds.pair.slice(0, 2).toUpperCase()
  return (
    <div className="ios-card p-4 sm:p-5 flex items-start gap-4">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold shrink-0"
        style={{ background: 'linear-gradient(145deg, #5AC8FA, #007AFF 60%, #5856D6)' }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[17px] truncate">{ds.pair}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ios-press w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary">
                <MoreVertical size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              <DropdownMenuItem onClick={onEdit} className="rounded-lg">
                <Pencil size={15} className="mr-2" /> Edit & Append
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="rounded-lg text-destructive focus:text-destructive">
                <Trash2 size={15} className="mr-2" /> Hapus Data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HardDrive size={14} /> {fmtSize(ds.sizeBytes)}
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={14} /> {fmtNum(ds.bars, 0)} bars
          </span>
          <span className="flex items-center gap-1.5 truncate">
            <Calendar size={14} /> {fmtDate(ds.startDate)} – {fmtDate(ds.endDate)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function FileModule() {
  const setTopBarCenter = useUIStore((s) => s.setTopBarCenter)
  const datasets = useDataStore((s) => s.datasets)
  const addDataset = useDataStore((s) => s.addDataset)
  const removeDataset = useDataStore((s) => s.removeDataset)
  const renameDataset = useDataStore((s) => s.renameDataset)
  const appendDataset = useDataStore((s) => s.appendDataset)
  const generateSampleData = useDataStore((s) => s.generateSampleData)

  const [addOpen, setAddOpen] = useState(false)
  const [pair, setPair] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [editTarget, setEditTarget] = useState<Dataset | null>(null)
  const [editName, setEditName] = useState('')
  const [editFile, setEditFile] = useState<File | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null)
  const { state: parseState, parse } = useJsonParser()

  useEffect(() => {
    setTopBarCenter(<h1 className="font-semibold text-[17px]">File Manager</h1>)
    return () => setTopBarCenter(null)
  }, [setTopBarCenter])

  const handleSaveNew = async () => {
    if (!pair.trim()) {
      toast.error('Nama pair wajib diisi.')
      return
    }
    if (!file) {
      toast.error('Pilih file JSON terlebih dahulu.')
      return
    }
    try {
      const candles = await parse(file, 'new')
      await addDataset(pair.trim().toUpperCase(), candles, file.size)
      toast.success(`Data ${pair.trim().toUpperCase()} tersimpan — ${fmtNum(candles.length, 0)} bars.`)
      setAddOpen(false)
      setPair('')
      setFile(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleSaveEdit = async () => {
    if (!editTarget) return
    try {
      if (editName.trim() && editName.trim().toUpperCase() !== editTarget.pair) {
        await renameDataset(editTarget.id, editName.trim().toUpperCase())
        toast.success(`Pair diganti menjadi ${editName.trim().toUpperCase()}.`)
      }
      if (editFile) {
        const merged = await parse(editFile, 'append', editTarget.data)
        await appendDataset(editTarget.id, merged)
        toast.success(`Data digabung — total ${fmtNum(merged.length, 0)} bars (duplikat dihapus).`)
      }
      setEditTarget(null)
      setEditFile(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await removeDataset(deleteTarget.id)
    toast.success(`Data ${deleteTarget.pair} telah dihapus.`)
    setDeleteTarget(null)
  }

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 pt-6 pb-32">
      <Button onClick={() => setAddOpen(true)} className="rounded-full w-full sm:w-auto mb-6" size="lg">
        <Plus size={18} className="mr-1" /> Tambahkan Data
      </Button>

      {parseState.active && (
        <div className="ios-card p-4 mb-6">
          <div className="flex items-center gap-2 text-[14px] font-medium mb-2">
            <Loader2 size={16} className="animate-spin text-primary" />
            {parseState.label}
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${parseState.pct}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {datasets.map((ds) => (
          <DatasetCard
            key={ds.id}
            ds={ds}
            onEdit={() => {
              setEditTarget(ds)
              setEditName(ds.pair)
              setEditFile(null)
            }}
            onDelete={() => setDeleteTarget(ds)}
          />
        ))}
        {!datasets.length && (
          <div className="text-center py-16 text-muted-foreground">
            <FileJson size={40} className="mx-auto mb-3 opacity-40" />
            <p>Belum ada dataset. Tambahkan file JSON atau buat data contoh.</p>
            <Button variant="outline" className="rounded-full mt-4" onClick={generateSampleData}>
              Buat Data Contoh XAUUSD
            </Button>
          </div>
        )}
      </div>

      {/* Modal Tambahkan Data */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-3xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Tambahkan Data</DialogTitle>
            <DialogDescription>Unggah riwayat harga JSON ke penyimpanan lokal perangkat Anda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nama Pair</Label>
              <Input
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                placeholder="Masukkan Nama Pair (mis. XAUUSD)"
                className="rounded-xl h-11"
              />
            </div>
            <Dropzone onFile={setFile} file={file} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button className="rounded-full" onClick={handleSaveNew} disabled={parseState.active}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Edit & Append */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="rounded-3xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Edit Data</DialogTitle>
            <DialogDescription>Ganti nama pair atau gabungkan (append) file JSON baru ke dataset ini.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Rename Pair</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="rounded-xl h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Append Data (opsional)</Label>
              <Dropzone onFile={setEditFile} file={editFile} />
              <p className="text-xs text-muted-foreground">
                File baru akan digabung, diurutkan kronologis, dan timestamp duplikat dihapus.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setEditTarget(null)}>
              Batal
            </Button>
            <Button className="rounded-full" onClick={handleSaveEdit} disabled={parseState.active}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Data?</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus data <strong>{deleteTarget?.pair}</strong>? Tindakan ini tidak dapat
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
