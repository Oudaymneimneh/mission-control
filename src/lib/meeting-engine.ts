/**
 * Meeting Engine — Autonomous agent meeting system inspired by ai-town.
 *
 * State machine: idle → walking → conversing → summarizing → concluded
 *
 * Integrates with:
 *   - Persona engine: Big Five traits drive meeting propensity & conversation style
 *   - Trust network: Partner selection weighted by pairwise trust
 *   - Simulation engine: Meeting ticks at P1.25 (active) and P4 (initiation)
 *   - Event bus: Real-time updates for office panel visualization
 */

import type Database from 'better-sqlite3'
import { logger } from '@/lib/logger'
import { getDatabase, writeTransaction } from '@/lib/db'
import { complete } from '@/lib/llm/router'
import { buildSystemPrompt, getPersona, getPairwiseTrust, updatePairwiseTrust } from '@/lib/persona-engine'
import { observe } from '@/lib/agent-memory'
import { eventBus } from '@/lib/event-bus'

// --- Types ---

export type MeetingStatus = 'walking' | 'conversing' | 'summarizing' | 'concluded' | 'cancelled'

export interface MeetingRow {
  id: number
  workspace_id: number
  initiator_id: number
  participant_id: number
  status: MeetingStatus
  topic: string | null
  summary: string | null
  location_x: number | null
  location_y: number | null
  turn_count: number
  max_turns: number
  scheduled_for: number | null
  recurring_interval_ms: number | null
  started_at: number | null
  concluded_at: number | null
  quality_score: string | null
  created_at: number
}

export interface MeetingMessageRow {
  id: number
  meeting_id: number
  agent_id: number
  content: string
  turn_number: number
  created_at: number
}

export interface AgentPositionRow {
  agent_id: number
  workspace_id: number
  x: number
  y: number
  target_x: number | null
  target_y: number | null
  zone: string | null
  updated_at: number
}

export interface AgentForMeeting {
  id: number
  name: string
  role: string
  status: string
  soul_content: string | null
  config: string | null
  workspace_id: number
}

// --- Constants ---

/** Minimum seconds after a concluded meeting before an agent can seek another. */
const MEETING_COOLDOWN_S = 60

/** Maximum concurrent meetings per workspace. */
const MAX_CONCURRENT_MEETINGS = 2

/** LLM timeout for meeting conversation turns (ms). */
const MEETING_TURN_TIMEOUT_MS = 8_000

/** Minimum propensity score to initiate a meeting. */
const PROPENSITY_THRESHOLD = 0.35

// --- Zone seat coordinates for position initialization ---

const ZONE_POSITIONS: Record<string, Array<{ x: number; y: number }>> = {
  engineering: [{ x: 24, y: 36 }, { x: 32, y: 36 }, { x: 24, y: 42 }, { x: 32, y: 42 }],
  product: [{ x: 54, y: 36 }, { x: 62, y: 36 }, { x: 54, y: 42 }, { x: 62, y: 42 }],
  operations: [{ x: 24, y: 64 }, { x: 32, y: 64 }, { x: 24, y: 70 }, { x: 32, y: 70 }],
  research: [{ x: 50, y: 64 }, { x: 58, y: 64 }, { x: 50, y: 70 }, { x: 58, y: 70 }],
  quality: [{ x: 58, y: 64 }, { x: 66, y: 64 }, { x: 58, y: 70 }, { x: 66, y: 70 }],
  general: [{ x: 38, y: 45 }, { x: 46, y: 39 }, { x: 54, y: 45 }, { x: 62, y: 39 }],
}

// --- Config Parsing (cached per call site) ---

interface ParsedPersonality {
  extraversion: number
  agreeableness: number
  openness: number
  conscientiousness: number
  neuroticism: number
}

/** Parse Big Five personality from agent config string. Returns null if not configured. */
export function parsePersonality(config: string | null): ParsedPersonality | null {
  if (!config) return null
  try {
    const parsed = JSON.parse(config)
    const p = parsed?.persona?.personality
    if (!p) return null
    return {
      extraversion: p.extraversion ?? 0.5,
      agreeableness: p.agreeableness ?? 0.5,
      openness: p.openness ?? 0.5,
      conscientiousness: p.conscientiousness ?? 0.5,
      neuroticism: p.neuroticism ?? 0.5,
    }
  } catch { return null }
}

// --- Propensity Calculation ---

/**
 * Calculate how likely an agent is to initiate a meeting based on Big Five traits.
 * Extraversion dominates (0.6), agreeableness (0.3), openness (0.1).
 * Accepts raw config string (parses once) or pre-parsed personality.
 */
export function calculatePropensity(config: string | null, personality?: ParsedPersonality | null): number {
  const p = personality !== undefined ? personality : parsePersonality(config)
  if (!p) return 0.3 // Default moderate propensity
  return p.extraversion * 0.6 + p.agreeableness * 0.3 + p.openness * 0.1
}

// --- Partner Selection ---

/**
 * Score potential meeting partners using 5-factor weighted system:
 *   trust (0.3) + compatibility (0.2) + proximity (0.2) + novelty (0.2) + jitter (0.1)
 *
 * Accepts pre-parsed personalities to avoid repeated JSON.parse in hot loops.
 */
