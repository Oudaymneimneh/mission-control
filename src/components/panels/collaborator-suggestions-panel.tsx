'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getInitials, hashColor } from '@/lib/format-utils'

interface Suggestion {
  agentId: number
  name: string
  totalScore: number
  factors: {
    trust: number
    compatibility: number
    proximity: number
    novelty: number
    jitter: number
  }
}

interface CollaboratorSuggestionsPanelProps {
  agentId: number
  workspaceId: number
  refreshTrigger?: number
}

const FACTOR_CONFIG: Array<{
  key: keyof Suggestion['factors']
  label: string
  color: string
  bgColor: string
}> = [
  { key: 'trust', label: 'Trust', color: 'bg-cyan-400', bgColor: 'bg-cyan-400/15' },
  { key: 'compatibility', label: 'Compat', color: 'bg-violet-400', bgColor: 'bg-violet-400/15' },
  { key: 'proximity', label: 'Prox', color: 'bg-amber-400', bgColor: 'bg-amber-400/15' },
  { key: 'novelty', label: 'Novel', color: 'bg-emerald-400', bgColor: 'bg-emerald-400/15' },
  { key: 'jitter', label: 'Jitter', color: 'bg-rose-400', bgColor: 'bg-rose-400/15' },
]

export function CollaboratorSuggestionsPanel({
  agentId,
  workspaceId,
  refreshTrigger,
}: CollaboratorSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchSuggestions = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(false)

    try {
      const res = await fetch(
        `/api/meetings/suggestions?agentId=${agentId}&workspaceId=${workspaceId}`,
        { signal: controller.signal }
      )
      if (res.ok) {
        const json = await res.json()
        setSuggestions(Array.isArray(json.data) ? json.data : [])
      } else {
        setError(true)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(true)
    }
    setLoading(false)
  }, [agentId, workspaceId])

  useEffect(() => {
    void fetchSuggestions()
    return () => { abortRef.current?.abort() }
  }, [fetchSuggestions, refreshTrigger])

  if (loading) {
    return (
      <div className="py-4 text-center text-[10px] text-muted-foreground font-mono">
        Loading suggestions...
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-4 text-center text-[10px] text-void-crimson/70 font-mono">
        Failed to load suggestions
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="py-4 text-center text-[10px] text-muted-foreground font-mono">
        No collaborator suggestions available
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {suggestions.map((s, idx) => (
        <div
          key={s.agentId}
          className="rounded-lg border border-border/30 bg-black/20 p-2"
        >
          {/* Header: avatar + name + score */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <span
                className={`w-7 h-7 rounded-full ${hashColor(s.name)} flex items-center justify-center text-[10px] font-bold text-white ring-1 ring-black/40`}
              >
                {getInitials(s.name)}
              </span>
              <span className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-black/80 border border-border/50 flex items-center justify-center text-[7px] font-mono text-muted-foreground">
                {idx + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium text-foreground truncate">
                {s.name}
              </div>
            </div>
            <div className="text-[11px] font-mono font-semibold text-void-cyan">
              {Math.round(s.totalScore * 100)}%
            </div>
          </div>

          {/* Factor bars */}
          <div className="mt-2 space-y-1">
            {FACTOR_CONFIG.map((f) => {
              const value = s.factors[f.key]
              return (
                <div key={f.key} className="flex items-center gap-1.5">
                  <span className="text-[8px] font-mono text-muted-foreground w-9 text-right shrink-0">
                    {f.label}
                  </span>
                  <div className={`flex-1 h-1.5 rounded-full ${f.bgColor} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full ${f.color} transition-all duration-300`}
                      style={{ width: `${Math.round(value * 100)}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-muted-foreground w-6 text-right shrink-0">
                    {Math.round(value * 100)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
