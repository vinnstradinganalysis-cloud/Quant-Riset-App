import { CandlestickChart, FolderOpen, Code2, FlaskConical, PieChart } from 'lucide-react'
import { useGlobalState, type TabKey } from '@/store/globalState'

const ITEMS: { key: TabKey; label: string; icon: typeof CandlestickChart }[] = [
  { key: 'chart', label: 'Chart', icon: CandlestickChart },
  { key: 'file', label: 'File', icon: FolderOpen },
  { key: 'editor', label: 'Editor', icon: Code2 },
  { key: 'tester', label: 'Tester', icon: FlaskConical },
  { key: 'report', label: 'Report', icon: PieChart },
]

export default function BottomNav() {
  const active = useGlobalState((s) => s.activeTab)
  const setActive = useGlobalState((s) => s.setActiveTab)

  return (
    <nav className="fixed z-40 left-1/2 -translate-x-1/2 bottom-[max(14px,env(safe-area-inset-bottom))]">
      {/* Navbar mengambang — rounded penuh (setengah lingkaran di kedua sisi) */}
      <div className="glass-strong rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-white/30 dark:border-white/10 p-1.5 flex items-center gap-0.5 sm:gap-1">
        {ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key
          return (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`ios-press relative flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-full px-3 sm:px-4 py-1.5 min-w-[58px] transition-colors duration-200 ${
                isActive ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
              <span className={`text-[10px] sm:text-[12px] font-medium leading-none ${isActive ? 'font-semibold' : ''}`}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