export function scorePartner(
  db: Database.Database,
  initiator: AgentForMeeting,
  candidate: AgentForMeeting,
  initiatorPos: AgentPositionRow | null,
  candidatePos: AgentPositionRow | null,
  initPersonality?: ParsedPersonality | null,
  candPersonality?: ParsedPersonality | null,
): number {
  // 1. Trust score (0-1)
  const trust = getPairwiseTrust(db, initiator.id, candidate.id)
  const trustScore = trust.trust_score

  // 2. Social compatibility — compare Big Five similarity
  const initP = initPersonality !== undefined ? initPersonality : parsePersonality(initiator.config)
  const candP = candPersonality !== undefined ? candPersonality : parsePersonality(candidate.config)
  let compatibility = 0.5
  if (initP && candP) {
    const traits = ['extraversion', 'agreeableness', 'openness', 'conscientiousness'] as const
    let totalDiff = 0
    for (const trait of traits) {
      totalDiff += Math.abs(initP[trait] - candP[trait])
    }
    compatibility = 1 - (totalDiff / traits.length)
  }

  // 3. Proximity (based on current positions)
  let proximity = 0.5
  if (initiatorPos && candidatePos) {
    const dist = Math.hypot(initiatorPos.x - candidatePos.x, initiatorPos.y - candidatePos.y)
    proximity = Math.max(0, 1 - dist / 80)
  }

  // 4. Novelty — fewer recent interactions = higher novelty
  const recentMeetings = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_meetings
    WHERE workspace_id = ?
      AND ((initiator_id = ? AND participant_id = ?) OR (initiator_id = ? AND participant_id = ?))
      AND created_at > unixepoch() - 3600
  `).get(initiator.workspace_id, initiator.id, candidate.id, candidate.id, initiator.id) as { cnt: number }
  const novelty = Math.max(0, 1 - recentMeetings.cnt * 0.3)

  // 5. Jitter — small random factor to prevent deterministic cliques
  const jitter = Math.random()

  return trustScore * 0.3 + compatibility * 0.2 + proximity * 0.2 + novelty * 0.2 + jitter * 0.1
}

/**
 * Find the best meeting partner for an agent from available candidates.
 * Batch-loads positions and pre-parses personalities for O(1) lookup in scoring loop.
 */
export function selectPartner(
  db: Database.Database,
  initiator: AgentForMeeting,
): { partner: AgentForMeeting; score: number } | null {
  // Get all idle agents in the same workspace (excluding self)
  const candidates = db.prepare(`
    SELECT id, name, role, status, soul_content, config, workspace_id
    FROM agents
    WHERE workspace_id = ? AND id != ? AND status = 'idle'
  `).all(initiator.workspace_id, initiator.id) as AgentForMeeting[]

  // Filter out agents already in active meetings
  const inMeeting = db.prepare(`
    SELECT initiator_id, participant_id FROM agent_meetings
    WHERE workspace_id = ? AND status IN ('walking', 'conversing', 'summarizing')
  `).all(initiator.workspace_id) as Array<{ initiator_id: number; participant_id: number }>

  const busyAgentIds = new Set<number>()
  for (const m of inMeeting) {
    busyAgentIds.add(m.initiator_id)
    busyAgentIds.add(m.participant_id)
  }

  const available = candidates.filter((c) => !busyAgentIds.has(c.id))
  if (available.length === 0) return null

  // Batch-load ALL positions for workspace in one query (C3 fix)
  const allPositions = getWorkspacePositions(db, initiator.workspace_id)
  const posMap = new Map(allPositions.map((p) => [p.agent_id, p]))

  // Parse initiator personality once (C4 fix)
  const initPersonality = parsePersonality(initiator.config)

  let bestPartner: AgentForMeeting | null = null
  let bestScore = -1

  for (const candidate of available) {
    const candPersonality = parsePersonality(candidate.config)
    const score = scorePartner(
      db, initiator, candidate,
      posMap.get(initiator.id) ?? null,
      posMap.get(candidate.id) ?? null,
      initPersonality, candPersonality,
    )
    if (score > bestScore) {
      bestScore = score
      bestPartner = candidate
    }
  }

  if (!bestPartner) return null
  return { partner: bestPartner, score: bestScore }
}

// --- Meeting Lifecycle ---

/**
 * Check if an agent can initiate a meeting (cooldown + concurrent limits).
 */
export function canInitiateMeeting(db: Database.Database, agentId: number, workspaceId: number): boolean {
  // Check agent availability (skip busy agents)
  const agent = db.prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string } | undefined
  if (agent && agent.status === 'busy') return false

  // Check cooldown
  const lastConcluded = db.prepare(`
    SELECT concluded_at FROM agent_meetings
    WHERE workspace_id = ?
      AND (initiator_id = ? OR participant_id = ?)
      AND status = 'concluded'
    ORDER BY concluded_at DESC LIMIT 1
  `).get(workspaceId, agentId, agentId) as { concluded_at: number } | undefined

  if (lastConcluded) {
    const elapsed = Math.floor(Date.now() / 1000) - lastConcluded.concluded_at
    if (elapsed < MEETING_COOLDOWN_S) return false
  }

  // Check agent not already in a meeting
  const activeMeeting = db.prepare(`
    SELECT id FROM agent_meetings
    WHERE workspace_id = ?
      AND (initiator_id = ? OR participant_id = ?)
      AND status IN ('walking', 'conversing', 'summarizing')
    LIMIT 1
  `).get(workspaceId, agentId, agentId) as { id: number } | undefined

  if (activeMeeting) return false

  // Check workspace concurrent meeting limit
  const concurrent = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_meetings
    WHERE workspace_id = ? AND status IN ('walking', 'conversing', 'summarizing')
  `).get(workspaceId) as { cnt: number }

  return concurrent.cnt < MAX_CONCURRENT_MEETINGS
}

