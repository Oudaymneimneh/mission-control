import { describe, it, expect } from 'vitest'
import {
  reduceMeetingStarted,
  reduceMeetingMessage,
  reduceMeetingConcluded,
} from '@/lib/meeting-sse-reducers'
import type { ActiveMeeting } from '@/lib/meeting-sse-reducers'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMeetingData(overrides: Partial<ActiveMeeting & { meeting_id: number }> = {}) {
  return {
    meeting_id: 1,
    initiator_id: 10,
    participant_id: 20,
    initiator_name: 'Alice',
    participant_name: 'Bob',
    location_x: 100,
    location_y: 200,
    max_turns: 6,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('meeting.started', () => {
  it('adds a new meeting to empty state', () => {
    const next = reduceMeetingStarted([], makeMeetingData())
    expect(next).toHaveLength(1)
    expect(next[0].meeting_id).toBe(1)
    expect(next[0].status).toBe('walking')
    expect(next[0].turn_count).toBe(0)
    expect(next[0].initiator_name).toBe('Alice')
    expect(next[0].participant_name).toBe('Bob')
    expect(next[0].location_x).toBe(100)
    expect(next[0].location_y).toBe(200)
    expect(next[0].max_turns).toBe(6)
  })

  it('replaces an existing meeting with the same id', () => {
    const initial = reduceMeetingStarted([], makeMeetingData())
    const next = reduceMeetingStarted(
      initial,
      makeMeetingData({ initiator_name: 'Charlie' }),
    )
    expect(next).toHaveLength(1)
    expect(next[0].initiator_name).toBe('Charlie')
  })

  it('defaults max_turns to 6 when not provided', () => {
    const dataWithoutMaxTurns = { ...makeMeetingData(), max_turns: undefined }
    const next = reduceMeetingStarted([], dataWithoutMaxTurns)
    expect(next[0].max_turns).toBe(6)
  })
})

describe('meeting.message', () => {
  it('transitions status to conversing and updates turn_count', () => {
    const state = reduceMeetingStarted([], makeMeetingData())
    const next = reduceMeetingMessage(state, {
      meeting_id: 1,
      turn_number: 1,
    })
    expect(next[0].status).toBe('conversing')
    expect(next[0].turn_count).toBe(1)
  })

  it('increments turn_count on subsequent messages', () => {
    let state = reduceMeetingStarted([], makeMeetingData())
    state = reduceMeetingMessage(state, { meeting_id: 1, turn_number: 1 })
    state = reduceMeetingMessage(state, { meeting_id: 1, turn_number: 2 })
    state = reduceMeetingMessage(state, { meeting_id: 1, turn_number: 3 })
    expect(state[0].turn_count).toBe(3)
  })

  it('only updates the matching meeting', () => {
    let state = reduceMeetingStarted([], makeMeetingData({ meeting_id: 1 }))
    state = reduceMeetingStarted(state, makeMeetingData({ meeting_id: 2, initiator_name: 'Charlie' }))

    const next = reduceMeetingMessage(state, {
      meeting_id: 2,
      turn_number: 4,
    })
    expect(next.find((m) => m.meeting_id === 1)?.turn_count).toBe(0)
    expect(next.find((m) => m.meeting_id === 2)?.turn_count).toBe(4)
  })
})

describe('meeting.concluded', () => {
  it('removes the meeting from state', () => {
    const state = reduceMeetingStarted([], makeMeetingData())
    const next = reduceMeetingConcluded(state, { meeting_id: 1 })
    expect(next).toHaveLength(0)
  })

  it('leaves other meetings intact', () => {
    let state = reduceMeetingStarted([], makeMeetingData({ meeting_id: 1 }))
    state = reduceMeetingStarted(state, makeMeetingData({ meeting_id: 2 }))
    const next = reduceMeetingConcluded(state, { meeting_id: 1 })
    expect(next).toHaveLength(1)
    expect(next[0].meeting_id).toBe(2)
  })

  it('is a no-op for a non-existent meeting id', () => {
    const state = reduceMeetingStarted([], makeMeetingData())
    const next = reduceMeetingConcluded(state, { meeting_id: 999 })
    expect(next).toHaveLength(1)
  })
})
