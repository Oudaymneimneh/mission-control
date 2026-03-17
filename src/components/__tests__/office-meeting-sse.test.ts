import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// SPEC TESTS — NOT integration tests.
//
// These test pure reducer functions that MIRROR the SSE handler logic in
// office-panel.tsx (lines ~1200-1270). They validate the state transformation
// contract but do NOT import or exercise the actual component handler.
//
// If office-panel.tsx SSE handling changes, these tests MUST be updated
// manually to stay in sync. They will NOT catch regressions automatically.
// ---------------------------------------------------------------------------

type ActiveMeeting = {
  meeting_id: number;
  initiator_id: number;
  participant_id: number;
  initiator_name: string;
  participant_name: string;
  location_x: number;
  location_y: number;
  status: 'walking' | 'conversing';
  turn_count: number;
  max_turns: number;
};

function handleMeetingStarted(
  current: ActiveMeeting[],
  data: any,
): ActiveMeeting[] {
  return [
    ...current.filter((x) => x.meeting_id !== data.meeting_id),
    {
      meeting_id: data.meeting_id,
      initiator_id: data.initiator_id,
      participant_id: data.participant_id,
      initiator_name: data.initiator_name,
      participant_name: data.participant_name,
      location_x: data.location_x,
      location_y: data.location_y,
      status: 'walking' as const,
      turn_count: 0,
      max_turns: data.max_turns ?? 6,
    },
  ];
}

function handleMeetingMessage(
  current: ActiveMeeting[],
  data: any,
): ActiveMeeting[] {
  return current.map((mtg) =>
    mtg.meeting_id === data.meeting_id
      ? { ...mtg, status: 'conversing' as const, turn_count: data.turn_number }
      : mtg,
  );
}

function handleMeetingConcluded(
  current: ActiveMeeting[],
  data: any,
): ActiveMeeting[] {
  return current.filter((x) => x.meeting_id !== data.meeting_id);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMeetingData(overrides: Partial<ActiveMeeting> = {}) {
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('meeting.started', () => {
  it('adds new meeting to empty state', () => {
    const next = handleMeetingStarted([], makeMeetingData());

    expect(next).toHaveLength(1);
    expect(next[0].status).toBe('walking');
    expect(next[0].turn_count).toBe(0);
    expect(next[0].max_turns).toBe(6);
  });

  it('replaces existing meeting with same id (dedup)', () => {
    const existing: ActiveMeeting[] = [
      {
        ...makeMeetingData(),
        status: 'conversing',
        turn_count: 3,
      } as ActiveMeeting,
    ];
    const next = handleMeetingStarted(
      existing,
      makeMeetingData({ initiator_name: 'Alice-v2' }),
    );

    expect(next).toHaveLength(1);
    expect(next[0].initiator_name).toBe('Alice-v2');
    expect(next[0].status).toBe('walking');
    expect(next[0].turn_count).toBe(0);
  });

  it('defaults max_turns to 6 when missing from data', () => {
    const { max_turns: _, ...dataWithoutMaxTurns } = makeMeetingData();
    const next = handleMeetingStarted([], dataWithoutMaxTurns);

    expect(next[0].max_turns).toBe(6);
  });
});

describe('meeting.message', () => {
  it('transitions meeting from walking to conversing', () => {
    const state = handleMeetingStarted([], makeMeetingData());
    const next = handleMeetingMessage(state, {
      meeting_id: 1,
      turn_number: 1,
    });

    expect(next[0].status).toBe('conversing');
    expect(next[0].turn_count).toBe(1);
  });

  it('updates turn count on subsequent messages', () => {
    let state = handleMeetingStarted([], makeMeetingData());
    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 });
    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 2 });
    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 3 });

    expect(state[0].turn_count).toBe(3);
    expect(state[0].status).toBe('conversing');
  });

  it('does not affect other meetings', () => {
    let state = handleMeetingStarted([], makeMeetingData({ meeting_id: 1 }));
    state = handleMeetingStarted(state, makeMeetingData({ meeting_id: 2, initiator_name: 'Charlie' }));

    const next = handleMeetingMessage(state, {
      meeting_id: 1,
      turn_number: 1,
    });

    expect(next).toHaveLength(2);
    const meeting2 = next.find((m) => m.meeting_id === 2)!;
    expect(meeting2.status).toBe('walking');
    expect(meeting2.turn_count).toBe(0);
    expect(meeting2.initiator_name).toBe('Charlie');
  });
});

describe('meeting.concluded', () => {
  it('removes meeting from active list', () => {
    const state = handleMeetingStarted([], makeMeetingData());
    const next = handleMeetingConcluded(state, { meeting_id: 1 });

    expect(next).toHaveLength(0);
  });

  it('preserves other active meetings', () => {
    let state = handleMeetingStarted([], makeMeetingData({ meeting_id: 1 }));
    state = handleMeetingStarted(state, makeMeetingData({ meeting_id: 2, initiator_name: 'Charlie' }));

    const next = handleMeetingConcluded(state, { meeting_id: 1 });

    expect(next).toHaveLength(1);
    expect(next[0].meeting_id).toBe(2);
    expect(next[0].initiator_name).toBe('Charlie');
  });

  it('no-op when meeting not in active list', () => {
    const state = handleMeetingStarted([], makeMeetingData({ meeting_id: 1 }));
    const next = handleMeetingConcluded(state, { meeting_id: 999 });

    expect(next).toHaveLength(1);
    expect(next[0].meeting_id).toBe(1);
  });
});

describe('full lifecycle', () => {
  it('started -> message -> message -> concluded produces clean state', () => {
    let state: ActiveMeeting[] = [];

    state = handleMeetingStarted(state, makeMeetingData());
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('walking');

    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 });
    expect(state[0].status).toBe('conversing');
    expect(state[0].turn_count).toBe(1);

    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 2 });
    expect(state[0].turn_count).toBe(2);

    state = handleMeetingConcluded(state, { meeting_id: 1 });
    expect(state).toHaveLength(0);
  });

  it('concurrent meetings tracked independently', () => {
    let state: ActiveMeeting[] = [];

    // Start two meetings
    state = handleMeetingStarted(state, makeMeetingData({ meeting_id: 1, initiator_name: 'Alice' }));
    state = handleMeetingStarted(state, makeMeetingData({ meeting_id: 2, initiator_name: 'Charlie' }));
    expect(state).toHaveLength(2);

    // Advance meeting 1 only
    state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 });
    const m1 = state.find((m) => m.meeting_id === 1)!;
    const m2 = state.find((m) => m.meeting_id === 2)!;
    expect(m1.status).toBe('conversing');
    expect(m1.turn_count).toBe(1);
    expect(m2.status).toBe('walking');
    expect(m2.turn_count).toBe(0);

    // Conclude meeting 1 — meeting 2 unchanged
    state = handleMeetingConcluded(state, { meeting_id: 1 });
    expect(state).toHaveLength(1);
    expect(state[0].meeting_id).toBe(2);
    expect(state[0].initiator_name).toBe('Charlie');
    expect(state[0].status).toBe('walking');
  });
});
