'use client'

import { cn } from '@/lib/utils'

type Props = {
  /** Batches fully completed */
  completedBatches: number
  totalBatches: number
  /** When a batch API call is in flight */
  inFlight?: boolean
  /** Before first batch (chunk prep) */
  preparing?: boolean
  className?: string
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export function extractionPercent(
  completedBatches: number,
  totalBatches: number,
  opts?: { inFlight?: boolean; preparing?: boolean }
): number {
  if (opts?.preparing) return 0
  if (totalBatches <= 0) return opts?.inFlight ? 5 : 100
  const partial = opts?.inFlight ? 0.35 : 0
  return Math.min(100, Math.round(((completedBatches + partial) / totalBatches) * 100))
}

export function parseBatchProgress(error: string | null | undefined): { completed: number; total: number } | null {
  if (!error) return null
  const m = error.match(/^(\d+)\/(\d+)\s+batches/i)
  if (!m) return null
  return { completed: Number(m[1]), total: Number(m[2]) }
}

export default function ExtractionProgressBar({
  completedBatches,
  totalBatches,
  inFlight = false,
  preparing = false,
  className,
  showLabel = true,
  size = 'md',
}: Props) {
  const pct = extractionPercent(completedBatches, totalBatches, { inFlight, preparing })

  return (
    <div className={cn('space-y-1.5', className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-blue-300/90 font-medium">
            {preparing
              ? 'Preparing chunks…'
              : totalBatches > 0
                ? `Batch ${Math.min(completedBatches + (inFlight ? 1 : 0), totalBatches)} of ${totalBatches}`
                : 'Extracting…'}
          </span>
          <span className="text-blue-400 font-bold tabular-nums">{pct}%</span>
        </div>
      )}
      <div
        className={cn(
          'w-full rounded-full bg-[#1e3a5f]/80 overflow-hidden',
          size === 'sm' ? 'h-1.5' : 'h-2.5'
        )}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500 ease-out',
            inFlight && !preparing && 'animate-pulse'
          )}
          style={{ width: `${Math.max(preparing ? 4 : pct, pct > 0 ? pct : 0)}%` }}
        />
      </div>
    </div>
  )
}
