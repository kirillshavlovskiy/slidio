'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  accentColor?: string
}

export function Switch({ className, accentColor, style, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=unchecked]:bg-[#1e3a5f]',
        className
      )}
      style={{
        ...(props.checked !== undefined || props.defaultChecked
          ? {}
          : {}),
        ...style,
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-3 w-3 rounded-full bg-white shadow-sm',
          'transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0'
        )}
      />
    </SwitchPrimitive.Root>
  )
}
