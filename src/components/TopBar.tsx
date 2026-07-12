import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useGlobalState } from '@/store/globalState'
import { useUIStore } from '@/store/uiStore'

function Logo() {
  return (
    <div className="flex items-center gap-2 select-none shrink-0">
      <div
        className="w-8 h-8 rounded-[10px] flex items-center justify-center shadow-sm"
        style={{ background: 'linear-gradient(145deg, #5AC8FA 0%, #007AFF 55%, #5856D6 100%)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
          <line x1="6" y1="4" x2="6" y2="20" />
          <rect x="4.5" y="8" width="3" height="8" rx="1" fill="white" stroke="none" />
          <line x1="18" y1="4" x2="18" y2="20" />
          <rect x="16.5" y="6" width="3" height="10" rx="1" fill="white" stroke="none" opacity="0.75" />
        </svg>
      </div>
      <span className="font-semibold text-[17px] tracking-tight hidden sm:block">QuantLab</span>
    </div>
  )
}

export default function TopBar() {
  const theme = useGlobalState((s) => s.theme)
  const toggleTheme = useGlobalState((s) => s.toggleTheme)
  const center = useUIStore((s) => s.topBarCenter)
  const rightExtra = useUIStore((s) => s.topBarRightExtra)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 h-14 transition-all duration-300 ${
        scrolled ? 'glass-strong shadow-[0_1px_0_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]' : 'glass'
      }`}
    >
      <div className="h-full max-w-[1400px] mx-auto px-3 sm:px-5 flex items-center justify-between gap-2">
        <Logo />
        <div className="flex-1 flex items-center justify-center min-w-0 gap-2 overflow-hidden">{center}</div>
        <div className="flex items-center gap-2 shrink-0">
          {rightExtra}
          <button
            onClick={toggleTheme}
            aria-label="Toggle tema"
            className="ios-press w-9 h-9 rounded-full bg-secondary/80 flex items-center justify-center text-foreground/80"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
    </header>
  )
}
