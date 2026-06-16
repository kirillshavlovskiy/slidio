import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import SessionProvider from '@/components/SessionProvider'
import ErrorBoundary from '@/components/ErrorBoundary'

export const metadata: Metadata = {
  title: 'Slidio',
  description: 'AI-powered presentation editor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <SessionProvider>{children}</SessionProvider>
        </ErrorBoundary>
        <Analytics />
      </body>
    </html>
  )
}
