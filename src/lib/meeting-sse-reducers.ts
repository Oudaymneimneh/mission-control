export type ActiveMeeting = {
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

export function reduceMeetingStarted(
  current: ActiveMeeting[],
  data: { meeting_id: number; initiator_id: number; participant_id: number; initiator_name: string; participant_name: string; location_x: number; location_y: number; max_turns?: number },
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
  ]
}

export function reduceMeetingMessage(
  current: ActiveMeeting[],
  data: { meeting_id: number; turn_number: number },
): ActiveMeeting[] {
  return current.map((mtg) =>
    mtg.meeting_id === data.meeting_id
      ? { ...mtg, status: 'conversing' as const, turn_count: data.turn_number }
      : mtg,
  )
}

export function reduceMeetingConcluded(
  current: ActiveMeeting[],
  data: { meeting_id: number },
): ActiveMeeting[] {
  return current.filter((x) => x.meeting_id !== data.meeting_id)
}
