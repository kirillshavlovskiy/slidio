'use client'

import { createContext, useContext } from 'react'
import type { DesignTokensView } from '@/lib/designSystem'

const DesignTokensContext = createContext<DesignTokensView | null>(null)

/** Active design-system tokens, available to any on-canvas editing tool. */
export function useDesignTokens(): DesignTokensView | null {
  return useContext(DesignTokensContext)
}

export function DesignTokensProvider({
  value,
  children,
}: {
  value: DesignTokensView | null
  children: React.ReactNode
}) {
  return <DesignTokensContext.Provider value={value}>{children}</DesignTokensContext.Provider>
}
