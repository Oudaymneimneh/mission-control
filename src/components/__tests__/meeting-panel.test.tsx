vi.mock('next-intl', () => {
  const { createElement } = require('react')
  return {
    useTranslations: (ns: string) => {
      return (key: string, values?: Record<string, unknown>) => {
        const fullKey = `${ns}.${key}`
        const msg = (messages as Record<string, Record<string, string>>)[ns]?.[key] ?? fullKey
        if (!values) return msg
        return msg.replace(/\{(\w+)\}/g, (_: string, k: string) => String(values[k] ?? `{${k}}`))
      }
    },
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
      createElement('div', null, children),
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { MeetingPanel, type MeetingPanelProps } from '@/components/panels/meeting-panel'

const messages = {
  office: {
    meetingPanelHeader: 'MEETINGS',
    meetingPanelNoActive: 'Agents autonomously initiate meetings based on personality traits.',
    meetingPanelRecent: 'Recent',
    meetingPanelHideRecent: 'Hide Recent',
    meetingPanelNoRecent: 'No recent meetings.',
    meetingPanelConversation: 'Conversation',
    meetingPanelSummary: 'Summary',
    meetingPanelLoading: 'Loading...',
    meetingPanelNoMessages: 'No messages yet.',
    meetingPanelFetchError: 'Failed to load. Try again.',
    meetingWalking: 'walking...',
    meetingConversing: 'conversing',
    meetingTurnProgress: 'Turn {current}/{max}',
  },
}

function makeMeeting(overrides: Partial<MeetingPanelProps['activeMeetings'][number]> = {}) {
  return {
    meeting_id: 1,
    initiator_id: 1,
    participant_id: 2,
    initiator_name: 'Atlas',
    participant_name: 'Nova',
    location_x: 40,
    location_y: 50,
    status: 'conversing' as const,
    turn_count: 3,
    max_turns: 6,
    ...overrides,
  }
}

function renderPanel(props: Partial<MeetingPanelProps> = {}) {
  const defaultProps: MeetingPanelProps = {
    activeMeetings: [],
    speechBubbles: new Map(),
    ...props,
  }
  return render(<MeetingPanel {...defaultProps} />)
}

describe('MeetingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('shows header with MEETINGS label', () => {
    renderPanel()
    expect(screen.getByText('MEETINGS')).toBeInTheDocument()
  })

  it('shows explanation when no active meetings', () => {
    renderPanel()
    expect(screen.getByText(/autonomously initiate/)).toBeInTheDocument()
  })

  it('shows active meeting count badge', () => {
    renderPanel({ activeMeetings: [makeMeeting()] })
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows walking status', () => {
    renderPanel({ activeMeetings: [makeMeeting({ status: 'walking' })] })
    expect(screen.getByText('walking...')).toBeInTheDocument()
  })

  it('shows conversing status with turn progress', () => {
    renderPanel({
      activeMeetings: [makeMeeting({ status: 'conversing', turn_count: 3, max_turns: 6 })],
    })
    expect(screen.getByText('conversing')).toBeInTheDocument()
    expect(screen.getByText('Turn 3/6')).toBeInTheDocument()
  })

  it('shows latest speech bubble content', () => {
    const bubbles = new Map([
      [1, { agentName: 'Atlas', content: 'Hello from Atlas', timestamp: 1000 }],
    ])
    renderPanel({
      activeMeetings: [makeMeeting()],
      speechBubbles: bubbles,
    })
    expect(screen.getByText(/Hello from Atlas/)).toBeInTheDocument()
  })

  it('fetches conversation when card clicked', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            messages: [
              { id: 1, agent_id: 1, agent_name: 'Atlas', content: 'Nice to meet you', turn_number: 1 },
              { id: 2, agent_id: 2, agent_name: 'Nova', content: 'Likewise!', turn_number: 2 },
            ],
          },
        }),
    })
    global.fetch = mockFetch

    renderPanel({ activeMeetings: [makeMeeting()] })

    const card = screen.getByRole('button', { name: /Atlas/i })
    fireEvent.click(card)

    expect(mockFetch).toHaveBeenCalledWith('/api/meetings/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))

    await waitFor(() => {
      expect(screen.getByText('Nice to meet you')).toBeInTheDocument()
      expect(screen.getByText('Likewise!')).toBeInTheDocument()
    })
  })

  it('toggles recent meetings section', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    })
    global.fetch = mockFetch

    renderPanel()

    const recentBtn = screen.getByRole('button', { name: /Recent/i })
    fireEvent.click(recentBtn)

    await waitFor(() => {
      expect(screen.getByText(/No recent meetings/)).toBeInTheDocument()
    })
  })
})