/**
 * Create a new meeting between two agents.
 * Calculates meeting point (midpoint between agents) and generates topic.
 */
export function createMeeting(
  db: Database.Database,
  initiator: AgentForMeeting,
  participant: AgentForMeeting,
): MeetingRow {
  // Determine max turns based on traits (parse BEFORE tx)
  const initParsed = initiator.config ? JSON.parse(initiator.config) : {}
  const partParsed = participant.config ? JSON.parse(participant.config) : {}
  const initC = initParsed?.persona?.personality?.conscientiousness ?? 0.5
  const partC = partParsed?.persona?.personality?.conscientiousness ?? 0.5
  const avgConscient = (initC + partC) / 2
  // Higher conscientiousness = longer meetings (4-8 turns)
  const maxTurns = Math.round(4 + avgConscient * 4)

  // All DB writes in a single transaction (busy-agent check is atomic inside tx)
  const result = writeTransaction(db, (tx) => {
    // Atomic busy-agent check inside transaction to prevent race condition
    const agent = tx.prepare('SELECT status FROM agents WHERE id = ?').get(initiator.id) as { status: string } | undefined
    if (agent && agent.status === 'busy') return { created: false as const, reason: 'busy' }

    const initPos = tx.prepare(
      'SELECT x, y FROM agent_office_positions WHERE agent_id = ?'
    ).get(initiator.id) as { x: number; y: number } | undefined

    const partPos = tx.prepare(
      'SELECT x, y FROM agent_office_positions WHERE agent_id = ?'
    ).get(participant.id) as { x: number; y: number } | undefined

    // Meeting location = midpoint, clamped to walkable area
    const lx = initPos && partPos ? Math.round((initPos.x + partPos.x) / 2) : 40
    const ly = initPos && partPos ? Math.round((initPos.y + partPos.y) / 2) : 50

    const now = Math.floor(Date.now() / 1000)
    const result = tx.prepare(`
      INSERT INTO agent_meetings (workspace_id, initiator_id, participant_id, status, location_x, location_y, max_turns, started_at, created_at)
      VALUES (?, ?, ?, 'walking', ?, ?, ?, ?, ?)
    `).run(initiator.workspace_id, initiator.id, participant.id, lx, ly, maxTurns, now, now)

    const meetingId = Number(result.lastInsertRowid)

    // Set target positions inside tx (inline the writes, skip broadcasts)
    initializeAgentPosition(tx, initiator.id, initiator.workspace_id)
    tx.prepare(
      'UPDATE agent_office_positions SET target_x = ?, target_y = ?, updated_at = unixepoch() WHERE agent_id = ?'
    ).run(lx, ly, initiator.id)

    initializeAgentPosition(tx, participant.id, participant.workspace_id)
    tx.prepare(
      'UPDATE agent_office_positions SET target_x = ?, target_y = ?, updated_at = unixepoch() WHERE agent_id = ?'
    ).run(lx, ly, participant.id)

    const m = tx.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(meetingId) as MeetingRow
    return { created: true as const, meeting: m, locX: lx, locY: ly }
  })

  if (!result.created) {
    throw new Error(`Cannot create meeting: ${result.reason}`)
  }

  const { meeting, locX, locY } = result

  // Broadcasts AFTER transaction commits
  eventBus.broadcast('office.position.updated', {
    workspace_id: initiator.workspace_id, agent_id: initiator.id, target_x: locX, target_y: locY,
  })
  eventBus.broadcast('office.position.updated', {
    workspace_id: participant.workspace_id, agent_id: participant.id, target_x: locX, target_y: locY,
  })
  eventBus.broadcast('meeting.started', {
    meeting_id: meeting.id,
    workspace_id: initiator.workspace_id,
    initiator_id: initiator.id,
    participant_id: participant.id,
    initiator_name: initiator.name,
    participant_name: participant.name,
    location_x: locX,
    location_y: locY,
    max_turns: meeting.max_turns,
  })

  logger.info(
    { meetingId: meeting.id, initiator: initiator.name, participant: participant.name },
    'Meeting created'
  )

  return meeting
}

/**
 * Create a scheduled meeting between two agents.
 * Scheduled meetings wait for the simulation engine to pick them up at P0 priority.
 */
