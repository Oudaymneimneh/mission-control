'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getInitials, hashColor } from '@/lib/format-utils'
import { MeetingAnalyticsPanel } from '@/components/panels/meeting-analytics-panel'
import { CollaboratorSuggestionsPanel } from '@/components/panels/collaborator-suggestions-panel'

interface ActiveMeeting {
  meeting_id: number
  initiator_id: number
  participant_id: number
  initiator_name: string
  participant_name: string
  location_x: number
  location_y: number
  status: 'walking' | 'conversing'
  turn_count: number
  max_turns: number
}

interface SpeechBubble {
  agentName: string
  content: string
  timestamp: number
}

interface RecentMeeting {
  id: number
  initiator_name: string
  participant_name: string
  topic: string | null
  summary: string | null
  quality_score: string | null
  status: string
  concluded_at: number | null
  created_at: number
}

interface MeetingMessage {
  id: number
  agent_id: number
  agent_name: string
  content: string
  turn_number: number
}

export interface MeetingPanelProps {
  activeMeetings: ActiveMeeting[]
  speechBubbles: Map<number, SpeechBubble>
}



export function MeetingPanel({ activeMeetings, speechBubbles }: MeetingPanelProps) {
  const t = useTranslations('office')

  function relativeTime(epochSec: number): string {
    const diff = Math.floor(Date.now() / 1000) - epochSec
    if (diff < 60) return t('relativeJustNow')
    if (diff < 3600) return t('relativeMinutesAgo', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('relativeHoursAgo', { n: Math.floor(diff / 3600) })
    return t('relativeDaysAgo', { n: Math.floor(diff / 86400) })
  }
  const [showRecent, setShowRecent] = useState(false)
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[] | null>(null)
  const [recentLoading, setRecentLoading] = useState(false)
  const [activeExpandedId, setActiveExpandedId] = useState<number | null>(null)
  const [activeExpandedMsgs, setActiveExpandedMsgs] = useState<MeetingMessage[]>([])
  const [activeExpandedLoading, setActiveExpandedLoading] = useState(false)
  const [recentExpandedId, setRecentExpandedId] = useState<number | null>(null)
  const [recentExpandedMsgs, setRecentExpandedMsgs] = useState<MeetingMessage[]>([])
  const [recentExpandedLoading, setRecentExpandedLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionsAgentId, setSuggestionsAgentId] = useState<number | null>(null)
  const [agentList, setAgentList] = useState<Array<{ id: number; name: string }>>([])
  const [agentListLoaded, setAgentListLoaded] = useState(false)
  const [suggestionsRefreshTrigger, setSuggestionsRefreshTrigger] = useState(0)

  const activeAbortRef = useRef<AbortController | null>(null)
  const recentAbortRef = useRef<AbortController | null>(null)
  const recentFetchAbortRef = useRef<AbortController | null>(null)
  const agentListAbortRef = useRef<AbortController | null>(null)

  // Fetch agent list when suggestions panel opens
  useEffect(() => {
    if (!showSuggestions || agentListLoaded) return
    agentListAbortRef.current?.abort()
    const controller = new AbortController()
    agentListAbortRef.current = controller

    fetch('/api/agents?limit=50', { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('fetch failed')))
      .then((json) => {
        const agents: Array<{ id: number; name: string }> = (json.data ?? json.agents ?? [])
          .map((a: { id: number; name: string }) => ({ id: a.id, name: a.name }))
        setAgentList(agents)
        setAgentListLoaded(true)
        if (agents.length > 0 && suggestionsAgentId === null) {
          setSuggestionsAgentId(agents[0].id)
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        /* best-effort */
      })

    return () => { controller.abort() }
  }, [showSuggestions, agentListLoaded, suggestionsAgentId])

  const fetchRecent = useCallback(async () => {
    recentFetchAbortRef.current?.abort()
    const controller = new AbortController()
    recentFetchAbortRef.current = controller
    setRecentLoading(true)
    setFetchError(false)
    try {
      const res = await fetch('/api/meetings?limit=8&status=concluded', { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        setRecentMeetings(Array.isArray(json.data) ? json.data : [])
      } else {
        setFetchError(true)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setFetchError(true)
    }
    setRecentLoading(false)
  }, [])

  const toggleRecent = useCallback(() => {
    if (!showRecent) {
      setShowRecent(true)
      setRecentMeetings(null) // Reset so next open refetches
      void fetchRecent()
    } else {
      setShowRecent(false)
    }
  }, [showRecent, fetchRecent])

  const expandActiveMeeting = useCallback(async (meetingId: number) => {
    if (activeExpandedId === meetingId) {
      activeAbortRef.current?.abort()
      activeAbortRef.current = null
      setActiveExpandedId(null)
      setActiveExpandedMsgs([])
      return
    }
    activeAbortRef.current?.abort()
    const controller = new AbortController()
    activeAbortRef.current = controller
    setActiveExpandedId(meetingId)
    setActiveExpandedLoading(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        setActiveExpandedMsgs(json.data?.messages ?? [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      /* conversation expand is best-effort */
    }
    setActiveExpandedLoading(false)
  }, [activeExpandedId])

  const expandRecentMeeting = useCallback(async (meetingId: number) => {
    if (recentExpandedId === meetingId) {
      recentAbortRef.current?.abort()
      recentAbortRef.current = null
      setRecentExpandedId(null)
      setRecentExpandedMsgs([])
      return
    }
    recentAbortRef.current?.abort()
    const controller = new AbortController()
    recentAbortRef.current = controller
    setRecentExpandedId(meetingId)
    setRecentExpandedLoading(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        setRecentExpandedMsgs(json.data?.messages ?? [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      /* conversation expand is best-effort */
    }
    setRecentExpandedLoading(false)
  }, [recentExpandedId])

  // Find latest speech bubble for a meeting
  const getLatestBubble = (meeting: ActiveMeeting): SpeechBubble | undefined => {
    const initBubble = speechBubbles.get(meeting.initiator_id)
    const partBubble = speechBubbles.get(meeting.participant_id)
    if (!initBubble && !partBubble) return undefined
    if (!initBubble) return partBubble
    if (!partBubble) return initBubble
    return initBubble.timestamp > partBubble.timestamp ? initBubble : partBubble
  }

  return (
    <div className="void-panel text-foreground p-3 h-fit">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold font-mono tracking-wider text-void-cyan">
          {t('meetingPanelHeader')}
        </div>
        {activeMeetings.length > 0 && (
          <div className="text-[10px] font-mono bg-void-cyan/15 border border-void-cyan/30 text-void-cyan px-1.5 py-0.5 rounded">
            {activeMeetings.length}
          </div>
        )}
      </div>

      {!showAnalytics && (
        <>
          {/* Active meetings */}
          {activeMeetings.length > 0 ? (
            <div className="space-y-2 mb-3">
              {activeMeetings.map((meeting) => {
                const latestBubble = getLatestBubble(meeting)
                const isExpanded = activeExpandedId === meeting.meeting_id
                const borderColor = meeting.status === 'walking' ? 'border-void-amber/40' : 'border-void-cyan/40'

                return (
                  <div key={meeting.meeting_id} className={`rounded-lg border ${borderColor} bg-black/20 p-2`}>
                    <button
                      type="button"
                      className="w-full text-left"
                      aria-expanded={isExpanded}
                      onClick={() => expandActiveMeeting(meeting.meeting_id)}
                    >
                      {/* Participant initials */}
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1.5">
                          <span className={`w-6 h-6 rounded-full ${hashColor(meeting.initiator_name)} flex items-center justify-center text-[9px] font-bold text-white ring-1 ring-black/40`}>
                            {getInitials(meeting.initiator_name)}
                          </span>
                          <span className={`w-6 h-6 rounded-full ${hashColor(meeting.participant_name)} flex items-center justify-center text-[9px] font-bold text-white ring-1 ring-black/40`}>
                            {getInitials(meeting.participant_name)}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-medium text-foreground truncate">
                            {meeting.initiator_name.split(/[\s_-]/)[0]} + {meeting.participant_name.split(/[\s_-]/)[0]}
                          </div>
                        </div>
                        {/* Status badge + turn counter */}
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`text-[9px] font-mono px-1 py-px rounded ${
                            meeting.status === 'walking'
                              ? 'bg-void-amber/15 text-void-amber'
                              : 'bg-void-cyan/15 text-void-cyan'
                          }`}>
                            {meeting.status === 'walking' ? t('meetingWalking') : t('meetingConversing')}
                          </span>
                          {meeting.status === 'conversing' && (
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {t('meetingTurnProgress', { current: meeting.turn_count, max: meeting.max_turns })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Latest speech */}
                      {latestBubble && (
                        <div className="mt-1.5 text-[10px] text-slate-300 leading-snug truncate">
                          <span className="text-void-cyan/70">{latestBubble.agentName}:</span>{' '}
                          {latestBubble.content.slice(0, 100)}
                        </div>
                      )}
                    </button>

                    {/* Expanded conversation */}
                    {isExpanded && (
                      <div className="mt-2 border-t border-border/30 pt-2 space-y-1.5 max-h-48 overflow-y-auto">
                        <div className="text-[9px] font-mono uppercase tracking-wider text-void-cyan/60">{t('meetingPanelConversation')}</div>
                        {activeExpandedLoading ? (
                          <div className="text-[10px] text-muted-foreground">{t('meetingPanelLoading')}</div>
                        ) : activeExpandedMsgs.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground">{t('meetingPanelNoMessages')}</div>
                        ) : (
                          activeExpandedMsgs.map((msg) => (
                            <div key={msg.id} className="text-[10px]">
                              <span className="font-medium text-void-cyan/80">{msg.agent_name}:</span>{' '}
                              <span className="text-slate-300">{msg.content}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground leading-relaxed mb-3 px-1">
              {t('meetingPanelNoActive')}
            </div>
          )}

          {/* Recent meetings toggle */}
          <div className="border-t border-border/30 pt-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleRecent}
              className="w-full h-auto px-2 py-1 text-[10px] font-mono border bg-secondary border-border text-muted-foreground hover:bg-muted"
            >
              {showRecent ? t('meetingPanelHideRecent') : t('meetingPanelRecent')}
            </Button>

            {showRecent && (
              <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
                {recentLoading ? (
                  <div className="text-[10px] text-muted-foreground">{t('meetingPanelLoading')}</div>
                ) : fetchError ? (
                  <div className="text-[10px] text-void-crimson/70 px-1">{t('meetingPanelFetchError')}</div>
                ) : !recentMeetings || recentMeetings.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground px-1">{t('meetingPanelNoRecent')}</div>
                ) : (
                  recentMeetings.map((meeting) => (
                    <button
                      key={meeting.id}
                      type="button"
                      className="w-full text-left rounded-lg bg-black/20 border border-border/30 p-2 hover:bg-black/30"
                      aria-expanded={recentExpandedId === meeting.id}
                      onClick={() => expandRecentMeeting(meeting.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1.5">
                          <span className={`w-5 h-5 rounded-full ${hashColor(meeting.initiator_name)} flex items-center justify-center text-[8px] font-bold text-white ring-1 ring-black/40`}>
                            {getInitials(meeting.initiator_name)}
                          </span>
                          <span className={`w-5 h-5 rounded-full ${hashColor(meeting.participant_name)} flex items-center justify-center text-[8px] font-bold text-white ring-1 ring-black/40`}>
                            {getInitials(meeting.participant_name)}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] text-foreground truncate">
                            {meeting.initiator_name.split(/[\s_-]/)[0]} + {meeting.participant_name.split(/[\s_-]/)[0]}
                          </div>
                          {meeting.topic && (
                            <div className="text-[9px] text-muted-foreground truncate">{meeting.topic.slice(0, 60)}</div>
                          )}
                        </div>
                        {meeting.concluded_at && (
                          <div className="text-[9px] text-muted-foreground whitespace-nowrap">
                            {relativeTime(meeting.concluded_at)}
                          </div>
                        )}
                      </div>
                      {meeting.summary && (
                        <div className="mt-1 text-[9px] text-slate-400 leading-snug line-clamp-2">
                          {meeting.summary.slice(0, 120)}
                        </div>
                      )}
                      {meeting.quality_score && (() => {
                        try {
                          const q = JSON.parse(meeting.quality_score)
                          const avg = ((q.coherence + q.actionability + q.role_adherence) / 3)
                          return (
                            <div className="mt-1 flex items-center gap-1.5 text-[9px]">
                              <span className={`w-1.5 h-1.5 rounded-full ${avg >= 4 ? 'bg-void-mint' : avg >= 3 ? 'bg-void-amber' : 'bg-void-crimson'}`} />
                              <span className="text-muted-foreground">{t('analyticsScore', { score: avg.toFixed(1) })}</span>
                            </div>
                          )
                        } catch { return null }
                      })()}

                      {/* Expanded conversation for recent */}
                      {recentExpandedId === meeting.id && (
                        <div className="mt-2 border-t border-border/30 pt-2 space-y-1.5 max-h-48 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                          <div className="text-[9px] font-mono uppercase tracking-wider text-void-cyan/60">{t('meetingPanelConversation')}</div>
                          {recentExpandedLoading ? (
                            <div className="text-[10px] text-muted-foreground">{t('meetingPanelLoading')}</div>
                          ) : recentExpandedMsgs.length === 0 ? (
                            <div className="text-[10px] text-muted-foreground">{t('meetingPanelNoMessages')}</div>
                          ) : (
                            recentExpandedMsgs.map((msg) => (
                              <div key={msg.id} className="text-[10px]">
                                <span className="font-medium text-void-cyan/80">{msg.agent_name}:</span>{' '}
                                <span className="text-slate-300">{msg.content}</span>
                              </div>
                            ))
                          )}
                          {meeting.summary && (
                            <div className="border-t border-border/30 pt-1.5 mt-1.5">
                              <div className="text-[9px] font-mono uppercase tracking-wider text-void-cyan/60 mb-0.5">{t('meetingPanelSummary')}</div>
                              <div className="text-[10px] text-slate-300">{meeting.summary}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}

      {showAnalytics && <MeetingAnalyticsPanel />}

      {/* Suggestions section */}
      {showSuggestions && (
        <div className="mt-2">
          {agentList.length > 0 && (
            <div className="mb-2">
              <label htmlFor="suggestions-agent-select" className="text-[9px] font-mono uppercase tracking-wider text-void-cyan/60 mb-1 block">
                View suggestions for
              </label>
              <select
                id="suggestions-agent-select"
                value={suggestionsAgentId ?? ''}
                onChange={(e) => setSuggestionsAgentId(Number(e.target.value))}
                className="w-full h-7 px-2 text-[10px] font-mono bg-black/40 border border-border/40 rounded text-foreground focus:outline-none focus:border-void-cyan/50"
              >
                {agentList.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>
          )}
          {suggestionsAgentId !== null && (
            <CollaboratorSuggestionsPanel
              agentId={suggestionsAgentId}
              workspaceId={1}
              refreshTrigger={suggestionsRefreshTrigger}
            />
          )}
        </div>
      )}

      {/* Bottom toggles */}
      <div className="border-t border-border/30 pt-2 mt-2 space-y-1.5">
        <Button variant="ghost" size="xs" onClick={() => setShowAnalytics(v => !v)}
          className="w-full h-auto px-2 py-1 text-[10px] font-mono border bg-secondary border-border text-muted-foreground hover:bg-muted">
          {showAnalytics ? t('meetingPanelHideAnalytics') : t('meetingPanelShowAnalytics')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => {
          setShowSuggestions(v => !v)
          if (!showSuggestions) setSuggestionsRefreshTrigger(p => p + 1)
        }}
          className={`w-full h-auto px-2 py-1 text-[10px] font-mono border border-border ${
            showSuggestions ? 'bg-void-cyan/15 text-void-cyan border-void-cyan/30' : 'bg-secondary text-muted-foreground hover:bg-muted'
          }`}>
          {showSuggestions ? 'Hide Suggestions' : 'Suggestions'}
        </Button>
      </div>
    </div>
  )
}
