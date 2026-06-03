'use client'

import { createContext, useContext } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const LIVE_MS = 10 * 60 * 1000

export type ActiveSession = {
  session_id: string
  project_path: string
  file_mtime_ms: number
  last_activity: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  [key: string]: unknown
}

type Today = { tokens: number; cost: number; session_count: number }

type LiveContextValue = {
  liveCount: number
  today: Today
  streak: number
  sessions: ActiveSession[]
  isLoading: boolean
}

const DEFAULT_TODAY: Today = { tokens: 0, cost: 0, session_count: 0 }

const LiveContext = createContext<LiveContextValue>({
  liveCount: 0,
  today: DEFAULT_TODAY,
  streak: 0,
  sessions: [],
  isLoading: false,
})

type ApiData = {
  sessions: ActiveSession[]
  today: Today
  streak: number
  server_time_ms: number
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useSWR<ApiData>(
    '/api/sessions/active',
    fetcher,
    { refreshInterval: 5000 }
  )

  const sessions = data?.sessions ?? []
  // Use the server clock the payload was stamped with (server_time_ms) rather than
  // a render-time Date.now(): file_mtime_ms is a server-side mtime, so comparing
  // both server-side timestamps avoids client/server skew and keeps render pure.
  const now = data?.server_time_ms ?? 0
  const liveCount = sessions.filter(s => now - s.file_mtime_ms <= LIVE_MS).length

  const value: LiveContextValue = {
    liveCount,
    today: data?.today ?? DEFAULT_TODAY,
    streak: data?.streak ?? 0,
    sessions,
    isLoading,
  }

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext)
}