export function createScheduledMeeting(
  db: Database.Database,
  initiatorId: number,
  participantId: number,
  workspaceId: number,
  topic?: string,
  scheduledFor?: number,
  recurringIntervalMs?: number,
): MeetingRow {
  if (recurringIntervalMs !== null && recurringIntervalMs !== undefined) {
    if (typeof recurringIntervalMs !== 'number' || recurringIntervalMs < 60000) {
      logger.warn({ recurringIntervalMs }, 'Invalid recurring_interval_ms, ignoring')
      recurringIntervalMs = null as unknown as undefined
    }
  }

  const initiator = db.prepare(
    'SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?'
  ).get(initiatorId) as AgentForMeeting | undefined
  const participant = db.prepare(
    'SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?'
  ).get(participantId) as AgentForMeeting | undefined

  if (!initiator || !participant) throw new Error('Agent not found')
  if (initiator.workspace_id !== workspaceId || participant.workspace_id !== workspaceId) {
    throw new Error('Agents must be in same workspace')
  }

  const scheduled = db.prepare(
    `SELECT COUNT(*) as cnt FROM agent_meetings WHERE workspace_id = ? AND status = 'scheduled'`
  ).get(workspaceId) as { cnt: number }
  if (scheduled.cnt >= 5) throw new Error('Maximum scheduled meetings reached')

  const now = Math.floor(Date.now() / 1000)
  const meeting = writeTransaction(db, (tx) => {
    const result = tx.prepare(`
      INSERT INTO agent_meetings (workspace_id, initiator_id, participant_id, status, topic, max_turns, scheduled_for, recurring_interval_ms, created_at)
      VALUES (?, ?, ?, 'scheduled', ?, 6, ?, ?, ?)
    `).run(workspaceId, initiatorId, participantId, topic || null, scheduledFor || null, recurringIntervalMs || null, now)
    return tx.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(Number(result.lastInsertRowid)) as MeetingRow
  })

  eventBus.broadcast('meeting.scheduled', {
    meeting_id: meeting.id,
    workspace_id: workspaceId,
    initiator_id: initiatorId,
    participant_id: participantId,
    initiator_name: initiator.name,
    participant_name: participant.name,
    topic: topic || null,
    scheduled_for: scheduledFor || null,
  })

  logger.info({ meetingId: meeting.id, initiator: initiator.name, participant: participant.name }, 'Meeting scheduled')
  return meeting
}

// --- Position Management ---

/**
 * Initialize or upsert an agent's office position.
 */
