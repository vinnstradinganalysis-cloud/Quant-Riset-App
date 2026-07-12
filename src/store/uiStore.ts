import { create } from 'zustand'
import type { ReactNode } from 'react'

interface UIStore {
  topBarCenter: ReactNode | null
  topBarRightExtra: ReactNode | null
  setTopBarCenter: (node: ReactNode | null) => void
  setTopBarRightExtra: (node: ReactNode | null) => void
}

export const useUIStore = create<UIStore>((set) => ({
  topBarCenter: null,
  topBarRightExtra: null,
  setTopBarCenter: (node) => set({ topBarCenter: node }),
  setTopBarRightExtra: (node) => set({ topBarRightExtra: node }),
}))
