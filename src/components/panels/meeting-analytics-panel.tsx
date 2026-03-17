'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import { TrustNetworkGraph } from '@/components/panels/trust-network-graph'

interface AnalyticsData {
  meetings_per_day: Array<{ day: string; count: number }>
  avg_turns: number
  top_pairs: Array<{ initiator_name: string; participant_name: string; meeting_count: number }>
  trust_network: Array<{ source_agent_id: number; target_agent_id: number; source_name: string; target_name: string; trust_score: number; interaction_count: number }>
  meetings_per_agent: Array<{ name: string; meeting_count: number; avg_duration_min: number | null; trust_delta: number }>
  avg_quality: { coherence: number; actionability: number; role_adherence: number } | null
  total_concluded: number
}

export function MeetingAnalyticsPanel() {
  const t = useTranslations('office')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/meetings/analytics', { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        setData(json.data ?? null)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    timerRef.current = setInterval(() => void fetchData(), 30_000)
    return () => {
      abortRef.current?.abort()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchData])

  if (loading) {
    return (
      <div className="text-[10px] text-muted-foreground px-1 py-2">
        {t('meetingPanelLoading')}
      </div>
    )
  }

  if (!data || data.total_concluded === 0) {
    return (
      <div className="text-[10px] text-muted-foreground px-1 py-2">
        {t('analyticsNoData')}
      </div>
    )
  }

  const maxTrust = Math.max(...data.trust_network.map(e => e.trust_score), 1)

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="text-[9px] font-mono uppercase tracking-wider text-void-cyan/60">
        {t('analyticsTitle')}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-sm font-bold text-foreground">{data.total_concluded}</div>
          <div className="text-[9px] text-muted-foreground">{t('analyticsTotalMeetings')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-sm font-bold text-foreground">{Math.round(data.avg_turns)}</div>
          <div className="text-[9px] text-muted-foreground">{t('analyticsAvgTurns')}</div>
        </div>
        {data.avg_quality && (
          <>
            <div className="bg-card border border-border rounded-lg p-2">
              <div className="text-sm font-bold text-foreground">
                {t('analyticsScore', { score: data.avg_quality.coherence.toFixed(1) })}
              </div>
              <div className="text-[9px] text-muted-foreground">{t('analyticsCoherence')}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2">
              <div className="text-sm font-bold text-foreground">
                {t('analyticsScore', { score: data.avg_quality.actionability.toFixed(1) })}
              </div>
              <div className="text-[9px] text-muted-foreground">{t('analyticsActionability')}</div>
            </div>
          </>
        )}
      </div>

      {/* Line chart: meetings per day */}
      {data.meetings_per_day.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-[9px] font-mono text-muted-foreground mb-1">{t('analyticsMeetingTrend')}</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.meetings_per_day.map(d => ({ day: d.day.slice(5), count: d.count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 10, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--void-cyan))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bar chart: meetings per agent */}
      {data.meetings_per_agent.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-[9px] font-mono text-muted-foreground mb-1">{t('analyticsMeetingsPerAgent')}</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.meetings_per_agent.slice(0, 8).map(d => ({
                name: d.name.length > 10 ? d.name.slice(0, 9) + '\u2026' : d.name,
                count: d.meeting_count,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 10, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="count" fill="hsl(var(--void-mint))" name={t('analyticsMeetings')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-agent stats table */}
      {data.meetings_per_agent.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-[9px] font-mono text-muted-foreground mb-1.5">{t('analyticsAgentStats')}</div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="font-medium pb-1">{t('analyticsAgentName')}</th>
                <th className="font-medium pb-1 text-right">{t('analyticsMeetings')}</th>
                <th className="font-medium pb-1 text-right">{t('analyticsAvgDuration')}</th>
                <th className="font-medium pb-1 text-right">{t('analyticsTrustDelta')}</th>
              </tr>
            </thead>
            <tbody>
              {data.meetings_per_agent.slice(0, 10).map((agent, i) => (
                <tr key={i} className="border-t border-border/20">
                  <td className="py-0.5 text-foreground truncate max-w-[80px]">{agent.name}</td>
                  <td className="py-0.5 text-right font-mono text-muted-foreground">{agent.meeting_count}</td>
                  <td className="py-0.5 text-right font-mono text-muted-foreground">
                    {agent.avg_duration_min != null ? `${agent.avg_duration_min}m` : '\u2014'}
                  </td>
                  <td className={`py-0.5 text-right font-mono ${
                    agent.trust_delta > 0 ? 'text-green-400' : agent.trust_delta < 0 ? 'text-red-400' : 'text-muted-foreground'
                  }`}>
                    {agent.trust_delta > 0 ? '+' : ''}{agent.trust_delta.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top pairs */}
      {data.top_pairs.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-[9px] font-mono text-muted-foreground mb-1.5">{t('analyticsTopPairs')}</div>
          <div className="space-y-1">
            {data.top_pairs.slice(0, 5).map((pair, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-foreground truncate">
                  {pair.initiator_name.split(/[\s_-]/)[0]} + {pair.participant_name.split(/[\s_-]/)[0]}
                </span>
                <span className="text-muted-foreground font-mono shrink-0 ml-2">
                  {pair.meeting_count} {t('analyticsMeetings')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust network graph */}
      {data.trust_network.length > 0 && (
        <TrustNetworkGraph trustData={data.trust_network} />
      )}

      {/* Trust network list */}
      {data.trust_network.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="text-[9px] font-mono text-muted-foreground mb-1.5">{t('analyticsTrustNetwork')}</div>
          <div className="space-y-1.5">
            {data.trust_network.slice(0, 8).map((edge, i) => (
              <div key={i} className="text-[10px]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-foreground truncate">
                    {edge.source_name.split(/[\s_-]/)[0]} &rarr; {edge.target_name.split(/[\s_-]/)[0]}
                  </span>
                  <span className="text-muted-foreground font-mono shrink-0 ml-2">
                    {edge.trust_score.toFixed(2)}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${(edge.trust_score / maxTrust) * 100}%`,
                      backgroundColor: 'hsl(var(--void-cyan))',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
