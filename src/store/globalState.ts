import { create } from 'zustand'

export type TabKey = 'chart' | 'file' | 'editor' | 'tester' | 'report'
export type ThemeMode = 'light' | 'dark'

interface GlobalState {
  activeTab: TabKey
  theme: ThemeMode
  setActiveTab: (tab: TabKey) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const THEME_KEY = 'quantlab.theme'
const TAB_KEY = 'quantlab.tab'

function loadTheme(): ThemeMode {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark') return t
  } catch { /* ignore */ }
  return 'light' // default terang
}

export const useGlobalState = create<GlobalState>((set, get) => ({
  activeTab: (() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as TabKey | null
      if (t && ['chart', 'file', 'editor', 'tester', 'report'].includes(t)) return t
    } catch { /* ignore */ }
    return 'chart'
  })(),
  theme: loadTheme(),
  setActiveTab: (tab) => {
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ }
    set({ activeTab: tab })
  },
  setTheme: (theme) => {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },
}))

// Apply theme class as early as possible
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', loadTheme() === 'dark')
}