export function initializeAgentPosition(
  db: Database.Database,
  agentId: number,
  workspaceId: number,
  zone?: string,
): void {
  const existing = db.prepare(
    'SELECT agent_id FROM agent_office_positions WHERE agent_id = ?'
  ).get(agentId) as { agent_id: number } | undefined

  if (existing) return // Already initialized

  // Pick a position based on zone
  const positions = ZONE_POSITIONS[zone || 'general'] || ZONE_POSITIONS.general
  const pos = positions[agentId % positions.length]

  // Add small jitter to avoid exact overlap
  const jitterX = (agentId * 7) % 5 - 2
  const jitterY = (agentId * 11) % 5 - 2

  db.prepare(`
    INSERT OR IGNORE INTO agent_office_positions (agent_id, workspace_id, x, y, zone, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(agentId, workspaceId, pos.x + jitterX, pos.y + jitterY, zone || 'general')
}

/**
 * Set an agent's target position (they will walk there).
 */
export function setAgentTargetPosition(
  db: Database.Database,
  agentId: number,
  workspaceId: number,
  targetX: number,
  targetY: number,
): void {
  // Ensure position row exists first
  initializeAgentPosition(db, agentId, workspaceId)

  db.prepare(`
    UPDATE agent_office_positions
    SET target_x = ?, target_y = ?, updated_at = unixepoch()
    WHERE agent_id = ?
  `).run(targetX, targetY, agentId)

  eventBus.broadcast('office.position.updated', {
    workspace_id: workspaceId,
    agent_id: agentId,
    target_x: targetX,
    target_y: targetY,
  })
}

/**
 * Mark agent as having arrived at target (clear target, update current position).
 */
export function arriveAtTarget(db: Database.Database, agentId: number): void {
  const pos = db.prepare(
    'SELECT * FROM agent_office_positions WHERE agent_id = ?'
  ).get(agentId) as AgentPositionRow | undefined

  if (!pos || pos.target_x == null || pos.target_y == null) return

  db.prepare(`
    UPDATE agent_office_positions
    SET x = target_x, y = target_y, target_x = NULL, target_y = NULL, updated_at = unixepoch()
    WHERE agent_id = ?
  `).run(agentId)
}

/**
 * Get all agent positions for a workspace.
 */
export function getWorkspacePositions(db: Database.Database, workspaceId: number): AgentPositionRow[] {
  return db.prepare(
    'SELECT * FROM agent_office_positions WHERE workspace_id = ?'
  ).all(workspaceId) as AgentPositionRow[]
}

// --- Meeting Conversation ---

/**
 * Check if both agents have "arrived" at the meeting point.
 * For simplicity, we transition to conversing after a fixed walk duration
 * managed by the simulation tick count rather than actual position matching.
 */
export function transitionToConversing(db: Database.Database, meetingId: number): void {
  const meeting = db.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(meetingId) as MeetingRow | undefined
  if (!meeting || meeting.status !== 'walking') return

  db.prepare(`
    UPDATE agent_meetings SET status = 'conversing', started_at = unixepoch() WHERE id = ?
  `).run(meetingId)

  // Arrive both agents at the meeting location
  arriveAtTarget(db, meeting.initiator_id)
  arriveAtTarget(db, meeting.participant_id)

  logger.debug({ meetingId }, 'Meeting transitioned to conversing')
}

/**
 * Generate the next conversation turn for a meeting.
 * Returns true if the turn was generated, false if the meeting should conclude.
 */
export async function generateMeetingTurn(
  db: Database.Database,
  meeting: MeetingRow,
): Promise<boolean> {
  if (meeting.status !== 'conversing') return false
  if (meeting.turn_count >= meeting.max_turns) return false

  // Determine whose turn it is (alternate between initiator and participant)
  const isInitiatorTurn = meeting.turn_count % 2 === 0
  const speakerId = isInitiatorTurn ? meeting.initiator_id : meeting.participant_id
  const listenerId = isInitiatorTurn ? meeting.participant_id : meeting.initiator_id

  // Get agent data
  const speaker = db.prepare(
    'SELECT id, name, role, soul_content, config, workspace_id FROM agents WHERE id = ?'
  ).get(speakerId) as AgentForMeeting | undefined
  const listener = db.prepare(
    'SELECT id, name, role FROM agents WHERE id = ?'
  ).get(listenerId) as { id: number; name: string; role: string } | undefined

  if (!speaker || !listener) return false

  // Build conversation context
  const previousMessages = db.prepare(`
    SELECT mm.content, mm.turn_number, a.name as agent_name
    FROM meeting_messages mm
    JOIN agents a ON mm.agent_id = a.id
    WHERE mm.meeting_id = ?
    ORDER BY mm.turn_number ASC
  `).all(meeting.id) as Array<{ content: string; turn_number: number; agent_name: string }>

  const threadContext = previousMessages
    .map((m) => `${m.agent_name}: ${m.content}`)
    .join('\n')

  // Build system prompt with persona
  const agentConfig = speaker.config ? JSON.parse(speaker.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: speaker.name,
    role: speaker.role,
    soul_content: speaker.soul_content,
    config: agentConfig,
  })

  // Generate topic on first turn
  let topicContext = ''
  if (meeting.topic) {
    topicContext = `The meeting topic is: "${meeting.topic}"\n\n`
  } else if (meeting.turn_count === 0) {
    topicContext = `You decided to have an informal meeting with ${listener.name} (${listener.role}). Start with a natural greeting and bring up something relevant to both your roles.\n\n`
  }

  const turnPrompt = meeting.turn_count === 0
    ? `${topicContext}Start the conversation naturally. Keep it concise (1-3 sentences).`
    : `${topicContext}You are in a meeting with ${listener.name}. Here is the conversation so far:\n\n${threadContext}\n\nContinue the conversation naturally. Keep your response concise (1-3 sentences).`

  let responseText: string
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: turnPrompt },
      ],
      { agentId: speaker.id, workspaceId: speaker.workspace_id, taskType: 'conversation' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('meeting_turn_timeout')), MEETING_TURN_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    responseText = response.text.trim()
  } catch (err) {
    if (err instanceof Error && err.message === 'meeting_turn_timeout') {
      responseText = 'Hmm, let me think about that for a moment...'
      logger.warn({ meetingId: meeting.id, agentId: speaker.id }, 'Meeting turn timed out')
    } else {
      throw err
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  // All DB writes in a single transaction
  const turnNumber = meeting.turn_count + 1
  writeTransaction(db, (tx) => {
    tx.prepare(`
      INSERT INTO meeting_messages (meeting_id, agent_id, content, turn_number, created_at)
      VALUES (?, ?, ?, ?, unixepoch())
    `).run(meeting.id, speaker.id, responseText, turnNumber)

    tx.prepare('UPDATE agent_meetings SET turn_count = ? WHERE id = ?').run(turnNumber, meeting.id)

    if (!meeting.topic && turnNumber === 1) {
      const topic = responseText.slice(0, 100)
      tx.prepare('UPDATE agent_meetings SET topic = ? WHERE id = ?').run(topic, meeting.id)
    }
  })

  // Broadcast AFTER transaction commits
  eventBus.broadcast('meeting.message', {
    meeting_id: meeting.id,
    workspace_id: meeting.workspace_id,
    agent_id: speaker.id,
    agent_name: speaker.name,
    content: responseText,
    turn_number: turnNumber,
  })

  logger.debug({ meetingId: meeting.id, turn: turnNumber, speaker: speaker.name }, 'Meeting turn generated')

  return turnNumber < meeting.max_turns
}

// --- Meeting Summary ---

/**
 * Generate a summary for a concluded meeting and update trust scores.
 */
export async function summarizeMeeting(
  db: Database.Database,
  meeting: MeetingRow,
): Promise<void> {
  // Phase 1: Read data and transition to summarizing (single tx)
  const { messages, initiator } = writeTransaction(db, (tx) => {
    tx.prepare('UPDATE agent_meetings SET status = ? WHERE id = ?').run('summarizing', meeting.id)

    const msgs = tx.prepare(`
      SELECT mm.content, a.name as agent_name
      FROM meeting_messages mm
      JOIN agents a ON mm.agent_id = a.id
      WHERE mm.meeting_id = ?
      ORDER BY mm.turn_number ASC
    `).all(meeting.id) as Array<{ content: string; agent_name: string }>

    const init = tx.prepare(
      'SELECT id, name, role, soul_content, config, workspace_id FROM agents WHERE id = ?'
    ).get(meeting.initiator_id) as AgentForMeeting | undefined

    return { messages: msgs, initiator: init }
  })

  if (messages.length === 0 || !initiator) {
    writeTransaction(db, (tx) => {
      tx.prepare(`
        UPDATE agent_meetings SET status = 'concluded', concluded_at = unixepoch() WHERE id = ?
      `).run(meeting.id)
    })
    return
  }

  // Phase 2: LLM call OUTSIDE transaction
  const transcript = messages.map((m) => `${m.agent_name}: ${m.content}`).join('\n')
  let summary = `Meeting between agents (${messages.length} messages)`
  try {
    const response = await complete(
      [
        { role: 'system', content: 'You are a concise meeting summarizer. Summarize the key points and outcomes.' },
        { role: 'user', content: `Summarize this meeting in 1-2 sentences:\n\n${transcript}` },
      ],
      { agentId: initiator.id, workspaceId: initiator.workspace_id, taskType: 'summarization' }
    )
    summary = response.text.trim()
  } catch (err) {
    logger.warn({ err, meetingId: meeting.id }, 'Meeting summary generation failed, using fallback')
  }

  // Phase 3: All concluding writes in a single transaction
  writeTransaction(db, (tx) => {
    tx.prepare(`
      UPDATE agent_meetings SET status = 'concluded', summary = ?, concluded_at = unixepoch() WHERE id = ?
    `).run(summary, meeting.id)

    updatePairwiseTrust(tx, meeting.initiator_id, meeting.participant_id, 0.05, meeting.workspace_id)
    updatePairwiseTrust(tx, meeting.participant_id, meeting.initiator_id, 0.05, meeting.workspace_id)

    tx.prepare('UPDATE agent_office_positions SET target_x = NULL, target_y = NULL WHERE agent_id IN (?, ?)').run(
      meeting.initiator_id, meeting.participant_id
    )
  })

  // Phase 4: Async side-effects (observations) — non-critical
  try {
    await observe(meeting.initiator_id, `Had a meeting: ${summary.slice(0, 150)}`, meeting.workspace_id)
  } catch { /* memory not available */ }
  try {
    await observe(meeting.participant_id, `Had a meeting: ${summary.slice(0, 150)}`, meeting.workspace_id)
  } catch { /* memory not available */ }

  // Phase 4b: Extract action items (async, non-critical)
  if (messages.length >= 3) {
    try {
      const { extractMeetingActions } = await import('@/lib/meeting-actions')
      const participantAgent = db.prepare('SELECT name FROM agents WHERE id = ?').get(meeting.participant_id) as { name: string } | undefined
      const actions = await extractMeetingActions({
        transcript,
        summary,
        participants: [
          { id: meeting.initiator_id, name: initiator.name },
          { id: meeting.participant_id, name: participantAgent?.name || 'Unknown' },
        ],
        workspaceId: meeting.workspace_id,
      })

      if (actions.length > 0) {
        for (const action of actions) {
          try {
            db.prepare(`
              INSERT INTO tasks (title, description, assigned_to, status, priority, source_type, source_id, workspace_id, created_at, updated_at)
              VALUES (?, ?, ?, 'inbox', 'medium', 'meeting', ?, ?, unixepoch(), unixepoch())
            `).run(action.title, action.description, action.assignee_name, meeting.id, meeting.workspace_id)
          } catch (err) {
            logger.warn({ meetingId: meeting.id, error: String(err) }, 'Failed to create task from meeting action')
          }
        }

        eventBus.broadcast('meeting.actions_created', {
          meeting_id: meeting.id,
          workspace_id: meeting.workspace_id,
          actions: actions.map(a => ({ title: a.title, assignee_name: a.assignee_name })),
        })
      }
    } catch (err) {
      logger.warn({ err, meetingId: meeting.id }, 'Action extraction failed')
    }
  } else if (messages.length > 0) {
    // Short meetings (< 3 messages): create a simple follow-up task
    try {
      const taskTitle = meeting.topic || messages[0].content.slice(0, 100)
      db.prepare(`
        INSERT INTO tasks (title, description, assigned_to, status, priority, source_type, source_id, workspace_id, created_at, updated_at)
        VALUES (?, ?, ?, 'inbox', 'low', 'meeting', ?, ?, unixepoch(), unixepoch())
      `).run(taskTitle, summary, initiator.name, meeting.id, meeting.workspace_id)
    } catch (err) {
      logger.warn({ meetingId: meeting.id, error: String(err) }, 'Failed to create task from short meeting')
    }
  }

  // Phase 4c: Quality evaluation (async, non-critical)
  try {
    const { evaluateMeetingQuality } = await import('@/lib/meeting-quality')
    const quality = await evaluateMeetingQuality(transcript, summary, meeting.initiator_id, meeting.workspace_id)
    db.prepare('UPDATE agent_meetings SET quality_score = ? WHERE id = ?').run(JSON.stringify(quality), meeting.id)

    const avg = (quality.coherence + quality.actionability + quality.role_adherence) / 3
    if (avg < 2.5) {
      const participantName = db.prepare('SELECT name FROM agents WHERE id = ?').get(meeting.participant_id) as { name: string } | undefined
      const reflection = `Recent meeting with ${participantName?.name || 'a colleague'} scored low on quality (${avg.toFixed(1)}/5). Consider being more focused and action-oriented in future meetings.`
      try { await observe(meeting.initiator_id, reflection, meeting.workspace_id) } catch { /* */ }
      try { await observe(meeting.participant_id, reflection, meeting.workspace_id) } catch { /* */ }
    }
  } catch (err) {
    logger.warn({ err, meetingId: meeting.id }, 'Quality evaluation failed')
  }

  // Phase 4d: Schedule recurring follow-up if recurring_interval_ms is set
  if (meeting.recurring_interval_ms && meeting.recurring_interval_ms > 0) {
    try {
      const nextScheduledFor = Math.floor((Date.now() + meeting.recurring_interval_ms) / 1000)
      createScheduledMeeting(
        db,
        meeting.initiator_id,
        meeting.participant_id,
        meeting.workspace_id,
        meeting.topic || undefined,
        nextScheduledFor,
        meeting.recurring_interval_ms,
      )
      logger.info(
        { meetingId: meeting.id, nextScheduledFor, intervalMs: meeting.recurring_interval_ms },
        'Recurring meeting scheduled'
      )
    } catch (err) {
      logger.warn({ err, meetingId: meeting.id }, 'Failed to schedule recurring follow-up')
    }
  }

  // Phase 5: Broadcasts AFTER all writes committed
  eventBus.broadcast('meeting.concluded', {
    meeting_id: meeting.id,
    workspace_id: meeting.workspace_id,
    initiator_id: meeting.initiator_id,
    participant_id: meeting.participant_id,
    summary,
  })

  logger.info({ meetingId: meeting.id, summary: summary.slice(0, 80) }, 'Meeting concluded')
}

// --- Simulation Integration ---

/**
 * P1.25: Process active meeting for an agent (generate next turn or summarize).
 * Returns true if the agent participated in a meeting this tick.
 */
export async function processActiveMeeting(agent: AgentForMeeting): Promise<boolean> {
  const db = getDatabase()

  // Find active meeting this agent is in
  const meeting = db.prepare(`
    SELECT * FROM agent_meetings
    WHERE workspace_id = ?
      AND (initiator_id = ? OR participant_id = ?)
      AND status IN ('walking', 'conversing', 'summarizing')
    LIMIT 1
  `).get(agent.workspace_id, agent.id, agent.id) as MeetingRow | undefined

  if (!meeting) return false

  // Guard: if either participant FK is null (after future SET NULL migration), cancel gracefully
  if (!meeting.initiator_id || !meeting.participant_id) {
    db.prepare("UPDATE agent_meetings SET status = 'concluded', summary = 'Meeting cancelled (participant removed)', concluded_at = unixepoch() WHERE id = ?").run(meeting.id)
    eventBus.broadcast('meeting.concluded', { meeting_id: meeting.id, workspace_id: meeting.workspace_id, initiator_id: meeting.initiator_id, participant_id: meeting.participant_id, summary: 'Meeting cancelled (participant removed)' })
    return false
  }

  const now = Math.floor(Date.now() / 1000)

  // Walking phase: transition to conversing after creation (simulate walk time via tick delay)
  if (meeting.status === 'walking') {
    const walkElapsed = now - (meeting.started_at || meeting.created_at)
    // Walk for at least 3 seconds to let animation play
    if (walkElapsed >= 3) {
      transitionToConversing(db, meeting.id)
    }
    // Safety: if stuck walking for > 30s, force transition
    if (walkElapsed > 30) {
      logger.warn({ meetingId: meeting.id }, 'Meeting stuck in walking, force transitioning')
      transitionToConversing(db, meeting.id)
    }
    return true // Agent is busy walking
  }

  // Conversing phase: generate next turn
  if (meeting.status === 'conversing') {
    if (meeting.turn_count >= meeting.max_turns) {
      await summarizeMeeting(db, meeting)
      return true
    }

    // Only one agent generates per tick (the one whose turn it is)
    const isMyTurn = meeting.turn_count % 2 === 0
      ? agent.id === meeting.initiator_id
      : agent.id === meeting.participant_id

    if (!isMyTurn) return true // Still in meeting, but waiting for partner's turn

    const hasMore = await generateMeetingTurn(db, meeting)
    if (!hasMore) {
      await summarizeMeeting(db, meeting)
    }
    return true
  }

  // Summarizing phase: another agent triggered summarization. Check for stuck timeout.
  if (meeting.status === 'summarizing') {
    const summarizeStarted = meeting.concluded_at || meeting.started_at || meeting.created_at
    const stuckDuration = now - summarizeStarted
    if (stuckDuration > 30) {
      logger.warn({ meetingId: meeting.id, stuckDuration }, 'Meeting stuck in summarizing, force-concluding')
      writeTransaction(db, (tx) => {
        tx.prepare(`
          UPDATE agent_meetings SET status = 'concluded', summary = 'Meeting concluded (timeout)', concluded_at = unixepoch() WHERE id = ? AND status = 'summarizing'
        `).run(meeting.id)
        tx.prepare('UPDATE agent_office_positions SET target_x = NULL, target_y = NULL WHERE agent_id IN (?, ?)').run(
          meeting.initiator_id, meeting.participant_id
        )
      })
      eventBus.broadcast('meeting.concluded', {
        meeting_id: meeting.id,
        workspace_id: meeting.workspace_id,
        initiator_id: meeting.initiator_id,
        participant_id: meeting.participant_id,
        summary: 'Meeting concluded (timeout)',
      })
      return false // Agent freed
    }
    return true // Still waiting for summarization
  }

  return false
}

/**
 * P4: Attempt to initiate a meeting for an idle agent.
 * Returns true if a meeting was initiated.
 */
export async function attemptMeetingInitiation(agent: AgentForMeeting): Promise<boolean> {
  const db = getDatabase()

  // Parse personality once for propensity + partner selection
  const personality = parsePersonality(agent.config)
  const propensity = calculatePropensity(agent.config, personality)
  if (propensity < PROPENSITY_THRESHOLD) return false

  // Random roll against propensity (not every tick)
  if (Math.random() > propensity * 0.3) return false

  // Check cooldown and limits
  if (!canInitiateMeeting(db, agent.id, agent.workspace_id)) return false

  // Find a partner (positions batch-loaded + personalities parsed inside)
  const result = selectPartner(db, agent)
  if (!result) return false

  // Create the meeting (positions initialized inside createMeeting's tx)
  createMeeting(db, agent, result.partner)
  return true
}

/**
 * Cancel a meeting (e.g., if an agent goes offline).
 */
export function cancelMeeting(db: Database.Database, meetingId: number): void {
  const meeting = db.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(meetingId) as MeetingRow | undefined
  if (!meeting) return
  if (meeting.status === 'concluded' || meeting.status === 'cancelled') return

  writeTransaction(db, (tx) => {
    tx.prepare(`
      UPDATE agent_meetings SET status = 'cancelled', concluded_at = unixepoch() WHERE id = ?
    `).run(meetingId)

    tx.prepare('UPDATE agent_office_positions SET target_x = NULL, target_y = NULL WHERE agent_id IN (?, ?)').run(
      meeting.initiator_id, meeting.participant_id
    )
  })

  // Broadcast AFTER transaction commits
  eventBus.broadcast('meeting.concluded', {
    meeting_id: meetingId,
    workspace_id: meeting.workspace_id,
    initiator_id: meeting.initiator_id,
    participant_id: meeting.participant_id,
    summary: 'Meeting cancelled',
  })

  logger.info({ meetingId }, 'Meeting cancelled')
}

/**
 * Cancel all active meetings for an agent (called when agent goes offline).
 */
export function cancelAgentMeetings(db: Database.Database, agentId: number, workspaceId: number): void {
  const activeMeetings = db.prepare(`
    SELECT id FROM agent_meetings
    WHERE workspace_id = ?
      AND (initiator_id = ? OR participant_id = ?)
      AND status IN ('walking', 'conversing', 'summarizing')
  `).all(workspaceId, agentId, agentId) as Array<{ id: number }>

  for (const m of activeMeetings) {
    cancelMeeting(db, m.id)
  }
}

// --- Query Helpers ---

/**
 * Get active meetings for a workspace.
 */
export function getActiveMeetings(db: Database.Database, workspaceId: number): MeetingRow[] {
  return db.prepare(`
    SELECT * FROM agent_meetings
    WHERE workspace_id = ? AND status IN ('walking', 'conversing', 'summarizing')
    ORDER BY created_at DESC
  `).all(workspaceId) as MeetingRow[]
}

/**
 * Get meeting with messages.
 */
export function getMeetingDetail(db: Database.Database, meetingId: number): {
  meeting: MeetingRow
  messages: Array<MeetingMessageRow & { agent_name: string }>
} | null {
  const meeting = db.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(meetingId) as MeetingRow | undefined
  if (!meeting) return null

  const messages = db.prepare(`
    SELECT mm.*, a.name as agent_name
    FROM meeting_messages mm
    JOIN agents a ON mm.agent_id = a.id
    WHERE mm.meeting_id = ?
    ORDER BY mm.turn_number ASC
  `).all(meetingId) as Array<MeetingMessageRow & { agent_name: string }>

  return { meeting, messages }
}

/**
 * List meetings with pagination.
 */
export function listMeetings(
  db: Database.Database,
  workspaceId: number,
  options: { status?: string; limit?: number; offset?: number } = {},
): { meetings: Array<MeetingRow & { initiator_name: string; participant_name: string }>; total: number } {
  const { status, limit = 20, offset = 0 } = options

  let whereClause = 'WHERE m.workspace_id = ?'
  const params: unknown[] = [workspaceId]

  if (status) {
    whereClause += ' AND m.status = ?'
    params.push(status)
  }

  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM agent_meetings m ${whereClause}`
  ).get(...params) as { cnt: number }

  const meetings = db.prepare(`
    SELECT m.*, a1.name as initiator_name, a2.name as participant_name
    FROM agent_meetings m
    JOIN agents a1 ON m.initiator_id = a1.id
    JOIN agents a2 ON m.participant_id = a2.id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<MeetingRow & { initiator_name: string; participant_name: string }>

  return { meetings, total: total.cnt }
}
