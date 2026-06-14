'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-[#1e3a5f] text-white hover:bg-[#2a4a6f]',
        ghost: 'text-[#475569] hover:text-white hover:bg-[#112236]',
        danger: 'bg-[#F87171] text-white hover:bg-[#ef4444]',
        outline: 'border border-[#1e3a5f] text-[#475569] hover:border-[#2a4a6f] hover:text-white',
        gold: 'bg-[#F59E0B] text-[#0d1b2a] font-bold hover:bg-[#d97706]',
        blue: 'bg-[#60A5FA] text-[#0d1b2a] font-bold hover:bg-[#3b82f6]',
      },
      size: {
        sm: 'h-6 px-2 py-0.5',
        md: 'h-7 px-3 py-1',
        lg: 'h-8 px-4 py-1.5',
        icon: 'h-6 w-6 p-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
