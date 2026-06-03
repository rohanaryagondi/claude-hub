import type { Metadata } from 'next'
import { Geist_Mono, Press_Start_2P } from 'next/font/google'
import './globals.css'
/* FLIGHTDECK design system — the token contract (v2-theme.css) + primitive
   animation classes (v2-tokens.css used by StatusDot / SkeletonRow). Both files
   scope everything under `.v2-root`; the per-page <V2Shell> draws that
   `fixed inset-0 z-50` wrapper and is now the only UI. */
import './v2-theme.css'
import '@/components/v2/ui/v2-tokens.css'
import { ThemeProvider } from '@/components/theme-provider'
import { LiveProvider } from '@/components/layout/live-context'
import { MemoryRefresher } from '@/components/v2/memory-refresher'

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const pressStart2P = Press_Start_2P({
  variable: '--font-press-start',
  weight: '400',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Claude Hub',
  description: 'A one-stop dashboard to monitor, recall, and reason about your Claude Code work. Reads directly from ~/.claude/',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t!=='light')}catch(e){}})()` }} />
      </head>
      <body suppressHydrationWarning className={`${geistMono.variable} ${pressStart2P.variable} antialiased`}>
        <ThemeProvider>
          {/* LiveProvider feeds the v2 shell's telemetry rail (useLive). Each
              page renders its own <V2Shell> (fixed inset-0) as the whole UI.
              MemoryRefresher is a zero-DOM client effect: on load it quietly
              kicks a background incremental memory build if the store is >24h
              stale. Non-blocking, runs once per page load. */}
          <MemoryRefresher />
          <LiveProvider>{children}</LiveProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
